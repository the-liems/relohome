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
    messages: [] as any[],
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
    thread,
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
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
}

for (const completedStatus of [
  "visit_due",
  "visited",
  "agreed",
  "reported_paid",
]) {
  test(`mixed viewing states keep remaining homes selectable after ${completedStatus}`, async ({
    page,
  }) => {
    const f = await fixture(page);
    Object.assign(f.items[0], {
      status: completedStatus,
      viewing: { slot: "2026-10-10T09:00:00+07:00" },
    });
    if (["agreed", "reported_paid"].includes(completedStatus)) {
      f.items[0].agreement = { deposit_vnd: 4000000, first_month_vnd: 4000000 };
      for (const item of f.items.slice(1))
        Object.assign(item, { status: "backup", backup_from: "selected" });
    }
    if (completedStatus === "reported_paid")
      f.items[0].reported_payment = {
        amount_vnd: 8000000,
        paid_on: "2026-10-11",
      };
    await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
    await expect(
      page.locator("#viewing-home-home-0").getByRole("checkbox"),
    ).toHaveCount(0);
    const first = page.getByRole("checkbox", {
      name: `Đặt lịch cho ${titles[1]}`,
      exact: true,
    });
    const second = page.getByRole("checkbox", {
      name: `Đặt lịch cho ${titles[2]}`,
      exact: true,
    });
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    await expect(page.locator("#viewing-home-home-0")).toHaveClass(
      /after-viewing/,
    );
    await expect(page.locator("#viewing-home-home-1")).not.toHaveClass(
      /after-viewing/,
    );
    await chooseAll(page);
    await expect(first).toBeChecked();
    await expect(second).toBeChecked();
    await page
      .getByRole("checkbox", { name: "Chọn tất cả", exact: true })
      .uncheck();
    await expect(first).not.toBeChecked();
    await expect(second).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Đi tiếp", exact: true }),
    ).toBeDisabled();
    for (const index of [1, 2])
      await page
        .getByLabel(`Giờ xem · ${titles[index]}`, { exact: true })
        .selectOption(slots[index]);
    // Excluding a draft from this batch must preserve both its time and the housing shortlist.
    await second.uncheck();
    await expect(
      page.getByLabel(`Giờ xem · ${titles[2]}`, { exact: true }),
    ).toHaveValue(slots[2]);
    await expect(page.locator(".viewing-item")).toHaveCount(3);
    expect(f.posts).toHaveLength(0);
    await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
    await expect(page.locator(".bulk-review-list > li")).toHaveCount(1);
    await expect(page.locator(".bulk-review-list")).toContainText(titles[1]);
    await page
      .getByRole("button", { name: "Xác nhận 1 lịch", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Kết quả đặt lịch", exact: true }),
    ).toBeVisible();
    expect(f.posts).toEqual([
      {
        path: "/threads/th_bulk/viewings/schedule",
        body: { listing_id: "home-1", slot: slots[1] },
      },
    ]);
    expect(f.items).toHaveLength(3);
    expect(f.items[2].viewing).toBeUndefined();
  });
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
  await expect(page.locator(".viewing-panel summary")).toHaveCount(0);
  await expect(page.locator(".plan-panel-title")).toHaveCount(0);
  await expect(
    page.getByText(
      "Chọn căn cho lượt đặt lịch. Bỏ dấu chọn không xóa căn khỏi kế hoạch.",
      { exact: true },
    ),
  ).toHaveCount(0);
  if (info.project.name === "desktop") {
    expect(
      await page
        .locator(".plan-peek-panel")
        .evaluate((el) => el.getBoundingClientRect().width),
    ).toBe(560);
  }

  await expect(
    page.getByRole("button", { name: "Đi tiếp", exact: true }),
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
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
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
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
  await expect(
    page.locator(".bulk-field-error").filter({ hasText: "Chọn ngày và giờ cho căn này." }),
  ).toHaveCount(3);
  for (const title of titles)
    await page
      .getByLabel(`Giờ xem · ${title}`, { exact: true })
      .selectOption(slots[0]);
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
  await expect(
    page.locator(".bulk-field-error").filter({ hasText: "Hai lịch bị trùng giờ. Hãy chọn giờ khác." }),
  ).toHaveCount(3);
  expect(posts).toHaveLength(0);

  await page
    .getByRole("checkbox", { name: `Đặt lịch cho ${titles[2]}`, exact: true })
    .uncheck();

  await expect(
    page.getByLabel(`Giờ xem · ${titles[1]}`, { exact: true }),
  ).toHaveValue(slots[0]);
});

