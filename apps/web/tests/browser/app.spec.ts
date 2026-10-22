import { test, expect, type Page, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { waitForUiMotion } from "./helpers/ui-motion";

async function auditAccessibility(page: Page) {
  await waitForUiMotion(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

// Axe does not detect text painted underneath an icon or another control.
async function assertInputIconSpacing(wrapper: Locator) {
  const layout = await wrapper.evaluate((el) => {
    const input = el.querySelector("input")!;
    const icon = el.querySelector("svg")!;
    const field = input.getBoundingClientRect();
    const symbol = icon.getBoundingClientRect();
    const style = getComputedStyle(input);
    return {
      textStart:
        field.left +
        parseFloat(style.paddingLeft) +
        parseFloat(style.borderLeftWidth),
      iconEnd: symbol.right,
      border: parseFloat(style.borderTopWidth),
      fieldEnd: field.right,
      wrapperEnd: el.getBoundingClientRect().right,
    };
  });
  expect(layout.textStart).toBeGreaterThanOrEqual(layout.iconEnd + 4);
  expect(layout.border).toBe(0);
  expect(layout.fieldEnd).toBeLessThanOrEqual(layout.wrapperEnd + 1);
}

test("layout regression: moving sections, selected home and pickup catalog remain usable without overlapping text", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { thread, turns } = await movingFormFixture(page);
  for (const key of [
    "from_address",
    "to_address",
    "pickup_coordinate",
    "destination_coordinate",
  ]) {
    delete thread.state.intake.constraints.values[key];
    delete thread.state.intake.user_confirmed_facts[key];
  }
  const home = {
    ...houses[0],
    address:
      "325/29A Đường Bạch Đằng, Phường 15, Quận Bình Thạnh, Thành phố Hồ Chí Minh",
  };
  thread.state.intake.user_confirmed_facts["selected:property"] = {
    value: home.id,
  };
  await page.route("**/web/api/housing/listing-a", (route) =>
    route.fulfill({ json: home }),
  );
  await page.route("**/web/api/map/search?**", (route) =>
    route.fulfill({
      json: {
        results: [
          {
            canonical_id: "layout-pickup",
            name: "12 Lê Lợi, Bến Nghé, Quận 1, Hồ Chí Minh",
            entity_type: "place",
            location: { lat: 10.775, lng: 106.697 },
          },
        ],
      },
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: 990 });
    await page.goto("/ai/th_ui");
    const form = page.getByRole("complementary", {
      name: "Thông tin chuyển đồ",
    });
    const navigation = form.getByRole("navigation", {
      name: "Các mục thông tin chuyển đồ",
    });
    await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue(home.address);
    const clippedNavigation = await navigation.evaluate((nav) =>
      [...nav.querySelectorAll("button")]
        .filter((button) => {
          const bounds = button.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(button);
          return [...range.getClientRects()].some(
            (text) =>
              text.left < bounds.left ||
              text.right > bounds.right + 1 ||
              text.top < bounds.top ||
              text.bottom > bounds.bottom + 1,
          );
        })
        .map((button) => button.textContent),
    );
    expect(clippedNavigation).toEqual([]);
    for (const wrapper of await form.locator(".mv-location-input").all())
      await assertInputIconSpacing(wrapper);
    await expect(form.locator(".mv-selected-home")).toContainText(home.address);
    // Every section still has its original fields; navigation only moves the scroll container.
    await navigation
      .getByRole("button", { name: "Lịch chuyển", exact: true })
      .click();
    await expect(form.getByLabel("Ngày chuyển")).toBeInViewport();
    await expect(form.getByLabel("Ngày chuyển")).toHaveValue(tomorrow());
    await navigation
      .getByRole("button", { name: "Hàng hóa", exact: true })
      .click();
    await expect(
      form.getByRole("button", { name: "Thêm kiện hàng" }),
    ).toBeInViewport();
    await form.getByRole("button", { name: "Thêm kiện hàng" }).click();
    await form.getByLabel("Mô tả kiện 1").fill("Bàn làm việc và thùng quần áo");
    await form.getByLabel("Nặng · kg kiện 1").fill("25");
    await navigation
      .getByRole("button", { name: "Giao nhận", exact: true })
      .click();
    if (await form.locator(".mv-optional").getAttribute("open") === null)
      await form.locator(".mv-optional summary").click();
    await form.getByLabel("Yêu cầu bằng chứng giao hàng").scrollIntoViewIfNeeded();
    await expect(
      form.getByLabel("Yêu cầu bằng chứng giao hàng"),
    ).toBeInViewport();
    await form.getByLabel("Yêu cầu bằng chứng giao hàng").check();
    await navigation
      .getByRole("button", { name: "Chọn xe", exact: true })
      .click();
    await expect(
      form.getByText("Chọn điểm lấy để hiển thị gói xe", { exact: true }),
    ).toBeInViewport();
    await form
      .getByRole("button", { name: "Chọn điểm lấy đồ A", exact: true })
      .click();
    await expect(form.getByLabel("Địa chỉ lấy đồ")).toBeFocused();
    await expect(form.getByLabel("Địa chỉ lấy đồ")).toBeInViewport();
    await form.getByLabel("Địa chỉ lấy đồ").fill("12 Lê Lợi");
    await form
      .getByRole("button", {
        name: "12 Lê Lợi, Bến Nghé, Quận 1, Hồ Chí Minh",
        exact: true,
      })
      .click();
    await navigation
      .getByRole("button", { name: "Chọn xe", exact: true })
      .click();
    await selectMovingService(form, "TEST-VAN");
    await expect(form.locator('input[value="TEST-VAN"]')).toBeChecked();
    await navigation
      .getByRole("button", { name: "Hàng hóa", exact: true })
      .click();
    await expect(form.getByLabel("Mô tả kiện 1")).toHaveValue(
      "Bàn làm việc và thùng quần áo",
    );
    await navigation
      .getByRole("button", { name: "Địa điểm", exact: true })
      .click();
    await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue(home.address);
    const top = await page.locator(".moving-booking .ws-top").boundingBox();
    const launcher = page.getByRole("button", { name: "Hiện khung chat" });
    const box = await launcher.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(top!.y + top!.height + 4);
    await launcher.click();
    await assertInputIconSpacing(page.locator(".ws-dock-input"));
    const dock = await page.locator(".ws-dock").boundingBox();
    expect(dock!.y).toBeGreaterThanOrEqual(top!.y + top!.height + 4);
    await page.getByRole("button", { name: "Ẩn khung chat" }).click();
    await page.screenshot({
      path: info.outputPath(`moving-addresses-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  expect(turns).toEqual([]);
  expect(errors).toEqual([]);
});

test("layout regression: flight timeline, housing and history inputs keep separate text and controls", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { thread, component, turns } = await fixture(page);
  const housingPlan = thread.state.plan;
  const housingStatus = thread.state.task_status;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    thread.messages = [];
    thread.state.plan = {
      ...housingPlan,
      tasks: [{ id: "flight", agent: "flight", inputs: { origin: "SGN", destination: "HAN", depart_date: tomorrow() } }],
    };
    thread.state.task_status = { flight: "done" };
    seed(thread, [
      {
        id: "layout-flight",
        type: "flight",
        task_id: "flight",
        data: {
          origin: "SGN",
          destination: "HAN",
          offers: [
            {
              id: "layout-flight",
              carrier:
                "Vietnam Airlines · Vietnam Airlines và đối tác khai thác",
              depart_at: tomorrow() + "T09:00:00+07:00",
              arrive_at: tomorrow() + "T11:00:00+07:00",
              stops: 0,
              fare_vnd: 1700000,
              expires_at: new Date(Date.now() + 86400000).toISOString(),
            },
          ],
        },
      },
    ]);
    await page.goto("/ai/th_ui");
    const timeline = page.locator(".svc-timeline");
    await expect(timeline).toBeVisible();
    const segments = await timeline
      .locator(":scope > span")
      .evaluateAll((items) =>
        items.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      );
    expect(segments[0].right + 4).toBeLessThanOrEqual(segments[1].left);
    expect(segments[1].right + 4).toBeLessThanOrEqual(segments[2].left);
    await page.getByRole("button", { name: "Hiện khung chat" }).click();
    await assertInputIconSpacing(page.locator(".ws-dock-input"));
    await page
      .getByLabel("Tin nhắn cho ReloHome")
      .fill("Đổi ngày bay và thêm một hành khách");
    await page.getByRole("button", { name: "Ẩn khung chat" }).click();
    await page.screenshot({
      path: info.outputPath(`flight-text-${width}.png`),
      fullPage: true,
    });
    thread.messages = [];
    thread.state.plan = housingPlan;
    thread.state.task_status = housingStatus;
    seed(thread, [component]);
    await page.goto("/ai/th_ui");
    await expect(
      page.getByRole("region", { name: "Bản đồ nhà ở", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Hiện khung chat" }).click();
    await assertInputIconSpacing(page.locator(".ws-dock-input"));
    await page.getByRole("button", { name: "Ẩn khung chat" }).click();
    await expect(page.getByRole("button", { name: "Lịch sử", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Mở tài khoản" }).focus();
    await page.getByRole("link", { name: "Mở tài khoản" }).click();
    await assertInputIconSpacing(page.locator(".history-search"));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  expect(errors).toEqual([]);
  expect(turns).toEqual([]);
});

test("production: landmarks, contrast and responsive controls at required widths", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { turns } = await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 800 : 960 });
    await page.goto("/ai");
    await expect(page.locator(".welcome")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    for (const control of await page
      .locator(".header-actions button:visible, .header-actions a:visible")
      .all()) {
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      if (width === 320) {
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
    await auditAccessibility(page);
    await page.getByRole("link", { name: "Mở tài khoản" }).focus();
    await page.getByRole("link", { name: "Mở tài khoản" }).click();
    await expect(
      page.getByRole("tab", { name: "Hồ sơ & bảo mật", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await auditAccessibility(page);
    await page.screenshot({
      path: info.outputPath(`account-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("button", { name: "Switch to dark mode" }).focus();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await auditAccessibility(page);
  await page.goto("/");
  await expect(page.locator(".landing-page")).toBeVisible();
  await auditAccessibility(page);
  await page.screenshot({
    path: info.outputPath("landing-production-dark.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(turns).toEqual([]);
});

test("production: keyboard tabs, native modal focus and readonly flight detail preserve contracts", async ({
  page,
}) => {
  const { thread, turns } = await fixture(page);
  await page.goto("/ai");
  const launcher = page.getByRole("button", { name: /Tìm nhà Một nơi/ });
  await launcher.focus();
  await launcher.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await auditAccessibility(page);
  await dialog.getByRole("button", { name: "Đóng", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(launcher).toBeFocused();
  await page.getByRole("button", { name: "Xem nhanh kế hoạch" }).click();
  const tabs = page.getByRole("tablist", { name: "Nội dung kế hoạch" });
  await tabs.getByRole("tab", { name: "Tiến trình" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Chi phí" })).toBeFocused();
  await expect(tabs.getByRole("tab", { name: "Tiến trình" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(tabs.getByRole("tab", { name: "Chi phí" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await auditAccessibility(page);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Mở tài khoản" }).focus();
  await page.getByRole("link", { name: "Mở tài khoản" }).click();
  const accountTabs = page.getByRole("tablist", { name: "Nội dung tài khoản" });
  await accountTabs
    .getByRole("tab", { name: "Lịch sử yêu cầu", exact: true })
    .focus();
  await page.keyboard.press("End");
  await expect(accountTabs.getByRole("tab", { name: /Đã lưu/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    accountTabs.getByRole("tab", { name: /Đã lưu/ }),
  ).toHaveAttribute("aria-selected", "true");
  expect(turns).toEqual([]);
  thread.state.plan.tasks.push({ id: "flight", agent: "flight", inputs: {} });
  thread.state.task_status = { ...thread.state.task_status, flight: "done" };
  seed(thread, [
    {
      id: "audit-flight",
      type: "flight",
      task_id: "flight",
      data: {
        origin: "SGN",
        destination: "HAN",
        offers: [
          {
            id: "audit-flight",
            carrier: "Vietnam Airlines",
            depart_at: tomorrow() + "T09:00:00+07:00",
            arrive_at: tomorrow() + "T11:00:00+07:00",
            stops: 0,
            fare_vnd: 1700000,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          },
        ],
      },
    },
  ]);
  await page.route("**/web/api/flight/audit-flight", (route) =>
    route.fulfill({
      json: {
        id: "audit-flight",
        carrier: "Vietnam Airlines",
        fare_vnd: 1700000,
        segments: [],
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
    }),
  );
  await page.goto("/ai/th_ui");
  const flight = page.getByRole("button", {
    name: "Xem chuyến bay Vietnam Airlines lúc 09:00",
  });
  await flight.focus();
  await flight.press("Enter");
  await expect(
    page.getByRole("complementary", { name: "Chi tiết hành trình" }),
  ).toBeVisible();
  await auditAccessibility(page);
  expect(turns).toEqual([]);
});

test("production: housing map and moving UI pass accessibility without losing form values", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const { thread, component, turns } = await fixture(page);
  seed(thread, [component]);
  await page.goto("/ai/th_ui");
  await expect(page.locator(".map-workspace .ws-card")).toHaveCount(2);
  await auditAccessibility(page);
  await page.screenshot({
    path: info.outputPath("housing-production.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Hiện khung chat" }).click();
  await page
    .getByRole("textbox", { name: "Tin nhắn cho ReloHome", exact: true })
    .fill("Giữ nguyên bản nháp");
  await page.getByRole("button", { name: "Ẩn khung chat" }).click();
  await page.getByRole("button", { name: "Hiện khung chat" }).click();
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho ReloHome", exact: true }),
  ).toHaveValue("Giữ nguyên bản nháp");
  expect(turns).toEqual([]);
  await movingFormFixture(page);
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await selectMovingService(form, "TEST-TRUCK");
  await form.getByLabel("Ghi chú cho tài xế").fill("Cổng sau, giữ nguyên");
  await auditAccessibility(page);
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("button", { name: "Switch to dark mode" }).focus();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  const enForm = page.getByRole("complementary", { name: "Moving details" });
  await expect(enForm.getByLabel("Driver notes")).toHaveValue(
    "Cổng sau, giữ nguyên",
  );
  await expect(enForm.locator('input[value="TEST-TRUCK"]')).toBeChecked();
  await auditAccessibility(page);
  await page.screenshot({
    path: info.outputPath("moving-production-dark.png"),
    fullPage: true,
  });
});

test("production: moving and flight panes fit narrow, tablet and desktop screens", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const { thread } = await movingFormFixture(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/ai/th_ui");
    const form = page.getByRole("complementary", {
      name: "Thông tin chuyển đồ",
    });
    await expect(form).toBeVisible();
    const canvas = await page.locator(".moving-booking .ws-map").boundingBox();
    expect(canvas!.height).toBeGreaterThan(200);
    expect(canvas!.width).toBeGreaterThan(200);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await selectMovingService(form, "TEST-TRUCK");
    await expect(form.locator('input[value="TEST-TRUCK"]')).toBeChecked();
    if (width === 320) await auditAccessibility(page);
    await page.screenshot({
      path: info.outputPath(`moving-${width}.png`),
      fullPage: true,
    });
  }
  thread.state.plan.tasks.push({ id: "flight", agent: "flight", inputs: {} });
  thread.state.task_status = { ...thread.state.task_status, flight: "done" };
  seed(thread, [
    {
      id: "responsive-flight",
      type: "flight",
      task_id: "flight",
      data: {
        origin: "SGN",
        destination: "HAN",
        offers: [
          {
            id: "responsive-flight",
            carrier: "Vietnam Airlines",
            depart_at: tomorrow() + "T09:00:00+07:00",
            arrive_at: tomorrow() + "T11:00:00+07:00",
            stops: 0,
            fare_vnd: 1700000,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          },
        ],
      },
    },
  ]);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/ai/th_ui");
    const flights = page.getByRole("region", { name: "Chuyến bay" });
    await expect(flights).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await expect(
      flights.getByRole("button", { name: "Chọn chuyến này", exact: true }),
    ).toBeVisible();
    await auditAccessibility(page);
    await page.screenshot({
      path: info.outputPath(`flight-${width}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("production: motion enhances feedback without hiding content and respects reduced motion", async ({
  page,
}) => {
  const { turns } = await fixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator(".landing-hero-media img")).toHaveCSS(
    "animation-name",
    "cover-settle",
  );
  await page.locator("#services").scrollIntoViewIfNeeded();
  await expect(page.locator("#services")).toHaveAttribute(
    "data-motion",
    "visible",
  );
  await expect(page.locator("#services")).toHaveCSS("opacity", "1");
  await auditAccessibility(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator(".landing-hero-media img")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator("#services")).not.toHaveAttribute(
    "data-motion",
    "ready",
  );
  expect(turns).toEqual([]);
});

test("landing cover keeps the home visible and the primary action readable across screen sizes", async ({
  page,
}, info) => {
  const { turns } = await fixture(page, false);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const cover = page.locator(".landing-hero");
    const image = page.locator(".landing-hero-media img");
    await expect(page.locator(".landing-page .robot, .landing-hero-caption")).toHaveCount(0);
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    await expect(image).toHaveCSS("object-fit", "cover");
    const bounds = await cover.boundingBox();
    expect(bounds!.x).toBe(0);
    expect(bounds!.width).toBe(width);
    const action = await page.getByRole("link", { name: "Bắt đầu với AI", exact: true }).boundingBox();
    expect(action!.y + action!.height).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`home-cover-${width}.png`) });
  }
  await page.getByRole("button", { name: "Chuyển sang chế độ tối" }).focus();
  await page.getByRole("button", { name: "Chuyển sang chế độ tối" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await auditAccessibility(page);
  await page.screenshot({ path: info.outputPath("home-cover-dark.png") });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await expect(page.getByRole("link", { name: "Bắt đầu với AI", exact: true })).toBeInViewport();
  await auditAccessibility(page);
  await page.screenshot({ path: info.outputPath("home-cover-dark-mobile.png") });
  expect(turns).toEqual([]);
  expect(errors).toEqual([]);
});

test("landing: public introduction, active guide and roommates, CTA uses existing login and chat", async ({
  page,
}, info) => {
  const { turns } = await fixture(page, false);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".landing-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Tìm nơi ở mới/ }),
  ).toBeVisible();
  await expect(page.locator(".composer")).toHaveCount(0);
  const image = page.locator(".landing-hero-media img");
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  const cta = page.getByRole("link", {
    name: "Bắt đầu với AI",
    exact: true,
  });
  const box = await cta.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    info.project.name === "mobile" ? 844 : 960,
  );
  await expect(page.locator("#next")).toContainText("Bạn tự chọn người đồng hành.");
  await expect(page.locator("#guide .lp-guide-link")).toHaveCount(
    3,
  );
  await expect(page.locator("#guide")).toContainText("ReloHome biên soạn");
  await expect(page.locator("#guide a, #next a").first()).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Mở điều hướng" }).click();
  if (info.project.name === "mobile") {
    await page
      .getByRole("navigation", { name: "Điều hướng giới thiệu" })
      .getByRole("link", { name: "Dịch vụ", exact: true })
      .focus();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Mở điều hướng" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Mở điều hướng" }).click();
  }
  await page
    .getByRole("navigation", { name: "Điều hướng giới thiệu" })
    .getByRole("link", { name: "Cẩm nang", exact: true })
    .click();
  await expect(page).toHaveURL(/#guide$/);
  if (info.project.name === "mobile")
    await expect(
      page.getByRole("button", { name: "Mở điều hướng" }),
    ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("#guide")).toContainText("Short guides written by ReloHome");
  await expect(page.locator("#next")).toContainText("You choose who to share it with.");
  await page.getByRole("button", { name: "Switch to dark mode" }).focus();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.screenshot({
    path: info.outputPath("landing-dark-en.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("heading", { name: /Find your next home/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Switch to light mode" }).focus();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.getByRole("button", { name: "VI", exact: true }).focus();
  await page.getByRole("button", { name: "VI", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("landing-light-vi.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Bắt đầu với AI", exact: true })
    .click();
  await expect(page).toHaveURL(/\/ai$/);
  await expect(
    page.getByRole("heading", { name: "Chào bạn quay lại" }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("ui@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password-test-123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).focus();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.locator(".welcome")).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".landing-page")).toBeVisible();
  if (info.project.name === "desktop")
    await expect(
      page.getByRole("link", { name: "Vào không gian AI" }),
    ).toBeVisible();
  await page
    .getByRole("link", { name: "Trò chuyện với ReloHome", exact: true })
    .click();
  await expect(page.locator(".welcome")).toBeVisible();
  expect(turns).toEqual([]);
  expect(errors).toEqual([]);
});

test("moving picker explains vehicle types, selects packages directly and preserves provider IDs", async ({
  page,
}, info) => {
  const { turns } = await movingFormFixture(page);
  const catalog = [
    ...movingCatalog,
    { service_id: "HAN-TRUCK-ECO-750", name: "Tiêu chuẩn 750kg", requests: [] },
    { service_id: "HAN-TRUCK-ECO-500", name: "Tiêu chuẩn 500kg", requests: [] },
    {
      service_id: "HAN-TRUCK-ECO-1000",
      name: "Tiêu chuẩn 1000kg",
      description: "Lên tới 850kg",
      requests: [],
    },
    { service_id: "HAN-VAN-500", name: "Xe VAN 500kg", requests: [] },
    { service_id: "HAN-BIKE", name: "Siêu Tốc", requests: [] },
    { service_id: "HAN-ECO", name: "Siêu Tốc - Tiết Kiệm", requests: [] },
    { service_id: "SGN-POOL", name: "Siêu Rẻ", requests: [] },
    { service_id: "SGN-AIPOB", name: "Mua hộ với AI", requests: [] },
    {
      service_id: "HAN-TRUCK-ECO-1500",
      name: "Tiêu chuẩn 1500kg",
      description: "Khoang hàng 3.2 x 1.6 x 1.7 m. Lên tới 1500 kg",
      requests: [],
    },
    { service_id: "HAN-PICKUP-TRUCK", name: "Xe Bán Tải", requests: [] },
    { service_id: "SGN-TRICYCLE", name: "Xe Ba Gác", requests: [] },
    { service_id: "UNKNOWN-9000", name: "Dịch vụ mới", requests: [] },
  ];
  await page.route("**/web/api/moving/services?**", (route) =>
    route.fulfill({ json: { services: catalog } }),
  );
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  const groups = form.getByRole("group", { name: "Loại xe AhaMove" });
  await expect(
    groups.getByRole("button", { name: "Để ReloHome gợi ý" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    groups.getByRole("button", { name: "Gói khác", exact: true }),
  ).toHaveCount(0);
  await expect(
    form.locator('select[aria-label="Tải trọng AhaMove"]'),
  ).toHaveCount(0);
  if (info.project.name === "desktop") {
    await groups.getByRole("button", { name: "Xe máy", exact: true }).hover();
    await expect(
      form.getByRole("region", { name: "Giới thiệu Xe máy" }),
    ).toBeVisible();
    await expect(
      groups.getByRole("button", { name: "Để ReloHome gợi ý" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(turns).toEqual([]);
  }
  await groups.getByRole("button", { name: "Xe tải", exact: true }).click();
  await expect(
    form.getByRole("region", { name: "Giới thiệu Xe tải" }),
  ).toContainText("thùng hàng riêng");
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect(form.getByRole("alert")).toContainText(
    "chọn gói dịch vụ cụ thể",
  );
  expect(turns).toEqual([]);
  await form.getByRole("button", { name: /Xem tất cả .* gói xe/ }).click();
  await expect(form.getByRole("radio")).toHaveCount(5);
  await form.locator('input[value="HAN-TRUCK-ECO-1500"]').check();
  await expect(form.locator(".mv-service-choice.selected")).toContainText(
    "Khoang hàng 3.2 x 1.6 x 1.7 m",
  );
  await form
    .getByRole("button", { name: "Tải lại danh mục", exact: true })
    .click();
  await expect(form.locator('input[value="HAN-TRUCK-ECO-1500"]')).toBeChecked();
  await expect(
    groups.getByRole("button", { name: "Xe tải", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await form.locator('input[value="TEST-TRUCK"]').check();
  await form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }).check();
  await form.getByLabel("Tiền thu hộ · VND").fill("100000");
  await groups.getByRole("button", { name: "Xe van", exact: true }).click();
  await expect(form.getByLabel("Tiền thu hộ · VND")).toHaveValue("");
  await expect(
    form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }),
  ).toHaveCount(0);
  await form.locator('input[value="HAN-VAN-500"]').check();
  await expect(
    form
      .getByRole("region", { name: "Giới thiệu Xe van" })
      .locator('svg[data-vehicle="van"]'),
  ).toBeVisible();
  await groups.getByRole("button", { name: "Xe máy", exact: true }).click();
  await expect(
    groups
      .getByRole("button", { name: "Xe máy", exact: true })
      .locator("svg.lucide-motorbike"),
  ).toBeVisible();
  await expect(form.getByRole("radio")).toHaveCount(3);
  await expect(
    form.locator('input[value="SGN-AIPOB"],input[value="UNKNOWN-9000"]'),
  ).toHaveCount(0);
  await form.locator('input[value="HAN-ECO"]').check();
  await groups.getByRole("button", { name: "Xe máy", exact: true }).click();
  await expect(form.locator('input[value="HAN-ECO"]')).toBeChecked();
  await form.getByRole("button", { name: "Đóng giới thiệu xe" }).click();
  await expect(form.locator(".mv-vehicle-guide")).toHaveCount(0);
  await groups.getByRole("button", { name: "Xe bán tải", exact: true }).click();
  await expect(form.getByRole("radio")).toHaveCount(1);
  await form.locator('input[value="HAN-PICKUP-TRUCK"]').check();
  await groups.getByRole("button", { name: "Xe ba gác", exact: true }).click();
  await form.locator('input[value="SGN-TRICYCLE"]').check();
  await groups.getByRole("button", { name: "Xe tải", exact: true }).click();
  await form.locator('input[value="HAN-TRUCK-ECO-750"]').check();
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("button", { name: "Switch to dark mode" }).focus();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  const enForm = page.getByRole("complementary", { name: "Moving details" });
  await expect(
    enForm.locator('input[value="HAN-TRUCK-ECO-750"]'),
  ).toBeChecked();
  await page.screenshot({
    path: info.outputPath("moving-picker.png"),
    fullPage: true,
  });
  await enForm.getByRole("button", { name: "Confirm and get quote" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0].moving_options).toMatchObject({
    service_id: "HAN-TRUCK-ECO-750",
    requests: [],
  });
  expect(turns[0].moving_options).not.toHaveProperty("family");
  expect(turns[0].moving_options).not.toHaveProperty("capacity");
  expect(turns[0].pickup).toMatchObject({
    lat: 21,
    lng: 105.84,
    confirmed: true,
  });
});

test("moving van choice shows only its supported sizes and keeps compact selection controls", async ({
  page,
}, info) => {
  const { turns } = await movingFormFixture(page);
  let catalog = [
    movingCatalog[0],
    {
      service_id: "HAN-VAN-500",
      name: "Xe VAN 500kg",
      description: "Khoang 160 x 120 x 110 cm. Tối đa 500kg",
      requests: [],
    },
    {
      service_id: "HAN-VAN-750",
      name: "Xe VAN 750kg",
      description: "Khoang 200 x 140 x 130 cm. Lên tới 750kg",
      requests: [],
    },
    {
      service_id: "HAN-VAN-1000",
      name: "Xe VAN 1000kg",
      description: "Khoang 230 x 150 x 140 cm. Lên tới 850kg",
      requests: [],
    },
    { service_id: "HAN-TRUCK-ECO-500", name: "Tiêu chuẩn 500kg", requests: [] },
    { service_id: "HAN-BIKE", name: "Siêu Tốc", requests: [] },
  ];
  await page.route("**/web/api/moving/services?**", (route) =>
    route.fulfill({ json: { services: catalog } }),
  );
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  const groups = form.getByRole("group", { name: "Loại xe AhaMove" });
  await selectMovingService(form, "TEST-TRUCK");
  await form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }).check();
  await groups.getByRole("button", { name: "Xe van", exact: true }).click();
  await expect(form.locator(".mv-service-picker legend")).toHaveText(
    "Các gói Xe van tại điểm A",
  );
  await expect(form.getByRole("radio")).toHaveCount(3);
  expect(
    await form
      .getByRole("radio")
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value)),
  ).toEqual(["HAN-VAN-500", "HAN-VAN-750", "HAN-VAN-1000"]);
  await expect(
    form.locator(
      'input[value="TEST-TRUCK"], input[value="HAN-TRUCK-ECO-500"], input[value="HAN-BIKE"]',
    ),
  ).toHaveCount(0);
  await expect(
    form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }),
  ).toHaveCount(0);
  for (const radio of await form.getByRole("radio").all()) {
    const box = await radio.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(18);
    expect(box!.height).toBeLessThanOrEqual(18);
  }
  for (const card of await form.locator(".mv-service-choice").all())
    expect((await card.boundingBox())!.height).toBeLessThanOrEqual(65);
  await form.locator('input[value="HAN-VAN-1000"]').check();
  await expect(form.locator(".mv-service-choice.selected")).toContainText(
    "Lên tới 850kg",
  );
  if (info.project.name === "desktop")
    await groups.getByRole("button", { name: "Xe tải", exact: true }).hover();
  else
    await groups.getByRole("button", { name: "Xe tải", exact: true }).focus();
  await expect(
    groups.getByRole("button", { name: "Xe van", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByRole("radio")).toHaveCount(3);
  await form.getByRole("button", { name: "Đóng giới thiệu xe" }).click();
  await page.screenshot({
    path: info.outputPath("moving-van-only.png"),
    fullPage: true,
  });
  catalog = catalog.filter((s) => s.service_id !== "HAN-VAN-750");
  await form
    .getByRole("button", { name: "Tải lại danh mục", exact: true })
    .click();
  await expect(form.getByRole("radio")).toHaveCount(2);
  await expect(form.locator('input[value="HAN-VAN-1000"]')).toBeChecked();
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  const enForm = page.getByRole("complementary", { name: "Moving details" });
  await expect(enForm.locator(".mv-service-picker legend")).toHaveText(
    "Van services at pickup A",
  );
  await expect(enForm.getByRole("radio")).toHaveCount(2);
  expect(turns).toEqual([]);
  await enForm.getByRole("button", { name: "Confirm and get quote" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0].moving_options).toMatchObject({
    service_id: "HAN-VAN-1000",
    requests: [],
  });
  expect(turns[0].pickup).toMatchObject({
    lat: 21,
    lng: 105.84,
    confirmed: true,
  });
});

test("moving quote footer does not hard-code a provider environment in either language", async ({
  page,
}) => {
  const { turns } = await movingFormFixture(page);
  await page.goto("/ai/th_ui");
  const footer = page.locator(".moving-booking .mv-confirm small");
  await expect(footer).toHaveText(
    "Báo giá AhaMove. Thanh toán trong app sau khi chọn gói; chưa tạo đơn.",
  );
  await expect(footer).not.toContainText(/staging|production/i);
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(footer).toHaveText(
    "AhaMove quote. Pay in the app after choosing a vehicle; no order has been created.",
  );
  await expect(footer).not.toContainText(/staging|production/i);
  expect(turns).toEqual([]);
});

test("moving vehicle guide explains automatic comparison and never books or clears input when opened", async ({
  page,
}, info) => {
  const { turns } = await movingFormFixture(page);
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await form.getByLabel("Tiền thu hộ · VND").fill("100000");
  await form.getByLabel("Ghi chú cho tài xế").fill("Giữ nguyên ghi chú này");
  await form
    .getByRole("group", { name: "Loại xe AhaMove" })
    .getByRole("button", { name: "Để ReloHome gợi ý", exact: true })
    .click();
  await expect(
    form.getByRole("region", { name: "Giới thiệu Để ReloHome gợi ý" }),
  ).toContainText("Không tự đặt xe");
  await expect(form.getByLabel("Tiền thu hộ · VND")).toHaveValue("100000");
  await expect(form.getByLabel("Ghi chú cho tài xế")).toHaveValue(
    "Giữ nguyên ghi chú này",
  );
  await form.getByRole("button", { name: "Đóng giới thiệu xe" }).click();
  await selectMovingService(form, "TEST-TRUCK");
  await form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }).check();
  await form
    .getByRole("group", { name: "Loại xe AhaMove" })
    .getByRole("button", { name: "Xe tải", exact: true })
    .click();
  await expect(form.locator('input[value="TEST-TRUCK"]')).toBeChecked();
  await expect(
    form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  const enForm = page.getByRole("complementary", { name: "Moving details" });
  await expect(
    enForm.getByRole("region", { name: "About Truck" }),
  ).toContainText("separate cabin and cargo body");
  await page.getByRole("button", { name: "Switch to dark mode" }).focus();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.screenshot({
    path: info.outputPath("moving-vehicle-guide.png"),
    fullPage: true,
  });
  expect(turns).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await enForm
    .getByRole("group", { name: "AhaMove vehicle type" })
    .getByRole("button", { name: "Let ReloHome recommend", exact: true })
    .click();
  await expect(
    enForm.locator('input[name="ahamove-service"]:checked'),
  ).toHaveCount(0);
  await enForm.getByRole("button", { name: "Confirm and get quote" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0].moving_options.service_id).toBeUndefined();
  expect(turns[0].moving_options.requests).toEqual([]);
  expect(turns[0].moving_options.remarks).toBe("Giữ nguyên ghi chú này");
  expect(turns[0].pickup).toMatchObject({
    lat: 21,
    lng: 105.84,
    confirmed: true,
  });
});

test("welcome: all starting actions fit before scrolling at laptop and mobile heights", async ({
  page,
}, info) => {
  const { turns, user } = await fixture(page);
  Object.assign(user.preferences, { city: "Hà Nội", budget: "7000000" });
  const sizes =
    info.project.name === "mobile"
      ? [
          { width: 390, height: 844 },
          { width: 360, height: 740 },
          { width: 390, height: 680 },
        ]
      : [
          { width: 1536, height: 790 },
          { width: 1366, height: 650 },
          { width: 1280, height: 600 },
        ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto("/ai");
    for (const locale of ["vi", "en"] as const) {
      const localeButton = page.getByRole("button", {
        name: locale === "vi" ? "VI" : "EN", exact: true,
      });
      await localeButton.focus();
      await localeButton.click();
      const scroll = page.locator(".conversation-scroll");
      await expect(page.locator(".quick-card")).toHaveCount(6);
      await expect(page.locator(".starter > button")).toHaveCount(2);
      await expect
        .poll(async () =>
          scroll.evaluate((el) => el.scrollHeight - el.clientHeight),
        )
        .toBeLessThanOrEqual(2);
      const box = await scroll.boundingBox();
      for (const action of await page
        .locator(
          ".quick-card, .starter > button, .welcome-note, .welcome > .text-button",
        )
        .all()) {
        const actionBox = await action.boundingBox();
        expect(actionBox).not.toBeNull();
        expect(actionBox!.y).toBeGreaterThanOrEqual(box!.y - 1);
        expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(
          box!.y + box!.height + 1,
        );
      }
      await expect(
        page.getByRole("textbox", {
          name: locale === "vi" ? "Tin nhắn cho ReloHome" : "Message ReloHome",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      if (size === sizes[0])
        await page.screenshot({
          path: info.outputPath(`welcome-compact-${locale}.png`),
          fullPage: true,
        });
    }
  }
  await page.getByRole("button", { name: "VI", exact: true }).focus();
  await page.getByRole("button", { name: "VI", exact: true }).click();
  await page.locator(".starter > button").first().click();
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho ReloHome", exact: true }),
  ).toHaveValue("Tìm nhà ở khu Ocean Park 2 dưới 5 triệu");
  expect(turns).toEqual([]);
});

test("appearance: language and theme persist without changing conversation data or drafts", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { thread, turns } = await fixture(page);
  thread.messages.push({
    id: "original-message",
    role: "assistant",
    created: Date.now() / 1000,
    content: {
      response: { kind: "ANSWER", text: "Địa chỉ gốc: 12 Lê Lợi, Quận 1." },
    },
  });
  await page.goto("/ai/th_ui");
  const draft = "Tìm nhà tại Bình Thạnh, giữ nguyên nội dung này";
  await page
    .getByRole("textbox", { name: "Tin nhắn cho ReloHome", exact: true })
    .fill(draft);
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("button", { name: "History", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Message ReloHome", exact: true }),
  ).toHaveValue(draft);
  await expect(
    page.getByText("Địa chỉ gốc: 12 Lê Lợi, Quận 1.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark mode" }).focus();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: info.outputPath("product-dark-en.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("textbox", { name: "Message ReloHome", exact: true }),
  ).toHaveValue(draft);
  await page.getByRole("button", { name: "VI", exact: true }).focus();
  await page.getByRole("button", { name: "VI", exact: true }).click();
  await page.getByRole("button", { name: "Chuyển sang chế độ sáng" }).focus();
  await page.getByRole("button", { name: "Chuyển sang chế độ sáng" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho ReloHome", exact: true }),
  ).toHaveValue(draft);
  expect(turns).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("appearance: English account labels preserve canonical preference values and unsaved edits", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  const edits: any[] = [];
  await page.route("**/web/api/profile", async (route) => {
    edits.push(route.request().postDataJSON());
    await route.fallback();
  });
  await page.goto("/account");
  await page.getByRole("tab", { name: "Sở thích AI", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Thành phố", exact: true })
    .selectOption("Hà Nội");
  await page
    .getByRole("spinbutton", { name: "Ngân sách thuê · VND/tháng" })
    .fill("6500000");
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My account", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "City", exact: true }),
  ).toHaveValue("Hà Nội");
  await expect(
    page.getByRole("spinbutton", { name: "Rent budget · VND/month" }),
  ).toHaveValue("6500000");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => edits.length).toBe(1);
  expect(edits[0].preferences).toMatchObject({
    city: "Hà Nội",
    budget: "6500000",
  });
  await expect(
    page.getByRole("heading", { name: "Minh Anh", exact: true }),
  ).toBeVisible();
});

test("appearance: moving pins and service choices survive theme and language switches", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { turns } = await movingFormFixture(page);
  await page.goto("/ai/th_ui");
  let form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await selectMovingService(form, "TEST-TRUCK");
  await form
    .getByLabel("Ghi chú cho tài xế")
    .fill("Đến cổng sau, giữ nguyên ghi chú");
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("button", { name: "Switch to dark mode" }).focus();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  form = page.getByRole("complementary", { name: "Moving details" });
  await expect(form.getByLabel("Pickup address")).toHaveValue(
    "Cổng A · Hà Nội",
  );
  await expect(form.getByLabel("Drop-off address")).toHaveValue(
    "Cổng B · Hà Nội",
  );
  await expect(form.getByLabel("Moving date")).toHaveValue(tomorrow());
  await expect(form.getByLabel("Pickup time")).toHaveValue("09:00");
  await expect(form.locator('input[value="TEST-TRUCK"]')).toBeChecked();
  await expect(form.getByLabel("Driver notes")).toHaveValue(
    "Đến cổng sau, giữ nguyên ghi chú",
  );
  expect(turns).toEqual([]);
  await page.screenshot({
    path: info.outputPath("moving-dark-en.png"),
    fullPage: true,
  });
  await form.getByRole("button", { name: "Confirm and get quote" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0]).toMatchObject({
    plan_version: 1,
    pickup: {
      address: "Cổng A · Hà Nội",
      lat: 21,
      lng: 105.84,
      confirmed: true,
    },
    destination: {
      address: "Cổng B · Hà Nội",
      lat: 21.01,
      lng: 105.85,
      confirmed: true,
    },
    moving_options: {
      service_id: "TEST-TRUCK",
      remarks: "Đến cổng sau, giữ nguyên ghi chú",
    },
  });
  expect(turns[0]).not.toHaveProperty("locale");
  expect(turns[0]).not.toHaveProperty("theme");
});

test("appearance: login, welcome and map are readable in both themes without overflow", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { thread, component } = await fixture(page, false);
  await page.goto("/login");
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark mode" }).focus();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.screenshot({
    path: info.outputPath("login-dark-en.png"),
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("ui@example.test");
  await page.getByLabel("Password", { exact: true }).fill("password-test-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.locator(".quick-card").filter({ hasText: "Find a home" }),
  ).toBeVisible();
  await page.locator(".quick-card").filter({ hasText: "Find a home" }).click();
  const homeForm = page.getByRole("dialog", {
    name: "What kind of home are you looking for?",
  });
  await expect(homeForm).toBeVisible();
  await homeForm.getByLabel("City", { exact: true }).selectOption("Hà Nội");
  await homeForm.locator(".request-extra > summary").click();
  await homeForm.getByLabel("Min price · VND/month").fill("9000000");
  await homeForm.getByLabel("Max price · VND/month").fill("5000000");
  await homeForm.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(homeForm.getByRole("alert")).toContainText(
    "Minimum price must not exceed maximum price.",
  );
  await page.keyboard.press("Escape");
  await page
    .locator(".quick-card")
    .filter({ hasText: "Find a flight" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Find a flight for your journey" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: info.outputPath("welcome-dark-en.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch to light mode" }).focus();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.screenshot({
    path: info.outputPath("welcome-light-en.png"),
    fullPage: true,
  });
  seed(thread, [component]);
  await page.goto("/ai/th_ui");
  await expect(
    page.getByRole("region", { name: "Housing map", exact: true }),
  ).toBeVisible();
  const canvas = page.locator(".ws-canvas canvas").first();
  const handle = await canvas.elementHandle();
  await page.getByRole("button", { name: "Switch to dark mode" }).focus();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(canvas).toBeVisible();
  expect(await handle!.evaluate((el) => el.isConnected)).toBeTruthy();
  await expect(page.locator(".map-workspace .ws-card")).toHaveCount(2);
  await page.screenshot({
    path: info.outputPath("housing-dark-en.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

// Explicit UI contract fixtures. Product builds never import this module.
const houses = [
  {
    id: "listing-a",
    title: "Căn hộ sáng thoáng, gần trung tâm",
    address: "Quận 1, Thành phố Hồ Chí Minh",
    price_vnd: 8500000,
    price: { amount: 8500000, currency: "VND", period: "month" },
    area_m2: 48,
    bedrooms: 2,
    bathrooms: 1,
    lat: 10.776,
    lng: 106.697,
    amenities: ["parking", "air_conditioning"],
    location_accuracy: "approximate",
  },
  {
    id: "listing-b",
    title: "Căn hộ hai phòng ngủ, ban công rộng",
    address: "Quận 1, Thành phố Hồ Chí Minh",
    price_vnd: 9200000,
    price: { amount: 9200000, currency: "VND", period: "month" },
    area_m2: 55,
    bedrooms: 2,
    bathrooms: 1,
    lat: 10.772,
    lng: 106.704,
    amenities: ["balcony", "elevator"],
    location_accuracy: "approximate",
  },
];
for (const mode of ["typed", "legacy", "choices", "mixed"] as const) {
  test(`housing location recovery avoids repeated generic forms: ${mode}`, async ({ page }) => {
    const { thread, turns } = await fixture(page);
    const values = { near: "Ocean Park 1", max_price_vnd: 5000000 };
    thread.state.intake = { kind: "new_goal", intent: { domains: ["property"] }, constraints: { values, missing: [] }, user_confirmed_facts: {} };
    thread.state.plan.tasks = [{ id: "housing", agent: "property", inputs: values }];
    thread.state.progress.items = [{ task_id: "housing", agent: "property", inputs: values, state: "waiting", task_status: "needs_input", after: [], level: 0 }];
    const text = "Mình chưa có tọa độ đáng tin cậy cho Ocean Park 1. Bạn gửi tên đầy đủ kèm địa chỉ nhé.";
    const question: any = { field: mode === "choices" ? "property.near" : "near", text };
    if (mode !== "legacy") question.reason = mode === "choices" ? "location_ambiguous" : "location_not_found";
    if (mode === "choices") question.choices = [{ id: "provider-place-1", entity_type: "place", label: "Địa điểm do provider trả", lat: 21.0, lng: 105.94 }];
    thread.messages.push({ id: "location-question", role: "assistant", created: Date.now() / 1000,
      content: { status: "done", response: { kind: "CLARIFY", text, questions: [question, ...(mode === "mixed" ? [{ field: "property.room_type", text: "Bạn muốn loại nhà nào?" }] : [])] } } });
    await page.goto("/ai/th_ui");
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    if (mode === "mixed") {
      const form = page.locator(".guided-service-panel");
      await expect(form).toBeVisible();
      await expect(form.getByLabel("Đến · VND/tháng", { exact: true })).toHaveValue("5000000");
      await expect(form.getByLabel("Gần địa điểm", { exact: true })).toHaveValue("Ocean Park 1");
    } else {
      await expect(page.locator(".guided-service-panel")).toHaveCount(0);
    }
    if (mode === "choices") {
      await page.getByRole("button", { name: "Địa điểm do provider trả", exact: true }).click();
      await expect.poll(() => turns.length).toBe(1);
      expect(turns[0].place_choice).toEqual({ field: "near", place_id: "provider-place-1" });
    } else if (mode !== "mixed") {
      // Adding a city cannot magically resolve the landmark. A repeated provider
      // clarification must stay in chat rather than reopening the same form.
      await page.route("**/web/api/threads/th_ui/chat", async route => {
        const body = route.request().postDataJSON();
        turns.push(body);
        const corrected = { ...values, city: "Hà Nội" };
        thread.state.intake.constraints.values = corrected;
        thread.state.plan.tasks[0].inputs = corrected;
        thread.messages.push(
          { id: "city-correction", role: "user", created: Date.now() / 1000, content: { status: "done", text: body.message } },
          { id: "still-unresolved", role: "assistant", created: Date.now() / 1000, content: { status: "done", response: { kind: "CLARIFY", text, questions: [question] } } },
        );
        await route.fulfill({ json: thread });
      });
      await page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" }).fill("Ở Hà Nội, giữ Ocean Park 1 và giá dưới 5 triệu");
      await page.getByRole("button", { name: "Gửi tin nhắn" }).click();
      await expect.poll(() => turns.length).toBe(1);
      expect(turns[0]).not.toHaveProperty("place_choice");
      expect(turns[0]).not.toHaveProperty("housing_location");
      await expect(page.getByText(text, { exact: true }).last()).toBeVisible();
      await expect(page.locator(".guided-service-panel")).toHaveCount(0);
      expect(thread.state.intake.constraints.values).toEqual({ ...values, city: "Hà Nội" });
    }
  });
}

async function fixture(page: Page, authenticated = true, calls: any[] = []) {
  let logged = authenticated;
  const user = {
    id: "ui-test",
    name: "Minh Anh",
    email: "minhanh@example.test",
    preferences: {},
  };
  let thread: any = {
    id: "th_ui",
    title: "Tìm nhà tại Quận 1",
    updated: 1790751600,
    revision: 1,
    messages: [],
    runs: [],
    state: {
      plan: {
        version: 1,
        tasks: [
          {
            id: "housing",
            agent: "property",
            inputs: { city: "Thành phố Hồ Chí Minh" },
          },
        ],
      },
      intake: { user_confirmed_facts: {} },
      task_status: { housing: "done" },
      progress: { items: [{ task_id: "housing", agent: "property", inputs: { city: "Thành phố Hồ Chí Minh" }, state: "reviewed", task_status: "done", after: [], level: 0 }], totals: {} },
      pending: null,
    },
  };
  let saved: any[] = [];
  const turns: any[] = [];
  const component = {
    id: "housing:result-1",
    task_id: "housing",
    type: "property",
    agent: "property",
    source: "Location · dữ liệu kiểm thử",
    source_kind: "live",
    fetched_at: "2026-09-30T00:00:00+00:00",
    data: {
      candidates: houses,
      area_name: "Thành phố Hồ Chí Minh",
      search_request: {
        district: "Quận 1",
        max_price: { amount: 10000000, currency: "VND", period: "month" },
      },
      map_context: {
        scope: "returned_candidates",
        listing_ids: houses.map((h) => h.id),
        viewport: { west: 106.69, south: 10.765, east: 106.71, north: 10.78 },
      },
      has_more: false,
    },
  };
  // Platform shapes: search results and map markers carry structured addresses and coordinates.
  const platformRow = (h: any) => ({
    listing_id: h.id,
    title: h.title,
    price: h.price,
    bedrooms: h.bedrooms,
    bathrooms: h.bathrooms,
    area: { value: h.area_m2, unit: "m2" },
    address: {
      housenumber: "12",
      street: "Lê Lợi",
      ward: "Bến Nghé",
      district: "Quận 1",
      city: "Hồ Chí Minh",
    },
    location: { lat: h.lat, lng: h.lng },
    location_accuracy: h.location_accuracy,
    amenities: h.amenities,
    thumbnail_url: null,
  });
  await page.route("**/web/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
        "/web/api",
        "",
      ),
      method = route.request().method(),
      body = route.request().postDataJSON() || {};
    let data: any = {},
      status = 200;
    if (path === "/session") {
      data = user;
      if (!logged) status = 401;
    } else if (path.startsWith("/auth/")) {
      logged = true;
      data = user;
    } else if (path === "/status")
      data = {
        domains: ["property", "map", "flight", "relocation", "payment"],
        writes_enabled: false,
        flight_booking_enabled: false,
      };
    else if (path === "/threads" && method === "GET")
      data = thread.messages.length ? [thread] : [];
    else if (
      (path === "/threads/th_ui" || path === "/threads") &&
      method === "DELETE"
    ) {
      calls.push({ path, method });
      thread.messages = [];
      data =
        path === "/threads"
          ? { deleted: 1, kept: [], memory_forgotten: true }
          : { ok: true };
    } else if (path === "/threads" && method === "POST") data = thread;
    else if (path === "/threads/th_ui" && method === "GET") data = thread;
    else if (
      path === "/threads/th_ui/chat" ||
      path === "/threads/th_ui/moving/quote"
    ) {
      turns.push(body);
      thread.messages.push({
        id: "u" + thread.messages.length,
        role: "user",
        created: 1790751600,
        content: {
          status: "done",
          text: body.message || "Báo giá chuyển đồ từ form. Chưa đặt đơn.",
        },
      });
      thread.messages.push({
        id: "a" + thread.messages.length,
        role: "assistant",
        created: 1790751601,
        content: {
          status: "done",
          response: {
            kind: "ANSWER",
            text: "Mình đã tìm được các căn phù hợp. Bạn xem vị trí và chọn căn muốn tìm hiểu thêm nhé.",
            data: {},
          },
          ui: { version: 1, plan_version: 1, components: [component] },
        },
      });
      data = thread;
    } else if (path === "/threads/th_ui/action") {
      calls.push({ path, body });
      const owner = thread.messages
        .flatMap((m: any) => m.content.ui?.components || [])
        .find((c: any) => c.task_id === body.task_id);
      thread.state.intake.user_confirmed_facts[
        "selected:" + (owner?.type || "property")
      ] = { value: body.entity_id };
      thread.state.cost_summary = {
        lines: [
          {
            task_id: "housing",
            label: houses[1].title,
            amount_vnd: 9200000,
            recurrence: "monthly",
          },
        ],
        total_one_time_vnd: 0,
        total_monthly_vnd: 9200000,
      };
      data = thread;
    } else if (path.startsWith("/housing/"))
      data = houses.find((h) => h.id === path.split("/").pop());
    else if (path === "/saved") data = saved;
    else if (path.startsWith("/saved/") && method === "PUT") {
      const house = houses.find((h) => h.id === path.split("/").pop());
      saved.push({ id: house!.id, thread_id: thread.id, house });
      data = { ok: true };
    } else if (path.startsWith("/saved/") && method === "DELETE") {
      saved = saved.filter((s) => s.id !== path.split("/").pop());
      data = { ok: true };
    } else if (path === "/profile") {
      Object.assign(user, body);
      data = user;
    } else if (path === "/logout") {
      logged = false;
      data = { ok: true };
    } else if (path === "/platform/housing/map") {
      calls.push({ path, body });
      data = {
        features: houses.map((h) => ({ kind: "listing", ...platformRow(h) })),
        meta: {
          mode: "listings",
          returned_count: houses.length,
          truncated: false,
        },
      };
    } else if (path === "/platform/housing/search") {
      calls.push({ path, body });
      data = {
        results: houses.map(platformRow),
        page: { next_cursor: null, returned_count: houses.length },
      };
    } else if (path === "/platform/places/map") {
      calls.push({ path, body });
      data = { type: "FeatureCollection", features: [] };
    } else if (path === "/map/search")
      data = {
        results: [
          {
            name: "Điểm kiểm thử",
            entity_type: "place",
            location: { lat: 10.776, lng: 106.697 },
            address: "Quận 1",
          },
        ],
      };
    else {
      status = 404;
      data = { detail: "Fixture route missing: " + path };
    }
    await route.fulfill({ status, json: data });
  });
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      json: {
        version: 8,
        glyphs: "http://127.0.0.1:5174/test-glyphs/{fontstack}/{range}.pbf",
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
  await page.route("**/test-glyphs/**", (route) =>
    route.fulfill({
      body: Buffer.alloc(0),
      contentType: "application/x-protobuf",
    }),
  );
  return { thread, component, user, turns };
}

function seed(thread: any, components: any[] = [], data: any = {}) {
  // A returned service result belongs to an active task, as required by the current API contract.
  for (const component of components) {
    if (!thread.state.plan.tasks.some((task: any) => task.id === component.task_id))
      thread.state.plan.tasks.push({ id: component.task_id, agent: component.type, inputs: {} });
    thread.state.task_status = { ...thread.state.task_status, [component.task_id]: "done" };
  }
  thread.messages.push({
    id: "audit-result-" + thread.messages.length,
    role: "assistant",
    created: Date.now() / 1000,
    content: {
      status: "done",
      response: {
        kind: "ANSWER",
        text: "Kết quả kiểm tra hợp đồng dịch vụ",
        data,
      },
      ui: { version: 1, plan_version: 1, components },
    },
  });
}

const movingCatalog = [
  {
    service_id: "TEST-TRUCK",
    name: "Xe tải 750kg",
    cod_limit: 500000,
    requests: [
      { _id: "lift", name: "Bốc xếp tận nơi", type: "BOOLEAN", price: 95000 },
      { _id: "tip", name: "Hỗ trợ tài xế", type: "PER_UNIT", price: 5000 },
      {
        _id: "bulky",
        name: "Hàng cồng kềnh",
        type: "TIER",
        tier_list: [
          {
            code: "small",
            name_vi_vn: "Tiêu chuẩn",
            price: 0,
            selectable: true,
          },
          {
            code: "large",
            name_vi_vn: "Mức 1",
            price: 10000,
            selectable: true,
          },
          { code: "over", name_vi_vn: "Quá tải", price: -1, selectable: false },
        ],
      },
    ],
  },
  { service_id: "TEST-VAN", name: "Xe van", cod_limit: 0, requests: [] },
];
async function selectMovingService(form: Locator, id: string) {
  await form
    .getByRole("button", {
      name: id === "TEST-VAN" ? "Xe van" : "Xe tải",
      exact: true,
    })
    .click();
  await form.locator(`input[type="radio"][value="${id}"]`).check();
}
async function movingFormFixture(page: Page) {
  const data = await fixture(page);
  const values = {
    from_address: "Cổng A · Hà Nội",
    to_address: "Cổng B · Hà Nội",
    move_date: tomorrow(),
    move_time: "09:00",
    pickup_coordinate: { lat: 21.0, lng: 105.84 },
    destination_coordinate: { lat: 21.01, lng: 105.85 },
  };
  data.thread.state.intake.constraints = { values };
  for (const [k, v] of Object.entries(values))
    data.thread.state.intake.user_confirmed_facts[k] = { value: v };
  data.thread.messages.push({
    id: "moving-form",
    role: "assistant",
    created: Date.now() / 1000,
    content: {
      status: "done",
      response: {
        kind: "ASK",
        text: "Kiểm tra yêu cầu chuyển đồ",
        questions: [
          { field: "relocation.move_date", text: "Chọn ngày chuyển" },
        ],
        data: {},
      },
    },
  });
  await page.route("**/web/api/moving/services?**", (route) =>
    route.fulfill({ json: { services: movingCatalog } }),
  );
  return data;
}

test("moving map selection matches the result address, and finding A again preserves B", async ({ page }, info) => {
  const { turns } = await movingFormFixture(page);
  await page.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#edf3ef" } }] } }));
  await page.route("**/web/api/map/search?**", route => route.fulfill({ json: { results: [{ canonical_id: "new-gate", display_name: "Cổng mới Duy Tân", location: { lat: 21.03, lng: 105.81 } }] } }));
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await form.getByLabel("Địa chỉ lấy đồ", { exact: true }).fill("Duy Tân");
  const toggle = form.getByRole("button", { name: "Thông tin chuyển đồ", exact: true });
  if (info.project.name === "mobile") await toggle.click();
  await expect(page.locator(".mv-candidate")).toHaveCount(1);
  await page.locator(".mv-candidate").click();
  if (info.project.name === "mobile") await toggle.click();
  await expect(form.getByLabel("Địa chỉ lấy đồ", { exact: true })).toHaveValue("Cổng mới Duy Tân");
  await form.getByRole("button", { name: "Chọn điểm B · Điểm giao đồ", exact: true }).click();
  await form.getByRole("button", { name: "Tìm lại vị trí A", exact: true }).click();
  await expect(form.getByRole("button", { name: "Chọn điểm A · Điểm lấy đồ", exact: true })).toHaveAttribute("aria-pressed", "true");
  if (info.project.name === "mobile") await toggle.click();
  const canvas = page.locator(".moving-booking .maplibregl-canvas");
  // Map controls stack at the top of the map on mobile; click the free map area below them.
  const mapBox = (await canvas.boundingBox())!;
  const controls = info.project.name === "mobile" ? await page.locator(".moving-booking .ws-chat-show").boundingBox() : null;
  const top = controls ? Math.max(140, controls.y + controls.height - mapBox.y + 24) : 140;
  await canvas.click({ position: { x: 125, y: top } });
  await expect(page.locator(".mv-marker.mv-a")).toHaveCount(1);
  if (info.project.name === "mobile") await toggle.click();
  await expect(form.getByLabel("Địa chỉ giao đồ", { exact: true })).toHaveValue("Cổng B · Hà Nội");
  await form.getByRole("button", { name: "Chọn điểm B · Điểm giao đồ", exact: true }).click();
  if (info.project.name === "mobile") await toggle.click();
  await canvas.click({ position: { x: 160, y: top + 40 } });
  await expect(page.locator(".mv-marker")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("moving-A-B-pins.png") });
  if (info.project.name === "mobile") await toggle.click();
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá", exact: true }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0].pickup).toMatchObject({ address: "Cổng mới Duy Tân", confirmed: true });
  expect(turns[0].destination).toMatchObject({ address: "Cổng B · Hà Nội", confirmed: true });
  expect(turns[0].pickup.lat).not.toBe(turns[0].destination.lat);
});

test("moving guest login keeps form values and only sends a quote after explicit reconfirmation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const { turns } = await movingFormFixture(page);
  let account = false;
  const user = { id: "tenant", name: "An", preferences: {} };
  await page.route("**/web/api/session", route => route.fulfill({ json: account ? user : { id: "guest_" + "a".repeat(32), kind: "guest", name: "Khách", email: "", preferences: {}, capabilities: ["chat", "housing_read", "flight_read", "map_read", "guides"], is_guest: true, expires_at: Date.now() / 1000 + 86400, active_thread_id: "th_ui" } }));
  await page.route("**/web/api/auth/login", route => { account = true; return route.fulfill({ json: user }); });
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await expect(form).toBeVisible();
  await form.getByLabel("Giờ xe đến", { exact: true }).fill("10:30");
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true });
  await expect(dialog).toBeVisible();
  expect(turns).toHaveLength(0);
  await dialog.getByLabel("Email", { exact: true }).fill("an@example.test");
  await dialog.getByLabel("Mật khẩu", { exact: true }).fill("correct-password");
  await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(form.getByLabel("Địa chỉ lấy đồ", { exact: true })).toHaveValue("Cổng A · Hà Nội");
  await expect(form.getByLabel("Địa chỉ giao đồ", { exact: true })).toHaveValue("Cổng B · Hà Nội");
  await expect(form.getByLabel("Giờ xe đến", { exact: true })).toHaveValue("10:30");
  expect(turns).toHaveLength(0);
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá", exact: true }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(errors).toEqual([]);
});

test("moving ignores a late lookup for A after the user selects and edits B", async ({ page }) => {
  const { turns } = await movingFormFixture(page);
  let release: (() => void) | undefined;
  let requested = false;
  await page.route("**/web/api/map/search?**", async route => {
    const query = new URL(route.request().url()).searchParams.get("text");
    if (query === "Old pickup") {
      requested = true;
      await new Promise<void>(resolve => { release = resolve; });
      return route.fulfill({ json: { results: [{ canonical_id: "old", display_name: "Old result", location: { lat: 21.1, lng: 105.8 } }] } });
    }
    return route.fulfill({ json: { results: [{ canonical_id: "new", display_name: "New destination", location: { lat: 21.02, lng: 105.82 } }] } });
  });
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await form.getByLabel("Địa chỉ lấy đồ", { exact: true }).fill("Old pickup");
  await expect.poll(() => requested).toBe(true);
  await form.getByLabel("Địa chỉ giao đồ", { exact: true }).fill("New drop-off");
  release?.();
  await form.getByRole("button", { name: "New destination", exact: true }).click();
  await expect(form.getByLabel("Địa chỉ giao đồ", { exact: true })).toHaveValue("New destination");
  await expect(form.getByLabel("Địa chỉ lấy đồ", { exact: true })).toHaveValue("Old pickup");
  await expect(form.getByRole("button", { name: "Old result", exact: true })).toHaveCount(0);
  expect(turns).toEqual([]);
});

test("moving empty search explains how to pin A without changing B", async ({ page }, info) => {
  await movingFormFixture(page);
  await page.route("**/web/api/map/search?**", route => route.fulfill({ json: { results: [] } }));
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await form.getByLabel("Địa chỉ lấy đồ", { exact: true }).fill("Địa chỉ chưa có dữ liệu");
  await expect(form).toContainText("Không tìm thấy địa chỉ này.");
  await form.getByRole("button", { name: "Ghim điểm A trên bản đồ", exact: true }).click();
  await expect(form.getByRole("button", { name: "Chọn điểm A · Điểm lấy đồ", exact: true })).toHaveAttribute("aria-pressed", "true");
  if (info.project.name === "mobile")
    await expect(form.getByRole("button", { name: "Thông tin chuyển đồ", exact: true })).toHaveAttribute("aria-expanded", "false");
});

test("moving form submits provider add-ons, packages and cash options with confirmed map points", async ({
  page,
}, testInfo) => {
  const { turns } = await movingFormFixture(page);
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await selectMovingService(form, "TEST-TRUCK");
  if (process.env.SIU_UI_SCREENSHOTS) {
    await page.screenshot({
      path: `../../logs/local/moving-form-${testInfo.project.name}.png`,
    });
  }
  await form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }).check();
  await form.getByRole("checkbox", { name: /Hỗ trợ tài xế/ }).check();
  await form.getByLabel("Số lượng · Hỗ trợ tài xế").fill("2");
  await form.getByRole("checkbox", { name: /Hàng cồng kềnh/ }).check();
  await form.getByRole("button", { name: "Thêm kiện hàng" }).click();
  await form.getByLabel("Mô tả kiện 1").fill("Thùng sách");
  await form.getByLabel("Nặng · kg kiện 1").fill("12");
  await form.getByLabel("Dài · cm kiện 1").fill("50");
  await form.getByLabel("Rộng · cm kiện 1").fill("40");
  await form.getByLabel("Cao · cm kiện 1").fill("30");
  await form.getByLabel("Giá trị hàng · VND").fill("300000");
  await form.getByLabel("Tiền thu hộ · VND").fill("100000");
  await form.getByLabel("Ghi chú cho tài xế").fill("Cổng sau");
  await form.locator(".mv-optional summary").click();
  await form.getByLabel("Mã khuyến mãi").fill("MOVING");
  await form
    .getByRole("checkbox", { name: "Yêu cầu bằng chứng giao hàng" })
    .check();
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect(form.getByRole("alert")).toContainText(
    "chọn mức hoặc loại hàng",
  );
  expect(turns.length).toBe(0);
  const tiers = form.getByLabel("Mức dịch vụ · Hàng cồng kềnh");
  await expect(tiers.getByRole("option", { name: /Quá tải/ })).toHaveAttribute(
    "disabled",
    "",
  );
  await tiers.selectOption("large");
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0].moving_options).toMatchObject({
    service_id: "TEST-TRUCK",
    packages: [
      {
        description: "Thùng sách",
        weight_kg: 12,
        length_cm: 50,
        width_cm: 40,
        height_cm: 30,
      },
    ],
    cod: 100000,
    item_value: 300000,
    remarks: "Cổng sau",
    promo_code: "MOVING",
    require_pod: true,
  });
  expect(turns[0].moving_options.requests).toEqual([
    { request_id: "lift" },
    { request_id: "tip", quantity: 2 },
    { request_id: "bulky", tier_code: "large" },
  ]);
  expect(turns[0].pickup).toMatchObject({
    lat: 21.0,
    lng: 105.84,
    confirmed: true,
  });
  expect(turns[0].destination).toMatchObject({
    lat: 21.01,
    lng: 105.85,
    confirmed: true,
  });
  expect(turns[0]).not.toHaveProperty("message");
  expect(turns[0].plan_version).toBe(1);
  await writeFile(
    testInfo.outputPath("moving-submitted.json"),
    JSON.stringify(turns[0]),
  );
});

test("moving validates package weight and COD, and changing vehicles clears incompatible add-ons", async ({
  page,
}) => {
  const { turns } = await movingFormFixture(page);
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await selectMovingService(form, "TEST-TRUCK");
  await form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }).check();
  await form.getByLabel("Tiền thu hộ · VND").fill("600000");
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect(form.getByRole("alert")).toContainText("vượt giới hạn");
  await form.getByRole("button", { name: "Thêm kiện hàng" }).click();
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect(form.getByRole("alert")).toContainText("khối lượng");
  await form.getByRole("button", { name: "Xóa kiện 1" }).click();
  await selectMovingService(form, "TEST-VAN");
  await expect(form.getByLabel("Tiền thu hộ · VND")).toHaveValue("");
  await expect(
    form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }),
  ).toHaveCount(0);
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0].moving_options.requests).toEqual([]);
  expect(turns[0].moving_options.service_id).toBe("TEST-VAN");
});

test("moving clearing an optional package description omits it from the submitted data", async ({
  page,
}, testInfo) => {
  const { turns } = await movingFormFixture(page);
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await form.getByRole("button", { name: "Thêm kiện hàng" }).click();
  await form.getByLabel("Nặng · kg kiện 1").fill("12");
  await form.getByLabel("Mô tả kiện 1").fill("Thùng sách");
  await form.getByLabel("Mô tả kiện 1").fill("   ");
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0].moving_options.packages).toEqual([{ weight_kg: 12 }]);
  await writeFile(
    testInfo.outputPath("moving-submitted.json"),
    JSON.stringify(turns[0]),
  );
});

for (const withQuotes of [true, false]) {
  test(`moving PARTIAL reply ${withQuotes ? "opens usable quotes despite housing warnings" : "keeps the form when no quote was returned"}`, async ({ page }) => {
    const { thread } = await movingFormFixture(page);
    await page.route("**/web/api/threads/th_ui/moving/quote", route => {
      if (withQuotes) {
        thread.state.plan.tasks.push({ id: "moving", agent: "relocation", inputs: {} });
        thread.state.task_status = { ...thread.state.task_status, moving: "done" };
      }
      thread.messages.push({
        id: "partial-moving-reply", role: "assistant", created: Date.now() / 1000,
        content: {
          status: "done",
          response: { kind: "PARTIAL", text: "Đã lấy báo giá. Một số tin nhà chưa xác minh giá.", questions: [], data: {} },
          ui: { version: 1, plan_version: 2, components: withQuotes ? [{
            id: "partial-moving-component", type: "relocation", task_id: "moving", fetched_at: new Date().toISOString(), source_kind: "sandbox",
            data: { from_address: "Cổng A · Hà Nội", to_address: "Cổng B · Hà Nội", payment_method: "CASH", expires_at: new Date(Date.now() + 600000).toISOString(), quotes: [{ id: "partial-quote", label: "Xe tải 500kg", service_id: "TEST-TRUCK", price_vnd: 100000 }] },
          }] : [] },
        },
      });
      return route.fulfill({ json: thread });
    });
    await page.goto("/ai/th_ui");
    const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
    await form.getByRole("button", { name: "Xác nhận và lấy báo giá", exact: true }).click();
    if (withQuotes) {
      await expect(page.getByRole("complementary", { name: "Phương án chuyển đồ", exact: true })).toBeVisible();
      await expect(page.locator(".mv-card")).toHaveCount(1);
      await expect(page.locator(".mv-card .ws-select-small")).toBeEnabled();
      await expect(page.getByRole("complementary", { name: "Thông tin chuyển đồ" })).toHaveCount(0);
    } else {
      await expect(form.getByRole("button", { name: "Xác nhận và lấy báo giá", exact: true })).toBeEnabled();
      await expect(form.getByLabel("Địa chỉ lấy đồ")).toHaveValue("Cổng A · Hà Nội");
      await expect(page.getByRole("heading", { name: "Chọn gói xe phù hợp", exact: true })).toHaveCount(0);
    }
  });
}

test("moving a failed quote keeps locations, schedule, packages and add-ons for retry", async ({
  page,
}) => {
  await movingFormFixture(page);
  const submissions: any[] = [];
  await page.route("**/web/api/threads/th_ui/moving/quote", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({
      status: 502,
      json: { detail: "Chưa lấy được báo giá. Vui lòng thử lại." },
    });
  });
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await selectMovingService(form, "TEST-TRUCK");
  await form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }).check();
  await form.getByRole("button", { name: "Thêm kiện hàng" }).click();
  await form.getByLabel("Nặng · kg kiện 1").fill("12");
  await form.getByLabel("Ghi chú cho tài xế").fill("Giao ở cổng sau");
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect(form.getByRole("alert")).toContainText("Chưa lấy được báo giá");
  await expect(form.getByLabel("Địa chỉ lấy đồ")).toHaveValue(
    "Cổng A · Hà Nội",
  );
  await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue(
    "Cổng B · Hà Nội",
  );
  await expect(form.getByLabel("Ngày chuyển")).toHaveValue(tomorrow());
  await expect(form.getByLabel("Giờ xe đến")).toHaveValue("09:00");
  await expect(
    form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }),
  ).toBeChecked();
  await expect(form.getByLabel("Nặng · kg kiện 1")).toHaveValue("12");
  await expect(form.getByLabel("Ghi chú cho tài xế")).toHaveValue(
    "Giao ở cổng sau",
  );
  await expect(
    form.getByRole("button", { name: "Xác nhận và lấy báo giá" }),
  ).toBeEnabled();
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1].pickup).toEqual(submissions[0].pickup);
  expect(submissions[1].destination).toEqual(submissions[0].destination);
  expect(submissions[1].moving_options).toEqual(submissions[0].moving_options);
});

for (const domain of ["flight", "relocation"]) {
  test(`${domain === "flight" ? "flight" : "moving"} stops selecting an expired price while the workspace remains open`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date() });
    const calls: any[] = [];
    const { thread } = await fixture(page, true, calls);
    const expiresAt = new Date(Date.now() + 30000).toISOString();
    seed(thread, [
      {
        id: domain + ":expiry",
        type: domain,
        task_id: domain,
        data:
          domain === "flight"
            ? {
                origin: "HAN",
                destination: "DAD",
                offers: [
                  {
                    id: "expiring-flight",
                    carrier: "Vietnam Airlines",
                    fare_vnd: 900000,
                    depart_at: "2026-11-20T06:00:00+07:00",
                    arrive_at: "2026-11-20T07:25:00+07:00",
                    stops: 0,
                    expires_at: expiresAt,
                  },
                ],
              }
            : {
                expires_at: expiresAt,
                from_address: "Chợ Bến Thành",
                to_address: "Bưu điện Trung tâm Sài Gòn",
                route: {
                  pickup: {
                    address: "Chợ Bến Thành",
                    lat: 10.7725,
                    lng: 106.698,
                  },
                  destination: {
                    address: "Bưu điện Trung tâm Sài Gòn",
                    lat: 10.78,
                    lng: 106.7,
                  },
                },
                quotes: [
                  {
                    id: "expiring-moving",
                    vehicle: "Xe tải",
                    price_vnd: 250000,
                  },
                ],
              },
      },
    ]);
    await page.goto("/ai/th_ui");
    const choose = page.locator(
      domain === "flight"
        ? ".svc-card-end .primary"
        : ".mv-card .ws-select-small",
    );
    await expect(choose).toBeEnabled();
    await page.clock.fastForward(31000);
    await expect(choose).toBeDisabled();
    await expect(choose).toContainText("hết hạn");
    expect(calls.filter((c) => c.path.endsWith("/action"))).toHaveLength(0);
  });

  test(`${domain === "flight" ? "flight" : "moving"} keeps price expiry when reopening results from chat`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date() });
    const calls: any[] = [];
    const { thread } = await fixture(page, true, calls);
    const expiresAt = new Date(Date.now() + 30000).toISOString();
    seed(thread, [
      {
        id: domain + ":chat-expiry",
        type: domain,
        task_id: domain,
        data:
          domain === "flight"
            ? {
                origin: "HAN",
                destination: "DAD",
                offers: [
                  {
                    id: "chat-expiring-flight",
                    carrier: "Vietnam Airlines",
                    fare_vnd: 900000,
                    depart_at: "2026-11-20T06:00:00+07:00",
                    arrive_at: "2026-11-20T07:25:00+07:00",
                    stops: 0,
                    expires_at: expiresAt,
                  },
                ],
              }
            : {
                expires_at: expiresAt,
                from_address: "Cổng A",
                to_address: "Cổng B",
                quotes: [
                  {
                    id: "chat-expiring-moving",
                    vehicle: "Xe tải",
                    price_vnd: 250000,
                  },
                ],
              },
      },
    ]);
    await page.route("**/web/api/flight/chat-expiring-flight", (route) =>
      route.fulfill({ json: { segments: [], expires_at: expiresAt } }),
    );
    await page.goto("/ai/th_ui");
    await page
      .getByRole("button", { name: "Về hội thoại", exact: true })
      .click();
    await page.getByRole("button", { name: "Xem phương án", exact: true }).click();
    if (domain === "flight") {
      await page.getByRole("button", { name: /Xem hành trình/ }).click();
      await expect(page.getByRole("complementary", { name: "Chi tiết hành trình" })).toBeVisible();
    }
    const choose = page.locator(domain === "flight" ? ".svc-card-end .primary" : ".mv-card .ws-select-small");
    await expect(choose).toBeEnabled();
    await page.clock.fastForward(31000);
    await expect(choose).toBeDisabled();
    await expect(choose).toContainText("hết hạn");
    expect(calls.filter((c) => c.path.endsWith("/action"))).toHaveLength(0);
  });
}

test("flight form validates blank and identical endpoints and preserves input after a service error", async ({
  page,
}) => {
  const { turns } = await fixture(page);
  await page.route("**/web/api/threads/th_ui/chat", (route) =>
    route.fulfill({
      status: 502,
      json: { detail: "Chưa tìm được chuyến bay. Hãy thử lại." },
    }),
  );
  await page.goto("/ai");
  await page.getByRole("button", { name: /Tìm chuyến bay/ }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Nơi đi", { exact: true }).fill("   ");
  await form.getByLabel("Nơi đến", { exact: true }).fill("DAD");
  await form.getByLabel("Ngày bay", { exact: true }).fill(tomorrow());
  await form.getByRole("button", { name: "Tìm chuyến bay", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("nhập nơi đi và nơi đến");
  await form.getByLabel("Nơi đi", { exact: true }).fill("HAN");
  await form.getByLabel("Nơi đến", { exact: true }).fill("han ");
  await form.getByRole("button", { name: "Tìm chuyến bay", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("khác nhau");
  expect(turns.length).toBe(0);
  await form.getByLabel("Nơi đến", { exact: true }).fill("DAD");
  await form.getByRole("button", { name: "Tìm chuyến bay", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText(
    "Chưa tìm được chuyến bay",
  );
  await expect(form.getByLabel("Nơi đi", { exact: true })).toHaveValue("HAN");
  await expect(form.getByLabel("Nơi đến", { exact: true })).toHaveValue("DAD");
  await expect(form.getByLabel("Ngày bay", { exact: true })).toHaveValue(
    tomorrow(),
  );
});

test("moving pickup edits invalidate the catalog selection and both sheets can be collapsed on mobile", async ({
  page,
}, testInfo) => {
  const { turns } = await movingFormFixture(page);
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await selectMovingService(form, "TEST-TRUCK");
  await form.getByRole("checkbox", { name: /Bốc xếp tận nơi/ }).check();
  await form.getByLabel("Địa chỉ lấy đồ").fill("Cổng A mới");
  await expect(
    form.locator('input[name="ahamove-service"]:checked'),
  ).toHaveCount(0);
  await expect(
    form
      .getByRole("group", { name: "Loại xe AhaMove" })
      .getByRole("button", { name: "Xe tải", exact: true }),
  ).toHaveCount(0);
  expect(turns.length).toBe(0);
  if (testInfo.project.name === "mobile") {
    const toggle = form.getByRole("button", {
      name: "Thông tin chuyển đồ",
      exact: true,
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(async () => (await form.boundingBox())!.height)
      .toBeLessThan(50);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("moving catalog errors can be retried without losing the route or calling the agent", async ({
  page,
}) => {
  const { turns } = await movingFormFixture(page);
  let recovered = false;
  await page.route("**/web/api/moving/services?**", (route) => {
    return !recovered
      ? route.fulfill({
          status: 502,
          json: { detail: "Chưa tải được danh mục" },
        })
      : route.fulfill({ json: { services: movingCatalog } });
  });
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await expect(form.getByRole("alert")).toContainText("Chưa tải được danh mục");
  recovered = true;
  await form.getByRole("button", { name: "Tải lại danh mục" }).click();
  await selectMovingService(form, "TEST-TRUCK");
  await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue(
    "Cổng B · Hà Nội",
  );
  await expect(form.getByLabel("Giờ xe đến")).toHaveValue("09:00");
  expect(turns.length).toBe(0);
});

test("moving empty catalogs explain the state and can be retried without submitting a quote", async ({
  page,
}) => {
  const { turns } = await movingFormFixture(page);
  let empty = true;
  await page.route("**/web/api/moving/services?**", (route) =>
    route.fulfill({ json: { services: empty ? [] : movingCatalog } }),
  );
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await expect(form.getByRole("alert")).toContainText(
    "Chưa có gói xe trong danh mục tại điểm A",
  );
  empty = false;
  await form.getByRole("button", { name: "Tải lại danh mục" }).click();
  await selectMovingService(form, "TEST-TRUCK");
  await expect(form.getByRole("alert")).toHaveCount(0);
  expect(turns.length).toBe(0);
});

for (const withHouse of [false, true]) {
  test(`moving map taps keep an explicit destination when selected house is ${withHouse ? "present" : "absent"}`, async ({
    page,
  }, testInfo) => {
    const { thread, turns } = await movingFormFixture(page);
    delete thread.state.intake.constraints.values.to_address;
    delete thread.state.intake.constraints.values.destination_coordinate;
    delete thread.state.intake.user_confirmed_facts.to_address;
    delete thread.state.intake.user_confirmed_facts.destination_coordinate;
    if (withHouse) {
      thread.state.intake.user_confirmed_facts["selected:property"] = {
        value: houses[0].id,
      };
      thread.state.selections = { property: houses[0] };
    }
    await page.goto("/ai/th_ui");
    const form = page.getByRole("complementary", {
      name: "Thông tin chuyển đồ",
    });
    await form.getByLabel("Địa chỉ giao đồ").fill("Cổng giao mới");
    const toggle = form.getByRole("button", {
      name: "Thông tin chuyển đồ",
      exact: true,
    });
    if (testInfo.project.name === "mobile") await toggle.click();
    const canvas = page.locator(".ws-canvas canvas");
    await expect(canvas).toBeVisible();
    await canvas.click({ position: { x: 200, y: 160 } });
    if (testInfo.project.name === "mobile") await toggle.click();
    await expect(
      form.getByText("Đã ghim: Vị trí bạn chạm trên bản đồ"),
    ).toBeVisible();
    await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
    await expect.poll(() => turns.length).toBe(1);
    expect(turns[0]).not.toHaveProperty("message");
    expect(turns[0].destination).toMatchObject({
      address: "Cổng giao mới",
      confirmed: true,
    });
    expect(Number.isFinite(turns[0].destination.lat)).toBeTruthy();
    expect(Number.isFinite(turns[0].destination.lng)).toBeTruthy();
  });
}

test("map handles structured provider warnings and approximate POIs", async ({
  page,
}) => {
  const { thread } = await fixture(page);
  seed(thread, [
    {
      id: "route",
      type: "map",
      task_id: "map",
      data: {
        nearby: {
          home: [
            {
              id: "poi",
              name: "Nhà thuốc thử nghiệm",
              location: { lat: 10.77, lng: 106.7 },
              distance_m: 125,
            },
          ],
        },
        approximate_origins: ["home"],
        routing: {
          profile: "walking",
          route: {
            distance_meters: 1600,
            duration_seconds: 1200,
            geometry: {
              type: "LineString",
              coordinates: [
                [106.7, 10.77],
                [106.71, 10.78],
              ],
            },
          },
          warnings: [{ code: "APPROXIMATE_LOCATION", endpoint: "origin" }],
        },
      },
    },
  ]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/ai/th_ui");
  await expect(page.getByText("1.60 km")).toBeVisible();
  await expect(page.getByText(/Điểm đi có vị trí gần đúng/)).toBeVisible();
  await page
    .getByRole("button", { name: "Tính đường tới Nhà thuốc thử nghiệm" })
    .click();
  await page.getByRole("button", { name: "Về hội thoại", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" }),
  ).toHaveValue(/Nhà thuốc thử nghiệm/);
  expect(errors).toEqual([]);
});

test("AhaMove quote fee breakdown, order amount and tracking use provider fields", async ({
  page,
}) => {
  const { thread } = await fixture(page);
  seed(thread, [
    {
      id: "moving",
      type: "relocation",
      task_id: "moving",
      data: {
        expires_at: new Date(Date.now() + 300000).toISOString(),
        quotes: [
          {
            id: "q:truck",
            vehicle: "Xe tải thử nghiệm",
            price_vnd: 250000,
            fee_breakdown: {
              currency: "VND",
              distance_price: 200000,
              stop_point_price: 50000,
              total_price: 250000,
            },
          },
        ],
        order: {
          order_id: "order-test",
          status: "ACCEPTED",
          total_price: 250000,
          shared_link: "https://example.test/tracking",
        },
      },
    },
  ]);
  await page.goto("/ai/th_ui");
  await expect(
    page.getByRole("link", { name: "Theo dõi", exact: true }),
  ).toHaveAttribute("href", "https://example.test/tracking");
  await page.getByRole("button", { name: "Xem dịch vụ", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Chi tiết dịch vụ" });
  await expect(modal.getByText("Phí quãng đường")).toBeVisible();
  await expect(modal.getByText("200.000 ₫")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Yêu cầu hủy đơn" }).click();
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" }),
  ).toHaveValue(/điều kiện hủy/);
});

test("approval sends PII separately, blocks double submit and shows receipt", async ({
  page,
}) => {
  const { thread } = await fixture(page);
  seed(thread);
  thread.state.pending = {
    type: "confirmation_required",
    plan_version: 1,
    payload_hash: "test-hash",
    expires_at: new Date(Date.now() + 300000).toISOString(),
    cost_summary: {
      lines: [
        {
          task_id: "moving",
          label: "Xe tải",
          amount_vnd: 250000,
          recurrence: "one_time",
        },
      ],
      total_one_time_vnd: 250000,
      total_monthly_vnd: 9000000,
      commit_actions: [{ id: "book", kind: "moving_booking" }],
    },
    pii_required: { book: ["pickup_contact", "destination_contact"] },
  };
  await page.route("**/web/api/status", (r) =>
    r.fulfill({
      json: { domains: ["property", "relocation"], writes_enabled: true },
    }),
  );
  let calls = 0;
  await page.route("**/web/api/threads/th_ui/decision", async (r) => {
    calls++;
    const body = r.request().postDataJSON();
    expect(body.payload_hash).toBe("test-hash");
    expect(body.pii_forms.book.pickup_contact.mobile).toBe("0901234567");
    expect(body.pii_forms.book.destination_contact.building).toBe("Tòa nhà B");
    expect(body.pii_forms.book.destination_contact.apartment_or_floor).toBe(
      "302",
    );
    expect(body.pii_forms.book.destination_contact.remarks).toBe(
      "Có thang máy",
    );
    expect(body.message).toBeUndefined();
    thread.state.pending = null;
    thread.messages.push({
      id: "receipt",
      role: "assistant",
      created: Date.now() / 1000,
      content: {
        status: "done",
        response: {
          kind: "COMMITTED",
          text: "Đã xác nhận",
          data: {
            receipts: [
              {
                action_id: "book",
                kind: "moving_booking",
                receipt_id: "order-confirmed",
                provider: "ahamove",
                status: "confirmed",
                source_kind: "sandbox",
                amount_vnd: 250000,
                details: { shared_link: "https://example.test/order" },
              },
            ],
          },
        },
      },
    });
    await r.fulfill({ json: thread });
  });
  await page.goto("/ai/th_ui");
  await expect(
    page.getByText("Đặt đơn chuyển đồ", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Họ tên", { exact: true }).nth(0).fill("Test Pickup");
  await page
    .getByLabel("Họ tên", { exact: true })
    .nth(1)
    .fill("Test Destination");
  await page
    .getByLabel("Số điện thoại", { exact: true })
    .nth(0)
    .fill("0901234567");
  await page.getByRole("button", { name: "Dùng liên hệ điểm lấy" }).click();
  await expect(page.getByLabel("Họ tên", { exact: true }).nth(1)).toHaveValue(
    "Test Pickup",
  );
  await expect(
    page.getByLabel("Số điện thoại", { exact: true }).nth(1),
  ).toHaveValue("0901234567");
  await page
    .getByLabel("Số điện thoại", { exact: true })
    .nth(1)
    .fill("0907654321");
  await page.getByLabel("Tòa nhà", { exact: true }).nth(1).fill("Tòa nhà B");
  await page.getByLabel("Căn hộ / tầng", { exact: true }).nth(1).fill("302");
  await page
    .getByLabel("Chỉ dẫn giao nhận", { exact: true })
    .nth(1)
    .fill("Có thang máy");
  await page.getByRole("checkbox", { name: /Tôi đồng ý/ }).check();
  await page.getByRole("button", { name: "Xác nhận thao tác" }).click();
  await expect(page.getByText("Biên nhận dịch vụ")).toBeVisible();
  expect(calls).toBe(1);
  await expect(
    page.getByRole("link", { name: "Theo dõi đơn" }),
  ).toHaveAttribute("href", "https://example.test/order");
  await expect(page.getByText("0901234567", { exact: true })).toHaveCount(0);
});

test("expired approval stays blocked and payment check never claims paid", async ({
  page,
}) => {
  const { thread } = await fixture(page);
  seed(thread);
  thread.state.pending = {
    type: "confirmation_required",
    plan_version: 1,
    expires_at: "2020-01-01T00:00:00Z",
    cost_summary: { commit_actions: [{ id: "book", kind: "moving_booking" }] },
  };
  await page.route("**/web/api/status", (r) =>
    r.fulfill({ json: { domains: ["relocation"], writes_enabled: true } }),
  );
  await page.goto("/ai/th_ui");
  await expect(page.getByRole("button", { name: "Xác nhận thao tác" })).toBeDisabled();
  thread.state.pending = {
    type: "payment_required",
    amount_vnd: 10000,
    source_kind: "sandbox",
    expires_at: new Date(Date.now() + 300000).toISOString(),
    pay_url: "https://example.test/pay",
  };
  let checks = 0;
  await page.route("**/web/api/threads/th_ui/payment/check", (r) => {
    checks++;
    return r.fulfill({ json: thread });
  });
  await page.reload();
  await expect(page.getByRole("link", { name: /Mở trang thanh toán/ })).toHaveAttribute("href", "https://example.test/pay");
  await page.getByRole("button", { name: "Kiểm tra thanh toán" }).click();
  await expect(page.getByText("Thanh toán đang chờ xác minh")).toBeVisible();
  expect(checks).toBe(1);
  await expect(page.getByText("Đã thanh toán", { exact: true })).toHaveCount(0);
});

test("service failure preserves user form input", async ({ page }) => {
  await fixture(page);
  await page.route("**/web/api/threads/th_ui/chat", (r) =>
    r.fulfill({ status: 502, json: { detail: "Dịch vụ chưa phản hồi" } }),
  );
  await page.goto("/ai");
  await page.getByRole("button", { name: "Tìm nhà Một nơi ở phù hợp với bạn", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Thành phố", { exact: true }).selectOption("Thành phố Hồ Chí Minh");
  await modal.getByLabel("Quận / khu vực", { exact: true }).fill("Quận 7");
  await modal.getByRole("button", { name: /Áp dụng/ }).click();
  await expect(modal.getByText("Dịch vụ chưa phản hồi")).toBeVisible();
  await expect(modal.getByLabel("Quận / khu vực", { exact: true })).toHaveValue(
    "Quận 7",
  );
});

test("login, welcome and responsive navigation", async ({ page }, info) => {
  await fixture(page, false);
  await page.goto("/ai");
  await expect(
    page.getByRole("heading", { name: "Chào bạn quay lại" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("login.png"), fullPage: true });
  await page.getByLabel("Email", { exact: true }).fill("minhanh@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("strong-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).focus();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /kế hoạch gì hôm nay/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Tìm nhà Một nơi ở phù hợp với bạn", exact: true })).toBeEnabled();
  await expect(
    page.getByText("Không gian của bạn", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".sidebar")).toHaveCount(0);
  expect((await page.locator(".main-shell").boundingBox())!.x).toBe(0);
  await page.screenshot({
    path: info.outputPath("welcome.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("link", { name: "Mở tài khoản" }).focus();
  await page.getByRole("link", { name: "Mở tài khoản" }).click();
  await expect(
    page.getByRole("heading", { name: "Tài khoản của tôi" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Chưa có lịch sử yêu cầu" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Hồ sơ & bảo mật", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Tên hiển thị" })).toHaveValue(
    "Minh Anh",
  );
  await page
    .getByRole("tab", { name: "Hồ sơ & bảo mật", exact: true })
    .click();
  await expect(
    page.getByText("Đổi hoặc khôi phục mật khẩu hiện chưa được hỗ trợ."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Về chat", exact: true }).focus();
  await page.getByRole("link", { name: "Về chat", exact: true }).click();
  await page.getByRole("button", { name: "Xem nhanh kế hoạch" }).click();
  await expect(
    page.getByRole("tab", { name: "Các kế hoạch", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Kế hoạch bắt đầu từ câu chuyện của bạn"),
  ).toBeVisible();
});

test("chat, housing details, selection, saved, plan and reload", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => {
    if (r.url().includes("maplibre-gl-worker"))
      errors.push(r.failure()?.errorText || "Map worker failed");
  });
  await fixture(page);
  await page.goto("/ai");
  await page
    .getByRole("textbox", { name: "Tin nhắn cho ReloHome" })
    .fill("Tìm nhà 2 phòng ngủ tại Quận 1 dưới 10 triệu/tháng");
  await page.getByRole("button", { name: "Gửi tin nhắn" }).click();
  // Current search results live in the map; the full detail dialog is shared with saved homes.
  const list = page.getByRole("complementary", { name: "Nhà trong vùng bản đồ" });
  await expect(list.locator(".ws-card")).toHaveCount(2);
  await expect(page.locator(".ws-canvas canvas")).toBeAttached();
  await page.screenshot({
    path: info.outputPath("housing.png"),
    fullPage: true,
  });
  await list.locator(".title-button").nth(1).click();
  await page.getByRole("button", { name: "Thông tin chi tiết ›", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Chi tiết nhà" }),
  ).toBeVisible();
  await page.getByRole("dialog", { name: "Chi tiết nhà" }).getByRole("button", { name: "Chọn căn này", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Chi tiết nhà" }).getByRole("button", { name: "Đã chọn", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Lưu nhà", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  await expect(list.locator(".ws-card.chosen")).toContainText(houses[1].title);
  await page.reload();
  await expect(list.locator(".ws-card.chosen")).toContainText(houses[1].title);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.goto("/plans/th_ui");
  await expect(page).toHaveURL(/\/ai\/th_ui\?panel=plan$/);
  await expect(
    page.getByRole("region", { name: "Kế hoạch trong cuộc trò chuyện" }),
  ).toContainText("Có kết quả");
  await page.screenshot({ path: info.outputPath("plan.png"), fullPage: true });
  await page.goto("/account");
  await page.getByRole("tab", { name: /Đã lưu/ }).click();
  await expect(
    page.getByRole("button", { name: houses[1].title, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("account.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

const tomorrow = () => {
  const d = new Date(Date.now() + 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("chosen home prefills the moving form; nothing is sent until confirmed", async ({
  page,
}) => {
  const { thread, turns } = await fixture(page);
  // Chosen on the map: only the agent state knows it, not any chat message.
  thread.state.intake.user_confirmed_facts["selected:property"] = {
    value: "map-only",
  };
  thread.state.selections = {
    property: {
      id: "map-only",
      title: "Phòng trọ trên bản đồ",
      address: "255 Cầu Giấy, Hà Nội",
      lat: 21.031,
      lng: 105.799,
      location_accuracy: "approximate",
    },
  };
  seed(thread);
  await page.goto("/ai/th_ui");
  await expect(page.getByText("Đã chọn:")).toContainText(
    "Phòng trọ trên bản đồ",
  );
  await page.getByRole("button", { name: /Chuyển đồ tới đây/ }).click();
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await expect(form).toContainText("Phòng đã chọn: Phòng trọ trên bản đồ");
  await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue(
    "255 Cầu Giấy, Hà Nội",
  );
  // The decided home is point B without another click; its approximate location stays flagged.
  await expect(form).toContainText("Điểm B là căn đã chốt.");
  await expect(form).toContainText("Vị trí tin đăng có thể gần đúng");
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect(form.getByRole("alert")).toContainText("điểm lấy");
  await form.getByLabel("Địa chỉ lấy đồ").fill("Đại học Bách khoa Hà Nội");
  await form.getByLabel("Ngày chuyển").fill(tomorrow());
  await form.getByLabel("Giờ xe đến").fill("09:00");
  // Typed text without a picked suggestion is not a confirmed point A.
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect(form.getByRole("alert")).toContainText("ghim điểm A");
  expect(turns).toEqual([]);
  const pickup = form.locator(".mv-endpoint").filter({
    has: page.getByLabel("Địa chỉ lấy đồ"),
  });
  await pickup.locator("button.place").first().click();
  await expect(pickup.locator("small.ok")).toContainText("Đã ghim:");
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0]).toMatchObject({
    destination: {
      address: "255 Cầu Giấy, Hà Nội",
      lat: 21.031,
      lng: 105.799,
      confirmed: true,
    },
    destination_listing_id: "map-only",
    pickup: { lat: 10.776, lng: 106.697, confirmed: true },
    move_date: tomorrow(),
    move_time: "09:00",
  });
});

test("map-only selected home is restored into point B after delayed detail and reload", async ({
  page,
}, info) => {
  const { thread, turns } = await movingFormFixture(page);
  const home = {
    ...houses[0],
    id: "map-only-home",
    title: "Phòng đã chọn ở Bình Thạnh",
    address: "325/29A Bạch Đằng, Bình Thạnh, Hồ Chí Minh",
    lat: 10.800452,
    lng: 106.70504,
  };
  thread.state.intake.user_confirmed_facts["selected:property"] = {
    value: home.id,
  };
  for (const key of [
    "from_address",
    "to_address",
    "pickup_coordinate",
    "destination_coordinate",
  ]) {
    delete thread.state.intake.user_confirmed_facts[key];
    delete thread.state.intake.constraints.values[key];
  }
  let release!: () => void;
  const detailReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/web/api/housing/map-only-home", async (route) => {
    await detailReady;
    await route.fulfill({ json: home });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await expect(form.getByText("Đang lấy địa chỉ căn đã chọn…")).toBeVisible();
  release();
  const homeCard = form.getByRole("button", {
    name: `Giao tới phòng đã chọn (${home.title})`,
  });
  await expect(homeCard).toHaveAttribute("aria-pressed", "true");
  await expect(homeCard).toContainText(home.address);
  await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue(home.address);
  await expect(form.getByLabel("Ngày chuyển")).toHaveValue(tomorrow());
  await expect(form.getByLabel("Giờ xe đến")).toHaveValue("09:00");
  await form.getByLabel("Địa chỉ giao đồ").fill("Địa chỉ B khác");
  await expect(homeCard).toHaveAttribute("aria-pressed", "false");
  await expect(homeCard).toContainText(home.address);
  await homeCard.click();
  await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue(home.address);
  // The decided home is point B, but an approximate listing location is never shown as a
  // user-confirmed pin.
  await expect(form).not.toContainText("Đã ghim:");
  await expect(
    page.getByRole("button", {
      name: "Chọn Phòng đã chọn: " + home.title,
      exact: true,
    }),
  ).toBeAttached();
  await page.screenshot({
    path: info.outputPath("moving-selected-home.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.reload();
  await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue(home.address);
  await expect(homeCard).toContainText(home.address);
  expect(turns).toEqual([]);
  expect(errors).toEqual([]);
});

test("a late selected-home response never overwrites a user-entered point B", async ({
  page,
}) => {
  const { thread, turns } = await movingFormFixture(page);
  thread.state.intake.user_confirmed_facts["selected:property"] = {
    value: "map-late",
  };
  delete thread.state.intake.user_confirmed_facts.to_address;
  delete thread.state.intake.constraints.values.to_address;
  delete thread.state.intake.constraints.values.destination_coordinate;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/web/api/housing/map-late", async (route) => {
    await ready;
    await route.fulfill({ json: { ...houses[0], id: "map-late" } });
  });
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await form.getByLabel("Địa chỉ giao đồ").fill("Điểm B do người dùng nhập");
  release();
  const card = form.getByRole("button", {
    name: `Giao tới phòng đã chọn (${houses[0].title})`,
  });
  await expect(card).toBeAttached();
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue(
    "Điểm B do người dùng nhập",
  );
  await card.click();
  await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue(
    houses[0].address,
  );
  await expect(form.getByLabel("Địa chỉ lấy đồ")).toHaveValue(
    "Cổng A · Hà Nội",
  );
  expect(turns).toEqual([]);
});

test("missing selected-home detail keeps point B editable and explains the lookup failure", async ({
  page,
}) => {
  const { thread, turns } = await movingFormFixture(page);
  thread.state.intake.user_confirmed_facts["selected:property"] = {
    value: "map-missing",
  };
  delete thread.state.intake.user_confirmed_facts.to_address;
  delete thread.state.intake.constraints.values.to_address;
  await page.route("**/web/api/housing/map-missing", (route) =>
    route.fulfill({ status: 404, json: { detail: "Not found" } }),
  );
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await expect(form).toContainText("Chưa đọc được địa chỉ căn đã chọn");
  await form.getByLabel("Địa chỉ giao đồ").fill("Điểm giao mới");
  await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue("Điểm giao mới");
  await expect(form.locator(".mv-selected-home")).toHaveCount(0);
  expect(turns).toEqual([]);
});

test("a moving question opens the moving form; a new address needs the pin again", async ({
  page,
}) => {
  const { thread, turns } = await fixture(page);
  thread.messages.push({
    id: "moving-question",
    role: "assistant",
    created: Date.now() / 1000,
    content: {
      status: "done",
      response: {
        kind: "CLARIFY",
        text: "Mình cần thêm vài thông tin để báo giá chuyển đồ.",
        questions: [
          {
            field: "relocation.move_date",
            text: "Bạn muốn chuyển đồ ngày nào?",
          },
          {
            field: "to_address",
            text: "Bạn chọn đúng điểm giao trên bản đồ nhé.",
            choices: [
              {
                id: "place-1",
                label: "Ngõ 43 Trung Kính",
                entity_type: "place",
                lat: 21.0207,
                lng: 105.7917,
              },
            ],
          },
        ],
        data: {
          known_request: {
            from_address: "Đại học Bách khoa Hà Nội",
            to_address: "Ngõ 43 Phố Trung Kính, Cầu Giấy",
            move_time: "10:00",
          },
        },
      },
    },
  });
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await expect(form).toContainText("Bạn muốn chuyển đồ ngày nào?");
  await expect(form.getByLabel("Địa chỉ lấy đồ")).toHaveValue(
    "Đại học Bách khoa Hà Nội",
  );
  await expect(form.getByLabel("Giờ xe đến")).toHaveValue("10:00");
  await form.getByRole("button", { name: /Ngõ 43 Trung Kính/ }).click();
  await expect(form).toContainText("Đã ghim: Ngõ 43 Trung Kính");
  await form.getByLabel("Địa chỉ giao đồ").fill("Ngõ 45 Phố Trung Kính");
  await expect(form).not.toContainText("Đã ghim: Ngõ 43 Trung Kính");
  await form
    .getByLabel("Địa chỉ giao đồ")
    .fill("Ngõ 43 Phố Trung Kính, Cầu Giấy");
  await form.getByRole("button", { name: /Ngõ 43 Trung Kính/ }).click();
  await form.getByLabel("Ngày chuyển").fill(tomorrow());
  // Point A arrived from chat as text only; the quote form needs it confirmed as well.
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect(form.getByRole("alert")).toContainText("ghim điểm A");
  expect(turns).toEqual([]);
  await form.getByLabel("Địa chỉ lấy đồ").click();
  await form
    .locator(".mv-endpoint")
    .filter({ has: page.getByLabel("Địa chỉ lấy đồ") })
    .locator("button.place")
    .first()
    .click();
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0]).toMatchObject({
    pickup: { lat: 10.776, lng: 106.697, confirmed: true },
    destination: {
      address: "Ngõ 43 Phố Trung Kính, Cầu Giấy",
      lat: 21.0207,
      lng: 105.7917,
      confirmed: true,
    },
  });
});

test("POI picker collapses aliases, labels the city and preserves moving date and time", async ({
  page,
}) => {
  const duplicateKeys: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("same key"))
      duplicateKeys.push(message.text());
  });
  const { thread, turns } = await fixture(page);
  thread.messages.push({
    id: "poi-question",
    role: "assistant",
    created: Date.now() / 1000,
    content: {
      status: "done",
      response: {
        kind: "CLARIFY",
        text: "Chọn điểm lấy đồ.",
        questions: [
          {
            field: "from_address",
            text: "Chọn điểm lấy đồ.",
            choices: [
              {
                id: "old-way",
                label: "Đại học Bách Khoa",
                entity_type: "place",
                lat: 21,
                lng: 105.84,
              },
              {
                id: "old-way",
                label: "Đại học Bách Khoa",
                entity_type: "place",
                lat: 21,
                lng: 105.84,
              },
              {
                id: "stop-2",
                label: "Đại học Bách Khoa · Trạm xe buýt",
                entity_type: "place",
                lat: 21.001,
                lng: 105.84,
              },
            ],
          },
        ],
        data: {
          known_request: {
            from_address: "Đại học Bách Khoa",
            to_address: "12 Tràng Tiền, Hà Nội",
            move_date: tomorrow(),
            move_time: "10:00",
          },
        },
      },
    },
  });
  await page.route("**/api/map/search?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        results: new URL(route.request().url()).searchParams
          .get("text")!
          .includes("Tràng Tiền")
          ? [
              {
                canonical_id: "trang-tien-12",
                name: "12 Tràng Tiền",
                display_name: "12 Tràng Tiền · Hoàn Kiếm · Hà Nội",
                entity_type: "address",
                location: { lat: 21.0245, lng: 105.8566 },
              },
            ]
          : [
              {
                canonical_id: "canonical-area",
                alias_ids: ["old-way"],
                name: "Đại học Bách Khoa",
                display_name: "Đại học Bách Khoa · Trường đại học · Hà Nội",
                entity_type: "place",
                category: "university",
                location: { lat: 21.0003, lng: 105.8403 },
              },
            ],
      }),
    }),
  );
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await expect(
    form.getByRole("button", { name: "Đại học Bách Khoa", exact: true }),
  ).toHaveCount(1);
  await form
    .getByRole("textbox", { name: "Địa chỉ lấy đồ", exact: true })
    .fill("Đại học Bách Khoa");
  await expect(form.getByRole("textbox", { name: /Địa chỉ/ })).toHaveCount(2);
  await expect(form.getByRole("textbox", { name: "Tìm địa điểm" })).toHaveCount(
    0,
  );
  await expect(
    form.getByRole("button", { name: "Đại học Bách Khoa", exact: true }),
  ).toHaveCount(0);
  await expect(form.getByRole("button", { name: /Trạm xe buýt/ })).toHaveCount(
    1,
  );
  await expect(form.getByLabel("Ngày chuyển")).toHaveValue(tomorrow());
  await expect(form.getByLabel("Giờ xe đến")).toHaveValue("10:00");
  expect(turns).toEqual([]);
  await form.getByRole("button", { name: /Trường đại học · Hà Nội/ }).click();
  // No home is decided here, so point B is picked from search just like point A.
  await form.getByLabel("Địa chỉ giao đồ").click();
  await form.getByRole("button", { name: /12 Tràng Tiền · Hoàn Kiếm/ }).click();
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0]).toMatchObject({
    pickup: { lat: 21.0003, lng: 105.8403, confirmed: true },
    destination: { lat: 21.0245, lng: 105.8566, confirmed: true },
    move_date: tomorrow(),
    move_time: "10:00",
  });
  expect(duplicateKeys).toEqual([]);
});

test("moving A and B search inline and submit the selected coordinates", async ({
  page,
}) => {
  const { thread, turns } = await fixture(page);
  thread.messages.push({
    id: "moving-inline",
    role: "assistant",
    created: Date.now() / 1000,
    content: {
      status: "done",
      response: {
        kind: "CLARIFY",
        text: "Chọn điểm lấy và điểm giao đồ.",
        questions: [{ field: "from_address", text: "Điểm lấy đồ?" }],
        data: { known_request: { move_date: tomorrow(), move_time: "10:00" } },
      },
    },
  });
  const queries: string[] = [];
  await page.route("**/api/map/search?**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("text")!;
    queries.push(query);
    const pickup = query === "Bách Khoa Hà Nội";
    return route.fulfill({
      json: {
        results: [
          {
            canonical_id: pickup ? "pickup-university" : "destination-home",
            name: pickup ? "Đại học Bách khoa Hà Nội" : "12 Tràng Tiền, Hà Nội",
            entity_type: "place",
            location: pickup
              ? { lat: 21.005, lng: 105.843 }
              : { lat: 21.024, lng: 105.856 },
          },
        ],
      },
    });
  });
  await page.goto("/ai/th_ui");
  const form = page.getByRole("complementary", { name: "Thông tin chuyển đồ" });
  await expect(form.getByRole("textbox", { name: /Địa chỉ/ })).toHaveCount(2);
  await expect(
    form.getByRole("button", { name: "Tìm", exact: true }),
  ).toHaveCount(0);
  await form.getByLabel("Địa chỉ lấy đồ").fill("Bách Khoa Hà Nội");
  await form
    .getByRole("button", { name: "Đại học Bách khoa Hà Nội", exact: true })
    .click();
  await expect(form.getByLabel("Địa chỉ lấy đồ")).toHaveValue(
    "Đại học Bách khoa Hà Nội",
  );
  await form.getByLabel("Địa chỉ giao đồ").fill("Tràng Tiền Hà Nội");
  await form
    .getByRole("button", { name: "12 Tràng Tiền, Hà Nội", exact: true })
    .click();
  await expect(form.getByLabel("Địa chỉ giao đồ")).toHaveValue(
    "12 Tràng Tiền, Hà Nội",
  );
  expect(turns).toEqual([]);
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(queries).toEqual(["Bách Khoa Hà Nội", "Tràng Tiền Hà Nội"]);
  expect({
    pickup: turns[0].pickup,
    destination: turns[0].destination,
  }).toEqual({
    pickup: {
      address: "Đại học Bách khoa Hà Nội",
      lat: 21.005,
      lng: 105.843,
      confirmed: true,
    },
    destination: {
      address: "12 Tràng Tiền, Hà Nội",
      lat: 21.024,
      lng: 105.856,
      confirmed: true,
    },
  });
});

test("housing answer opens the map workspace with viewport list, filters and chat dock", async ({
  page,
}, info) => {
  const calls: any[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page, true, calls);
  await page.goto("/ai");
  await page
    .getByRole("textbox", { name: "Tin nhắn cho ReloHome" })
    .fill("Tìm nhà dưới 10 triệu ở Quận 1");
  await page.getByRole("button", { name: "Gửi tin nhắn" }).click();
  const list = page.getByRole("complementary", {
    name: "Nhà trong vùng bản đồ",
  });
  await expect(
    page.getByRole("region", { name: "Bản đồ nhà ở" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Xem nhanh kế hoạch" }).click();
  const quickPlan = page.getByRole("region", {
    name: "Kế hoạch trong cuộc trò chuyện",
  });
  await expect(quickPlan).toContainText("Thành phố Hồ Chí Minh");
  await page.getByRole("button", { name: "Đóng kế hoạch nhanh" }).click();
  await expect(
    page.getByRole("button", { name: "Tiện ích", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(() => calls.filter((c) => c.path === "/platform/places/map").length)
    .toBeGreaterThan(0);
  // Every listing has its own address and opens the existing consent-based directions dialog.
  await expect(list.getByText(houses[0].title)).toBeAttached();
  await expect(
    list.getByText("12, Lê Lợi, Bến Nghé, Quận 1, Hồ Chí Minh").first(),
  ).toBeAttached();
  await list.getByRole("button", { name: "Chỉ đường từ vị trí của bạn" }).first().click();
  const directions = page.getByRole("dialog", { name: "Từ vị trí của bạn tới căn nhà" });
  await expect(directions).toBeVisible();
  await directions.getByRole("button", { name: "Đóng", exact: true }).click();
  // Chat filters are applied to the viewport list request, with the chosen sort and page size.
  await expect
    .poll(() => calls.filter((c) => c.path.endsWith("/search")).length)
    .toBeGreaterThan(0);
  let search = calls.filter((c) => c.path.endsWith("/search")).pop().body;
  expect(search.district).toBe("Quận 1");
  expect(search.max_price.amount).toBe(10000000);
  expect(search.pagination.limit).toBe(10);
  expect(search.bounding_box.west).toBeLessThan(search.bounding_box.east);
  if (info.project.name === "mobile") await page.getByRole("button", { name: "Bộ lọc", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Sắp xếp" })
    .selectOption("price_asc");
  await expect
    .poll(
      () => calls.filter((c) => c.path.endsWith("/search")).pop().body.sort[0],
    )
    .toEqual({ field: "price_amount", direction: "asc" });
  // The chat dock sends the current map view so "khu này" refers to it.
  let sent: any = null;
  await page.route("**/web/api/threads/th_ui/chat", async (route) => {
    sent = route.request().postDataJSON();
    await route.fallback();
  });
  await page.getByRole("button", { name: "Hiện khung chat" }).click();
  await page
    .getByRole("textbox", { name: "Tin nhắn cho ReloHome" })
    .fill("Căn rẻ hơn ở khu này");
  await page.getByRole("button", { name: "Gửi tin nhắn" }).click();
  await expect.poll(() => sent?.map_view?.bounding_box?.west).toBeDefined();
  expect(sent.map_view.zoom).toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath("map-workspace.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

for (const replyKind of ["ERROR", "CLARIFY"]) {
  test(`housing map scope follow-up keeps context on ${replyKind} and replaces it only after success`, async ({ page }) => {
    const calls: any[] = [];
    const { thread, component } = await fixture(page, true, calls);
    seed(thread, [component]);
    thread.state.intake = { kind: "new_goal", intent: { domains: ["property"] }, user_confirmed_facts: {} };
    await page.goto("/ai/th_ui");
    const map = page.getByRole("region", { name: "Bản đồ nhà ở" });
    await expect(map).toBeVisible();
    await map.evaluate(el => el.setAttribute("data-followup-identity", "mounted"));
    const reason = replyKind === "ERROR"
      ? "Tìm ở Cầu Giấy đang bị gián đoạn. Bạn thử lại nhé."
      : 'Mình chưa xác định được vị trí "Cầu Giấy". Bạn muốn tìm theo khu vực nào?';
    let attempt = 0;
    await page.route("**/web/api/threads/th_ui/chat", async route => {
      attempt += 1;
      const body = route.request().postDataJSON();
      thread.messages.push({ id: `scope-user-${attempt}`, role: "user", content: { status: "done", text: body.message } });
      const success = attempt > 1;
      thread.state.plan.version = attempt + 1;
      thread.state.intake = {
        kind: "change", intent: { domains: ["property"] },
        constraints: { values: { district: "Cầu Giấy", city: "Hà Nội", max_price_vnd: 5000000 } },
        user_confirmed_facts: {},
      };
      thread.state.task_status.housing = success ? "done" : replyKind === "ERROR" ? "failed" : "needs_input";
      const updated = {
        ...component, id: "housing:caugiay", data: {
          ...component.data, area_name: "Phường Cầu Giấy",
          search_request: { administrative_area_ids: ["caugiay"], max_price: { amount: 5000000, currency: "VND", period: "month" } },
          map_context: { viewport: { west: 105.77, south: 21.01, east: 105.82, north: 21.05 } },
        },
      };
      thread.messages.push({
        id: `scope-reply-${attempt}`, role: "assistant", created: Date.now() / 1000,
        content: {
          status: "done",
          response: { kind: success ? "ANSWER" : replyKind, text: success ? "Kết quả tại Cầu Giấy." : reason,
            questions: !success && replyKind === "CLARIFY" ? [{ field: "near", text: reason, options: ["Phường Cầu Giấy"] }] : [] },
          ui: { version: 1, plan_version: attempt + 1, components: success ? [updated] : [] },
        },
      });
      await route.fulfill({ json: thread });
    });
    await page.getByRole("button", { name: "Hiện khung chat" }).click();
    const input = page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" });
    await input.fill("đổi lại khu vực cầu giấy hà nội");
    await page.getByRole("button", { name: "Gửi tin nhắn" }).click();
    const dock = page.getByRole("region", { name: "Trò chuyện với ReloHome" });
    await expect(dock).toContainText(reason);
    await expect(dock).toContainText("khu vực mới chưa được cập nhật");
    await expect(map).toHaveAttribute("data-followup-identity", "mounted");
    await expect(page.locator(".guided-service-panel")).toHaveCount(0);
    for (const button of await page.getByRole("button", { name: "Chọn căn này", exact: true }).all())
      await expect(button).toBeDisabled();
    if (replyKind === "CLARIFY") {
      await dock.getByRole("button", { name: "Phường Cầu Giấy", exact: true }).click();
    } else {
      await input.fill("Thử tìm lại ở khu vực Cầu Giấy Hà Nội");
      await page.getByRole("button", { name: "Gửi tin nhắn" }).click();
    }
    await expect.poll(() => calls.filter(c => c.path === "/platform/housing/search").at(-1)?.body.administrative_area_ids).toEqual(["caugiay"]);
    await expect(map).toHaveAttribute("data-followup-identity", "mounted");
    await expect(page.getByText("Bản đồ đang hiển thị kết quả trước; khu vực mới chưa được cập nhật.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Chọn căn này", exact: true }).first()).toBeEnabled();
    // Explicit exit must still return to chat rather than immediately reopening the map.
    await page.getByRole("button", { name: "Về hội thoại", exact: true }).click();
    await expect(map).toHaveCount(0);
  });
}

test("choosing a home keeps the map selection; chat dock can hide", async ({
  page,
}, info) => {
  const calls: any[] = [];
  await fixture(page, true, calls);
  await page.goto("/ai");
  await page
    .getByRole("textbox", { name: "Tin nhắn cho ReloHome" })
    .fill("Tìm nhà dưới 10 triệu ở Quận 1");
  await page.getByRole("button", { name: "Gửi tin nhắn" }).click();
  await expect(
    page.getByRole("region", { name: "Bản đồ nhà ở" }),
  ).toBeVisible();
  // Only the launcher appears initially. Opening it reveals a small composer.
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Hiện khung chat" }).click();
  await expect(
    page.getByRole("button", { name: "Xem đầy đủ", exact: true }),
  ).toHaveCount(0);
  const input = page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" });
  await input.fill("Tìm căn gần đây");
  // Collapsing the composer preserves the unsent draft.
  await page.getByRole("button", { name: "Ẩn khung chat" }).click();
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Hiện khung chat" }).click();
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" }),
  ).toBeVisible();
  await expect(input).toHaveValue("Tìm căn gần đây");
  await input.fill("");
  await page.screenshot({ path: info.outputPath("compact-chat.png") });
  const list = page.getByRole("complementary", {
    name: "Nhà trong vùng bản đồ",
  });
  if (info.project.name === "mobile") {
    // Mobile keeps the list in a bottom sheet over the map.
    await list.getByRole("button", { name: /căn trong vùng này/ }).click();
    await page.screenshot({ path: info.outputPath("sheet.png") });
  }
  await list.getByRole("button", { name: "Chọn căn này" }).nth(1).click();
  await expect
    .poll(() => calls.find((c) => c.path.endsWith("/action"))?.body.entity_id)
    .toBe(houses[1].id);
  // Current main keeps the map mounted after a choice, preserving its viewport and dock.
  await expect(page.getByRole("region", { name: "Bản đồ nhà ở" })).toBeVisible();
  await expect(list.locator(".ws-card.chosen")).toContainText(houses[1].title);
  await expect(input).toBeVisible();
});

test("flight results open a flight workspace with sorting and selection", async ({
  page,
}, testInfo) => {
  const calls: any[] = [];
  const { thread } = await fixture(page, true, calls);
  const later = new Date(Date.now() + 3600_000).toISOString();
  seed(thread, [
    {
      id: "flight:1",
      type: "flight",
      task_id: "flight",
      fetched_at: "2026-10-01T00:00:00+00:00",
      data: {
        origin: "Hà Nội",
        destination: "Đà Nẵng",
        offers: [
          {
            id: "f-exp",
            carrier: "Vietjet",
            fare_vnd: 1_500_000,
            depart_at: "2026-11-20T09:00:00+07:00",
            arrive_at: "2026-11-20T10:20:00+07:00",
            stops: 0,
            expires_at: later,
          },
          {
            id: "f-cheap",
            carrier: "Bamboo",
            fare_vnd: 900_000,
            depart_at: "2026-11-20T06:00:00+07:00",
            arrive_at: "2026-11-20T07:25:00+07:00",
            stops: 0,
            expires_at: later,
          },
        ],
      },
    },
  ]);
  await page.goto("/ai/th_ui");
  const flights = page.getByRole("region", { name: "Chuyến bay" });
  await expect(flights).toBeVisible();
  if (testInfo.project.name === "mobile")
    await expect
      .poll(
        async () =>
          (await flights.locator(".svc-head h2").boundingBox())!.height,
      )
      .toBeLessThan(40);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  if (process.env.SIU_UI_SCREENSHOTS)
    await page.screenshot({
      path: `../../logs/local/flight-workspace-${testInfo.project.name}.png`,
    });
  // Default sort is cheapest first.
  await expect(flights.locator(".svc-carrier").first()).toHaveText("Bamboo");
  await flights
    .getByRole("combobox", { name: "Sắp xếp chuyến bay" })
    .selectOption("depart");
  await expect(flights.locator(".svc-carrier").first()).toHaveText("Bamboo");
  await flights.getByRole("button", { name: "Vietjet", exact: true }).click();
  await expect(flights.locator(".svc-card")).toHaveCount(1);
  await flights.getByRole("button", { name: "Chọn chuyến này" }).click();
  await expect
    .poll(() => calls.find((c) => c.path.endsWith("/action"))?.body)
    .toMatchObject({ kind: "select", task_id: "flight", entity_id: "f-exp" });
  await expect(flights).toBeVisible();
  await expect(flights.getByRole("button", { name: "Đã chọn", exact: true })).toBeDisabled();
});

test("flight detail keeps the latest request, shows provider airport codes and stays closed", async ({
  page,
}, info) => {
  const { thread } = await fixture(page);
  const offers = ["A", "B"].map((carrier, i) => ({
    id: "detail-" + carrier,
    carrier: "Hãng " + carrier,
    fare_vnd: 900000 + i * 100000,
    depart_at: "2026-11-20T06:00:00+07:00",
    arrive_at: "2026-11-20T07:25:00+07:00",
    stops: 0,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  }));
  seed(thread, [
    {
      id: "flight:details",
      type: "flight",
      task_id: "flight",
      data: { origin: "HAN", destination: "DAD", offers },
    },
  ]);
  let release: (() => void) | undefined;
  let delayed = false;
  let responseSent = false;
  await page.route("**/api/flight/detail-*", async (route) => {
    const isA = route.request().url().endsWith("detail-A");
    if (isA) {
      delayed = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await route.fulfill({
      json: {
        segments: [
          {
            origin: isA ? "HAN" : "DAD",
            destination: isA ? "DAD" : "SGN",
            departure_time: "2026-11-20T06:00:00+07:00",
            arrival_time: "2026-11-20T07:25:00+07:00",
            airline_code: "VN",
            flight_number: isA ? "VN101" : "VN102",
          },
        ],
      },
    });
    if (isA) responseSent = true;
  });
  await page.goto("/ai/th_ui");
  const cards = page.locator(".svc-card");
  const panel = page.getByRole("complementary", {
    name: "Chi tiết hành trình",
  });
  await cards
    .filter({ hasText: "Hãng A" })
    .getByRole("button", { name: "Xem hành trình" })
    .click();
  await expect.poll(() => delayed).toBe(true);
  if (info.project.name === "mobile")
    await panel.getByRole("button", { name: "Đóng chi tiết" }).click();
  await cards
    .filter({ hasText: "Hãng B" })
    .getByText("Hãng B", { exact: true })
    .click();
  await expect(panel).toContainText("VN102");
  await expect(panel).toContainText("DAD");
  await expect(panel).toContainText("SGN");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  if (process.env.SIU_UI_SCREENSHOTS)
    await page.screenshot({
      path: `../../logs/local/flight-detail-${info.project.name}.png`,
    });
  release!();
  await expect.poll(() => responseSent).toBe(true);
  await page.waitForLoadState("networkidle");
  await expect(panel).toContainText("VN102");
  await panel.getByRole("button", { name: "Đóng chi tiết" }).click();
  delayed = false;
  responseSent = false;
  await cards
    .filter({ hasText: "Hãng A" })
    .getByRole("button", { name: "Xem hành trình" })
    .click();
  await expect.poll(() => delayed).toBe(true);
  await panel.getByRole("button", { name: "Đóng chi tiết" }).click();
  release!();
  await expect.poll(() => responseSent).toBe(true);
  await page.waitForLoadState("networkidle");
  await expect(panel).toHaveCount(0);
});

test("a failed workspace selection shows its error without opening chat manually", async ({
  page,
}) => {
  const { thread } = await fixture(page);
  seed(thread, [
    {
      id: "flight:error",
      type: "flight",
      task_id: "flight",
      data: {
        origin: "HAN",
        destination: "DAD",
        offers: [
          {
            id: "expired-selection",
            carrier: "Vietnam Airlines",
            fare_vnd: 900000,
            depart_at: "2026-11-20T06:00:00+07:00",
            arrive_at: "2026-11-20T07:25:00+07:00",
            stops: 0,
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          },
        ],
      },
    },
  ]);
  await page.route("**/api/threads/th_ui/action", (route) =>
    route.fulfill({
      status: 409,
      json: { detail: "Giá đã thay đổi. Hãy tìm lại." },
    }),
  );
  await page.goto("/ai/th_ui");
  await expect(
    page.getByRole("button", { name: "Hiện khung chat" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Chọn chuyến này" }).click();
  await expect(
    page
      .getByRole("region", { name: "Trò chuyện với ReloHome" })
      .getByRole("alert"),
  ).toContainText("Giá đã thay đổi");
  await expect(page.getByRole("region", { name: "Chuyến bay" })).toBeVisible();
});

test("moving quotes open a moving workspace with A/B points and fee details", async ({
  page,
}) => {
  const calls: any[] = [];
  const { thread } = await fixture(page, true, calls);
  const routeCalls: any[] = [];
  await page.route("**/web/api/platform/routes/entities", (route) => {
    routeCalls.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        route: {
          geometry: {
            type: "LineString",
            coordinates: [
              [106.698, 10.7725],
              [106.699, 10.775],
              [106.7, 10.78],
            ],
          },
        },
      },
    });
  });
  seed(thread, [
    {
      id: "moving:1",
      type: "relocation",
      task_id: "moving",
      fetched_at: "2026-10-01T00:00:00+00:00",
      data: {
        expires_at: new Date(Date.now() + 300000).toISOString(),
        from_address: "Chợ Bến Thành",
        to_address: "Bưu điện Trung tâm Sài Gòn",
        route: {
          pickup: { address: "Chợ Bến Thành", lat: 10.7725, lng: 106.698 },
          destination: {
            address: "Bưu điện Trung tâm Sài Gòn",
            lat: 10.78,
            lng: 106.7,
          },
        },
        quotes: [
          {
            id: "q:truck",
            vehicle: "Xe tải 500kg",
            price_vnd: 250000,
            distance_km: 1.4,
            fee_breakdown: { distance_price: 200000, total_price: 250000 },
          },
        ],
      },
    },
  ]);
  await page.goto("/ai/th_ui");
  const panel = page.getByRole("complementary", {
    name: "Phương án chuyển đồ",
  });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Chợ Bến Thành")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "OSRM (ô tô)" }),
  ).toBeVisible();
  expect(routeCalls.length).toBeGreaterThan(0);
  // StrictMode may repeat the read; every request must retain the exact provider coordinates.
  for (const call of routeCalls) expect(call).toEqual(
    {
      city: "hcm",
      profile: "driving",
      snap_radius_m: 100,
      origin: { type: "coordinate", location: { lat: 10.7725, lng: 106.698 } },
      destination: { type: "coordinate", location: { lat: 10.78, lng: 106.7 } },
    },
  );
  await panel.getByRole("button", { name: "Xem chi phí" }).click();
  await expect(panel.getByText("200.000 ₫")).toBeVisible();
  await panel.getByRole("button", { name: "Chọn phương án" }).click();
  await expect
    .poll(() => calls.find((c) => c.path.endsWith("/action"))?.body.entity_id)
    .toBe("q:truck");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Đã chọn", exact: true })).toBeDisabled();
});

test("a conversation can be deleted, and all conversations reset", async ({
  page,
}) => {
  const calls: any[] = [];
  const { thread } = await fixture(page, true, calls);
  seed(thread);
  await page.goto("/ai/th_ui");
  await expect(
    page.getByText("Kết quả kiểm tra hợp đồng dịch vụ"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Xóa cuộc trò chuyện này" }).focus();
  await page.getByRole("button", { name: "Xóa cuộc trò chuyện này" }).click();
  const confirm = page.getByRole("dialog", { name: "Xóa cuộc trò chuyện?" });
  await expect(confirm).toContainText("Đơn đã đặt không bị hủy");
  await confirm.getByRole("button", { name: "Hủy" }).click();
  expect(calls).toEqual([]);
  await page.getByRole("button", { name: "Xóa cuộc trò chuyện này" }).focus();
  await page.getByRole("button", { name: "Xóa cuộc trò chuyện này" }).click();
  await confirm.getByRole("button", { name: "Xóa cuộc trò chuyện" }).click();
  await expect(page).toHaveURL(/\/ai$/);
  await expect(page.getByText("Đã xóa cuộc trò chuyện.")).toBeVisible();
  expect(calls).toEqual([{ path: "/threads/th_ui", method: "DELETE" }]);

  seed(thread);
  await page.reload();
  await expect(page.getByRole("button", { name: "Lịch sử", exact: true })).toHaveCount(0);
  await page.goto("/account");
  await page.getByRole("tab", { name: "Hồ sơ & bảo mật", exact: true }).click();
  await page.getByRole("button", { name: "Xóa dữ liệu trò chuyện", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Xóa tất cả và làm mới ReloHome?" })
    .getByRole("button", { name: "Xóa tất cả" })
    .click();
  await expect(
    page.getByText(
      "Đã xóa toàn bộ trò chuyện và làm mới những gì ReloHome ghi nhớ.",
    ),
  ).toBeVisible();
  expect(calls.at(-1)).toEqual({ path: "/threads", method: "DELETE" });
});

test("right panel contains only current progress, costs and responses", async ({
  page,
}, info) => {
  const { thread } = await fixture(page);
  seed(thread);
  thread.state.progress = {
    plan_version: 2,
    items: [
      {
        task_id: "home",
        agent: "property",
        inputs: {
          district: "Cầu Giấy",
          city: "Hà Nội",
          max_price_vnd: 5000000,
        },
        state: "confirmed",
        after: [],
        level: 0,
        chosen: {
          id: "h1",
          label: "Căn A",
          amount_vnd: 4000000,
          recurrence: "monthly",
        },
      },
      {
        task_id: "fly",
        agent: "flight",
        inputs: {
          origin: "Hà Nội",
          destination: "Đà Nẵng",
          date: "2026-10-20",
        },
        state: "reviewed",
        after: [],
        level: 0,
        chosen: null,
      },
      {
        task_id: "move",
        agent: "relocation",
        mode: "quote",
        inputs: {
          mode: "quote",
          from_address: "Bách khoa",
          to_address: "selected:property",
        },
        state: "waiting",
        after: ["home"],
        level: 1,
        chosen: null,
      },
    ],
    totals: {
      monthly_vnd: 4000000,
      one_time_vnd: 0,
      confirmed: 1,
      unpriced: [],
    },
  };
  await page.goto("/ai/th_ui");
  const strip = page.getByRole("region", { name: "Tiến trình kế hoạch" });
  await expect(strip).toHaveCount(0);
  const tab = page.getByRole("button", { name: "Xem nhanh kế hoạch" });
  const peek = page.getByRole("region", {
    name: "Kế hoạch trong cuộc trò chuyện",
  });
  await expect(tab).toHaveAttribute("aria-expanded", "false");
  expect(
    await tab.evaluate((el) => el.closest(".composer-wrap, .ws-dock")),
  ).toBeNull();
  const rail = (await tab.boundingBox())!;
  expect(
    Math.abs(rail.x + rail.width - page.viewportSize()!.width),
  ).toBeLessThan(2);
  await expect(peek).toHaveCount(0);
  await tab.click();
  await expect(peek).toContainText("3 mục tiêu · 1 phương án đã chọn");
  // Wait for the panel's entry animation before checking its final edge.
  await expect
    .poll(async () => {
      const card = (await peek.boundingBox())!;
      return card.x + card.width;
    })
    .toBeLessThan(rail.x);
  await expect(peek.locator("li")).toHaveCount(3);
  await expect(peek).toContainText("Bách khoa → căn đã chọn");
  await expect(peek).toContainText("Căn A");
  await expect(peek).toContainText("Sau: Tìm nhà");
  await expect(peek).not.toContainText("Tổng");
  await page.screenshot({
    path: info.outputPath("quick-plan.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(peek).toHaveCount(0);
  await expect(tab).toBeFocused();
  await tab.click();
  await page.getByRole("button", { name: "Đóng kế hoạch nhanh" }).click();
  await expect(peek).toHaveCount(0);
  await tab.click();
  await peek.getByRole("tab", { name: "Chi phí", exact: true }).click();
  await expect(peek).toContainText("Tổng tiền đã chốt");
  await expect(peek).toContainText("4.000.000");
  await expect(peek).toContainText("Chưa có biên nhận dịch vụ.");
  await expect(page).toHaveURL(/\/ai\/th_ui$/);
  await expect(peek.getByRole("tab", { name: "Cần phản hồi", exact: true })).toHaveCount(0);
  await expect(peek.getByRole("tab")).toHaveCount(4);
  await expect(
    peek.getByRole("tab", { name: "Các kế hoạch", exact: true }),
  ).toHaveCount(0);
  await peek.getByRole("tab", { name: "Tiến trình", exact: true }).click();
  await expect(peek).toContainText("Bách khoa → căn đã chọn");
  await page.goto("/plans/th_ui");
  await expect(page).toHaveURL(/\/ai\/th_ui\?panel=plan$/);
  await expect(peek).toContainText("Căn A");
  await page.reload();
  await expect(peek).toBeVisible();
  await page.goto("/plans");
  await expect(page).toHaveURL(/\/account$/);
});

test("account reads saved request history and supports search, status filters and reopening chat", async ({
  page,
}, info) => {
  const { thread } = await fixture(page);
  thread.messages = [
    {
      id: "u1",
      role: "user",
      created: 1790751600,
      content: { text: "Tìm nhà ở Quận 1", status: "done" },
    },
    {
      id: "a1",
      role: "assistant",
      created: 1790751601,
      content: {
        status: "done",
        response: { kind: "ANSWER", text: "Đã tìm được nhà trong khu vực." },
      },
    },
    {
      id: "u2",
      role: "user",
      created: 1790751660,
      content: { text: "Tính đường tới sân bay", status: "done" },
    },
    {
      id: "a2",
      role: "assistant",
      created: 1790751661,
      content: {
        status: "done",
        response: { kind: "ERROR", text: "Chưa xác định được điểm đến." },
      },
    },
  ];
  await page.goto("/account");
  const history = page.getByRole("region", { name: "Lịch sử yêu cầu" });
  await expect(history.getByRole("article")).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "Lọc trạng thái yêu cầu" })
    .selectOption("ERROR");
  await expect(history.getByRole("article")).toHaveCount(1);
  await history
    .getByRole("button", { name: "Xem phản hồi", exact: true })
    .click();
  await expect(history).toContainText("Chưa xác định được điểm đến.");
  await page
    .getByRole("combobox", { name: "Lọc trạng thái yêu cầu" })
    .selectOption("all");
  await page
    .getByRole("textbox", { name: "Tìm trong lịch sử yêu cầu" })
    .fill("Quận 1");
  // The common thread title matches both requests; response content narrows the search.
  await page
    .getByRole("textbox", { name: "Tìm trong lịch sử yêu cầu" })
    .fill("Đã tìm được nhà");
  await expect(history.getByRole("article")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("request-history.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await history.getByRole("link", { name: "Mở hội thoại" }).click();
  await expect(page).toHaveURL(/\/ai\/th_ui$/);
});

test("account profile and preferences persist, the saved thread remains accessible, and logout ends the session", async ({
  page,
}) => {
  const { thread } = await fixture(page);
  seed(thread);
  const edits: any[] = [];
  await page.route("**/web/api/profile", async (route) => {
    edits.push(route.request().postDataJSON());
    await route.fallback();
  });
  await page.goto("/ai/th_ui");
  await page.getByRole("link", { name: "Mở tài khoản" }).focus();
  await page.getByRole("link", { name: "Mở tài khoản" }).click();
  await page.getByRole("tab", { name: "Hồ sơ & bảo mật", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tên hiển thị" })
    .fill("Minh Anh mới");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.locator(".account-chip-name strong")).toHaveText(
    "Minh Anh mới",
  );
  await page.getByRole("tab", { name: "Sở thích AI", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Thành phố", exact: true })
    .selectOption("Hà Nội");
  await page
    .getByRole("spinbutton", { name: "Ngân sách thuê · VND/tháng" })
    .fill("6000000");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect.poll(() => edits.length).toBe(2);
  expect(edits[1]).toMatchObject({
    name: "Minh Anh mới",
    preferences: { city: "Hà Nội", budget: "6000000" },
  });
  await page.reload();
  await page.getByRole("tab", { name: "Hồ sơ & bảo mật", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Tên hiển thị" })).toHaveValue(
    "Minh Anh mới",
  );
  await page.getByRole("tab", { name: "Sở thích AI", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Thành phố", exact: true }),
  ).toHaveValue("Hà Nội");
  await page.getByRole("link", { name: "Về chat", exact: true }).focus();
  await page.getByRole("link", { name: "Về chat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lịch sử", exact: true })).toHaveCount(0);
  await page.goto("/ai/th_ui");
  await expect(page).toHaveURL(/\/ai\/th_ui$/);
  await page.getByRole("button", { name: "Xem nhanh kế hoạch" }).click();
  await expect(
    page.getByRole("region", { name: "Kế hoạch trong cuộc trò chuyện" }),
  ).toContainText(thread.title);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Mở tài khoản" }).focus();
  await page.getByRole("link", { name: "Mở tài khoản" }).click();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
});

test("a saved map home still opens its detail when it is absent from chat result cards", async ({
  page,
}) => {
  const { thread, component } = await fixture(page);
  seed(thread, [
    { ...component, data: { ...component.data, candidates: [houses[0]] } },
  ]);
  // A house found by panning the map can be saved without appearing in the agent's original cards.
  await page.route("**/web/api/saved", (route) =>
    route.fulfill({
      json: [{ id: houses[1].id, thread_id: thread.id, house: houses[1] }],
    }),
  );
  await page.goto("/account");
  await page.getByRole("tab", { name: /Đã lưu/ }).click();
  await page
    .getByRole("button", { name: houses[1].title, exact: true })
    .click();
  await expect(page).toHaveURL(/\/ai\/th_ui\?panel=house&house=listing-b$/);
  const detail = page.getByRole("dialog", { name: "Chi tiết nhà" });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(houses[1].title);
  await expect(
    detail.getByRole("button", { name: "Chọn căn này", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(page).toHaveURL(/\/ai\/th_ui$/);
});

test("ReloHome branding has no robot logo on landing, login, or chat", async ({ page }) => {
  const { thread } = await fixture(page, false);
  seed(thread);
  await page.goto("/");
  await expect(page.locator(".landing-page")).toBeVisible();
  await expect(page.locator(".robot, .landing-hero-caption")).toHaveCount(0);

  await page.goto("/ai");
  await expect(page.locator(".login-page")).toBeVisible();
  await expect(page.locator(".robot")).toHaveCount(0);
  await page.locator('input[name="email"]').fill("minhanh@example.test");
  await page.locator('input[name="password"]').fill("strong-password");
  await page.locator('form button[type="submit"], .login-form form button').first().click();
  await page.goto("/ai/th_ui");
  await expect(page.locator(".chat-title a")).toHaveText("ReloHome");
  await expect(page.locator(".chat-home-link")).toHaveCount(0);
  await expect(page.locator(".message.assistant")).toHaveCount(1);
  await expect(page.locator(".robot")).toHaveCount(0);

  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute("href", "/favicon.svg?v=home");
  const favicon = await page.request.get("/favicon.svg?v=home");
  expect(favicon.ok()).toBeTruthy();
  expect(await favicon.text()).toContain("M11 29 32 12");
});

test("relocation preserves existing browser preferences, draft and identity keys", async ({ page }) => {
  const { thread, turns } = await fixture(page);
  thread.messages.push({
    id: "pre-relocation-message", role: "assistant", created: Date.now() / 1000,
    content: { response: { kind: "ANSWER", text: "Saved conversation before relocation" } },
  });
  await page.addInitScript(() => {
    if (localStorage.getItem("relocation-fixture-seeded")) return;
    localStorage.setItem("siu-ui-preferences", JSON.stringify({ theme: "dark", locale: "en" }));
    localStorage.setItem("siu-plan-strip-open", "0");
    localStorage.setItem("relohome.mode", "renter");
    sessionStorage.setItem("siu-draft-ui-test-th_ui", "Draft saved before relocation");
    sessionStorage.setItem("relohome-analytics-id", "existing-visitor-fixture");
    localStorage.setItem("relocation-fixture-seeded", "1");
  });
  await page.goto("/ai/th_ui");
  for (let visit = 0; visit < 2; visit++) {
    await expect(page).toHaveTitle(/ReloHome/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("textbox", { name: "Message ReloHome", exact: true })).toHaveValue("Draft saved before relocation");
    await expect(page.getByText("Saved conversation before relocation", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => ({
      plan: localStorage.getItem("siu-plan-strip-open"),
      mode: localStorage.getItem("relohome.mode"),
      visitor: sessionStorage.getItem("relohome-analytics-id"),
    }))).toEqual({ plan: "0", mode: "renter", visitor: "existing-visitor-fixture" });
    if (visit === 0) await page.reload();
  }
  expect(turns).toHaveLength(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`tenant map detail and comparison match the ${theme} design`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await fixture(page, true);
    await page.goto("/ai");
    await page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" }).fill("Tìm nhà dưới 10 triệu ở Quận 1");
    await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
    const list = page.getByRole("complementary", { name: "Nhà trong vùng bản đồ" });
    await expect(list).toBeVisible();
    await expect(page.locator(".ws-counter, .search-scope-legend")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`map-list-${theme}.png`) });
    await list.locator(".title-button").first().click();
    const detail = page.getByRole("complementary", { name: "Chi tiết nhà", exact: true });
    await expect(detail.getByRole("button", { name: "Thông tin chi tiết ›", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`map-detail-${theme}.png`) });
    await detail.getByRole("button", { name: "Thông tin chi tiết ›", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Chi tiết nhà", exact: true });
    await expect(modal).toBeVisible();
    await expect(modal.locator(".housing-cost-box")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`map-full-detail-${theme}.png`) });
    await modal.getByRole("button", { name: "Đóng", exact: true }).click();
    await detail.getByRole("button", { name: "Đóng chi tiết", exact: true }).click();
    await list.locator(".ws-compare-toggle").nth(0).click();
    await list.locator(".ws-compare-toggle").nth(1).click();
    await page.screenshot({ path: info.outputPath(`map-compare-tray-${theme}.png`) });
    await page.getByRole("button", { name: "So sánh 2 căn", exact: true }).click();
    const compare = page.getByRole("dialog", { name: "So sánh các căn đã chọn", exact: true });
    await expect(compare.locator("thead th")).toHaveCount(3);
    await expect(compare).not.toContainText("Giá / m²");
    await expect(compare.locator(".comparison-guide")).toBeVisible();
    await expect(compare.locator("table")).toHaveCSS("border-collapse", "collapse");
    await page.screenshot({ path: info.outputPath(`map-comparison-${theme}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
