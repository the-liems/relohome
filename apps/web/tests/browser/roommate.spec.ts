import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
const profile = {
  profile_id: "anna",
  display_name: "Anna Nguyễn",
  introduction:
    "Tìm người cùng thuê phòng, tôn trọng không gian riêng và cùng thống nhất việc dọn dẹp.",
  facts,
  avatar_id: null,
};
const intro = {
  display_name: "Minh",
  introduction: "Tôi muốn tìm người cùng thuê phòng và sinh hoạt gọn gàng.",
  facts,
  preferences: {},
};
const compatibility = {
  score: null,
  label: null,
  positives: ["areas"],
  differences: [],
  missing: ["budget", "smoking", "pets_allowed"],
};
async function fixture(
  page: Page,
  settings: {
    guest?: boolean;
    enabled?: boolean;
    eligible?: boolean;
    empty?: boolean;
    unavailable?: boolean;
  } = {},
) {
  const payloads: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/web/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/web/api",
      "",
    );
    const body = route.request().postDataJSON();
    if (body) payloads.push({ path, body });
    let data: unknown = {};
    if (path === "/session") {
      if (settings.guest)
        return route.fulfill({ status: 401, json: { detail: "Sign in" } });
      data = {
        id: "viewer",
        name: "Minh",
        email: "minh@example.test",
        preferences: {},
      };
    } else if (path === "/threads" || path === "/saved") data = [];
    else if (path === "/roommate/availability")
      data = {
        enabled: settings.enabled !== false,
        cities: ["hcm", "hanoi", "danang"],
        terms_version: "roommate-1.0",
      };
    else if (path === "/roommate/access")
      data = {
        eligible: settings.eligible !== false || Boolean(body),
        terms_version: "roommate-1.0",
        moderator: false,
      };
    else if (path === "/roommate/me/criteria") data = null;
    else if (path === "/roommate/areas/hcm")
      data = { areas: [{ area_id: "city:hcm", city: "hcm" }] };
    else if (path === "/roommate/search")
      data = {
        items: settings.empty ? [] : [{ profile, compatibility }],
        total: settings.empty ? 0 : 1,
        offset: 0,
        limit: 12,
      };
    else if (path === "/roommate/profiles/anna")
      data = settings.unavailable
        ? { available: false, profile_id: "anna" }
        : { available: true, profile };
    else if (path === "/roommate/me/bookmarks") data = { items: [] };
    else if (path === "/roommate/me/intro") data = intro;
    else if (path === "/roommate/me/profile") data = null;
    else if (path === "/roommate/me/profile/preview")
      data = { ...intro, profile_id: "viewer" };
    else if (path === "/roommate/me/contacts")
      data = {
        channels: [
          {
            channel_id: "phone1",
            version: 1,
            kind: "phone",
            value: "0901234567",
          },
        ],
      };
    else if (path === "/roommate/requests")
      data = { request_id: "request-one", direction: "sent" };
    else if (path === "/roommate/requests/request-one")
      data = {
        request_id: "request-one",
        direction: "sent",
        state: "pending",
        available: true,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 604800000).toISOString(),
        grant_state: null,
        grant_expires_at: null,
        intro: { ...intro, reviewed_at: new Date().toISOString() },
        actions: ["withdraw"],
      };
    await route.fulfill({ json: data });
  });
  return payloads;
}
test("roommate guest, disabled and explicit age/terms gates", async ({
  page,
}) => {
  await fixture(page, { guest: true });
  await page.goto("/roommate/profiles/anna");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Tìm người",
  );
  await expect(page.getByText("Anna Nguyễn")).toHaveCount(0);
  await page.unrouteAll();
  await fixture(page, { enabled: false });
  await page.goto("/roommate");
  await expect(page.getByText("Roommate chưa được bật")).toBeVisible();
  await page.unrouteAll();
  const calls = await fixture(page, { eligible: false });
  await page.goto("/roommate");
  const continueButton = page.getByRole("button", {
    name: "Xác nhận và tiếp tục",
  });
  await expect(continueButton).toBeDisabled();
  await page.getByLabel("Tôi xác nhận mình từ 18 tuổi.").check();
  await page.getByLabel(/Tôi đồng ý quy tắc sử dụng/).check();
  await continueButton.click();
  expect(calls.find((c) => c.path === "/roommate/access")?.body).toEqual({
    adult: true,
    terms_version: "roommate-1.0",
  });
});
test("search, missing score, fresh detail and reviewed contact consent preserve payload", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.goto("/roommate");
  await page.getByRole("button", { name: "Tìm người phù hợp" }).click();
  await expect(page.getByText("Chưa đủ dữ liệu để chấm điểm")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("/100", { exact: false })).toHaveCount(0);
  await page.getByRole("link", { name: "Xem hồ sơ" }).click();
  await page.getByRole("button", { name: "Gửi yêu cầu kết nối" }).click();
  await page.getByRole("button", { name: "Xem lại trước khi gửi" }).click();
  const dialog = page.getByRole("dialog"),
    send = dialog.getByRole("button", { name: "Gửi yêu cầu", exact: true });
  await expect(send).toBeDisabled();
  await dialog.getByLabel(/Điện thoại: 0901234567/).check();
  await expect(send).toBeDisabled();
  await dialog.getByLabel(/Tôi đã xem lại bản giới thiệu/).check();
  await send.click();
  await expect(page).toHaveURL(/requests\/request-one/);
  const body = calls.find((c) => c.path === "/roommate/requests")!.body;
  expect(body).toMatchObject({
    recipient_id: "anna",
    consent: true,
    contact: { channel_id: "phone1", version: 1 },
    intro,
  });
  expect(body).not.toHaveProperty("actor_id");
  expect(typeof body.operation_key).toBe("string");
  expect(JSON.stringify(body)).not.toContain("0901234567");
});
test("responsive, keyboard and accessibility in both themes/languages with clean console", async ({
  page,
}, info) => {
  await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      errors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/roommate");
    await page.getByRole("button", { name: "Tìm người phù hợp" }).click();
    await expect(page.getByRole("link", { name: "Xem hồ sơ" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Find a roommate", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Switch to dark|Chuyển sang tối/ })
    .click();
  const dark = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(dark.violations.map((v) => v.id)).toEqual([]);
  await page.screenshot({
    path: info.outputPath("roommate-dark-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "View profile", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "Send a connection request", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Send a connection request",
      exact: true,
    }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});
test("empty, stale profile and read error stay actionable", async ({
  page,
}) => {
  await fixture(page, { empty: true, unavailable: true });
  await page.goto("/roommate");
  await page.getByRole("button", { name: "Tìm người phù hợp" }).click();
  await expect(page.getByText("Chưa tìm thấy hồ sơ phù hợp")).toBeVisible();
  await page.goto("/roommate/profiles/anna");
  await expect(page.getByText("Hồ sơ không còn khả dụng")).toBeVisible();
  await expect(page.getByText("Anna Nguyễn")).toHaveCount(0);
  await page.route("**/web/api/roommate/availability", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: { code: "service_unavailable" } },
    }),
  );
  await page.goto("/roommate");
  await expect(page.getByRole("alert")).toContainText(
    "Chưa kết nối được dịch vụ",
  );
  await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
});
test("unknown write outcome is reconciled without sending a second connection", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.route("**/web/api/roommate/requests", async (route) => {
    calls.push({
      path: "/roommate/requests",
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      status: 503,
      json: { detail: { code: "operation_unknown" } },
    });
  });
  await page.route("**/web/api/roommate/operations/*", (route) =>
    route.fulfill({
      json: {
        status: "completed",
        result: { request_id: "request-one", direction: "sent" },
      },
    }),
  );
  await page.goto("/roommate/profiles/anna");
  await page
    .getByRole("button", { name: "Gửi yêu cầu kết nối", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Xem lại trước khi gửi", exact: true })
    .click();
  await page.getByLabel(/Điện thoại: 0901234567/).check();
  await page.getByLabel(/Tôi đã xem lại bản giới thiệu/).check();
  const send = page.getByRole("button", { name: "Gửi yêu cầu", exact: true });
  await send.click();
  await expect(send).toBeDisabled();
  await page
    .getByRole("button", { name: "Kiểm tra trạng thái", exact: true })
    .click();
  await expect(page).toHaveURL(/requests\/request-one/);
  expect(calls.filter((c) => c.path === "/roommate/requests")).toHaveLength(1);
});