test("opening viewings again after saving starts another round without resending the saved home", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  await fillTimes(page, [0]);
  await page
    .getByRole("button", { name: "Xác nhận 1 lịch", exact: true })
    .click();
  await expect(page.locator(".bulk-result.saved")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Đóng kế hoạch nhanh", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Xem nhà (3 căn)", exact: true })
    .click();
  const secondTime = page.getByLabel(`Giờ xem · ${titles[1]}`, { exact: true });
  await expect(secondTime).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: `Đặt lịch cho ${titles[0]}`,
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel(`Giờ xem · ${titles[0]}`, { exact: true }),
  ).toHaveValue(slots[0]);
  await secondTime.selectOption(slots[1]);
  await page
    .getByLabel(`Giờ xem · ${titles[2]}`, { exact: true })
    .selectOption(slots[2]);
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
  await page
    .getByRole("button", { name: "Xác nhận 2 lịch", exact: true })
    .click();
  await expect(page.locator(".bulk-result.saved")).toHaveCount(2);
  expect(f.posts.map((p) => p.body.listing_id)).toEqual([
    "home-0",
    "home-1",
    "home-2",
  ]);
  expect(f.items[0].viewing.slot).toBe(slots[0]);
});

test("map booking button starts a new round while keeping the same map mounted", async ({
  page,
}) => {
  const f = await fixture(page);
  const candidates = f.items.map((item, index) => ({
    id: item.listing_id,
    title: item.title,
    ...item.snapshot,
    lat: 21.03 + index * 0.001,
    lng: 105.78,
  }));
  const additionalHomes = f.items.splice(1);
  Object.assign(f.thread.state, { task_status: { housing: "done" } });
  f.thread.messages.push({
    id: "housing-reply",
    role: "assistant",
    created: Date.now() / 1000,
    content: {
      response: { kind: "ANSWER", text: "Các căn phù hợp để hẹn xem." },
      ui: {
        version: 1,
        plan_version: 1,
        components: [
          {
            id: "housing-result",
            task_id: "housing",
            type: "property",
            data: {
              candidates,
              map_context: {
                viewport: {
                  west: 105.77,
                  south: 21.02,
                  east: 105.79,
                  north: 21.04,
                },
              },
            },
          },
        ],
      },
    },
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
  await page.route("**/web/api/platform/**", (route) =>
    route.fulfill({
      json: {
        features: candidates.map((home) => ({ kind: "listing", ...home })),
        results: candidates,
        meta: {
          mode: "listings",
          returned_count: candidates.length,
          truncated: false,
        },
        page: { returned_count: candidates.length, next_cursor: null },
      },
    }),
  );
  const selections: string[] = [];
  await page.route("**/web/api/threads/th_bulk/action", (route) => {
    const id = route.request().postDataJSON().entity_id;
    selections.push(id);
    f.items.push(additionalHomes.find((item) => item.listing_id === id));
    f.thread.revision++;
    return route.fulfill({ json: f.thread });
  });
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  const map = page.getByRole("region", { name: "Bản đồ nhà ở", exact: true });
  await expect(map).toBeVisible();
  await page
    .locator(".ws-map canvas")
    .evaluate((el) => el.setAttribute("data-viewing-round-map", "retained"));
  await fillTimes(page, [0]);
  await page
    .getByRole("button", { name: "Xác nhận 1 lịch", exact: true })
    .click();
  await expect(page.locator(".bulk-result.saved")).toHaveCount(1);
  if (page.viewportSize()!.width < 768)
    await page
      .getByRole("button", { name: "Đóng kế hoạch nhanh", exact: true })
      .click();
  const list = page.getByRole("complementary", {
    name: "Nhà trong vùng bản đồ",
    exact: true,
  });
  if (
    page.viewportSize()!.width < 768 &&
    (await list.locator(".ws-sheet-toggle").getAttribute("aria-expanded")) !==
      "true"
  )
    await list.locator(".ws-sheet-toggle").click();
  await list
    .getByRole("article", { name: `Xem ${titles[1]}`, exact: true })
    .getByRole("button", { name: "Chọn căn này", exact: true })
    .click();
  await expect(list.locator(".ws-selection-tray")).toContainText(
    "Đã chọn 2/3 căn để hẹn xem",
  );
  await page
    .getByRole("button", { name: "Xong, hẹn lịch xem", exact: true })
    .click();
  await expect(
    page.getByLabel(`Giờ xem · ${titles[1]}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: `Đặt lịch cho ${titles[0]}`,
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByLabel(`Giờ xem · ${titles[1]}`, { exact: true })
    .selectOption(slots[1]);
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
  await page
    .getByRole("button", { name: "Xác nhận 1 lịch", exact: true })
    .click();
  await expect(page.locator(".bulk-result.saved")).toHaveCount(1);
  await expect(
    page.locator(".ws-map canvas[data-viewing-round-map=retained]"),
  ).toHaveCount(1);
  expect(selections).toEqual(["home-1"]);
  expect(f.posts.map((p) => p.body.listing_id)).toEqual(["home-0", "home-1"]);
  expect(f.items[0].viewing.slot).toBe(slots[0]);
});

test("opening another round cannot bypass an uncertain saved request", async ({
  page,
}) => {
  const f = await fixture(page);
  f.mode("unknown");
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  await fillTimes(page, [0]);
  await page
    .getByRole("button", { name: "Xác nhận 1 lịch", exact: true })
    .click();
  await expect(page.locator(".bulk-result.unknown")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Đóng kế hoạch nhanh", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Xem nhà (3 căn)", exact: true })
    .click();
  await expect(page.locator(".bulk-result.unknown")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Kiểm tra trạng thái", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Đi tiếp", exact: true }),
  ).toHaveCount(0);
  expect(f.posts).toHaveLength(1);
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
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
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
  await expect(page.getByRole("alert").filter({ hasText: "Danh sách hoặc lịch đã thay đổi" })).toContainText(
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
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
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
      page.getByRole("button", { name: "Đi tiếp", exact: true }),
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
    .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true }).focus();
  await page
    .getByRole("button", { name: "Chuyển sang chế độ tối", exact: true })
    .click();
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page
    .getByRole("button", { name: "Quick plan view", exact: true })
    .click();
  await expect(
    page.getByLabel(`Viewing time · ${titles[0]}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
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

test("initial calendar shows every server slot including 22:00 across all days", async ({
  page,
}) => {
  const f = await fixture(page);
  const today = [
    "17:00",
    "17:30",
    "18:00",
    "18:30",
    "19:00",
    "19:30",
    "20:00",
    "20:30",
    "21:00",
    "21:30",
    "22:00",
  ];
  f.viewing.slots = [
    ...today.map((t) => `2027-02-10T${t}:00+07:00`),
    "2027-02-11T08:00:00+07:00",
    "2027-02-11T22:00:00+07:00",
  ];
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  const picker = page.getByLabel(`Giờ xem · ${titles[0]}`, { exact: true });
  await expect(picker.getByRole("option")).toHaveText(["Chọn giờ", ...today]);
  await page
    .getByLabel(`Ngày xem · ${titles[0]}`, { exact: true })
    .selectOption("2027-02-11");
  await expect(picker.getByRole("option")).toHaveText([
    "Chọn giờ",
    "08:00",
    "22:00",
  ]);
});

test("replacement calendar contains only owner suggestions even when visit time is bypassed", async ({
  page,
}) => {
  const f = await fixture(page);
  Object.assign(f.items[0], {
    status: "visit_due",
    viewing: { slot: slots[0] },
    landlord: {
      request_id: "request-1",
      request_status: "new",
      viewing_status: "declined",
      viewing_options: [slots[1]],
    },
    available_slots: [slots[1]],
  });
  await page.goto("/ai/th_bulk?panel=plan&planTab=viewing");
  const time = page.getByLabel(`Giờ xem · ${titles[0]}`, { exact: true });
  await expect(time.locator("option")).toHaveText(["Chọn giờ", "10:30"]);
  await time.selectOption(slots[1]);
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
  await page
    .getByRole("button", { name: "Xác nhận 1 lịch", exact: true })
    .click();
  await expect
    .poll(() => f.posts.filter((p) => p.path.endsWith("/schedule")).length)
    .toBe(1);
  expect(f.posts.find((p) => p.path.endsWith("/schedule"))?.body).toEqual({
    listing_id: "home-0",
    slot: slots[1],
  });
});

for (const theme of ["light", "dark"]) {
  test(`tenant bell stays at the lower right edge with account names in ${theme} theme`, async ({
    page,
  }) => {
    await fixture(page);
    await page.addInitScript(
      (theme) =>
        localStorage.setItem(
          "siu-ui-preferences",
          JSON.stringify({ theme, locale: "vi" }),
        ),
      theme,
    );
    await page.route(
      "**/web/api/housing-management/housing/contact-notifications",
      (route) =>
        route.fulfill({
          json: {
            items: [
              {
                id: "request-person",
                title: "Studio Duy Tân",
                role: "tenant",
                counterparty_name: "Mai",
                unread: 1,
              },
            ],
          },
        }),
    );
    await page.route(
      "**/web/api/housing-management/housing/contact-requests/request-person/messages",
      (route) =>
        route.fulfill({
          json: {
            role: "tenant",
            viewer_id: "tenant",
            counterparty_name: "Mai",
            request: {
              id: "request-person",
              title: "Studio Duy Tân",
              tenant_user_id: "tenant",
              message: "Em muốn xem nhà",
              created_at: "2026-10-14T10:00:00Z",
              status: "new",
              open: true,
            },
            messages: [
              {
                id: "reply",
                sender_user_id: "owner",
                sender_role: "landlord",
                body: "Chào em",
                created_at: "2026-10-14T10:01:00Z",
              },
            ],
          },
        }),
    );
    await page.goto("/ai/th_bulk");
    const plan = page.locator(".plan-peek-tab"),
      bell = page.locator(".contact-messenger-toggle");
    await expect(plan).toBeVisible();
    await expect(bell).toBeVisible();
    await expect
      .poll(async () => {
        const b = await bell.boundingBox();
        return page.viewportSize()!.height - (b!.y + b!.height);
      })
      .toBe(24);
    for (const control of [plan, bell]) {
      const colors = await control.evaluate((element) => {
        const s = getComputedStyle(element),
          root = getComputedStyle(document.documentElement);
        return {
          background: s.backgroundColor,
          color: s.color,
          accent: root.getPropertyValue("--ui-accent").trim(),
          onAccent: root.getPropertyValue("--ui-on-accent").trim(),
        };
      });
      // Browser resolves hex token values to RGB; compare through an element.
      const expected = await page.evaluate(({ accent, onAccent }) => {
        const e = document.createElement("span");
        e.style.background = accent;
        e.style.color = onAccent;
        document.body.append(e);
        const s = getComputedStyle(e),
          result = { background: s.backgroundColor, color: s.color };
        e.remove();
        return result;
      }, colors);
      expect(colors.background).toBe(expected.background);
      expect(colors.color).toBe(expected.color);
    }
    await bell.click();
    const row = page.locator(".contact-messenger-conversations > button");
    await expect(row.locator("strong")).toHaveText("Mai");
    await row.click();
    await expect(
      page.locator(".contact-messenger-panel header strong"),
    ).toHaveText("Studio Duy Tân – Mai");
    await expect(page.locator(".contact-thread-list .theirs")).toContainText(
      "Chào em",
    );
    if (theme === "light") {
      await page.setViewportSize({ width: 320, height: 568 });
      await expect
        .poll(async () => {
          const b = await bell.boundingBox();
          return page.viewportSize()!.height - (b!.y + b!.height);
        })
        .toBe(24);
      const panel = await page
        .locator(".contact-messenger-panel")
        .boundingBox();
      expect(panel!.x).toBeGreaterThanOrEqual(0);
      expect(panel!.y).toBeGreaterThanOrEqual(0);
      const send = await page
        .getByRole("button", { name: "Gửi", exact: true })
        .boundingBox();
      expect(send!.y + send!.height).toBeLessThanOrEqual(568);
    }
  });
}
