import { expect, test, type Page } from "@playwright/test";

const facts = {
  city: "hcm",
  area_ids: ["city:hcm"],
  budget: { min_vnd: 2000000, max_vnd: 5000000, fee_basis: "rent_only" },
  need: { kind: "looking_together" },
  move_in: { kind: "flexible" },
  self_traits: {
    smoking: "non_smoker",
    has_pets: false,
    cleanliness: "daily",
    sociability: "balanced",
  },
};
async function fixture(
  page: Page,
  role: "guest" | "account" | "admin" = "account",
  expireOnWriteOnly = false,
) {
  let expired = false,
    otherAccount = false,
    mediaEnabled = false,
    authenticated = role !== "guest";
  const calls: {
    path: string;
    method: string;
    body: any;
    operation?: string;
  }[] = [];
  const owner = () => ({
    id: otherAccount ? "other-user" : "viewer",
    name: otherAccount ? "Bình" : "An",
    email: "test@example.test",
    preferences: {},
    is_admin: role === "admin",
  });
  const house = {
    id: "home",
    title: "Phòng kiểm thử",
    address: "Gò Vấp, Hồ Chí Minh",
    lat: 10.84,
    lng: 106.67,
    price_vnd: 4000000,
    management: { accepts_contact_requests: true, poster_type: "owner" },
  };
  const intro = () => ({
    display_name: owner().name,
    introduction: "Tôi muốn tìm người cùng thuê phòng và sinh hoạt gọn gàng.",
    facts,
    preferences: {},
  });
  const thread: any = {
    id: "th_auth",
    title: "Tìm nhà",
    updated: Date.now() / 1000,
    revision: 1,
    runs: [],
    state: {
      plan: { version: 1, tasks: [] },
      intake: { user_confirmed_facts: {} },
      viewing: { items: [], slots: [] },
    },
    messages: [
      {
        id: "reply",
        role: "assistant",
        created: Date.now() / 1000,
        content: {
          response: { kind: "ANSWER", text: "Kết quả" },
          ui: {
            version: 1,
            plan_version: 1,
            components: [
              {
                id: "homes",
                type: "property",
                task_id: "housing",
                data: { candidates: [house] },
              },
            ],
          },
        },
      },
    ],
  };
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
  await page.route("**/web/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace("/web/api", "");
    let body: any;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    calls.push({
      path,
      method: req.method(),
      body,
      operation: req.headers()["x-roommate-operation"],
    });
    if (path.startsWith("/auth/")) {
      expired = false;
      authenticated = true;
      return route.fulfill({ json: owner() });
    }
    if (path === "/session")
      return route.fulfill({
        json:
          role === "guest"
            ? {
                id: "guest_" + "a".repeat(32),
                kind: "guest",
                is_guest: true,
                name: "Khách",
                email: "",
                preferences: {},
                expires_at: Date.now() / 1000 + 86400,
                active_thread_id: "th_auth",
                capabilities: [
                  "chat",
                  "housing_read",
                  "map_read",
                  "flight_read",
                ],
              }
            : owner(),
      });
    if (path === "/status")
      return route.fulfill({
        json: {
          domains: ["property", "flight", "map", "relocation"],
          writes_enabled: false,
        },
      });
    if (path === "/threads" || path === "/saved")
      return route.fulfill({ json: [] });
    if (path === "/threads/th_auth") return route.fulfill({ json: thread });
    if (path === "/threads/th_auth/viewings")
      return route.fulfill({ json: thread.state.viewing });
    if (path === "/housing/home") return route.fulfill({ json: house });
    if (path.startsWith("/platform/"))
      return route.fulfill({
        json: {
          type: "FeatureCollection",
          features: [],
          results: [],
          page: { returned_count: 0, next_cursor: null },
        },
      });
    const privatePath =
      path.startsWith("/housing-management/") ||
      path.startsWith("/landlord/") ||
      (path.startsWith("/roommate/") && path !== "/roommate/availability") ||
      path === "/profile/traveler";
    if (privatePath && ((!expireOnWriteOnly || req.method() !== "GET") && expired || !authenticated))
      return route.fulfill({
        status: 401,
        json: {
          code: "authentication_required",
          detail: "Đăng nhập để sử dụng chức năng này.",
        },
      });
    let json: any = {};
    // Admin renders queue counts and a listing page; empty shapes keep it mounted.
    if (path === "/housing-management/moderation/housing/queue")
      json = { hosts: [], properties: [], listings: [] };
    else if (path === "/housing-management/moderation/housing/listings")
      json = { items: [], total: 0 };
    else if (path === "/roommate/availability")
      json = {
        enabled: true,
        cities: ["hcm"],
        terms_version: "roommate-1.0",
        features: mediaEnabled ? ["media"] : [],
      };
    else if (path === "/roommate/access")
      json = { eligible: true, moderator: false };
    else if (path === "/roommate/me/intro")
      json = req.method() === "GET" ? intro() : body;
    else if (
      path === "/roommate/me/profile" ||
      path === "/roommate/me/criteria"
    )
      json = null;
    else if (path === "/roommate/areas/hcm")
      json = { areas: [{ area_id: "city:hcm", city: "hcm" }] };
    else if (path === "/profile/traveler")
      json = {
        traveler: {
          last_name: "NGUYEN",
          first_name: "AN",
          date_of_birth: "1998-01-01",
          email: "test@example.test",
        },
      };
    else if (path.endsWith("/profile"))
      json = { profile: null, can_publish: false };
    else if (path.endsWith("/overview"))
      json = { properties: 0, listings: 0, requests: 0 };
    else json = { items: [], profiles: [], listings: [], properties: [] };
    return route.fulfill({ json });
  });
  return {
    thread,
    calls,
    isExpired: () => expired,
    expire: () => {
      expired = true;
    },
    switchAccount: () => {
      otherAccount = true;
    },
    enableMedia: () => {
      mediaEnabled = true;
    },
  };
}
async function signIn(page: Page) {
  const dialog = page.getByRole("dialog", {
    name: "Đăng nhập để tiếp tục",
    exact: true,
  });
  await dialog.getByLabel("Email", { exact: true }).fill("test@example.test");
  await dialog.getByLabel("Mật khẩu", { exact: true }).fill("correct-password");
  await dialog.getByRole("button", { name: /^Đăng nhập(?: Admin)?$/ }).click();
  await expect(dialog).toHaveCount(0);
}

