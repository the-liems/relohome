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
    else if (path === "/threads/th_ui/chat") {
      turns.push(body);
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
  // Housing answers open the map workspace; this test continues in the chat cards.
  await page.getByRole("button", { name: "Về hội thoại" }).click();
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
  await page.getByRole("button", { name: "Về hội thoại" }).click();
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
  await expect(form).toContainText("255 Cầu Giấy, Hà Nội");
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect(form.getByRole("alert")).toContainText("điểm lấy");
  await form.getByLabel("Địa chỉ lấy đồ").fill("Đại học Bách khoa Hà Nội");
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect(form.getByRole("alert")).toContainText("ngày chuyển");
  expect(turns).toEqual([]);
  await form.getByLabel("Ngày chuyển").fill(tomorrow());
  await form.getByLabel("Giờ xe đến").fill("09:00");
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0].message).toBe(
    `Báo giá chuyển đồ từ Đại học Bách khoa Hà Nội đến phòng mình đã chọn ngày ${tomorrow()} lúc 09:00. Chưa đặt đơn.`,
  );
  expect(turns[0].moving_locations).toBeUndefined();
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
  await form.getByRole("button", { name: "Xác nhận và lấy báo giá" }).click();
  await expect.poll(() => turns.length).toBe(1);
  expect(turns[0].moving_locations).toEqual({
    destination: {
      address: "Ngõ 43 Phố Trung Kính, Cầu Giấy",
      lat: 21.0207,
      lng: 105.7917,
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
    .getByRole("textbox", { name: "Tin nhắn cho SIU AI" })
    .fill("Tìm nhà dưới 10 triệu ở Quận 1");
  await page.getByRole("button", { name: "Gửi tin nhắn" }).click();
  const list = page.getByRole("complementary", {
    name: "Nhà trong vùng bản đồ",
  });
  await expect(
    page.getByRole("region", { name: "Bản đồ nhà ở" }),
  ).toBeVisible();
  // Every listing is shown individually with its own address and directions link.
  await expect(list.getByText(houses[0].title)).toBeAttached();
  await expect(
    list.getByText("12, Lê Lợi, Bến Nghé, Quận 1, Hồ Chí Minh").first(),
  ).toBeAttached();
  await expect(
    list.getByRole("link", { name: "Chỉ đường" }).first(),
  ).toHaveAttribute(
    "href",
    /google\.com\/maps\/dir\/.*destination=10\.776,106\.697/,
  );
  // Chat filters are applied to the viewport list request, with the chosen sort and page size.
  await expect
    .poll(() => calls.filter((c) => c.path.endsWith("/search")).length)
    .toBeGreaterThan(0);
  let search = calls.filter((c) => c.path.endsWith("/search")).pop().body;
  expect(search.district).toBe("Quận 1");
  expect(search.max_price.amount).toBe(10000000);
  expect(search.pagination.limit).toBe(10);
  expect(search.bounding_box.west).toBeLessThan(search.bounding_box.east);
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
  await page
    .getByRole("textbox", { name: "Tin nhắn cho SIU AI" })
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

test("choosing a home from the map list returns to chat; chat dock can hide", async ({
  page,
}, info) => {
  const calls: any[] = [];
  await fixture(page, true, calls);
  await page.goto("/ai");
  await page
    .getByRole("textbox", { name: "Tin nhắn cho SIU AI" })
    .fill("Tìm nhà dưới 10 triệu ở Quận 1");
  await page.getByRole("button", { name: "Gửi tin nhắn" }).click();
  await expect(
    page.getByRole("region", { name: "Bản đồ nhà ở" }),
  ).toBeVisible();
  // The dock hides to keep the map readable and comes back from the floating button.
  await page.getByRole("button", { name: "Ẩn khung chat" }).click();
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho SIU AI" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Hiện khung chat" }).click();
  await expect(
    page.getByRole("textbox", { name: "Tin nhắn cho SIU AI" }),
  ).toBeVisible();
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
  // Back in the conversation with the chosen home, ready for moving or other services.
  await expect(page.getByRole("region", { name: "Bản đồ nhà ở" })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Đã chọn:", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mở bản đồ nhà ở" }),
  ).toBeVisible();
});

test("flight results open a flight workspace with sorting and selection", async ({
  page,
}) => {
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
  // Default sort is cheapest first.
  await expect(flights.locator(".svc-carrier").first()).toHaveText("Bamboo");
  await flights
    .getByRole("combobox", { name: "Sắp xếp chuyến bay" })
    .selectOption("depart");
  await expect(flights.locator(".svc-carrier").first()).toHaveText("Bamboo");
  await flights.getByRole("button", { name: "Vietjet" }).click();
  await expect(flights.locator(".svc-card")).toHaveCount(1);
  await flights.getByRole("button", { name: "Chọn chuyến này" }).click();
  await expect
    .poll(() => calls.find((c) => c.path.endsWith("/action"))?.body)
    .toMatchObject({ kind: "select", task_id: "flight", entity_id: "f-exp" });
  await expect(flights).toHaveCount(0);
});

test("moving quotes open a moving workspace with A/B points and fee details", async ({
  page,
}) => {
  const calls: any[] = [];
  const { thread } = await fixture(page, true, calls);
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
  await panel.getByRole("button", { name: "Xem chi phí" }).click();
  await expect(panel.getByText("200.000 ₫")).toBeVisible();
  await panel.getByRole("button", { name: "Chọn phương án" }).click();
  await expect
    .poll(() => calls.find((c) => c.path.endsWith("/action"))?.body.entity_id)
    .toBe("q:truck");
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mở phương án chuyển đồ" }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Xóa cuộc trò chuyện này" }).click();
  const confirm = page.getByRole("dialog", { name: "Xóa cuộc trò chuyện?" });
  await expect(confirm).toContainText("Đơn đã đặt không bị hủy");
  await confirm.getByRole("button", { name: "Hủy" }).click();
  expect(calls).toEqual([]);
  await page.getByRole("button", { name: "Xóa cuộc trò chuyện này" }).click();
  await confirm.getByRole("button", { name: "Xóa cuộc trò chuyện" }).click();
  await expect(page).toHaveURL(/\/ai$/);
  await expect(page.getByText("Đã xóa cuộc trò chuyện.")).toBeVisible();
  expect(calls).toEqual([{ path: "/threads/th_ui", method: "DELETE" }]);

  seed(thread);
  await page.reload();
  await page.getByRole("button", { name: "Lịch sử" }).click();
  await expect(
    page.getByRole("button", {
      name: "Xóa cuộc trò chuyện Tìm nhà tại Quận 1",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Xóa tất cả và làm mới SIU" }).click();
  await page
    .getByRole("dialog", { name: "Xóa tất cả và làm mới SIU?" })
    .getByRole("button", { name: "Xóa tất cả" })
    .click();
  await expect(
    page.getByText(
      "Đã xóa toàn bộ trò chuyện và làm mới những gì SIU ghi nhớ.",
    ),
  ).toBeVisible();
  expect(calls.at(-1)).toEqual({ path: "/threads", method: "DELETE" });
});
