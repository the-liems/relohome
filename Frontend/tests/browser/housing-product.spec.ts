import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const propertyId = "11111111-1111-4111-8111-111111111111";
const listingId = "33333333-3333-4333-8333-333333333333";
let moderator = false;
let reviewed: { path: string; body: unknown }[] = [];
const verifiedProfile = { user_id: "owner", poster_type: "owner", display_name: "Cô Mai", legal_name: "Trần Thị Mai", phone: "0901234567", broker_license_no: null, business_name: null, tax_code: null, status: "verified", info_request: null, terms_version: null, revision: 2 };
let profile: Record<string, unknown> | null = verifiedProfile;
let properties = true;
let savedProfile: unknown = null;
let messages: Record<string, string>[] = [];

test.beforeEach(async ({ page }) => {
  moderator = false;
  reviewed = [];
  profile = verifiedProfile;
  properties = true;
  savedProfile = null;
  messages = [{ id: "m0", sender_role: "tenant", body: "Chiều mai em qua được không ạ?", created_at: "2026-10-09T09:00:00Z" }];
  await page.route("**/web/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/web/api", "");
    if (path === "/session") return route.fulfill({ json: { id: "owner", email: "owner@example.test", name: "Mai", preferences: {} } });
    if (path === "/threads" || path === "/saved") return route.fulfill({ json: [] });
    if (path === "/status") return route.fulfill({ json: { status: "ok" } });
    if (path.endsWith("/moderation/housing/reviews")) return route.fulfill({ json: { items: [], flags: [], next_offset: null } });
    if (path.endsWith("/host/profile")) {
      if (route.request().method() === "PUT") {
        savedProfile = route.request().postDataJSON();
        profile = { ...verifiedProfile, ...(savedProfile as object), status: "pending", revision: 1 };
      }
      return route.fulfill({ json: { profile, terms_version: null } });
    }
    if (!properties && path.endsWith("/landlord/properties")) return route.fulfill({ json: { items: [] } });
    if (path.endsWith("/landlord/overview")) return route.fulfill({ json: { properties: 1, units: 3, vacant: 2, new_contacts: 1, measured_since: "2026-10-01T00:00:00Z", detail_views: 148, saves: 19, contact_requests: 7 } });
    if (path.endsWith("/landlord/properties")) return route.fulfill({ json: { items: [{ id: propertyId, name: "Nhà Nguyễn Trãi", property_type: "room", address: { full_address: "123 Nguyễn Trãi, Thanh Xuân, Hà Nội" }, lng: 105.81, lat: 21, role: "owner", status: "active", revision: 1, unit_count: 3, vacant_count: 2 }] } });
    if (path.endsWith(`/landlord/properties/${propertyId}`)) return route.fulfill({ json: { id: propertyId, name: "Nhà Nguyễn Trãi", property_type: "room", address: { full_address: "123 Nguyễn Trãi, Thanh Xuân, Hà Nội" }, lng: 105.81, lat: 21, role: "owner", status: "active", management_status: "active", revision: 1, unit_count: 3, vacant_count: 2, units: [{ id: "22222222-2222-4222-8222-222222222222", unit_code: "P.301", bedrooms: 1, bathrooms: 1, area_m2: 24, amenities: ["wifi"], listing_id: "33333333-3333-4333-8333-333333333333", title: "Phòng sáng thoáng", publication_status: "hidden", availability_status: "vacant", revision: 2 }, { id: "55555555-5555-4555-8555-555555555555", unit_code: "P.302", bedrooms: 1, bathrooms: 1, area_m2: 20, amenities: [], listing_id: "66666666-6666-4666-8666-666666666666", title: "Phòng gác lửng", publication_status: "published", availability_status: "vacant", revision: 3 }] } });
    if (path.endsWith(`/landlord/listings/${listingId}`)) return route.fulfill({ json: { id: listingId, property_id: propertyId, unit_id: "22222222-2222-4222-8222-222222222222", title: "Phòng sáng thoáng", description: "Phòng có cửa sổ lớn và nội thất cơ bản.", rent_vnd: 4500000, deposit_vnd: 4500000, availability_from: "2026-10-20", publication_status: "hidden", availability_status: "vacant", rejection_reason: null, revision: 2, updated_at: "2026-10-08T10:00:00Z", fees: [{ id: "fee-1", code: "electricity", label: "Tiền điện", amount: 4000, billing_unit: "kwh", required: true, refundable: false }, { id: "fee-2", code: "service", label: "Phí dịch vụ", amount: null, billing_unit: "month", required: true, refundable: false }], media: [] } });
    if (path.endsWith("/messages")) {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        messages.push({ id: `m${messages.length}`, sender_role: "landlord", body: body.body, created_at: "2026-10-09T09:05:00Z" });
        return route.fulfill({ status: 201, json: messages.at(-1) });
      }
      return route.fulfill({ json: { role: "landlord", request: { id: "99999999-9999-4999-8999-999999999999", title: "Phòng sáng thoáng", status: "new", message: "Người thuê đặt lịch xem nhà qua ReloHome.", created_at: "2026-10-09T08:00:00Z", open: true }, messages } });
    }
    if (path.endsWith("/viewing") && path.includes("/landlord/contact-requests/")) {
      reviewed.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ json: { viewing_status: "confirmed" } });
    }
    if (path.endsWith("/landlord/contact-requests")) return route.fulfill({ json: { items: [{ id: "99999999-9999-4999-8999-999999999999", listing_id: listingId, tenant_user_id: "tenant-2", message: "Người thuê đặt lịch xem nhà qua ReloHome.", status: "new", revision: 1, created_at: "2026-10-09T08:00:00Z", updated_at: "2026-10-09T08:00:00Z", title: "Phòng sáng thoáng", unit_code: "P.301", property_name: "Nhà Nguyễn Trãi", viewing_slot: "2026-10-10T06:00:00Z", viewing_status: "requested", source: "viewing", unread: 1 }, { id: "44444444-4444-4444-8444-444444444444", listing_id: "33333333-3333-4333-8333-333333333333", tenant_user_id: "tenant-1", message: "Tôi muốn xem phòng vào cuối tuần.", status: "new", revision: 1, created_at: "2026-10-08T10:00:00Z", updated_at: "2026-10-08T10:00:00Z", title: "Phòng sáng thoáng", unit_code: "P.301", property_name: "Nhà Nguyễn Trãi" }] } });
    if (path.endsWith("/moderation/housing/queue")) {
      if (!moderator) return route.fulfill({ status: 403, json: { detail: "Moderator permission is required." } });
      return route.fulfill({ json: { hosts: [{ user_id: "owner-2", poster_type: "broker", display_name: "Anh Tuấn môi giới", legal_name: "Lê Văn Tuấn", phone: "0912 345 678", broker_license_no: "CC-0042", business_name: null, tax_code: null, updated_at: "2026-10-08T08:00:00Z", pending_properties: 1, pending_listings: 1 }], properties: [{ id: "77777777-7777-4777-8777-777777777777", name: "Nhà Lê Lợi", property_type: "house", address: { full_address: "45 Lê Lợi, Quận 1, TP.HCM" }, user_id: "owner-2", requested_at: "2026-10-08T09:00:00Z", host_status: "pending", host_name: "Anh Tuấn môi giới", poster_type: "broker" }], listings: [{ id: "88888888-8888-4888-8888-888888888888", title: "Căn hộ gần chợ", description: "Hai phòng ngủ, có ban công.", property_name: "Nhà Lê Lợi", address: { full_address: "45 Lê Lợi, Quận 1, TP.HCM" }, unit_code: "A1", created_by: "owner-2", updated_at: "2026-10-08T09:30:00Z", rent_vnd: 7000000, deposit_vnd: null, fee_count: 2, pending_media: [], property_status: "pending", host_status: "pending", host_name: "Anh Tuấn môi giới", poster_type: "broker" }] } });
    }
    if (path.includes("/moderation/housing/") || path.includes("/moderation/host/")) {
      reviewed.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { detail: "fixture missing" } });
  });
});

