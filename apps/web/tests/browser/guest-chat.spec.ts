import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { waitForUiMotion } from "./helpers/ui-motion";

async function fixture(page: Page, seeded = false) {
  let account = false, failLogin = false, quota = false, sessions = 0, denySchedule = false;
  const posts: string[] = [];
  const guest = {
    id: "guest_" + "a".repeat(32), kind: "guest", is_guest: true, name: "Khách", email: "", preferences: {},
    expires_at: Date.now() / 1000 + 86400, active_thread_id: seeded ? "th_guest" : null,
    capabilities: ["chat", "housing_read", "flight_read", "map_read", "guides"],
  };
  const house = { id: "home", title: "Phòng Ocean Park", address: "Ocean Park 2, Hưng Yên", price_vnd: 4000000, lat: 20.956, lng: 105.994 };
  const thread: any = {
    id: "th_guest", title: "Tìm nhà", updated: Date.now() / 1000, revision: 1, runs: [],
    state: { plan: { version: 1, tasks: [{ id: "housing", agent: "property", inputs: {} }] }, intake: { user_confirmed_facts: {} }, task_status: { housing: "done" }, viewing: { max_selected: 3, items: [], slots: [] } },
    messages: [],
  };
  const reply = () => {
    thread.messages = [{ id: "reply", role: "assistant", created: Date.now() / 1000, content: {
      response: { kind: "ANSWER", text: "Kết quả nhà trong phiên khách." },
      ui: { version: 1, plan_version: 1, components: [{ id: "housing-result", type: "property", task_id: "housing", fetched_at: new Date().toISOString(), data: { candidates: [house] } }] },
    } }];
  };
  if (seeded) reply();
  await page.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#edf3ef" } }] } }));
  await page.route("**/web/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/web/api", "");
    if (route.request().method() !== "GET") posts.push(path);
    if (path === "/session") {
      sessions++;
      return route.fulfill({ json: account ? { id: "b".repeat(32), name: "An", email: "an@example.test", preferences: {} } : guest });
    }
    if (path.startsWith("/auth/")) {
      if (failLogin) return route.fulfill({ status: 401, json: { detail: "Email hoặc mật khẩu chưa đúng." } });
      account = true;
      return route.fulfill({ json: { id: "b".repeat(32), name: "An", email: "an@example.test", preferences: {} } });
    }
    if (path === "/status") return route.fulfill({ json: { domains: ["property", "flight", "map", "relocation"], writes_enabled: account } });
    if (path === "/threads") {
      if (route.request().method() === "POST") { guest.active_thread_id = "th_guest"; return route.fulfill({ json: thread }); }
      return route.fulfill({ json: seeded || thread.messages.length ? [thread] : [] });
    }
    if (path === "/threads/th_guest/chat") {
      if (quota) return route.fulfill({ status: 429, json: { code: "guest_quota", detail: "Bạn đã dùng hết lượt của phiên khách. Hãy chờ hoặc đăng nhập." } });
      reply(); return route.fulfill({ json: thread });
    }
    if (path === "/threads/th_guest") return route.fulfill({ json: thread });
    if (path.startsWith("/platform/")) return route.fulfill({ json: { type: "FeatureCollection", features: [], results: [], page: { returned_count: 0, next_cursor: null } } });
    if (path === "/roommate/availability") return route.fulfill({ json: { enabled: false, requires_account: true } });
    if (path === "/saved") return route.fulfill({ json: [] });
    if (path.endsWith("/viewings")) return route.fulfill({ json: thread.state.viewing });
    if (path.endsWith("/viewings/schedule")) {
      if (!account || denySchedule) return route.fulfill({ status: 401, json: { code: "authentication_required", detail: "Đăng nhập để sử dụng chức năng này." } });
      const body = route.request().postDataJSON();
      const item = thread.state.viewing.items.find((i: any) => i.listing_id === body.listing_id);
      Object.assign(item, { status: "viewing_scheduled", viewing: { slot: body.slot } });
      return route.fulfill({ json: thread.state.viewing });
    }
    return route.fulfill({ json: {} });
  });
  return { guest, thread, posts, denySchedule: (value: boolean) => { denySchedule = value; }, failLogin: (value: boolean) => { failLogin = value; }, quota: () => { quota = true; }, sessions: () => sessions };
}

async function login(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true });
  await dialog.getByLabel("Email", { exact: true }).fill("an@example.test");
  await dialog.getByLabel("Mật khẩu", { exact: true }).fill("correct-password");
  await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click();
}