for (const client of [
  "roommate-read",
  "roommate-write",
  "landlord-read",
  "landlord-upload",
]) {
  test(`${client}: expired session opens login without redirecting or replaying the request`, async ({
    page,
  }) => {
    const f = await fixture(page);
    await page.goto("/ai");
    await expect(page.locator(".quick-card")).toHaveCount(6);
    f.expire();
    await page.evaluate(async (client) => {
      if (client.startsWith("roommate")) {
        const { roommate } = await import("/src/roommate/client.ts");
        await roommate(
          client.endsWith("read") ? "/me/intro" : "/me/intro",
          client.endsWith("read") ? "GET" : "PUT",
          client.endsWith("read") ? undefined : { display_name: "Draft" },
        ).catch(() => {});
      } else {
        const { housingManagement, uploadListingImage } =
          await import("/src/landlord/client.ts");
        if (client.endsWith("upload"))
          await uploadListingImage(
            "listing",
            new File(["bytes"], "photo.png", { type: "image/png" }),
            "Photo",
          ).catch(() => {});
        else await housingManagement("landlord/properties").catch(() => {});
      }
    }, client);
    await expect(
      page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true }),
    ).toBeVisible();
    const before = f.calls.filter(
      (c) =>
        c.path.startsWith("/roommate/") ||
        c.path.startsWith("/landlord/") ||
        c.path.endsWith("/properties"),
    ).length;
    await signIn(page);
    await expect(page).toHaveURL(/\/ai$/);
    expect(
      f.calls.filter(
        (c) =>
          c.path.startsWith("/roommate/") ||
          c.path.startsWith("/landlord/") ||
          c.path.endsWith("/properties"),
      ),
    ).toHaveLength(before);
  });
}

