import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const titles = ["Studio Duy Tân", "Phòng Trần Thái Tông", "Căn hộ Cầu Giấy"];
const slots = ["09:00", "10:30", "12:00"].map(
  (time) => `2027-02-10T${time}:00+07:00`,
);
async function fixture(page: Page, limit = 3) {
  const items: any[] = titles.map((title, index) => ({
    listing_id: `home-${index}`,
    title,
    status: "selected",
    snapshot: {
      address: `${index + 1} phố Duy Tân, Cầu Giấy, Hà Nội`,
      price_vnd: 4000000 + index * 500000,
    },
  }));
  const viewing = { items, max_selected: limit, slots, slot_minutes: 30 };
  const thread = {
    id: "th_bulk",
    title: "Tìm nhà để hẹn xem",
    updated: Date.now() / 1000,
    revision: 1,
    runs: [],
    messages: [],
    state: {
      plan: {
        version: 1,
        tasks: [{ id: "housing", agent: "property", inputs: {} }],
      },
      intake: { user_confirmed_facts: {} },
      viewing,
    },
  };
  const posts: { path: string; body: any }[] = [];
  let mode = "ok";
  let release: (() => void) | undefined;
  await page.route("**/web/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/web/api", "");
    let data: any = {};
    if (request.method() === "POST")
      posts.push({ path, body: request.postDataJSON() });
    if (path === "/session")
      data = { id: "tenant", name: "An", preferences: {} };
    else if (path === "/status")
      data = { domains: ["property", "map", "flight", "relocation"] };
    else if (path === "/threads" || path === "/saved") data = [];
    else if (path === "/threads/th_bulk") data = thread;
    else if (path === "/threads/th_bulk/viewings") data = viewing;
    else if (path.endsWith("/schedule")) {
      const body = request.postDataJSON();
      if (mode === "slow")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (mode === "partial" && body.listing_id === "home-1")
        return route.fulfill({
          status: 409,
          json: { detail: "Không đủ thời gian di chuyển tới căn này." },
        });
      const item = items.find((i) => i.listing_id === body.listing_id);
      Object.assign(item, {
        status: "viewing_scheduled",
        viewing: { slot: body.slot },
        landlord: {
          request_id: `request-${body.listing_id}`,
          request_status: "new",
          viewing_status: "requested",
          ...(mode === "sync" ? { sync: "failed" } : {}),
        },
      });
      if (mode === "unknown")
        return route.fulfill({
          status: 502,
          json: { detail: "Mất phản hồi sau khi lưu." },
        });
      data = viewing;
    } else if (path.endsWith("/cancel")) {
      const item = items.find(
        (i) => i.listing_id === request.postDataJSON().listing_id,
      );
      Object.assign(item, {
        status: "selected",
        viewing: null,
        landlord: { request_status: "resolved", viewing_status: "cancelled" },
      });
      data = viewing;
    }
    await route.fulfill({ json: data });
  });
  return {
    items,
    viewing,
    posts,
    mode: (value: string) => {
      mode = value;
    },
    release: () => release?.(),
  };
}
async function chooseAll(page: Page) {
  await page
    .getByRole("checkbox", { name: "Chọn tất cả", exact: true })
    .check();
}
async function fillTimes(page: Page, indices = [0, 1, 2]) {
  for (const index of indices)
    await page
      .getByLabel(`Giờ xem · ${titles[index]}`, { exact: true })
      .selectOption(slots[index]);
  await page.getByRole("button", { name: "Xem lại lịch", exact: true }).click();
}

