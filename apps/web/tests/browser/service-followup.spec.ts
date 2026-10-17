// Local transport fixtures only; selection is not a booking or payment.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function fixture(
  page: Page,
  kind: "flight" | "relocation" | "map",
  next?: string,
) {
  const expires = new Date(Date.now() + 3600000).toISOString();
  const data: any =
    kind === "flight"
      ? {
          origin: "SGN",
          destination: "HAN",
          offers: [
            {
              id: "offer",
              carrier: "Fixture Air",
              fare_vnd: 1000000,
              depart_at: "2027-02-10T09:00:00+07:00",
              arrive_at: "2027-02-10T11:00:00+07:00",
              expires_at: expires,
            },
          ],
        }
      : kind === "relocation"
        ? {
            quote_id: "quote",
            from_address: "1 Duy Tân, Hà Nội",
            to_address: "2 Duy Tân, Hà Nội",
            expires_at: expires,
            route: {
              pickup: { lat: 21.03, lng: 105.82 },
              destination: { lat: 21.04, lng: 105.83 },
              geometry: {
                type: "LineString",
                coordinates: [
                  [105.82, 21.03],
                  [105.83, 21.04],
                ],
              },
            },
            quotes: [
              {
                id: "offer",
                vehicle: "Xe van",
                service_id: "VAN",
                price_vnd: 200000,
                distance_km: 2,
              },
            ],
          }
        : {
            routing: {
              profile: "walking",
              origin: { lat: 21.03, lng: 105.82 },
              destination: { lat: 21.04, lng: 105.83 },
              route: {
                distance_meters: 2000,
                duration_seconds: 1200,
                geometry: {
                  type: "LineString",
                  coordinates: [
                    [105.82, 21.03],
                    [105.83, 21.04],
                  ],
                },
              },
            },
          };
  const pending = next
    ? {
        task_id: `pending:${next}`,
        agent: next,
        state: "waiting",
        task_status: "needs_input",
        inputs: {},
        chosen: null,
      }
    : null;
  const thread: any = {
    id: "th_followup",
    title: "Kiểm tra bước tiếp theo",
    updated: Date.now() / 1000,
    revision: 1,
    runs: [],
    messages: [
      {
        id: "answer",
        role: "assistant",
        created: Date.now() / 1000,
        content: {
          status: "done",
          response: { kind: "ANSWER", text: "Kết quả dịch vụ." },
          ui: {
            version: 1,
            plan_version: 1,
            components: [
              {
                id: "result",
                task_id: "current",
                type: kind,
                fetched_at: new Date().toISOString(),
                data,
              },
            ],
          },
        },
      },
    ],
    state: {
      plan: { version: 1, tasks: [{ id: "current", agent: kind, inputs: {} }] },
      task_status: { current: "done" },
      intake: { user_confirmed_facts: {} },
      progress: {
        items: [
          {
            task_id: "current",
            agent: kind,
            state: "reviewed",
            task_status: "done",
            inputs: {},
            chosen: null,
          },
          ...(pending ? [pending] : []),
        ],
      },
    },
  };
  const posts: any[] = [];
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "bg",
            type: "background",
            paint: { "background-color": "#edf3ef" },
          },
        ],
      },
    }),
  );
  await page.route("**/web/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/web/api",
      "",
    );
    let body: any = {};
    // Routing uses a read-only POST for the map preview; only count mutations here.
    if (
      route.request().method() === "POST" &&
      path !== "/platform/routes/entities"
    )
      posts.push({ path, body: route.request().postDataJSON() });
    if (path === "/session")
      body = { id: "tester", name: "An", preferences: {} };
    else if (path === "/status")
      body = {
        domains: ["property", "flight", "relocation", "map", "roommate"],
        writes_enabled: false,
      };
    else if (path === "/threads" || path === "/saved") body = [];
    else if (path === "/threads/th_followup") body = thread;
    else if (path === "/threads/th_followup/action") {
      const selected = route.request().postDataJSON();
      thread.state.intake.user_confirmed_facts[`selected:${kind}`] = {
        value: selected.entity_id,
      };
      Object.assign(thread.state.progress.items[0], {
        state: "confirmed",
        chosen: { id: selected.entity_id, label: "Phương án kiểm thử" },
      });
      body = thread;
    } else if (path === "/roommate/availability")
      body = { enabled: false, demo_enabled: false };
    else if (path.startsWith("/platform/"))
      body = {
        type: "FeatureCollection",
        features: [],
        results: [],
        page: { returned_count: 0, next_cursor: null },
      };
    await route.fulfill({ json: body });
  });
  return { thread, posts };
}