test("guest can read a managed home; only an explicit contact request asks for login", async ({
  page,
}) => {
  const f = await fixture(page, "guest");
  await page.goto("/ai/th_auth?panel=house&house=home");
  await expect(
    page.getByRole("dialog", { name: "Chi tiết nhà", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Lời nhắn cho chủ nhà", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true }),
  ).toHaveCount(0);
  expect(
    f.calls.filter((c) => c.path.endsWith("/contact-requests/me")),
  ).toEqual([]);
  await page
    .getByRole("textbox", { name: "Lời nhắn cho chủ nhà", exact: true })
    .fill("Tôi muốn xem nhà vào chiều mai.");
  await page.getByRole("button", { name: "Gửi yêu cầu", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true }),
  ).toBeVisible();
  expect(
    f.calls.filter(
      (c) => c.method === "POST" && c.path.endsWith("/contact-requests"),
    ),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "Lời nhắn cho chủ nhà", exact: true }),
  ).toHaveValue("Tôi muốn xem nhà vào chiều mai.");
});

test("Roommate intro survives expiry and same-account login; a different account gets a fresh editor", async ({
  page,
}) => {
  // Isolate write expiry from background refreshes, which have separate read-expiry coverage.
  const f = await fixture(page, "account", true);
  await page.goto("/roommate?tab=profile");
  const name = page.getByRole("textbox", { name: "Tên hiển thị", exact: true });
  await expect(name).toHaveValue("An");
  await name.fill("Bản nháp của An");
  f.expire();
  await page
    .getByRole("button", { name: "Lưu bản giới thiệu riêng", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true }),
  ).toBeVisible();
  await signIn(page);
  await expect(name).toHaveValue("Bản nháp của An");
  expect(
    f.calls.filter(
      (c) => c.path === "/roommate/me/intro" && c.method === "PUT",
    ),
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "Lưu bản giới thiệu riêng", exact: true })
    .click();
  await expect(
    page.getByText("Đã lưu bản giới thiệu riêng. Chưa đăng công khai.", {
      exact: true,
    }),
  ).toBeVisible();
  f.expire();
  await name.fill("Không chuyển nháp này sang người khác");
  await page
    .getByRole("button", { name: "Lưu bản giới thiệu riêng", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true }),
  ).toBeVisible();
  f.switchAccount();
  await signIn(page);
  await expect(name).toHaveValue("Bình");
  expect(
    f.calls.filter(
      (c) => c.path === "/roommate/me/intro" && c.method === "PUT",
    ),
  ).toHaveLength(3);
});

test("Admin can reauthenticate with the Admin endpoint without leaving the workspace", async ({
  page,
}) => {
  const f = await fixture(page, "admin");
  await page.goto("/admin");
  await expect(
    page.getByRole("button", { name: "Đăng xuất", exact: true }),
  ).toBeVisible();
  f.expire();
  await page.evaluate(async () => {
    const { api } = await import("/src/api.ts");
    await api("/housing-management/moderation/housing/queue").catch(() => {});
  });
  await expect(
    page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true }),
  ).toBeVisible();
  await signIn(page);
  await expect(page).toHaveURL(/\/admin$/);
  expect(
    f.calls.filter((c) => c.path.startsWith("/auth/")).map((c) => c.path),
  ).toEqual(["/auth/admin"]);
});

test("403 permission denial does not open login", async ({ page }) => {
  await fixture(page);
  await page.goto("/ai");
  await page.route("**/web/api/roommate/me/intro", (route) =>
    route.fulfill({
      status: 403,
      json: { detail: { code: "service_restricted" } },
    }),
  );
  await page.evaluate(async () => {
    const { roommate } = await import("/src/roommate/client.ts");
    await roommate("/me/intro").catch(() => {});
  });
  await expect(
    page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true }),
  ).toHaveCount(0);
});