test("three compact homes, draft preservation, review and one confirmation with exact serial payloads", async ({
  page,
}, info) => {
  const { posts } = await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  await expect(page.locator(".viewing-item")).toHaveCount(3);
  await expect(page.locator(".viewing-item select")).toHaveCount(6);
  await expect(
    page.getByRole("button", { name: "Xem lại lịch", exact: true }),
  ).toBeDisabled();
  await chooseAll(page);
  await fillTimes(page);
  expect(posts).toHaveLength(0);
  await expect(
    page.getByRole("heading", {
      name: "Xem lại lịch trước khi gửi",
      exact: true,
    }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Sửa giờ", exact: true }).click();
  await expect(
    page.getByLabel(`Giờ xem · ${titles[0]}`, { exact: true }),
  ).toHaveValue(slots[0]);
  await page
    .getByRole("button", { name: "Đóng kế hoạch nhanh", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Xem nhanh kế hoạch", exact: true })
    .click();
  await expect(
    page.getByLabel(`Giờ xem · ${titles[1]}`, { exact: true }),
  ).toHaveValue(slots[1]);
  await page.getByRole("button", { name: "Xem lại lịch", exact: true }).click();
  const confirm = page.getByRole("button", {
    name: "Xác nhận 3 lịch",
    exact: true,
  });
  await expect(confirm).toBeInViewport();
  await page.locator(".plan-panel-content").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(confirm).toBeInViewport();
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Kết quả đặt lịch", exact: true }),
  ).toBeVisible();
  expect(posts).toEqual(
    slots.map((slot, index) => ({
      path: "/threads/th_bulk/viewings/schedule",
      body: { listing_id: `home-${index}`, slot },
    })),
  );
  await expect(page.locator(".bulk-result.saved")).toHaveCount(3);
  await expect(
    page
      .locator(".bulk-result")
      .getByText("Đã gửi giờ hẹn, chờ chủ nhà xác nhận", { exact: true }),
  ).toHaveCount(3);
  await page.screenshot({
    path: info.outputPath("bulk-results.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("overlapping/missing times stop before a request and back keeps drafts", async ({
  page,
}) => {
  const { posts } = await fixture(page);
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  await chooseAll(page);
  await page.getByRole("button", { name: "Xem lại lịch", exact: true }).click();
  await expect(
    page.getByText("Chọn ngày và giờ cho căn này.", { exact: true }),
  ).toHaveCount(3);
  for (const title of titles)
    await page
      .getByLabel(`Giờ xem · ${title}`, { exact: true })
      .selectOption(slots[0]);
  await page.getByRole("button", { name: "Xem lại lịch", exact: true }).click();
  await expect(
    page.getByText("Hai lịch bị trùng giờ. Hãy chọn giờ khác.", {
      exact: true,
    }),
  ).toHaveCount(3);
  expect(posts).toHaveLength(0);

  await page
    .getByRole("checkbox", { name: `Đặt lịch cho ${titles[2]}`, exact: true })
    .uncheck();

  await expect(
    page.getByLabel(`Giờ xem · ${titles[1]}`, { exact: true }),
  ).toHaveValue(slots[0]);
});

test("backend travel failure keeps earlier successes; retry sends only unsent homes", async ({
  page,
}) => {
  const f = await fixture(page);
  f.mode("partial");
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  await chooseAll(page);
  await fillTimes(page);
  await page
    .getByRole("button", { name: "Xác nhận 3 lịch", exact: true })
    .click();
  await expect(page.locator(".bulk-result.saved")).toHaveCount(1);
  await expect(page.locator(".bulk-result.failed")).toContainText(
    "Không đủ thời gian di chuyển",
  );
  await expect(page.locator(".bulk-result.not_sent")).toHaveCount(1);
  expect(f.posts.map((p) => p.body.listing_id)).toEqual(["home-0", "home-1"]);
  f.mode("ok");
  await page
    .getByRole("button", { name: "Sửa các lịch chưa gửi", exact: true })
    .click();
  await expect(
    page.getByLabel(`Giờ xem · ${titles[1]}`, { exact: true }),
  ).toHaveValue(slots[1]);
  await page.getByRole("button", { name: "Xem lại lịch", exact: true }).click();
  await page
    .getByRole("button", { name: "Xác nhận 2 lịch", exact: true })
    .click();
  await expect(page.locator(".bulk-result.saved")).toHaveCount(2);
  expect(f.posts.map((p) => p.body.listing_id)).toEqual([
    "home-0",
    "home-1",
    "home-1",
    "home-2",
  ]);
});

test("lost response survives reload; check uses GET and never resends an uncertain booking", async ({
  page,
}) => {
  const f = await fixture(page);
  f.mode("unknown");
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  await chooseAll(page);
  await fillTimes(page);
  await page
    .getByRole("button", { name: "Xác nhận 3 lịch", exact: true })
    .click();
  await expect(page.locator(".bulk-result.unknown")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".bulk-result.unknown")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Kiểm tra trạng thái", exact: true })
    .click();
  await expect(page.locator(".bulk-result.saved")).toHaveCount(1);
  expect(f.posts).toHaveLength(1);
  f.mode("ok");
  await page
    .getByRole("button", { name: "Sửa các lịch chưa gửi", exact: true })
    .click();
  await fillTimes(page, [1, 2]);
  await page
    .getByRole("button", { name: "Xác nhận 2 lịch", exact: true })
    .click();
  await expect(page.locator(".bulk-result.saved")).toHaveCount(2);
  expect(f.posts.map((p) => p.body.listing_id)).toEqual([
    "home-0",
    "home-1",
    "home-2",
  ]);
});

test("owner sync failure is visible, stops the batch and retains the legacy retry action", async ({
  page,
}) => {
  const f = await fixture(page);
  f.mode("sync");
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  await chooseAll(page);
  await fillTimes(page);
  await page
    .getByRole("button", { name: "Xác nhận 3 lịch", exact: true })
    .click();
  await expect(page.locator(".bulk-result.sync_pending")).toHaveCount(1);
  await expect(page.locator(".viewing-preparation")).toHaveCount(0);
  expect(f.posts).toHaveLength(1);
  await page
    .getByRole("button", { name: "Xem danh sách căn", exact: true })
    .click();
  await page.locator(".viewing-item").first().locator("summary").click();
  await expect(
    page.getByRole("button", { name: "Gửi lại cho chủ nhà", exact: true }),
  ).toBeVisible();
});

test("changed shared basket at preflight requires review instead of scheduling stale data", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  await chooseAll(page);
  await fillTimes(page);
  f.items[1].status = "visited";
  await page
    .getByRole("button", { name: "Xác nhận 3 lịch", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Danh sách hoặc lịch đã thay đổi",
  );
  await expect(
    page.getByLabel(`Giờ xem · ${titles[0]}`, { exact: true }),
  ).toBeVisible();
  expect(f.posts).toHaveLength(0);
});

test("server cap is respected and unchecking never unselects the shared housing basket", async ({
  page,
}) => {
  const f = await fixture(page, 2);
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  await expect(
    page.getByRole("checkbox", { name: "Chọn tất cả", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: `Đặt lịch cho ${titles[0]}`, exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: `Đặt lịch cho ${titles[1]}`, exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", {
      name: `Đặt lịch cho ${titles[2]}`,
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: `Đặt lịch cho ${titles[0]}`, exact: true })
    .uncheck();
  await expect(page.locator(".viewing-item")).toHaveCount(3);
  expect(f.posts).toHaveLength(0);
});

test("inline time selection checks the home without extra steps or losing drafts when unchecked", async ({
  page,
}) => {
  const f = await fixture(page, 2);
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  await page
    .getByLabel(`Giờ xem · ${titles[0]}`, { exact: true })
    .selectOption(slots[0]);
  const checkbox = page.getByRole("checkbox", {
    name: `Đặt lịch cho ${titles[0]}`,
    exact: true,
  });
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(
    page.getByLabel(`Giờ xem · ${titles[0]}`, { exact: true }),
  ).toHaveValue(slots[0]);
  await checkbox.check();
  await page
    .getByLabel(`Giờ xem · ${titles[1]}`, { exact: true })
    .selectOption(slots[1]);
  await expect(
    page.getByLabel(`Giờ xem · ${titles[2]}`, { exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Xem lại lịch", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Xác nhận 2 lịch", exact: true }),
  ).toBeVisible();
  expect(f.posts).toHaveLength(0);
});

test("sending stays visible, blocks duplicate confirmation and prevents hiding the progress", async ({
  page,
}) => {
  const f = await fixture(page);
  f.mode("slow");
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  await chooseAll(page);
  await fillTimes(page);
  await page
    .getByRole("button", { name: "Xác nhận 3 lịch", exact: true })
    .click();
  await expect.poll(() => f.posts.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Đang lưu lịch…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Đóng kế hoạch nhanh", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("tab", { name: "Chi phí", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(".plan-peek-panel")).toBeVisible();
  await expect(
    page.locator(".viewing-scheduler").getByRole("status"),
  ).toContainText(titles[0]);
  f.mode("ok");
  f.release();
  await expect(page.locator(".bulk-result.saved")).toHaveCount(3);
  expect(f.posts).toHaveLength(3);
});

test("green compact cards, accessible keyboard controls and pinned footer across mobile/dark/English", async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  const all = page.getByRole("checkbox", { name: "Chọn tất cả", exact: true });
  await all.focus();
  await page.keyboard.press("Space");
  await expect(all).toBeChecked();
  await page.screenshot({
    path: info.outputPath("bulk-selection.png"),
    fullPage: true,
  });

  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(
      page.getByRole("button", { name: "Xem lại lịch", exact: true }),
    ).toBeInViewport();
    expect(
      await page
        .locator(".plan-peek-panel")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.screenshot({
    path: info.outputPath("bulk-times-mobile.png"),
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .include(".plan-peek-panel")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true })
    .click();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page
    .getByRole("button", { name: "Quick plan view", exact: true })
    .click();
  await expect(
    page.getByLabel(`Viewing time · ${titles[0]}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review viewings", exact: true }),
  ).toBeInViewport();
  expect(
    (
      await new AxeBuilder({ page })
        .include(".plan-peek-panel")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("bulk-times-dark-en.png"),
    fullPage: true,
  });
});
