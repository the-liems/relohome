import { test, expect, type Page } from "@playwright/test";

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
async function fixture(page: Page, authenticated = true) {
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
      pending: null,
    },
  };
  let saved: any[] = [];
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
      has_more: false,
    },
  };
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
    else if (path === "/threads" && method === "POST") data = thread;
    else if (path === "/threads/th_ui" && method === "GET") data = thread;
    else if (path === "/threads/th_ui/chat") {
      thread.messages.push({
        id: "u" + thread.messages.length,
        role: "user",
        created: 1790751600,
        content: { status: "done", text: body.message },
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
      thread.state.intake.user_confirmed_facts["selected:property"] = {
        value: body.entity_id,
      };
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
  return { thread, component, user };
}

function seed(thread: any, components: any[] = [], data: any = {}) {
  thread.messages.push({
    id: "audit-result",
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
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho SIU AI" }),
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
    page.getByRole("textbox", { name: "Tin nhắn cho SIU AI" }),
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
  await page
    .getByLabel("Số điện thoại", { exact: true })
    .nth(1)
    .fill("0907654321");
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
  await expect(
    page.getByRole("button", { name: "Xác nhận thao tác" }),
  ).toBeDisabled();
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
  await expect(
    page.getByRole("link", { name: /Mở trang thanh toán/ }),
  ).toHaveAttribute("href", "https://example.test/pay");
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
  await page.getByRole("button", { name: /Tìm nhà/ }).click();
  const modal = page.getByRole("dialog");
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
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /kế hoạch gì hôm nay/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Tìm nhà/ })).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("welcome.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Mở menu" }).click();
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("link", { name: "Kế hoạch" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Kế hoạch của bạn" }),
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
    .getByRole("textbox", { name: "Tin nhắn cho SIU AI" })
    .fill("Tìm nhà 2 phòng ngủ tại Quận 1 dưới 10 triệu/tháng");
  await page.getByRole("button", { name: "Gửi tin nhắn" }).click();
  await expect(page.getByText("Đang hiển thị 2 căn")).toBeVisible();
  await expect(page.locator('[data-map-ready="true"]').first()).toBeAttached();
  await page.screenshot({
    path: info.outputPath("housing.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Xem chi tiết", exact: true })
    .nth(1)
    .click();
  await expect(
    page.getByRole("dialog", { name: "Chi tiết nhà" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Chọn căn này", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Đã chọn", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Lưu nhà", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  await expect(
    page.getByText("Đã chọn:", { exact: false }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Đã chọn:", { exact: false }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.goto("/plans/th_ui");
  await expect(page.getByText("Đã có kết quả tìm kiếm")).toBeVisible();
  await page.screenshot({ path: info.outputPath("plan.png"), fullPage: true });
  await page.goto("/account");
  await page.getByRole("button", { name: /Đã lưu/ }).click();
  await expect(
    page.getByRole("button", { name: houses[1].title, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("account.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("moving pin changes require confirmation again; empty price is not zero", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/ai");
  await page.getByRole("button", { name: /Chuyển đồ/ }).click();
  const dialog = page.getByRole("dialog", { name: "Sắp xếp chuyến chuyển đồ" });
  await dialog
    .getByLabel("Địa chỉ lấy đồ", { exact: true })
    .fill("Điểm kiểm thử");
  await dialog.getByLabel("Vĩ độ", { exact: true }).first().fill("10.77");
  await dialog.getByLabel("Kinh độ", { exact: true }).first().fill("106.7");
  const confirmed = dialog
    .getByRole("checkbox", { name: "Tôi đã kiểm tra đúng điểm xe dừng" })
    .first();
  await confirmed.check();
  await expect(confirmed).toBeChecked();
  await dialog
    .getByLabel("Địa chỉ lấy đồ", { exact: true })
    .fill("Địa chỉ mới");
  await expect(confirmed).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