test("landlord workspace presents real operations clearly on desktop and mobile", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/landlord");
  await expect(page.getByRole("heading", { name: "Quản lý nhà cho thuê" })).toBeVisible();
  await expect(page.getByText("148")).toBeVisible();
  await page.getByRole("button", { name: /Nhà & phòng/ }).click();
  await page.getByRole("button", { name: /Nhà Nguyễn Trãi/ }).click();
  await expect(page.getByText("P.301")).toBeVisible();
  await expect(page.getByText("Còn trống").first()).toBeVisible();
  // A published listing must be hidden before editing; the hidden one is editable and can be resubmitted.
  await expect(page.getByRole("button", { name: "Sửa tin" }).nth(1)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Gửi duyệt" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Duyệt tin/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Sửa tin" }).first().click();
  await expect(page.getByLabel("Giá thuê / tháng")).toHaveValue("4500000");
  await expect(page.locator('textarea[name="description"]')).toHaveValue("Phòng có cửa sổ lớn và nội thất cơ bản.");
  await expect(page.getByLabel("Tên khoản phí").first()).toHaveValue("Tiền điện");
  await expect(page.getByLabel("Số tiền").first()).toHaveValue("4000");
  // An unknown amount stays blank (shown to tenants as "Chưa rõ"), never 0.
  await expect(page.getByLabel("Số tiền").nth(1)).toHaveValue("");
  await page.getByRole("button", { name: "Đóng" }).click();
  await page.getByRole("button", { name: /Yêu cầu liên hệ/ }).click();
  await expect(page.getByText("Tôi muốn xem phòng vào cuối tuần.")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Quản lý nhà cho thuê" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
  expect(errors).toEqual([]);
});