test("moving selection stays on its map and offers a correctly named Roommate step with no extra writes", async ({
  page,
}) => {
  const f = await fixture(page, "relocation", "roommate");
  await page.goto("/ai/th_followup");
  const map = page.getByRole("region", {
    name: "Bản đồ chuyển đồ",
    exact: true,
  });
  await expect(map).toBeVisible();
  await page
    .getByRole("button", { name: "Chọn phương án", exact: true })
    .click();
  const step = page.getByRole("region", {
    name: "Bước tiếp theo trong kế hoạch",
    exact: true,
  });
  const next = step.getByRole("button", {
    name: "Bước tiếp theo: Ở ghép",
    exact: true,
  });
  await expect(next).toBeVisible();
  await expect(map).toBeVisible();
  expect(f.posts).toHaveLength(1);
  expect(f.posts[0]).toMatchObject({
    path: "/threads/th_followup/action",
    body: { kind: "select", task_id: "current", entity_id: "offer" },
  });
  await next.click();
  await expect(page).toHaveURL(/\/roommate$/);
  expect(f.posts).toHaveLength(1);
});

test("a completed route offers the actual next Flight form without a detour through chat", async ({
  page,
}) => {
  const f = await fixture(page, "map", "flight");
  await page.goto("/ai/th_followup");
  await expect(page.locator(".service-map-result")).toBeVisible();
  const map = page.locator(".service-map-result .maplibregl-canvas");
  await expect(map).toBeVisible();
  await map.evaluate((el) => el.setAttribute("data-followup-map", "original"));
  const next = page.getByRole("button", {
    name: "Bước tiếp theo: Chuyến bay",
    exact: true,
  });
  await expect(next).toBeVisible();
  await expect(page.locator('[data-followup-map="original"]')).toHaveCount(1);
  await next.click();
  await expect(
    page.getByRole("dialog").getByLabel("Nơi đi", { exact: true }),
  ).toBeVisible();
  expect(f.posts).toHaveLength(0);
});

test("a single selected flight offers optional forms, preserves results and never invents a goal", async ({
  page,
}, info) => {
  const f = await fixture(page, "flight");
  await page.goto("/ai/th_followup");
  const results = page.getByRole("region", { name: "Chuyến bay", exact: true });
  await results
    .getByRole("button", { name: "Chọn chuyến này", exact: true })
    .click();
  await expect(results).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Bước tiếp theo trong kế hoạch",
      exact: true,
    }),
  ).toHaveCount(0);
  const suggestion = page.getByRole("region", {
    name: "Gợi ý dịch vụ liên quan",
    exact: true,
  });
  await expect(
    suggestion.getByRole("button", { name: "Tìm chỗ ở", exact: true }),
  ).toBeVisible();
  await suggestion
    .getByRole("button", { name: "Tìm chỗ ở", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Thành phố", { exact: true }),
  ).toBeVisible();
  await expect(results).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hủy", exact: true })
    .click();
  await expect(
    suggestion.getByRole("button", { name: "Tìm chỗ ở", exact: true }),
  ).toBeFocused();
  await suggestion
    .getByRole("button", { name: "Xem đường đi", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Tính đường đi", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hủy", exact: true })
    .click();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(
      await suggestion.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .include(".service-suggestions")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("flight-optional-suggestions.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true }).focus();
  await page
    .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true })
    .click();
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  const english = page.getByRole("region", {
    name: "Related service suggestions",
    exact: true,
  });
  await expect(
    english.getByRole("button", { name: "Find a place to stay", exact: true }),
  ).toBeVisible();
  await expect(
    english.getByRole("button", { name: "View directions", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 960 });
  expect(
    await english.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .include(".service-suggestions")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("flight-suggestions-dark-en.png"),
    fullPage: true,
  });
  expect(f.posts).toHaveLength(1);
  expect(f.thread.state.plan.tasks).toHaveLength(1);
});