function seedViewing(thread: any) {
  const slot = "2027-02-10T22:00:00+07:00";
  thread.state.viewing = { max_selected: 3, slot_minutes: 30, slots: [slot], items: [
    { listing_id: "home", title: "Phòng Ocean Park", status: "selected", snapshot: { address: "Ocean Park 2" } },
  ] };
  return slot;
}

test("guest viewing confirmation preserves review through cancel and login without sending automatically", async ({ page }) => {
  const f = await fixture(page, true);
  const slot = seedViewing(f.thread);
  await page.goto("/ai/th_guest?panel=plan&planTab=viewing");
  await page.getByLabel("Giờ xem · Phòng Ocean Park", { exact: true }).selectOption(slot);
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận 1 lịch", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true })).toBeVisible();
  expect(f.posts.filter(p => p.endsWith("/schedule"))).toEqual([]);
  await page.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Xem lại lịch trước khi gửi", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận 1 lịch", exact: true }).click();
  await login(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Xem lại lịch trước khi gửi", exact: true })).toBeVisible();
  expect(f.posts.filter(p => p.endsWith("/schedule"))).toEqual([]);
  await page.getByRole("button", { name: "Xác nhận 1 lịch", exact: true }).click();
  await expect(page.locator(".bulk-result.saved")).toContainText("Đã lưu lịch");
  expect(f.posts.filter(p => p.endsWith("/schedule"))).toHaveLength(1);
});

test("expired account reauthenticates in place and keeps the unsent viewing review", async ({ page }, info) => {
  const f = await fixture(page, true);
  const slot = seedViewing(f.thread);
  await page.goto("/ai/th_guest?panel=plan&planTab=viewing");
  await page.getByLabel("Giờ xem · Phòng Ocean Park", { exact: true }).selectOption(slot);
  await page.getByRole("button", { name: "Đi tiếp", exact: true }).click();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).focus();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await login(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Xem lại lịch trước khi gửi", exact: true })).toBeVisible();
  f.denySchedule(true);
  await page.getByRole("button", { name: "Xác nhận 1 lịch", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true })).toBeVisible();
  f.denySchedule(false);
  await login(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Xem lại lịch trước khi gửi", exact: true })).toBeVisible();
  await expect(page.locator(".bulk-result.failed")).toHaveCount(0);
  expect(f.posts.filter(p => p.endsWith("/schedule"))).toHaveLength(1);
  await page.screenshot({ path: info.outputPath("review-after-reauth.png") });
  await page.getByRole("button", { name: "Xác nhận 1 lịch", exact: true }).click();
  await expect(page.locator(".bulk-result.saved")).toHaveCount(1);
  expect(f.posts.filter(p => p.endsWith("/schedule"))).toHaveLength(2);
});

test("guest login remains accessible in dark mode and English without losing the map", async ({ page }, info) => {
  const f = await fixture(page, true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/ai");
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).focus();
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sign in to continue", exact: true })).toBeVisible();
  await waitForUiMotion(page);
  expect((await new AxeBuilder({ page }).include(".dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("guest-login-dark-en.png") });
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/ai\/th_guest$/);
  await expect(page.locator(".maplibregl-canvas").first()).toBeVisible();
  expect(f.posts.filter(path => !path.startsWith("/platform/"))).toEqual([]);
});

test("guest welcome and chat work without login; no private draft is persisted", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/ai");
  await expect(page.locator(".quick-card")).toHaveCount(6);
  await expect(page.locator(".login-page")).toHaveCount(0);
  await page.locator(".starter > button").first().click();
  await expect(page.getByRole("textbox", { name: "Tin nhắn cho ReloHome" })).toHaveValue("Tìm nhà ở khu Ocean Park 2 dưới 5 triệu");
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("siu-draft-")))).toEqual([]);
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await expect(page).toHaveURL(/\/ai\/th_guest$/);
  await expect(page.getByRole("region", { name: "Bản đồ nhà ở", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(f.posts.filter(path => path.includes("auth"))).toEqual([]);
});

test("login dialog keeps draft on error/cancel and restores focus without sending chat", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/ai");
  const input = page.getByRole("textbox", { name: "Tin nhắn cho ReloHome", exact: true });
  await input.fill("Nội dung đang viết");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).focus();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  f.failLogin(true);
  await login(page);
  await expect(page.getByRole("dialog")).toContainText("Email hoặc mật khẩu chưa đúng.");
  await page.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(input).toHaveValue("Nội dung đang viết");
  await expect(page).toHaveURL(/\/ai$/);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).focus();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  f.failLogin(false);
  await login(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(input).toHaveValue("Nội dung đang viết");
  expect(f.posts.filter(path => path.endsWith("/chat"))).toEqual([]);
});