test("moderators see the review queue and send decisions", async ({ page }) => {
  moderator = true;
  // A moderator who does not post is not pushed into the poster form.
  profile = null;
  properties = false;
  await page.goto("/landlord");
  await page.getByRole("button", { name: /Duyệt tin/ }).click();
  await expect(page.getByText("Nhà Lê Lợi").first()).toBeVisible();
  await expect(page.getByText("Căn hộ gần chợ")).toBeVisible();
  await expect(page.getByText("Lê Văn Tuấn")).toBeVisible();
  // The poster and the location are not verified yet, so neither can be approved.
  await expect(page.getByRole("button", { name: "Duyệt và hiển thị" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Xác minh địa điểm" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Đã xác minh" })).toBeDisabled();
  await page.getByLabel("Cách đã xác minh").selectOption("video_call");
  await page.getByRole("button", { name: "Đã xác minh" }).click();
  await page.getByLabel("Lý do cần bổ sung", { exact: true }).fill("Thiếu ảnh phòng");
  await page.getByRole("button", { name: "Trả lại để bổ sung" }).click();
  await expect.poll(() => reviewed.length).toBe(2);
  expect(reviewed[0]).toEqual({
    path: "/housing-management/moderation/host/owner-2/review",
    body: { decision: "verify", method: "video_call" },
  });
  expect(reviewed[1]).toEqual({
    path: "/housing-management/moderation/housing/listings/88888888-8888-4888-8888-888888888888/review",
    body: { decision: "reject", reason: "Thiếu ảnh phòng" },
  });
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
});

test("first visit in owner mode asks for the poster profile, then shows its review state", async ({ page }) => {
  profile = null;
  properties = false;
  await page.goto("/ai");
  await page.getByRole("link", { name: "Chế độ chủ nhà" }).click();
  await expect(page.getByRole("heading", { name: "Bắt đầu cho thuê trên ReloHome" })).toBeVisible();
  await page.getByText("Môi giới", { exact: true }).click();
  await page.getByLabel("Tên hiển thị với người thuê").fill("Anh Tuấn môi giới");
  await page.getByLabel("Họ tên đầy đủ").fill("Lê Văn Tuấn");
  await page.getByLabel("Số điện thoại để ReloHome xác minh").fill("0912 345 678");
  await page.getByLabel("Số chứng chỉ hành nghề môi giới (nếu có)").fill("CC-0042");
  await page.getByRole("button", { name: "Gửi hồ sơ để xác minh" }).click();
  await expect(page.getByText("Hồ sơ đang chờ xác minh")).toBeVisible();
  expect(savedProfile).toEqual({
    poster_type: "broker", display_name: "Anh Tuấn môi giới", legal_name: "Lê Văn Tuấn", phone: "0912 345 678",
    broker_license_no: "CC-0042", business_name: null, tax_code: null,
  });
  await expect(page.getByRole("link", { name: "Chế độ thuê nhà" })).toHaveAttribute("href", "/ai");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
});

test("a viewing time booked by a tenant can be confirmed from the landlord inbox", async ({ page }) => {
  await page.goto("/landlord");
  await page.locator(".ll-nav").getByRole("button", { name: /Yêu cầu liên hệ/ }).click();
  await expect(page.getByText(/Giờ xem người thuê chọn:/)).toBeVisible();
  await expect(page.getByText("Chờ bạn xác nhận")).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận giờ xem" }).click();
  await expect.poll(() => reviewed.length).toBe(1);
  expect(reviewed[0]).toEqual({
    path: "/housing-management/landlord/contact-requests/99999999-9999-4999-8999-999999999999/viewing",
    body: { decision: "confirm", revision: 1 },
  });
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
});

test("landlord and tenant exchange messages on a request", async ({ page }) => {
  await page.goto("/landlord");
  await page.locator(".ll-nav").getByRole("button", { name: /Yêu cầu liên hệ/ }).click();
  await page.getByRole("button", { name: /Nhắn tin với người thuê/ }).first().click();
  await expect(page.getByText("Chiều mai em qua được không ạ?")).toBeVisible();
  await page.getByLabel("Nội dung tin nhắn").fill("Được em, 3 giờ chiều nhé.");
  await page.getByRole("button", { name: "Gửi" }).click();
  await expect(page.locator(".contact-thread-list li.mine")).toContainText("Được em, 3 giờ chiều nhé.");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
});