test("single moving service suggests a route with the selected quote's addresses and an actual guide", async ({
  page,
}) => {
  const f = await fixture(page, "relocation");
  await page.goto("/ai/th_followup");
  await expect(page.locator(".service-suggestions")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Chọn phương án", exact: true })
    .click();
  await expect(page.locator(".plan-next-step")).toHaveCount(0);
  await page
    .locator(".service-suggestions")
    .getByRole("button", { name: "Xem đường đi", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Tính đường đi", exact: true });
  await expect(form.getByLabel("Điểm đi", { exact: true })).toHaveValue(
    "1 Duy Tân, Hà Nội",
  );
  await expect(form.getByLabel("Điểm đến", { exact: true })).toHaveValue(
    "2 Duy Tân, Hà Nội",
  );
  await expect(
    page.getByRole("region", { name: "Bản đồ chuyển đồ", exact: true }),
  ).toBeVisible();
  await form.getByRole("button", { name: "Hủy", exact: true }).click();
  await page
    .locator(".service-suggestions")
    .getByRole("button", { name: "Cẩm nang nhận phòng", exact: true })
    .click();
  await expect(page).toHaveURL(/\/guides\?article=nhan-phong$/);
  expect(f.posts).toHaveLength(1);
});

test("single route shows optional suggestions; disabled services are filtered and failed routes do not imply completion", async ({
  page,
}) => {
  const f = await fixture(page, "map");
  await page.route("**/web/api/status", (route) =>
    route.fulfill({ json: { domains: ["map"] } }),
  );
  await page.goto("/ai/th_followup");
  const optional = page.locator(".service-suggestions");
  await expect(optional.getByRole("button")).toHaveCount(1);
  await expect(
    optional.getByRole("button", { name: "Cẩm nang xem phòng", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".plan-next-step")).toHaveCount(0);
  f.thread.messages[0].content.ui.components[0].data.routing.route = null;
  await page.reload();
  await expect(optional).toHaveCount(0);
  expect(f.posts).toHaveLength(0);
});

test("guide footer links open actual forms and an unsupported service entry never sends anything", async ({
  page,
}) => {
  const f = await fixture(page, "flight");
  await page.goto("/guides?article=xem-phong");
  await page
    .locator(".service-suggestions")
    .getByRole("link", { name: "Tìm chỗ ở", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Thành phố", { exact: true }),
  ).toBeVisible();
  expect(f.posts).toHaveLength(0);
  await page.goto("/ai?service=unknown");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(f.posts).toHaveLength(0);
});

test("nearby discovery offers optional services only when it has actual place results", async ({
  page,
}) => {
  const f = await fixture(page, "map");
  const result = f.thread.messages[0].content.ui.components[0];
  result.data = {
    nearby: {
      supermarket: [
        {
          id: "poi",
          name: "Địa điểm kiểm thử",
          location: { lat: 21.03, lng: 105.82 },
        },
      ],
    },
  };
  await page.goto("/ai/th_followup");
  await expect(page.locator(".service-suggestions")).toBeVisible();
  result.data.nearby.supermarket = [];
  await page.reload();
  await expect(page.locator(".service-map-result")).toBeVisible();
  await expect(page.locator(".service-suggestions")).toHaveCount(0);
  expect(f.posts).toHaveLength(0);
});

test("accepted Roommate connection offers further services; pending or revoked contact does not", async ({
  page,
}) => {
  const f = await fixture(page, "flight");
  const record: any = {
    request_id: "request",
    direction: "sent",
    available: true,
    state: "accepted",
    grant_state: "active",
    expires_at: "2027-02-10T09:00:00Z",
    actions: [],
  };
  await page.route("**/web/api/roommate/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith("/availability")
        ? { enabled: true, cities: ["hanoi"], terms_version: "1" }
        : path.endsWith("/access")
          ? { eligible: true, terms_version: "1", moderator: false }
          : record,
    });
  });
  await page.goto("/roommate/requests/request");
  await expect(
    page
      .locator(".service-suggestions")
      .getByRole("link", { name: "Cùng tìm chỗ ở", exact: true }),
  ).toBeVisible();
  expect(f.posts).toHaveLength(0);
  await page
    .locator(".service-suggestions")
    .getByRole("link", { name: "Cùng tìm chỗ ở", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Thành phố", { exact: true }),
  ).toBeVisible();
  for (const state of ["pending", "revoked"]) {
    record.state = state;
    record.grant_state = state === "pending" ? null : "revoked";
    await page.goto("/roommate/requests/request");
    await expect(
      page.getByRole("heading", {
        name: "Bản giới thiệu bạn đã gửi",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".service-suggestions")).toHaveCount(0);
  }
  expect(f.posts).toHaveLength(0);
});

test("a flight with a pending route opens its route form only on explicit click", async ({
  page,
}) => {
  const f = await fixture(page, "flight", "map");
  await page.goto("/ai/th_followup");
  const results = page.getByRole("region", { name: "Chuyến bay", exact: true });
  await results
    .getByRole("button", { name: "Chọn chuyến này", exact: true })
    .click();
  await expect(results).toBeVisible();
  await page
    .getByRole("button", { name: "Bước tiếp theo: Đường đi", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Tính đường đi", exact: true })
      .getByLabel("Điểm đến", { exact: true }),
  ).toBeVisible();
  expect(f.posts).toHaveLength(1);
});

test("a current single-service intent uses suggestions while retaining older manual service tabs", async ({page}) => {
  const f = await fixture(page,"flight","map");
  f.thread.state.intake.intent = { domains: ["flight"] };
  await page.goto("/ai/th_followup");
  await page.getByRole("region",{name:"Chuyến bay",exact:true}).getByRole("button",{name:"Chọn chuyến này",exact:true}).click();
  await expect(page.locator(".plan-next-step")).toHaveCount(0);
  await expect(page.locator(".service-suggestions")).toBeVisible();
  await expect(page.getByRole("navigation",{name:"Dịch vụ trong kế hoạch",exact:true})).toBeVisible();
  expect(f.posts).toHaveLength(1);
});

test("single-service chat drops redundant success label but keeps the workspace action", async ({ page }) => {
  const f = await fixture(page, "flight");
  f.thread.messages[0].content.response.text = "Mình có 1 chuyến bay trong lượt này. Bạn mở danh sách để xem giờ bay và giá nhé.";
  await page.goto("/ai/th_followup");
  await page.getByRole("button", { name: "Về hội thoại", exact: true }).click();
  const summary = page.locator(".chat-service-summary");
  await expect(summary).toHaveAttribute("data-service", "flight");
  await expect(summary.locator("span")).toHaveCount(0);
  await expect(summary.getByRole("button", { name: "Xem phương án" })).toBeVisible();
  await expect(page.locator(".assistant-bubble .prose")).toHaveText(f.thread.messages[0].content.response.text);
  await summary.getByRole("button", { name: "Xem phương án" }).click();
  await expect(page.getByRole("region", { name: "Chuyến bay", exact: true })).toBeVisible();
  expect(f.posts).toHaveLength(0);
});

test("multi-service chat keeps domain labels without a blanket success claim", async ({ page }) => {
  const f = await fixture(page, "flight", "map");
  await page.goto("/ai/th_followup");
  await page.getByRole("button", { name: "Về hội thoại", exact: true }).click();
  const summary = page.locator(".chat-service-summary");
  await expect(summary.locator("span")).toHaveText("Chuyến bay");
  await expect(summary).not.toContainText("Có kết quả");
  await expect(page.getByRole("navigation", { name: "Dịch vụ trong kế hoạch", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(summary.locator("span")).toHaveText("Flights");
  expect(f.posts).toHaveLength(0);
});

test("comparison table stays separate from search summaries and preserves service navigation", async ({ page }) => {
  const f = await fixture(page, "flight");
  f.thread.messages[0].content.ui.components.push({
    id: "comparison", task_id: "compare", type: "property", data: {
      comparison: { rows: [{ id: "fixture-home", title: "Căn kiểm thử", rent_vnd: 3000000 }] },
    },
  });
  await page.goto("/ai/th_followup");
  await page.getByRole("button", { name: "Về hội thoại", exact: true }).click();
  await expect(page.locator("#comparison-comparison")).toBeVisible();
  await expect(page.locator(".chat-service-summary")).toHaveCount(1);
  await expect(page.locator(".chat-service-summary span")).toHaveCount(0);
  expect(f.posts).toHaveLength(0);
});
