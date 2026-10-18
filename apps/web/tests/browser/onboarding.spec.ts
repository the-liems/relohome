import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ storageState: { cookies: [], origins: [] } });

const seenKey = "relohome.onboarding.v1.seen";

async function fixture(
  page: Page,
  mode: "blank" | "housing" | "moving" = "blank",
  english = false,
) {
  const writes: string[] = [];
  let catalogReads = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((en) => {
    localStorage.setItem(
      "siu-ui-preferences",
      JSON.stringify({
        theme: en ? "dark" : "light",
        locale: en ? "en" : "vi",
      }),
    );
  }, english);
  const values = {
    from_address: "Cổng A",
    to_address: "Cổng B",
    move_date: "2026-12-30",
    move_time: "09:00",
    pickup_coordinate: { lat: 21, lng: 105.84 },
    destination_coordinate: { lat: 21.01, lng: 105.85 },
  };
  const house = {
    id: "tour-house",
    title: "Căn nhà kiểm thử",
    address: "Cầu Giấy, Hà Nội",
    lat: 21.03,
    lng: 105.8,
    price: { amount: 4500000, currency: "VND", period: "month" },
    area_m2: 30,
    bedrooms: 1,
    bathrooms: 1,
    amenities: [],
  };
  const component = {
    id: "housing:tour",
    task_id: "housing",
    type: "property",
    agent: "property",
    source: "Test",
    source_kind: "live",
    fetched_at: new Date().toISOString(),
    data: {
      candidates: [house],
      area_name: "Hà Nội",
      search_request: { city: "Hà Nội" },
      map_context: {
        scope: "returned_candidates",
        listing_ids: [house.id],
        viewport: { west: 105.79, south: 21.02, east: 105.82, north: 21.05 },
      },
    },
  };
  const thread = {
    id: "th_tour",
    title: "Kiểm tra hướng dẫn",
    revision: 1,
    updated: Date.now() / 1000,
    runs: [],
    messages:
      mode === "blank"
        ? []
        : [
            {
              id: "result",
              role: "assistant",
              created: Date.now() / 1000,
              content: {
                status: "done",
                response: {
                  kind: mode === "housing" ? "ANSWER" : "ASK",
                  text: "Kết quả kiểm thử",
                  questions:
                    mode === "moving"
                      ? [
                          {
                            field: "relocation.move_date",
                            text: "Chọn ngày chuyển",
                          },
                        ]
                      : [],
                  data: {},
                },
                ui: {
                  version: 1,
                  plan_version: 1,
                  components: mode === "housing" ? [component] : [],
                },
              },
            },
          ],
    state: {
      plan: {
        version: 1,
        tasks: [
          { id: "housing", agent: "property", inputs: { city: "Hà Nội" } },
        ],
      },
      task_status: { housing: "done" },
      intake: {
        constraints: { values: mode === "moving" ? values : {} },
        user_confirmed_facts:
          mode === "moving"
            ? Object.fromEntries(
                Object.entries(values).map(([key, value]) => [key, { value }]),
              )
            : {},
      },
      progress: {
        items:
          mode === "housing"
            ? [
                {
                  task_id: "housing",
                  agent: "property",
                  state: "reviewed",
                  task_status: "done",
                  inputs: {},
                  after: [],
                  level: 0,
                },
              ]
            : [],
        totals: {},
      },
      pending: null,
    },
  };
  await page.route("**/web/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace("/web/api", "");
    // These viewport/search endpoints read data via POST; all actual writes stay blocked.
    const searchRead = request.method() === "POST" && [
      "/platform/housing/map",
      "/platform/housing/search",
      "/platform/places/map",
    ].includes(path);
    if (request.method() !== "GET" && !searchRead) {
      writes.push(path);
      return route.fulfill({
        status: 409,
        json: { detail: "Unexpected mutation in guide test" },
      });
    }
    let data: unknown = {};
    if (path === "/session")
      data = {
        id: "onboarding-user",
        name: "Bạn mới",
        email: "new@example.test",
        preferences: {},
      };
    else if (path === "/status")
      data = {
        domains: ["property", "map", "relocation"],
        writes_enabled: false,
      };
    else if (path === "/threads" || path === "/saved") data = [];
    else if (path === "/threads/th_tour") data = thread;
    else if (path === "/moving/services") {
      catalogReads++;
      data = {
        services: [{ service_id: "TEST-TRUCK", name: "Xe tải", requests: [] }],
      };
    } else if (path === "/platform/housing/map")
      data = {
        features: [],
        meta: { mode: "listings", returned_count: 0, truncated: false },
      };
    else if (path === "/platform/housing/search")
      data = { results: [], page: { next_cursor: null } };
    else if (path === "/platform/places/map")
      data = { type: "FeatureCollection", features: [] };
    await route.fulfill({ json: data });
  });
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#edf3ef" },
          },
        ],
      },
    }),
  );
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ body: "", contentType: "text/css" }),
  );
  return { writes, errors, catalogReads: () => catalogReads };
}

