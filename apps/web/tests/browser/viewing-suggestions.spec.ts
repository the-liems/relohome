import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function fixture(
  page: Page,
  stage = "selected",
  available = ["property", "relocation", "flight", "map", "roommate"],
  mapBackground = false,
  replyAfterSchedule = false,
) {
  const slot = "2027-02-10T09:00:00+07:00";
  const item: any = {
    listing_id: "viewing-home",
    task_id: "home",
    title: "Phòng hẹn xem",
    status: stage,
    snapshot: {
      address: "12 phố Duy Tân, Cầu Giấy, Hà Nội",
      city: "Hà Nội",
      price_vnd: 4000000,
    },
    viewing: stage === "selected" ? null : { slot },
    landlord:
      stage === "selected"
        ? null
        : { viewing_status: "requested", request_status: "new" },
  };
  const thread: any = {
    id: "th_viewing",
    title: "Tìm phòng Cầu Giấy",
    updated: Date.now() / 1000,
    revision: 1,
    runs: [],
    messages: [],
    state: {
      plan: {
        version: 1,
        tasks: [{ id: "home", agent: "property", inputs: { city: "Hà Nội" } }],
      },
      intake: { user_confirmed_facts: {} },
      viewing: { max_selected: 3, items: [item], slots: [slot] },
    },
  };
  const requests: { path: string; body: any }[] = [];
  if (mapBackground) {
    thread.state.task_status = { home: "done" };
    thread.messages = [
      {
        id: "home-result",
        role: "assistant",
        created: Date.now() / 1000,
        content: {
          status: "done",
          response: { kind: "ANSWER", text: "Kết quả tìm phòng." },
          ui: {
            version: 1,
            plan_version: 1,
            components: [
              {
                id: "home-map",
                task_id: "home",
                type: "property",
                fetched_at: new Date().toISOString(),
                data: {
                  area_name: "Hà Nội",
                  candidates: [],
                  search_request: { city: "Hà Nội" },
                  map_context: {
                    viewport: {
                      west: 105.82,
                      south: 21.02,
                      east: 105.85,
                      north: 21.04,
                    },
                  },
                },
              },
            ],
          },
        },
      },
    ];
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
  }
  let fail = false;
  await page.route("**/web/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/web/api",
      "",
    );
    let data: any = {};
    if (route.request().method() === "POST")
      requests.push({ path, body: route.request().postDataJSON() });
    if (path === "/session")
      data = { id: "viewer", name: "An", preferences: {} };
    else if (path === "/status") data = { domains: available };
    else if (path === "/threads" || path === "/saved") data = [];
    else if (path === "/threads/th_viewing") data = thread;
    else if (path === "/threads/th_viewing/viewings") data = thread.state.viewing;
    else if (path.startsWith("/platform/"))
      data = {
        type: "FeatureCollection",
        features: [],
        results: [],
        page: { returned_count: 0, next_cursor: null },
      };
    else if (path.endsWith("/viewings/schedule")) {
      if (fail)
        return route.fulfill({
          status: 409,
          json: { detail: "Chưa lưu được lịch." },
        });
      Object.assign(item, {
        status: "viewing_scheduled",
        viewing: { slot },
        landlord: { viewing_status: "requested", request_status: "new" },
      });
      if (replyAfterSchedule)
        thread.messages.push({
          id: "saved-appointment",
          role: "assistant",
          created: Date.now() / 1000,
          content: {
            status: "done",
            response: { kind: "ANSWER", text: "Lịch đã được lưu." },
          },
        });
      data = thread.state.viewing;
    } else if (path.endsWith("/viewings/unselect")) {
      thread.state.viewing.items = [];
      data = thread.state.viewing;
    } else if (path.endsWith("/viewings/cancel")) {
      Object.assign(item, {
        status: "selected",
        viewing: null,
        landlord: { viewing_status: "cancelled", request_status: "resolved" },
      });
      data = thread.state.viewing;
    }
    await route.fulfill({ json: data });
  });
  return {
    item,
    requests,
    slot,
    thread,
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}