test("Roommate has no photo upload even when a legacy backend advertises media", async ({
  page,
}) => {
  const f = await fixture(page);
  f.enableMedia();
  await page.goto("/roommate?tab=profile");
  await expect(
    page.getByRole("textbox", { name: "Tên hiển thị", exact: true }),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  expect(
    f.calls.filter((c) => c.path === "/roommate/media" && c.method === "POST"),
  ).toHaveLength(0);
});

test("late previous-account saved data cannot enter the new account", async ({
  page,
}) => {
  const f = await fixture(page);
  let release: (() => void) | undefined;
  let oldRead = false,
    switched = false;
  await page.route("**/web/api/saved", async (route) => {
    if (!switched && !oldRead) {
      oldRead = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return route.fulfill({
        json: [
          {
            id: "old-home",
            thread_id: "private-old",
            house: {
              id: "old-home",
              title: "Nhà riêng của tài khoản cũ",
              price_vnd: 4000000,
            },
          },
        ],
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/ai");
  await expect.poll(() => oldRead).toBe(true);
  f.expire();
  await page.evaluate(async () => {
    const { api } = await import("/src/api.ts");
    await api("/profile/traveler").catch(() => {});
  });
  f.switchAccount();
  switched = true;
  await signIn(page);
  await page.getByRole("link", { name: "Mở tài khoản", exact: true }).focus();
  await page.getByRole("link", { name: "Mở tài khoản", exact: true }).click();
  await page.getByRole("tab", { name: /Đã lưu/ }).click();
  const oldResponse = page.waitForResponse(
    async (response) =>
      response.url().endsWith("/web/api/saved") &&
      (await response.text()).includes("old-home"),
  );
  release?.();
  await (await oldResponse).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByText("Nhà riêng của tài khoản cũ", { exact: true }),
  ).toHaveCount(0);
});

test("Roommate private reads resume after same-account login without replaying writes", async ({
  page,
}) => {
  const f = await fixture(page);
  f.expire();
  await page.goto("/roommate?tab=profile");
  await expect(
    page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true }),
  ).toBeVisible();
  await signIn(page);
  await expect(
    page.getByRole("textbox", { name: "Tên hiển thị", exact: true }),
  ).toHaveValue("An");
  expect(
    f.calls.filter(
      (c) => c.path.startsWith("/roommate/") && c.method !== "GET",
    ),
  ).toEqual([]);
});

test("expired flight checkout retries summary and traveler together without automatic payment", async ({
  page,
}) => {
  const f = await fixture(page);
  f.thread.state.checkout = {
    transactions: [
      {
        domain: "flight",
        title: "Vé kiểm thử",
        status: "selected",
        price_vnd: 900000,
      },
    ],
    totals: {},
  };
  let summaryCalls = 0;
  await page.route("**/web/api/threads/th_auth/checkout/summary", (route) => {
    summaryCalls++;
    // Expire when this operation reaches the server, after its button was clicked.
    if (summaryCalls === 1) f.expire();
    return f.isExpired()
      ? route.fulfill({
          status: 401,
          json: {
            code: "authentication_required",
            detail: "Đăng nhập để tiếp tục.",
          },
        })
      : route.fulfill({
          json: {
            transaction_id: "tx-flight",
            domain: "flight",
            title: "Vé kiểm thử",
            status: "selected",
            price_vnd: 900000,
            passenger_counts: { adult: 1 },
          },
        });
  });
  await page.goto("/ai/th_auth?panel=plan&planTab=checkout");
  await page
    .locator(".checkout-card")
    .getByRole("button", { name: "Thanh toán", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true }),
  ).toBeVisible();
  const failedLoads = summaryCalls;
  await signIn(page);
  expect(summaryCalls).toBe(failedLoads);
  await page
    .getByRole("dialog", { name: "Thanh toán vé máy bay", exact: true })
    .getByRole("button", { name: "Thử lại", exact: true })
    .click();
  await expect(page.getByText("1. NGUYEN AN", { exact: true })).toBeVisible();
  expect(summaryCalls).toBe(failedLoads + 1);
  expect(f.calls.filter((c) => c.path.endsWith("/pay"))).toEqual([]);
});

test("Roommate direct-link login retains the requested tab", async ({
  page,
}) => {
  await fixture(page, "guest");
  await page.goto("/roommate?tab=inbox");
  await page
    .getByRole("link", { name: "Đăng nhập để tìm người", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).fill("test@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("correct-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).focus();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Điều hướng Roommate", exact: true })
      .getByRole("link", { name: "Yêu cầu kết nối", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/tab=inbox/);
});