async function assertFits(page: Page) {
  const panel = page.locator(".onboarding-content");
  await expect(panel).toBeVisible();
  const rect = await page
    .locator(".onboarding-welcome, .onboarding-card")
    .boundingBox();
  const viewport = page.viewportSize()!;
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function replay(page: Page) {
  // Existing desktop navigation reveals on hover; touch navigation is always visible.
  await page.locator(".header-reveal").hover({ position: { x: 60, y: 4 } });
  await page
    .getByRole("button", { name: /^(Hướng dẫn sử dụng|Usage guide)$/ })
    .click();
}

test("first visit invites once; dismiss, refresh and replay do not send requests", async ({
  page,
}, info) => {
  const { writes, errors } = await fixture(page);
  await page.goto("/ai");
  await expect(
    page.getByRole("dialog", { name: "Làm quen với ReloHome" }),
  ).toBeVisible();
  await assertFits(page);
  await page.screenshot({ path: info.outputPath("welcome.png") });
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    audit.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.getByRole("button", { name: "Để sau", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Hướng dẫn sử dụng" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await replay(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Tìm nhà/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Nói khu vực và ngân sách" }),
  ).toBeFocused();
  await assertFits(page);
  await page.screenshot({ path: info.outputPath("housing-intro.png") });
  await page.getByRole("button", { name: "Tiếp", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Thích điền form? Bắt đầu ở đây" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Quay lại" }).click();
  await expect(
    page.getByRole("heading", { name: "Nói khu vực và ngân sách" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Hướng dẫn sử dụng" }),
  ).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), seenKey)).toBe(
    "1",
  );
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("deep links do not auto-invite; Moving tour leaves form and optional values intact", async ({
  page,
}) => {
  const { writes, errors, catalogReads } = await fixture(page, "moving");
  await page.goto("/ai/th_tour");
  await expect(page.locator('[data-moving-section="locations"]')).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Xe tải", exact: true }),
  ).toBeVisible();
  const beforeTour = catalogReads();
  await replay(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Chuyển đồ/ })
    .click();
  for (const title of [
    "Chốt hai điểm A và B",
    "Chọn lịch và khai đồ cần chuyển",
    "Chọn xe hoặc để ReloHome gợi ý",
    "Xem báo giá trước khi quyết định",
  ]) {
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await assertFits(page);
    await page
      .getByRole("button", {
        name: title.startsWith("Xem báo") ? "Tự thử thôi" : "Tiếp",
        exact: true,
      })
      .click();
  }
  const optional = page.locator(".mv-optional");
  expect(catalogReads()).toBe(beforeTour);
  await expect(optional).not.toHaveAttribute("open");
  await optional.locator("summary").click();
  await page.getByLabel("Mã khuyến mãi", { exact: true }).fill("TEST-PROMO");
  await page
    .getByLabel("Yêu cầu bằng chứng giao hàng", { exact: true })
    .check();
  await page
    .getByLabel("Ghi chú cho tài xế", { exact: true })
    .fill("Cần xe có bửng nâng");
  await optional.locator("summary").click();
  await expect(optional).not.toHaveAttribute("open");
  await expect(
    page.getByLabel("Ghi chú cho tài xế", { exact: true }),
  ).toHaveValue("Cần xe có bửng nâng");
  await optional.locator("summary").click();
  await expect(page.getByLabel("Mã khuyến mãi", { exact: true })).toHaveValue(
    "TEST-PROMO",
  );
  await expect(
    page.getByLabel("Yêu cầu bằng chứng giao hàng", { exact: true }),
  ).toBeChecked();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("Housing result tour targets actual map controls without selecting a home", async ({
  page,
}) => {
  const { writes, errors } = await fixture(page, "housing");
  await page.goto("/ai/th_tour");
  await expect(page.locator('[data-tour="housing-map"]')).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await replay(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Tìm nhà/ })
    .click();
  for (const title of [
    "Khám phá các căn trên bản đồ",
    "Điều chỉnh tiêu chí",
    "Tiếp tục nhắn ngay tại đây",
    "Chọn căn rồi hẹn xem",
  ]) {
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await assertFits(page);
    await expect(page.locator(".onboarding-unavailable")).toHaveCount(0);
    await page
      .getByRole("button", {
        name: title === "Chọn căn rồi hẹn xem" ? "Tự thử thôi" : "Tiếp",
        exact: true,
      })
      .click();
  }
  await expect(page.locator('[data-tour="housing-map"]')).toBeVisible();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("English dark tour, keyboard containment and small viewport", async ({
  page,
}) => {
  const { errors } = await fixture(page, "blank", true);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/ai");
  await expect(
    page.getByRole("dialog", { name: "Get to know ReloHome" }),
  ).toBeVisible();
  await assertFits(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Plan a move/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start with Moving" }),
  ).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest(".onboarding-dialog"),
      ),
    ).toBe(true);
  }
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations.map((item) => item.id)).toEqual([]);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("blocked optional localStorage does not crash onboarding", async ({
  page,
}) => {
  const { errors, writes } = await fixture(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("relohome.onboarding"))
        throw new DOMException("Storage blocked", "SecurityError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/ai");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Đóng hướng dẫn" }).click();
  await replay(page);
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("resumed draft is not interrupted; missing anchors and a route change close safely", async ({
  page,
}) => {
  const { writes, errors } = await fixture(page);
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "siu-draft-onboarding-user-new",
      "Giữ bản nháp của tôi",
    ),
  );
  await page.goto("/ai");
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" }),
  ).toHaveValue("Giữ bản nháp của tôi");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" }).fill("");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await replay(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Tìm nhà/ })
    .click();
  await page
    .locator('.quick-card[data-service="property"]')
    .evaluate((el) => el.remove());
  await page.getByRole("button", { name: "Tiếp", exact: true }).click();
  await expect(page.locator(".onboarding-unavailable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tiếp", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    history.pushState(null, "", "/ai/th_tour");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("a returning browser does not re-invite after the account changes", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/ai");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Đóng hướng dẫn" }).click();
  await page.route("**/web/api/session", (route) =>
    route.fulfill({
      json: {
        id: "another-onboarding-user",
        name: "Người dùng khác",
        email: "other@example.test",
        preferences: {},
      },
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Hướng dẫn sử dụng" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
