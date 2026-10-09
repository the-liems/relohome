import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const propertyId = "11111111-1111-4111-8111-111111111111";
const listingId = "33333333-3333-4333-8333-333333333333";

test.beforeEach(async ({ page }) => {
  await page.route("**/web/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/web/api", "");
    if (path === "/session") return route.fulfill({ json: { id: "owner", email: "owner@example.test", name: "Mai", preferences: {} } });
    if (path === "/threads" || path === "/saved") return route.fulfill({ json: [] });
    if (path === "/status") return route.fulfill({ json: { status: "ok" } });
    if (path.endsWith("/landlord/overview")) return route.fulfill({ json: { properties: 1, units: 3, vacant: 2, new_contacts: 1, measured_since: "2026-10-01T00:00:00Z", detail_views: 148, saves: 19, contact_requests: 7 } });
    if (path.endsWith("/landlord/properties")) return route.fulfill({ json: { items: [{ id: propertyId, name: "Nhà Nguyễn Trãi", property_type: "room", address: { full_address: "123 Nguyễn Trãi, Thanh Xuân, Hà Nội" }, lng: 105.81, lat: 21, role: "owner", status: "active", revision: 1, unit_count: 3, vacant_count: 2 }] } });
    if (path.endsWith(`/landlord/properties/${propertyId}`)) return route.fulfill({ json: { id: propertyId, name: "Nhà Nguyễn Trãi", property_type: "room", address: { full_address: "123 Nguyễn Trãi, Thanh Xuân, Hà Nội" }, lng: 105.81, lat: 21, role: "owner", status: "active", management_status: "active", revision: 1, unit_count: 3, vacant_count: 2, units: [{ id: "22222222-2222-4222-8222-222222222222", unit_code: "P.301", bedrooms: 1, bathrooms: 1, area_m2: 24, amenities: ["wifi"], listing_id: "33333333-3333-4333-8333-333333333333", title: "Phòng sáng thoáng", publication_status: "published", availability_status: "vacant", revision: 2 }] } });
    if (path.endsWith(`/landlord/listings/${listingId}`)) return route.fulfill({ json: { id: listingId, property_id: propertyId, unit_id: "22222222-2222-4222-8222-222222222222", title: "Phòng sáng thoáng", description: "Phòng có cửa sổ lớn và nội thất cơ bản.", rent_vnd: 4500000, deposit_vnd: 4500000, availability_from: "2026-10-20", publication_status: "published", availability_status: "vacant", rejection_reason: null, revision: 2, updated_at: "2026-10-08T10:00:00Z", fees: [{ id: "fee-1", code: "electricity", label: "Tiền điện", amount: 4000, billing_unit: "kwh", required: true, refundable: false }], media: [] } });
    if (path.endsWith("/landlord/contact-requests")) return route.fulfill({ json: { items: [{ id: "44444444-4444-4444-8444-444444444444", listing_id: "33333333-3333-4333-8333-333333333333", tenant_user_id: "tenant-1", message: "Tôi muốn xem phòng vào cuối tuần.", status: "new", revision: 1, created_at: "2026-10-08T10:00:00Z", updated_at: "2026-10-08T10:00:00Z", title: "Phòng sáng thoáng", unit_code: "P.301", property_name: "Nhà Nguyễn Trãi" }] } });
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
  await expect(page.getByText("Còn trống")).toBeVisible();
  await page.getByRole("button", { name: "Sửa tin" }).click();
  await expect(page.getByLabel("Giá thuê / tháng")).toHaveValue("4500000");
  await expect(page.locator('textarea[name="description"]')).toHaveValue("Phòng có cửa sổ lớn và nội thất cơ bản.");
  await expect(page.getByLabel("Điện / kWh")).toHaveValue("4000");
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