test("signing in keeps the original map mounted and never sends booking or payment", async ({ page }, info) => {
  const f = await fixture(page, true);
  await page.goto("/ai");
  const map = page.locator(".maplibregl-canvas").first();
  await map.waitFor();
  await map.evaluate(element => element.setAttribute("data-guest-continuity", "same-map"));
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).focus();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await waitForUiMotion(page);
  expect((await new AxeBuilder({ page }).include(".dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("guest-login-context.png") });
  await login(page);
  await expect(page.locator('[data-guest-continuity="same-map"]')).toHaveCount(1);
  await expect(page).toHaveURL(/\/ai\/th_guest$/);
  await expect(page.getByRole("link", { name: "Mở tài khoản", exact: true })).toBeVisible();
  expect(f.posts.filter(path => /schedule|pay|decision|contact/.test(path))).toEqual([]);
});

test("Roommate and landlord request login without changing workspace before consent", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/ai");
  await page.locator('.quick-card[data-service="roommate"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/ai$/);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Chế độ chủ nhà", exact: true }).focus();
  await page.getByRole("link", { name: "Chế độ chủ nhà", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/ai$/);
  expect(f.posts).toEqual([]);
});

test("guest checkout asks for login before opening a payment or sending a summary", async ({ page }) => {
  const f = await fixture(page, true);
  f.thread.state.checkout = { transactions: [{ domain: "flight", title: "Vé thử nghiệm", status: "selected", price_vnd: 900000 }], totals: {} };
  await page.goto("/ai/th_guest?panel=plan&planTab=checkout");
  await page.locator(".checkout-card").getByRole("button", { name: "Thanh toán", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Thanh toán vé máy bay", exact: true })).toHaveCount(0);
  expect(f.posts.filter(path => path.includes("/checkout/"))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "Thanh toán", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("guest save and restricted reads request login, while wrong credentials stay a login error", async ({ page }) => {
  const f = await fixture(page, true);
  await page.goto("/ai/th_guest?panel=house&house=home");
  await page.getByRole("button", { name: "Lưu nhà", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true })).toBeVisible();
  expect(f.posts.filter(path => path.startsWith("/saved/"))).toEqual([]);
  await page.keyboard.press("Escape");
  await page.route("**/web/api/profile/traveler", route => route.fulfill({status: 401, json: {code: "authentication_required", detail: "Đăng nhập để sử dụng chức năng này."}}));
  await page.evaluate(async () => {
    const { api } = await import("/src/api.ts");
    await api("/profile/traveler").catch(() => {});
  });
  await expect(page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true })).toBeVisible();
  f.failLogin(true);
  await login(page);
  await expect(page.getByRole("dialog", { name: "Đăng nhập để tiếp tục", exact: true })).toContainText("Email hoặc mật khẩu chưa đúng.");
  expect(f.posts.filter(path => /schedule|pay|decision/.test(path))).toEqual([]);
});

test("guest quota restores the unsent draft and does not invent a result", async ({ page }, info) => {
  const f = await fixture(page);
  f.quota();
  await page.goto("/ai");
  const input = page.getByRole("textbox", { name: "Tin nhắn cho ReloHome", exact: true });
  await input.fill("Tìm nhà trong hạn mức");
  const failure = page.waitForResponse(response => response.url().endsWith("/chat"));
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await info.attach("quota-response.json", { body: JSON.stringify({ response: await (await failure).json(), posts: f.posts }), contentType: "application/json" });
  await expect(input).toHaveValue("Tìm nhà trong hạn mức");
  await expect(page.getByText("Bạn đã dùng hết lượt của phiên khách. Hãy chờ hoặc đăng nhập.", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("Tìm nhà trong hạn mức");
  await expect(page.getByRole("region", { name: "Bản đồ nhà ở", exact: true })).toHaveCount(0);
});

test("guest expiry clears the old conversation and opens a fresh session", async ({ page }) => {
  const f = await fixture(page, true);
  f.guest.expires_at = Date.now() / 1000 + 600;
  await page.clock.install();
  await page.goto("/ai");
  await expect(page.getByRole("region", { name: "Bản đồ nhà ở", exact: true })).toBeVisible();
  f.guest.id = "guest_" + "e".repeat(32);
  f.guest.active_thread_id = null;
  f.guest.expires_at = Date.now() / 1000 + 86400;
  await page.clock.fastForward(610000);
  await expect(page).toHaveURL(/\/ai$/);
  await expect(page.locator(".quick-card")).toHaveCount(6);
  await expect(page.getByRole("region", { name: "Bản đồ nhà ở", exact: true })).toHaveCount(0);
  expect(f.sessions()).toBeGreaterThanOrEqual(2);
});