async function scheduleOne(page: Page, slot: string) {
  await page.getByRole("checkbox", { name: "Đặt lịch cho Phòng hẹn xem", exact: true }).check();
  await page.getByLabel("Giờ xem · Phòng hẹn xem", { exact: true }).selectOption(slot);
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận 1 lịch", exact: true }).click();
}

test("opening and saving viewings preserves the mounted housing map until another service is chosen", async ({
  page,
}, info) => {
  const { requests, slot } = await fixture(
    page,
    "selected",
    ["property", "relocation", "flight", "map", "roommate"],
    true,
    true,
  );
  await page.goto("/ai/th_viewing");
  const map = page.getByRole("region", { name: "Bản đồ nhà ở", exact: true });
  await expect(map).toBeVisible();
  await page
    .locator(".maplibregl-canvas")
    .first()
    .evaluate((el) => {
      el.setAttribute("data-continuity-check", "original-map");
    });
  await page
    .getByRole("button", { name: "Xong, hẹn lịch xem", exact: true })
    .click();
  await expect(map).toBeVisible();
  await expect(
    page.locator('[data-continuity-check="original-map"]'),
  ).toHaveCount(1);
  await scheduleOne(page, slot);
  const preparation = page.getByRole("region", {
    name: "Chuẩn bị cho buổi xem nhà",
    exact: true,
  });
  await expect(preparation).toBeVisible();
  await expect(map).toBeVisible();
  await expect(
    page.locator('[data-continuity-check="original-map"]'),
  ).toHaveCount(1);
  await expect(page.locator(".composer textarea")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("map-retained-after-scheduling.png"),
    fullPage: true,
  });
  await preparation
    .getByRole("button", { name: "Tìm chuyến bay", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Nơi đi", { exact: true }),
  ).toBeVisible();
  await expect(map).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hủy", exact: true })
    .click();
  await expect(map).toBeVisible();
  await page
    .getByRole("button", { name: "Xem nhanh kế hoạch", exact: true })
    .click();
  await page.getByRole("tab", { name: "Xem nhà", exact: true }).click();
  await preparation
    .getByRole("button", { name: "Chuyển đồ", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", {
      name: "Thông tin chuyển đồ",
      exact: true,
    }),
  ).toBeVisible();
  await expect(map).toHaveCount(0);
  expect(requests.filter((r) => r.path.includes("/viewings/schedule"))).toEqual(
    [
      {
        path: "/threads/th_viewing/viewings/schedule",
        body: { listing_id: "viewing-home", slot },
      },
    ],
  );
  expect(
    requests.some(
      (r) => r.path.endsWith("/chat") || r.path.endsWith("/moving/quote"),
    ),
  ).toBe(false);
});

test("saved viewing shows contextual preparation; route form uses that home's address without sending chat", async ({
  page,
}, info) => {
  const { requests, slot } = await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/ai/th_viewing?panel=plan&planTab=viewing");
  const preparation = page.getByRole("region", {
    name: "Chuẩn bị cho buổi xem nhà",
    exact: true,
  });
  await expect(preparation).toHaveCount(0);
  await scheduleOne(page, slot);
  await expect(preparation).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kết quả đặt lịch", exact: true })).toBeFocused();
  await preparation.scrollIntoViewIfNeeded();
  await expect(
    preparation.getByRole("button", { name: "Xem đường đi", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: info.outputPath("immediately-after-scheduling.png"),
    fullPage: true,
  });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(
      await preparation.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  }
  await expect(
    page.getByText("Đã gửi giờ hẹn, chờ chủ nhà xác nhận", { exact: true }),
  ).toBeVisible();
  expect(requests).toEqual([
    {
      path: "/threads/th_viewing/viewings/schedule",
      body: { listing_id: "viewing-home", slot },
    },
  ]);
  await preparation
    .getByRole("button", { name: "Xem đường đi", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Tính đường đi", exact: true });
  await expect(form.getByLabel("Điểm đến", { exact: true })).toHaveValue(
    "12 phố Duy Tân, Cầu Giấy, Hà Nội",
  );
  await expect(form.getByLabel("Thành phố", { exact: true })).toHaveValue(
    "Hà Nội",
  );
  expect(requests).toHaveLength(1);
  await form.getByRole("button", { name: "Hủy", exact: true }).click();
  await page
    .getByRole("button", { name: "Xem nhanh kế hoạch", exact: true })
    .click();
  await page.getByRole("tab", { name: "Xem nhà", exact: true }).click();
  await expect(preparation).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include(".viewing-preparation")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("viewing-preparation.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true }).focus();
  await page
    .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true })
    .click();
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  // Appearance controls sit outside the plan popover and close it by design.
  await page
    .getByRole("button", { name: "Quick plan view", exact: true })
    .click();
  const english = page.getByRole("region", {
    name: "Prepare for your viewing",
    exact: true,
  });
  await expect(
    english.getByRole("button", { name: "Viewing checklist", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 960 });
  expect(
    await english.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await english.scrollIntoViewIfNeeded();
  expect(
    (
      await new AxeBuilder({ page })
        .include(".viewing-preparation")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("viewing-preparation-dark-en.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "VI", exact: true }).focus();
  await page.getByRole("button", { name: "VI", exact: true }).click();
  await page
    .getByRole("button", { name: "Xem nhanh kế hoạch", exact: true })
    .click();
  await page.getByRole("button", { name: "Xong", exact: true }).click();
  await page.getByRole("button", { name: "Hủy lịch & bỏ chọn", exact: true }).click();
  await expect(preparation).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("only enabled services are offered; the guide opens the actual viewing checklist", async ({
  page,
}) => {
  const { requests } = await fixture(page, "viewing_scheduled", ["property"]);
  await page.goto("/ai/th_viewing?panel=plan&planTab=viewing");
  const preparation = page.getByRole("region", {
    name: "Chuẩn bị cho buổi xem nhà",
    exact: true,
  });
  await expect(preparation).toBeVisible();
  await expect(preparation.getByRole("button")).toHaveCount(1);
  await preparation
    .getByRole("button", { name: "Cẩm nang xem phòng", exact: true })
    .click();
  await expect(page).toHaveURL(/\/guides\?article=xem-phong$/);
  await expect(
    page.getByRole("heading", {
      name: "Đi xem phòng: kiểm tra gì ngoài ảnh đăng?",
      exact: true,
    }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
});

test("failed schedule keeps input and no preparation; declined or unsynced appointments never look successful", async ({
  page,
}) => {
  const { item, slot, setFail } = await fixture(page);
  setFail(true);
  await page.goto("/ai/th_viewing?panel=plan&planTab=viewing");
  await scheduleOne(page, slot);
  await expect(page.locator(".bulk-result.failed")).toContainText("Chưa lưu được lịch");
  await page.getByRole("button", { name: "Sửa các lịch chưa gửi", exact: true }).click();
  await expect(page.getByLabel("Giờ xem · Phòng hẹn xem", { exact: true })).toHaveValue(slot);
  await expect(page.locator(".viewing-preparation")).toHaveCount(0);
  for (const landlord of [
    { viewing_status: "declined", request_status: "new" },
    { viewing_status: "requested", request_status: "new", sync: "failed" },
  ]) {
    Object.assign(item, {
      status: "viewing_scheduled",
      viewing: { slot },
      landlord,
    });
    await page.reload();
    await expect(page.locator(".viewing-preparation")).toHaveCount(0);
  }
});

test("a decided home prioritizes moving and roommate services without booking either", async ({
  page,
}) => {
  const { requests } = await fixture(page, "agreed");
  await page.goto("/ai/th_viewing?panel=plan&planTab=viewing");
  const preparation = page.getByRole("region", {
    name: "Chuẩn bị chuyển đến",
    exact: true,
  });
  await expect(preparation).toBeVisible();
  await expect(
    preparation.getByRole("button", { name: "Chuyển đồ", exact: true }),
  ).toBeVisible();
  await expect(
    preparation.getByRole("button", { name: "Ở ghép", exact: true }),
  ).toBeVisible();
  await preparation
    .getByRole("button", { name: "Tìm chuyến bay", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Nơi đi", { exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
});
