import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const propertyId = "11111111-1111-4111-8111-111111111111";
const listingId = "33333333-3333-4333-8333-333333333333";
let moderator = false;
let reviewed: { path: string; body: unknown }[] = [];
const verifiedProfile = {
  user_id: "owner",
  poster_type: "owner",
  display_name: "Cô Mai",
  legal_name: "Trần Thị Mai",
  phone: "0901234567",
  broker_license_no: null,
  business_name: null,
  tax_code: null,
  status: "verified",
  info_request: null,
  terms_version: null,
  revision: 2,
};
let profile: Record<string, unknown> | null = verifiedProfile;
let properties = true;
let savedProfile: unknown = null;
let profileSaves = 0;
let messages: Record<string, string>[] = [];
let propertyPayload: unknown = null;

test.beforeEach(async ({ page }) => {
  moderator = false;
  reviewed = [];
  profile = verifiedProfile;
  properties = true;
  savedProfile = null;
  profileSaves = 0;
  propertyPayload = null;
  messages = [
    {
      id: "m0",
      sender_role: "tenant",
      sender_user_id: "tenant-2",
      body: "Chiều mai em qua được không ạ?",
      created_at: "2026-10-09T09:00:00Z",
    },
  ];
  await page.route("**/web/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/web/api",
      "",
    );
    if (path === "/session")
      return route.fulfill({
        json: {
          id: "owner",
          email: "owner@example.test",
          name: "Mai",
          ...(moderator ? { is_admin: true } : {}),
          preferences: {},
        },
      });
    if (path === "/threads" || path === "/saved")
      return route.fulfill({ json: [] });
    if (path === "/status") return route.fulfill({ json: { status: "ok" } });
    if (path.endsWith("/housing/contact-notifications"))
      return route.fulfill({json:{items:[{id:"99999999-9999-4999-8999-999999999999",title:"Phòng sáng thoáng",role:"landlord",counterparty_name:"Khánh",unread:1}]}});
    if (path.endsWith("/moderation/housing/reviews"))
      return route.fulfill({
        json: { items: [], flags: [], next_offset: null },
      });
    if (path.endsWith("/host/profile")) {
      if (route.request().method() === "PUT") {
        profileSaves++;
        savedProfile = route.request().postDataJSON();
        profile = {
          ...verifiedProfile,
          ...(savedProfile as object),
          status: "pending",
          revision: 1,
        };
      }
      return route.fulfill({ json: { profile, terms_version: null } });
    }
    if (path.endsWith("/landlord/locations/search"))
      return route.fulfill({
        json: {
          results: [
            {
              ref_id: "auto:chosen",
              display: "197 Trần Phú, Phường Chợ Quán, TP.HCM",
            },
          ],
        },
      });
    if (path.endsWith("/landlord/locations/confirm"))
      return route.fulfill({json:{location_token:"signed-test-token"}});
    if (path.endsWith("/documents"))return route.fulfill({json:{items:[]}});
    if (path.endsWith("/landlord/locations/resolve"))
      return route.fulfill({
        json: {
          address: "197 Trần Phú, Phường Chợ Quán, TP.HCM",
          location: { lat: 10.759, lng: 106.676 },
          location_token: "signed-test-token",
          components: { ward: "Chợ Quán", city: "Hồ Chí Minh" },
        },
      });
    if (
      path.endsWith("/landlord/properties") &&
      route.request().method() === "POST"
    ) {
      propertyPayload = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: propertyId } });
    }
    if (path.endsWith("/landlord/stats"))
      return route.fulfill({
        json: {
          days: 30,
          inventory: { published: 1, pending_review: 1, draft: 1, rejected: 0 },
          contacts: { new_contacts: 1, pending_viewings: 1 },
          daily: [],
          measured_since: null,
        },
      });
    if (path.endsWith("/landlord/listings"))
      return route.fulfill({
        json: {
          items: [
            {
              id: listingId,
              title: "Phòng sáng thoáng",
              property_id: propertyId,
              property_name: "Nhà Nguyễn Trãi",
              unit_code: "P.301",
              publication_status: "hidden",
              availability_status: "vacant",
              rent_vnd: 4500000,
            },
          ],
          total: 1,
        },
      });
    if (path.endsWith("/moderation/housing/listings"))
      return route.fulfill({
        json: {
          items: [
            {
              id: "88888888-8888-4888-8888-888888888888",
              title: "Căn hộ gần chợ",
              host_name: "Anh Tuấn môi giới",
              publication_status: "pending_review",
              availability_status: "vacant",
              rent_vnd: 7000000,
            },
          ],
          total: 1,
        },
      });
    if (
      path.endsWith(
        "/moderation/housing/listings/88888888-8888-4888-8888-888888888888",
      )
    )
      return route.fulfill({
        json: {
          id: "88888888-8888-4888-8888-888888888888",
          title: "Căn hộ gần chợ",
          description: "Hai phòng ngủ.",
          created_by: "owner-2",
          revision: 5,
          publication_status: "pending_review",
          host_status: "pending",
          host_name: "Anh Tuấn môi giới",
          legal_name: "Lê Văn Tuấn",
          phone: "0912345678",
          property_status: "pending",
          address: { full_address: "45 Lê Lợi" },
          rent_vnd: 7000000,
          issues: { images: "Thiếu ảnh phòng" },
          media: [],
          fees: [],
          review_history: [],
        },
      });
    if (!properties && path.endsWith("/landlord/properties"))
      return route.fulfill({ json: { items: [] } });
    if (path.endsWith("/landlord/overview"))
      return route.fulfill({
        json: {
          properties: 1,
          units: 3,
          vacant: 2,
          new_contacts: 1,
          measured_since: "2026-10-01T00:00:00Z",
          detail_views: 148,
          saves: 19,
          contact_requests: 7,
        },
      });
    if (path.endsWith("/landlord/properties"))
      return route.fulfill({
        json: {
          items: [
            {
              id: propertyId,
              name: "Nhà Nguyễn Trãi",
              property_type: "room",
              address: { full_address: "123 Nguyễn Trãi, Thanh Xuân, Hà Nội" },
              lng: 105.81,
              lat: 21,
              role: "owner",
              status: "active",
              revision: 1,
              unit_count: 3,
              vacant_count: 2,
            },
          ],
        },
      });
    if (path.endsWith(`/landlord/properties/${propertyId}`))
      return route.fulfill({
        json: {
          id: propertyId,
          name: "Nhà Nguyễn Trãi",
          property_type: "room",
          address: { full_address: "123 Nguyễn Trãi, Thanh Xuân, Hà Nội" },
          lng: 105.81,
          lat: 21,
          role: "owner",
          status: "active",
          management_status: "active",
          revision: 1,
          unit_count: 3,
          vacant_count: 2,
          units: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              unit_code: "P.301",
              bedrooms: 1,
              bathrooms: 1,
              area_m2: 24,
              amenities: ["wifi"],
              listing_id: "33333333-3333-4333-8333-333333333333",
              title: "Phòng sáng thoáng",
              publication_status: "hidden",
              availability_status: "vacant",
              revision: 2,
            },
            {
              id: "55555555-5555-4555-8555-555555555555",
              unit_code: "P.302",
              bedrooms: 1,
              bathrooms: 1,
              area_m2: 20,
              amenities: [],
              listing_id: "66666666-6666-4666-8666-666666666666",
              title: "Phòng gác lửng",
              publication_status: "published",
              availability_status: "vacant",
              revision: 3,
            },
          ],
        },
      });
    if (path.endsWith(`/landlord/listings/${listingId}`))
      return route.fulfill({
        json: {
          id: listingId,
          property_id: propertyId,
          unit_id: "22222222-2222-4222-8222-222222222222",
          title: "Phòng sáng thoáng",
          description: "Phòng có cửa sổ lớn và nội thất cơ bản.",
          rent_vnd: 4500000,
          deposit_vnd: 4500000,
          availability_from: "2026-10-20",
          publication_status: "hidden",
          availability_status: "vacant",
          rejection_reason: null,
          revision: 2,
          updated_at: "2026-10-08T10:00:00Z",
          fees: [
            {
              id: "fee-1",
              code: "electricity",
              label: "Tiền điện",
              amount: 4000,
              billing_unit: "kwh",
              required: true,
              refundable: false,
            },
            {
              id: "fee-2",
              code: "service",
              label: "Phí dịch vụ",
              amount: null,
              billing_unit: "month",
              required: true,
              refundable: false,
            },
          ],
          media: [],
        },
      });
    if (path.endsWith("/messages")) {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        messages.push({
          id: `m${messages.length}`,
          sender_role: "landlord",
          sender_user_id: "owner",
          body: body.body,
          created_at: "2026-10-09T09:05:00Z",
        });
        return route.fulfill({ status: 201, json: messages.at(-1) });
      }
      return route.fulfill({
        json: {
          role: "landlord",
          viewer_id: "owner",
          counterparty_name: "Khánh",
          request: {
            id: "99999999-9999-4999-8999-999999999999",
            title: "Phòng sáng thoáng",
            tenant_user_id: "tenant-2",
            status: "new",
            message: "Người thuê đặt lịch xem nhà qua ReloHome.",
            created_at: "2026-10-09T08:00:00Z",
            open: true,
          },
          messages,
        },
      });
    }
    if (
      path.endsWith("/viewing") &&
      path.includes("/landlord/contact-requests/")
    ) {
      reviewed.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ json: { viewing_status: "confirmed" } });
    }
    if (path.endsWith("/landlord/contact-requests"))
      return route.fulfill({
        json: {
          items: [
            {
              id: "99999999-9999-4999-8999-999999999999",
              listing_id: listingId,
              tenant_user_id: "tenant-2",
              message: "Người thuê đặt lịch xem nhà qua ReloHome.",
              status: "new",
              revision: 1,
              created_at: "2026-10-09T08:00:00Z",
              updated_at: "2026-10-09T08:00:00Z",
              title: "Phòng sáng thoáng",
              unit_code: "P.301",
              property_name: "Nhà Nguyễn Trãi",
              viewing_slot: "2026-10-10T06:00:00Z",
              viewing_status: "requested",
              source: "viewing",
              unread: 1,
            },
            {
              id: "44444444-4444-4444-8444-444444444444",
              listing_id: "33333333-3333-4333-8333-333333333333",
              tenant_user_id: "tenant-1",
              message: "Tôi muốn xem phòng vào cuối tuần.",
              status: "new",
              revision: 1,
              created_at: "2026-10-08T10:00:00Z",
              updated_at: "2026-10-08T10:00:00Z",
              title: "Phòng sáng thoáng",
              unit_code: "P.301",
              property_name: "Nhà Nguyễn Trãi",
            },
          ],
        },
      });
    if (path.endsWith("/moderation/housing/queue")) {
      if (!moderator)
        return route.fulfill({
          status: 403,
          json: { detail: "Moderator permission is required." },
        });
      return route.fulfill({
        json: {
          hosts: [
            {
              user_id: "owner-2",
              poster_type: "broker",
              display_name: "Anh Tuấn môi giới",
              legal_name: "Lê Văn Tuấn",
              phone: "0912 345 678",
              broker_license_no: "CC-0042",
              business_name: null,
              tax_code: null,
              revision: 3,
              updated_at: "2026-10-08T08:00:00Z",
              pending_properties: 1,
              pending_listings: 1,
            },
          ],
          properties: [
            {
              id: "77777777-7777-4777-8777-777777777777",
              name: "Nhà Lê Lợi",
              property_type: "house",
              address: { full_address: "45 Lê Lợi, Quận 1, TP.HCM" },
              user_id: "owner-2",
              requested_at: "2026-10-08T09:00:00Z",
              host_status: "pending",
              host_name: "Anh Tuấn môi giới",
              poster_type: "broker",
            },
          ],
          listings: [
            {
              id: "88888888-8888-4888-8888-888888888888",
              title: "Căn hộ gần chợ",
              description: "Hai phòng ngủ, có ban công.",
              property_name: "Nhà Lê Lợi",
              address: { full_address: "45 Lê Lợi, Quận 1, TP.HCM" },
              unit_code: "A1",
              created_by: "owner-2",
              updated_at: "2026-10-08T09:30:00Z",
              rent_vnd: 7000000,
              deposit_vnd: null,
              fee_count: 2,
              pending_media: [],
              property_status: "pending",
              host_status: "pending",
              host_name: "Anh Tuấn môi giới",
              poster_type: "broker",
            },
          ],
        },
      });
    }
    if (
      path.includes("/moderation/housing/") ||
      path.includes("/moderation/host/")
    ) {
      reviewed.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { detail: "fixture missing" } });
  });
});

async function openInbox(page:import('@playwright/test').Page) {
  await page.locator('.ll-nav').getByRole('button',{name:/Yêu cầu liên hệ/}).click();
  await page.locator('.ll-contact-house-open').filter({hasText:'Nhà Nguyễn Trãi'}).click();
  await page.locator('.ll-contact-room').filter({hasText:'P.301'}).click();
}

test("landlord workspace presents real operations clearly on desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/landlord");
  await expect.poll(() => page.locator(".host-shell").evaluate(
    (element) => getComputedStyle(element).backgroundImage,
  )).toContain("radial-gradient");
  await expect(
    page.getByRole("heading", { name: "Quản lý nhà cho thuê" }),
  ).toBeVisible();
  // Supply tiles only; requests, viewings and interest live in their own tabs.
  await expect(page.locator(".ll-metric")).toHaveCount(3);
  await expect(
    page.locator(".ll-metric").filter({ hasText: "Phòng còn trống" }),
  ).toContainText("2");
  await expect(page.getByText("148")).toHaveCount(0);
  await page.getByRole("button", { name: /Nhà & phòng/ }).click();
  await page.getByRole("button", { name: /Nhà Nguyễn Trãi/ }).click();
  await expect(page.getByText("P.301")).toBeVisible();
  await expect(page.getByText("Còn trống").first()).toBeVisible();
  // Approved listings can be edited; meaningful changes require a new review.
  await expect(
    page.getByRole("button", { name: "Sửa tin" }).nth(1),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "Gửi duyệt" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Duyệt tin/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Sửa tin" }).first().click();
  await expect(page.getByRole("spinbutton", { name: "Giá thuê / tháng", exact: true })).toHaveValue("4500000");
  await expect(page.locator('textarea[name="description"]')).toHaveValue(
    "Phòng có cửa sổ lớn và nội thất cơ bản.",
  );
  // Older fee codes land on the fixed electricity, water and service rows.
  await expect(page.getByLabel("Số tiền Tiền điện")).toHaveValue("4000");
  await expect(page.getByLabel("Số tiền Tiền nước")).toHaveValue("");
  await expect(page.getByLabel("Số tiền Tiền nước")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Số tiền Phí dịch vụ")).toHaveValue("");
  await expect(page.getByLabel("Tên khoản phí")).toHaveCount(0);
  await page.getByRole("button", { name: "Đóng" }).click();
  await openInbox(page);
  await expect(
    page.getByText("Tôi muốn xem phòng vào cuối tuần."),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Quản lý nhà cho thuê" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
  expect(errors).toEqual([]);
});

test("admins review from a separate workspace with required rejection reasons and revisions", async ({
  page,
}) => {
  moderator = true;
  await page.goto("/admin");
  await page.getByRole("button", { name: "Xem chi tiết để duyệt" }).click();
  await expect(
    page.getByRole("button", { name: "Duyệt và hiển thị" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Trả lại để bổ sung" }),
  ).toBeDisabled();
  await page
    .getByLabel("Lý do từ chối", { exact: true })
    .fill("Thiếu ảnh phòng");
  await page.getByRole("button", { name: "Trả lại để bổ sung" }).click();
  await expect.poll(() => reviewed.length).toBe(1);
  expect(reviewed[0]).toEqual({
    path: "/housing-management/moderation/housing/listings/88888888-8888-4888-8888-888888888888/review",
    body: { decision: "reject", reason: "Thiếu ảnh phòng", revision: 5 },
  });
  await page.getByRole("button", { name: "Người đăng & địa điểm" }).click();
  await expect(
    page.getByRole("button", { name: "Xác minh địa điểm" }),
  ).toBeDisabled();
  await page.getByLabel("Cách đã xác minh").selectOption("video_call");
  await page.getByRole("button", { name: "Đã xác minh", exact: true }).click();
  await expect.poll(() => reviewed.length).toBe(2);
  expect(reviewed[1].body).toEqual({
    decision: "verify",
    method: "video_call",
    revision: 3,
  });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((v) => v.id)).toEqual([]);
});

test("owner selects an address and confirms the map before saving", async ({
  page,
}) => {
  await page.goto("/landlord");
  await page
    .getByRole("button", { name: "Thêm nhà", exact: true })
    .first()
    .click();
  await page.getByLabel("Tên dễ nhận biết").fill("Nhà Trần Phú");
  await page.getByLabel("Địa chỉ đầy đủ").fill("197 Trần Phú");
  await page.getByRole("button", { name: "Tìm vị trí", exact: true }).click();
  await page
    .getByRole("button", { name: "197 Trần Phú, Phường Chợ Quán, TP.HCM" })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Tôi đã kiểm tra địa chỉ và vị trí trên bản đồ",
    })
    .click();
  await expect(page.getByRole("checkbox", {name:"Tôi đã kiểm tra địa chỉ và vị trí trên bản đồ"})).toBeChecked();
  await page
    .locator("form")
    .getByRole("button", { name: "Thêm nhà", exact: true })
    .click();
  await expect
    .poll(() => propertyPayload)
    .toMatchObject({
      location: { lat: 10.759, lng: 106.676 },
      location_token: "signed-test-token",
      location_confirmed: true,
      address: {
        full_address: "197 Trần Phú, Phường Chợ Quán, TP.HCM",
        ward: "Chợ Quán",
      },
    });
});

test("changing the address clears its previous map confirmation", async ({
  page,
}) => {
  await page.goto("/landlord");
  await page
    .getByRole("button", { name: "Thêm nhà", exact: true })
    .first()
    .click();
  const address = page.getByLabel("Địa chỉ đầy đủ");
  await address.fill("197 Trần Phú");
  await page.getByRole("button", { name: "Tìm vị trí", exact: true }).click();
  await page
    .getByRole("button", { name: "197 Trần Phú, Phường Chợ Quán, TP.HCM" })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Tôi đã kiểm tra địa chỉ và vị trí trên bản đồ",
    })
    .click();
  await address.fill("198 Trần Phú");
  await expect(
    page.getByRole("checkbox", {
      name: "Tôi đã kiểm tra địa chỉ và vị trí trên bản đồ",
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Duyệt tin/ })).toHaveCount(0);
});

test("first home asks once for the poster profile and subsequent homes reuse it", async ({
  page,
}) => {
  profile = null;
  properties = false;
  await page.goto("/ai");
  await page.getByRole("link", { name: "Chế độ chủ nhà" }).focus();
  await page.getByRole("link", { name: "Chế độ chủ nhà" }).click();
  await expect(
    page.getByRole("heading", { name: "Bắt đầu cho thuê trên ReloHome" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Thêm nhà", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Bắt đầu cho thuê trên ReloHome" }),
  ).toBeVisible();
  await page.getByText("Môi giới", { exact: true }).click();
  await page
    .getByLabel("Tên hiển thị với người thuê")
    .fill("Anh Tuấn môi giới");
  await page.getByLabel("Họ tên đầy đủ").fill("Lê Văn Tuấn");
  await page
    .getByLabel("Số điện thoại để ReloHome xác minh")
    .fill("0912 345 678");
  await page
    .getByLabel("Số chứng chỉ hành nghề môi giới (nếu có)")
    .fill("CC-0042");
  await page.getByRole("button", { name: "Gửi hồ sơ để xác minh" }).click();
  await expect(page.getByText("Hồ sơ đang chờ xác minh")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Thêm nhà hoặc tòa nhà" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Bắt đầu cho thuê trên ReloHome" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Thêm nhà", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Thêm nhà hoặc tòa nhà" }),
  ).toBeVisible();
  expect(profileSaves).toBe(1);
  expect(savedProfile).toEqual({
    poster_type: "broker",
    display_name: "Anh Tuấn môi giới",
    legal_name: "Lê Văn Tuấn",
    phone: "0912 345 678",
    broker_license_no: "CC-0042",
    business_name: null,
    tax_code: null,
  });
  await expect(
    page.getByRole("link", { name: "Chế độ thuê nhà" }),
  ).toHaveAttribute("href", "/ai");
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
});

test("a viewing time booked by a tenant can be confirmed from the landlord inbox", async ({
  page,
}) => {
  await page.goto("/landlord");
  await openInbox(page);
  await expect(page.getByText(/Giờ xem người thuê chọn:/)).toBeVisible();
  await expect(page.getByText("Chờ bạn xác nhận")).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận giờ xem" }).click();
  await expect.poll(() => reviewed.length).toBe(1);
  expect(reviewed[0]).toEqual({
    path: "/housing-management/landlord/contact-requests/99999999-9999-4999-8999-999999999999/viewing",
    body: { decision: "confirm", revision: 1 },
  });
  // The request spy fires before the response and inbox refresh finish.
  await expect(page.getByRole("button", { name: "Xác nhận giờ xem" })).toBeEnabled();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations, JSON.stringify(accessibility.violations)).toEqual([]);
});

test("landlord and tenant exchange messages on a request", async ({ page }) => {
  await page.setViewportSize({width:320,height:568});
  await page.goto("/landlord");
  await openInbox(page);
  await page
    .getByRole("button", { name: /Nhắn tin với người thuê/ })
    .first()
    .click();
  await expect(page.getByText("Chiều mai em qua được không ạ?")).toBeVisible();
  await page.getByLabel("Nội dung tin nhắn").fill("Được em, 3 giờ chiều nhé.");
  await page.getByRole("button", { name: "Gửi" }).click();
  await expect(page.locator(".contact-thread-list li.mine")).toContainText(
    "Được em, 3 giờ chiều nhé.",
  );
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
});

test("dashboard counters open the matching filter and statistics retain the chosen period", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("landlord/stats?")) calls.push(request.url());
  });
  await page.goto("/landlord");
  await page.getByRole("button", { name: /Tin chờ duyệt/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Trạng thái tin", exact: true }),
  ).toHaveValue("pending_review");
  await page
    .locator(".ll-nav")
    .getByRole("button", { name: "Thống kê", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Khoảng thời gian thống kê" })
    .selectOption("7");
  await expect
    .poll(() => calls.some((url) => url.includes("days=7")))
    .toBe(true);
});

test("Admin uses the dark glass theme and English language controls", async ({
  page,
}) => {
  moderator = true;
  await page.addInitScript(() =>
    localStorage.setItem(
      "siu-ui-preferences",
      JSON.stringify({ theme: "dark", locale: "en" }),
    ),
  );
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Manage and review listings" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const styles = await page.locator(".rh-admin-shell").evaluate((element) => {
    const style = getComputedStyle(element);
    const root = getComputedStyle(document.documentElement);
    return {
      background: style.backgroundColor,
      color: style.color,
      expectedBackground: root.backgroundColor,
      expectedColor: root.color,
    };
  });
  // Admin shares the owner workspace glass backdrop, in its dark variant here.
  expect(styles.background).toBe("rgb(11, 33, 27)");
  expect(styles.color).toBe(styles.expectedColor);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((v) => v.id)).toEqual([]);
});

test("declining a time requires suitable proposals, with no generic completion shortcuts", async ({ page }) => {
  const proposed = ["2027-02-10T09:00:00+07:00", "2027-02-10T10:30:00+07:00"];
  const writes: any[] = [];
  await page.route("**/web/api/landlord/viewing-options", route => route.fulfill({json:{slots:proposed}}));
  await page.route("**/web/api/housing-management/landlord/contact-requests/*/viewing-options", route => {
    writes.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});
  });
  await page.goto("/landlord");
  await openInbox(page);
  await expect(page.getByRole("button",{name:"Đã liên hệ",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Hoàn tất",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Từ chối",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Không nhận giờ này",exact:true}).click();
  const modal = page.getByRole("dialog",{name:"Đề xuất giờ xem trong 7 ngày tới"});
  await expect(modal.getByRole("button",{name:"Gửi giờ thay thế"})).toBeDisabled();
  await modal.getByRole("checkbox",{name:"09:00",exact:true}).check();
  await modal.getByRole("button",{name:"Gửi giờ thay thế"}).click();
  await expect.poll(()=>writes.length).toBe(1);
  expect(writes[0]).toEqual({revision:1,slots:[proposed[0]]});
});

test("owner reviews reported transfers and archives completed requests without deleting conversation history", async ({ page }) => {
  const report = {id:listingId,amount_vnd:9000000,paid_on:"2026-10-13",status:"pending",revision:1,agreement:{deposit_vnd:4500000,first_month_vnd:4500000},reason:null};
  const row: any = {id:"99999999-9999-4999-8999-999999999999",listing_id:listingId,tenant_user_id:"tenant-2",message:"Người thuê đặt lịch xem nhà qua ReloHome.",status:"viewing",revision:4,title:"Phòng sáng thoáng",unit_code:"P.301",property_name:"Nhà Nguyễn Trãi",viewing_slot:"2026-10-10T06:00:00Z",viewing_status:"confirmed",created_at:"2026-10-09T08:00:00Z",payment_report:report,unread:1};
  let archived=false;
  const writes:any[]=[];
  await page.route("**/web/api/housing-management/landlord/contact-requests",route=>route.fulfill({json:{items:archived?[]:[row]}}));
  await page.route("**/web/api/housing-management/landlord/contact-requests/*/payment-review",route=>{
    const body=route.request().postDataJSON();writes.push(body);report.status=body.decision==='confirm'?'confirmed':'rejected';report.revision++;report.reason=body.reason||null;if(body.decision==='confirm') row.status='resolved';row.revision++;return route.fulfill({json:report});
  });
  await page.route("**/web/api/housing-management/landlord/contact-requests/*/archive",route=>{archived=true;return route.fulfill({json:{archived:true}})});
  await page.goto("/landlord");await openInbox(page);
  await expect(page.getByText("Người thuê báo đã chuyển tiền",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Xóa khỏi hộp thư",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Chưa nhận / không khớp"}).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Chưa thấy tiền vào tài khoản");
  await page.getByRole("button",{name:"Gửi phản hồi"}).click();
  await expect(page.getByText("Chưa thấy tiền vào tài khoản",{exact:true})).toBeVisible();
  expect(writes[0]).toMatchObject({decision:"reject",reason:"Chưa thấy tiền vào tài khoản",revision:1});
  // A corrected report arrives from the tenant; reload the workspace to receive it.
  report.status='pending';report.revision=1;await page.reload();await openInbox(page);
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Xác nhận đã nhận tiền",exact:true}).click();
  await expect(page.getByText("Đã xác nhận nhận tiền · hoàn tất",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Nhắn tin với người thuê"}).click();
  await expect(page.locator(".contact-messenger-panel")).toBeVisible();
  await expect(page.locator(".contact-thread-list li.theirs").last()).toContainText("Chiều mai em qua được không ạ?");
  await page.getByRole("button",{name:"Thu gọn tin nhắn"}).click();
  await page.getByRole("button",{name:"Xóa khỏi hộp thư",exact:true}).click();
  await expect(page.getByText("Chưa có yêu cầu",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:/Tin nhắn và cập nhật ·/}).click();
  await page.locator(".contact-messenger-conversations").getByRole("button",{name:/Khánh/}).click();
  await expect(page.getByText("Chiều mai em qua được không ạ?",{exact:true})).toBeVisible();
});


test("owner bell is a bright edge tab and conversations use tenant names", async ({
  page,
}) => {
  await page.goto("/landlord");
  const bell = page.locator(".contact-messenger-toggle");
  await expect(bell).toBeVisible();
  await expect(bell).not.toContainText("Tin nhắn");
  const box = await bell.boundingBox();
  expect(box!.x + box!.width).toBe(page.viewportSize()!.width);
  expect(page.viewportSize()!.height - (box!.y + box!.height)).toBe(24);
  await bell.click();
  const row = page.locator(".contact-messenger-conversations > button");
  await expect(row.locator("strong")).toHaveText("Khánh");
  await row.click();
  await expect(
    page.locator(".contact-messenger-panel header strong"),
  ).toHaveText("Phòng sáng thoáng – Khánh");
  await page.getByRole("button", { name: "Thu gọn tin nhắn" }).click();
  await expect(page.locator(".contact-messenger-panel")).toHaveCount(0);
  await expect(page.locator(".contact-messenger-minimized")).toHaveCount(0);
  await bell.click();
  await row.click();
  await expect(
    page.getByRole("dialog", { name: "Tin nhắn · Phòng sáng thoáng – Khánh" }),
  ).toBeVisible();
});


test("Admin sees own pending profile with blocked actions and queue refreshes on focus", async ({
  page,
}) => {
  moderator = true;
  let items: any[] = [];
  await page.route(
    "**/web/api/housing-management/moderation/housing/queue",
    (route) =>
      route.fulfill({ json: { hosts: items, properties: [], listings: [] } }),
  );
  await page.goto("/admin");
  const metric = page.getByRole("button", { name: /Người đăng chờ xác minh/ });
  await expect(metric.locator("strong")).toHaveText("0");
  items = [
    {
      ...verifiedProfile,
      status: "pending",
      user_id: "owner",
      can_review: false,
      pending_properties: 0,
      pending_listings: 0,
      updated_at: "2026-10-14T10:00:00Z",
    },
  ];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(metric.locator("strong")).toHaveText("1");
  await metric.click();
  await expect(
    page.getByText("Hồ sơ của bạn cần một Admin khác xác minh."),
  ).toBeVisible();
  await page.getByLabel("Cách đã xác minh").selectOption("phone_call");
  await expect(
    page.getByRole("button", { name: "Đã xác minh", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Cần bổ sung", exact: true }),
  ).toBeDisabled();
  expect(reviewed).toEqual([]);
});

test("owner receives profile verification on focus without entering profile again", async ({
  page,
}) => {
  profile = { ...verifiedProfile, status: "pending" };
  await page.goto("/landlord");
  await expect(page.getByText("Hồ sơ đang chờ xác minh")).toBeVisible();
  profile = verifiedProfile;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Hồ sơ đang chờ xác minh")).toHaveCount(0);
  await page.getByRole("button", { name: "Thêm nhà", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Thêm nhà hoặc tòa nhà" }),
  ).toBeVisible();
  expect(profileSaves).toBe(0);
});

test("a profile refresh preserves the revision of an open edit form", async ({
  page,
}) => {
  profile = { ...verifiedProfile, status: "pending" };
  let submitted: any = null;
  await page.route(
    "**/web/api/housing-management/host/profile",
    async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      submitted = route.request().postDataJSON();
      return route.fulfill({
        status: 409,
        json: { detail: "Hồ sơ đã được cập nhật ở nơi khác." },
      });
    },
  );
  await page.goto("/landlord");
  await page.getByRole("button", { name: "Sửa hồ sơ", exact: true }).click();
  await page.getByLabel("Tên hiển thị với người thuê").fill("Tên đang sửa");
  profile = { ...verifiedProfile, status: "pending", revision: 9 };
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/host/profile") &&
      response.request().method() === "GET",
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event("housing-contact-update")),
  );
  await refreshed;
  await page.getByRole("button", { name: "Lưu hồ sơ", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Hồ sơ đã được cập nhật ở nơi khác.",
  );
  expect(submitted.revision).toBe(verifiedProfile.revision);
  await expect(page.getByLabel("Tên hiển thị với người thuê")).toHaveValue(
    "Tên đang sửa",
  );
});

test("one room form saves a complete draft, retries photos without duplicating the room and submits later", async ({
  page,
}) => {
  const unitId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const creates: any[] = [],
    updates: any[] = [],
    submissions: any[] = [];
  let failPhoto = true;
  let revision = 2;
  const listing: any = {
    id: listingId,
    title: "Phòng mới đầy đủ",
    description: "Mô tả phòng đầy đủ.",
    rent_vnd: 5000000,
    deposit_vnd: 5000000,
    availability_from: null,
    publication_status: "draft",
    availability_status: "vacant",
    revision,
    fees: [],
    media: [],
    issues: {},
  };
  await page.route("**/web/api/housing-management/landlord/properties/*/room-listing", (route) => {
    creates.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      json: { id: listingId, unit_id: unitId, unit_revision: 1, revision },
    });
  });
  await page.route("**/web/api/housing-management/landlord/units/*/room-listing", (route) => {
    updates.push(route.request().postDataJSON());
    listing.revision = ++revision;
    return route.fulfill({
      json: { id: listingId, unit_id: unitId, unit_revision: updates.length + 1, revision },
    });
  });
  await page.route(`**/web/api/housing-management/landlord/listings/${listingId}`, (route) =>
    route.fulfill({ json: listing }),
  );
  await page.route("**/web/api/landlord/listings/*/media-upload*", (route) => {
    if (failPhoto) {
      failPhoto = false;
      return route.fulfill({ status: 503, json: { detail: "Tải ảnh tạm thời chưa thành công" } });
    }
    listing.media = [
      {
        id: "image-new",
        url: "http://example.test/room.png",
        position: 0,
        is_primary: true,
        moderation_status: "pending",
        alt_text: "Phòng mới",
      },
    ];
    listing.revision = ++revision;
    return route.fulfill({ status: 201, json: listing.media[0] });
  });
  await page.route("**/web/api/housing-management/landlord/listings/*/submit", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { publication_status: "pending_review" } });
  });
  await page.goto("/landlord");
  await page
    .locator(".ll-nav")
    .getByRole("button", { name: /Nhà & phòng/ })
    .click();
  await page.getByRole("button", { name: /Nhà Nguyễn Trãi/ }).click();
  await page.getByRole("button", { name: "Thêm phòng", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Thêm phòng và đăng tin" })).toBeVisible();
  await page.getByRole("textbox", { name: "Mã phòng", exact: true }).fill("P.999");
  await page.getByRole("spinbutton", { name: "Diện tích (m²)", exact: true }).fill("25");
  // The count field appears once the toilet type is chosen.
  await expect(page.getByLabel("Số phòng vệ sinh khép kín")).toHaveCount(0);
  await page.getByLabel("Phòng vệ sinh khép kín").check();
  await expect(page.getByLabel("Số phòng vệ sinh khép kín")).toHaveValue("1");
  await page.getByRole("textbox", { name: "Tiêu đề", exact: true }).fill(listing.title);
  await page.getByRole("textbox", { name: "Mô tả tiện ích", exact: true }).fill(listing.description);
  await page.getByRole("spinbutton", { name: "Giá thuê / tháng", exact: true }).fill("5000000");
  await page.getByRole("spinbutton", { name: "Tiền cọc", exact: true }).fill("5000000");
  await page.getByLabel(/^Ngày có thể vào ở/).fill("2026-11-01");
  await page.getByLabel("Số tiền Tiền điện").fill("3500");
  await page.getByLabel("Số tiền Tiền nước").fill("20000");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "room.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW1sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await page.getByRole("button", { name: "Lưu bản nháp", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Tải ảnh tạm thời chưa thành công");
  expect(creates).toHaveLength(1);
  expect(creates[0]).toMatchObject({
    unit: {
      unit_code: "P.999",
      area_m2: 25,
      bedrooms: 0,
      bathrooms: 1,
      bathroom_type: "private",
      amenities: [],
    },
    listing: {
      title: listing.title,
      rent_vnd: 5000000,
      deposit_vnd: 5000000,
      availability_from: "2026-11-01",
    },
  });
  // An empty optional service fee is left out rather than sent as unknown.
  expect(creates[0].listing.fees).toEqual([
    { code: "tien_dien", label: "Tiền điện", amount: 3500, billing_unit: "kwh", required: true, refundable: false },
    { code: "tien_nuoc", label: "Tiền nước", amount: 20000, billing_unit: "m3", required: true, refundable: false },
  ]);
  await page.getByRole("button", { name: "Lưu bản nháp", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(creates).toHaveLength(1);
  expect(updates).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Lưu và gửi duyệt", exact: true })).toBeEnabled();
  expect(submissions).toHaveLength(0);
  await page.getByRole("button", { name: "Lưu và gửi duyệt", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0].revision).toBe(revision);
});

test("operating counters navigate to houses, all rooms, vacant rooms and the property-room inbox", async ({
  page,
}) => {
  await page.goto("/landlord");
  await page.getByRole("button", { name: /Phòng trong hệ thống/ }).click();
  await expect(page.getByRole("heading", { name: "Phòng trong hệ thống", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Nhà Nguyễn Trãi · P.301/ })).toBeVisible();
  await page.getByRole("button", { name: "Tổng quan", exact: true }).click();
  await page.getByRole("button", { name: /Phòng còn trống/ }).click();
  await expect(page.getByRole("heading", { name: "Phòng còn trống", exact: true })).toBeVisible();
  await expect(page.locator(".ll-metrics").getByRole("button", { name: /Yêu cầu mới/ })).toHaveCount(0);
  // Requests now open from their tab, whose badge sums the waiting work.
  const inboxTab = page.locator(".ll-nav").getByRole("button", { name: /Yêu cầu liên hệ/ });
  await expect(inboxTab).toContainText("2");
  await inboxTab.click();
  await expect(page.getByRole("heading", { name: "Yêu cầu liên hệ theo nhà" })).toBeVisible();
  await expect(page.getByText("Tôi muốn xem phòng vào cuối tuần.")).toHaveCount(0);
  await page.locator(".ll-contact-house-open").filter({ hasText: "Nhà Nguyễn Trãi" }).click();
  await expect(page.locator(".ll-contact-room").filter({ hasText: "P.301" })).toBeVisible();
  await page.locator(".ll-contact-room").filter({ hasText: "P.301" }).click();
  await expect(page.getByText("Tôi muốn xem phòng vào cuối tuần.")).toBeVisible();
});


test('property and room badges count requests once and the chat timeline opens the right request',async({page})=>{
  const requestId='99999999-9999-4999-8999-999999999999';
  const event={id:'event-1',kind:'viewing_requested',audience:'landlord',contact_id:requestId,property_id:propertyId,listing_id:listingId,title:'Phòng sáng thoáng',property_name:'Nhà Nguyễn Trãi',unit_code:'P.301',counterparty_name:'Khánh',unread:true,payload:{slot:'2026-10-15T09:00:00+07:00'}};
  await page.route('**/web/api/housing-management/housing/activity',route=>route.fulfill({json:{items:[event]}}));
  await page.route('**/web/api/housing-management/housing/contact-requests/*/activity',route=>route.fulfill({json:{items:[{...event,created_at:'2026-10-09T09:06:00Z'}]}}));
  await page.route('**/web/api/housing-management/housing/activity/event-1/read',route=>{event.unread=false;return route.fulfill({json:{read:true}})});
  await page.goto('/landlord');await page.locator('.ll-nav').getByRole('button',{name:/Yêu cầu liên hệ/}).click();
  // Badges count work items: one viewing to confirm plus one unread message.
  const property=page.locator('.ll-contact-house').first();
  await expect(property.locator('.ll-request-badge')).toHaveText('2');
  await expect(property.getByRole('img',{name:'1 lịch cần xác nhận'})).toBeVisible();
  await expect(property.getByRole('img',{name:'0 báo chuyển tiền'})).toBeVisible();
  await expect(property.getByRole('img',{name:'1 tin chưa đọc'})).toBeVisible();
  // Quick view lists the rooms under the card and opens one directly.
  await property.getByRole('button',{name:'Xem nhanh các phòng của Nhà Nguyễn Trãi'}).click();
  await expect(property.locator('.ll-quick-rooms li')).toHaveCount(2);
  await property.locator('.ll-contact-house-open').click();const room=page.locator('.ll-contact-room').filter({hasText:'P.301'});
  await expect(room.locator('.ll-request-badge')).toHaveText('2');
  await page.getByRole('button',{name:/Tin nhắn và cập nhật/}).click();
  await expect(page.getByRole('heading',{name:'Thông báo hoạt động',exact:true})).toHaveCount(0);
  await page.locator('.contact-messenger-conversations > button').filter({hasText:'Khánh'}).click();
  const notice=page.locator('.contact-system-action').filter({hasText:'Người thuê đề nghị xem nhà'});
  await expect(notice).toContainText('15');
  await notice.click();await expect(page).toHaveURL(new RegExp('request='+requestId));
  await expect(page.locator('#contact-request-'+requestId)).toBeVisible();
});

test('the admin chat bell hides activity items and has no badge for hidden notifications',async({page})=>{
  moderator=true;
  await page.route('**/web/api/housing-management/housing/activity?admin=true',route=>route.fulfill({json:{items:[{id:'admin-event',kind:'listing_submitted',audience:'admin',unread:true}]}}));
  await page.goto('/admin');const bell=page.getByRole('button',{name:/Tin nhắn và cập nhật/});await bell.click();
  await expect(page.locator('.contact-messenger-updates')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Thông báo hoạt động',exact:true})).toHaveCount(0);
  await expect(page.getByText('Chưa có cuộc trò chuyện.',{exact:true})).toBeVisible();
  await expect(bell.locator('b')).toHaveCount(0);
});

test("a rejected listing sent back unchanged asks the owner to add information first", async ({
  page,
}) => {
  await page.route(
    `**/web/api/housing-management/landlord/listings/${listingId}/submit`,
    (route) =>
      route.fulfill({
        status: 409,
        json: {
          detail: "Bạn phải bổ sung thêm thông tin phù hợp.",
          code: "listing_unchanged",
        },
      }),
  );
  await page.goto("/landlord");
  await page.locator(".ll-nav").getByRole("button", { name: /Nhà & phòng/ }).click();
  await page.getByRole("button", { name: /Nhà Nguyễn Trãi/ }).click();
  await page.getByRole("button", { name: "Gửi duyệt" }).click();
  const dialog = page.getByRole("dialog", { name: "Chưa thể gửi duyệt" });
  await expect(dialog).toContainText("Bạn phải bổ sung thêm thông tin phù hợp.");
  await expect(page.locator(".ll-unit-card [role=alert]")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Sửa tin" }).click();
  await expect(page.getByRole("heading", { name: "Cập nhật tin" })).toBeVisible();
});

test("the calendar reminds the owner of tomorrow's viewing and its tab counts it", async ({
  page,
}) => {
  // 10:00 on 9 Oct in Vietnam; the requested slot is 13:00 the next day.
  await page.clock.setFixedTime(new Date("2026-10-09T03:00:00Z"));
  await page.goto("/landlord");
  const tab = page.locator(".ll-nav").getByRole("button", { name: /Lịch xem nhà/ });
  await expect(tab.locator(".ll-count")).toHaveText("1");
  await tab.click();
  const reminder = page.getByRole("status", { name: "Nhắc lịch xem nhà" });
  await expect(reminder).toContainText("Nhắc lịch: ngày mai bạn có 1 lịch xem nhà");
  const slot = page.locator("#viewing-99999999-9999-4999-8999-999999999999");
  await expect(slot.locator(".ll-viewing-chip")).toHaveText("Chờ xác nhận");
  await expect(slot.locator(".ll-countdown")).toHaveText("Còn 1 ngày");
  await expect(slot).toHaveClass(/soon/);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations, JSON.stringify(accessibility.violations)).toEqual([]);
});

test("the reminder counts today's and tomorrow's viewings separately", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-09T03:00:00Z"));
  const base = {
    listing_id: listingId,
    tenant_user_id: "tenant-2",
    message: "Người thuê đặt lịch xem nhà qua ReloHome.",
    status: "new",
    revision: 1,
    created_at: "2026-10-08T08:00:00Z",
    updated_at: "2026-10-08T08:00:00Z",
    title: "Phòng sáng thoáng",
    unit_code: "P.301",
    property_name: "Nhà Nguyễn Trãi",
    viewing_status: "requested",
    source: "viewing",
  };
  await page.route("**/web/api/housing-management/landlord/contact-requests", (route) =>
    route.fulfill({
      json: {
        items: [
          { ...base, id: "aaaaaaaa-0000-4000-8000-000000000001", viewing_slot: "2026-10-09T08:00:00Z" },
          { ...base, id: "aaaaaaaa-0000-4000-8000-000000000002", viewing_slot: "2026-10-10T06:00:00Z" },
        ],
      },
    }),
  );
  await page.goto("/landlord");
  const tab = page.locator(".ll-nav").getByRole("button", { name: /Lịch xem nhà/ });
  await expect(tab.locator(".ll-count")).toHaveText("2");
  await tab.click();
  await expect(page.getByRole("status", { name: "Nhắc lịch xem nhà" })).toContainText(
    "Nhắc lịch: hôm nay bạn có 1 lịch, ngày mai có 1 lịch xem nhà",
  );
});

test("saving an older listing keeps a service fee whose amount is still unknown", async ({ page }) => {
  const saved: any[] = [];
  // The beforeEach listing (older "electricity"/"service" codes), now with a photo.
  await page.route(`**/web/api/housing-management/landlord/listings/${listingId}`, (route) =>
    route.fulfill({
      json: {
        id: listingId,
        property_id: propertyId,
        unit_id: "22222222-2222-4222-8222-222222222222",
        title: "Phòng sáng thoáng",
        description: "Phòng có cửa sổ lớn và nội thất cơ bản.",
        rent_vnd: 4500000,
        deposit_vnd: 4500000,
        availability_from: "2026-10-20",
        publication_status: "hidden",
        availability_status: "vacant",
        rejection_reason: null,
        revision: 2,
        fees: [
          { id: "fee-1", code: "electricity", label: "Tiền điện", amount: 4000, billing_unit: "kwh", required: true, refundable: false },
          { id: "fee-2", code: "service", label: "Phí dịch vụ", amount: null, billing_unit: "month", required: true, refundable: false },
        ],
        media: [
          { id: "image-1", url: "http://example.test/room.png", position: 0, is_primary: true, moderation_status: "approved", alt_text: "Phòng sáng thoáng" },
        ],
      },
    }),
  );
  await page.route("**/web/api/housing-management/landlord/units/*/room-listing", (route) => {
    saved.push(route.request().postDataJSON());
    return route.fulfill({
      json: { id: listingId, unit_id: "22222222-2222-4222-8222-222222222222", unit_revision: 2, revision: 3 },
    });
  });
  await page.goto("/landlord");
  await page.locator(".ll-nav").getByRole("button", { name: /Nhà & phòng/ }).click();
  await page.getByRole("button", { name: /Nhà Nguyễn Trãi/ }).click();
  await page.getByRole("button", { name: "Sửa tin" }).first().click();
  // The saved service fee has no amount; it reads "Chưa rõ", not "Nếu có".
  await expect(page.getByLabel("Số tiền Phí dịch vụ")).toHaveAttribute("placeholder", "Chưa rõ");
  await page.getByLabel("Phòng vệ sinh khép kín").check();
  await page.getByLabel("Số tiền Tiền nước").fill("20000");
  await page.getByRole("button", { name: "Lưu bản nháp", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].listing.fees).toContainEqual({
    code: "service",
    label: "Phí dịch vụ",
    amount: null,
    billing_unit: "month",
    required: true,
    refundable: false,
  });
  expect(saved[0].listing.fees.map((fee: { code: string }) => fee.code)).toEqual([
    "electricity",
    "tien_nuoc",
    "service",
  ]);
});

test("statistics estimate monthly revenue per home without deposits", async ({ page }) => {
  const second = "22222222-2222-4222-8222-222222222222";
  const calls: string[] = [];
  const revenue = (months: number) => ({
    months,
    as_of: "2026-10-15",
    estimated: true,
    series: ["2026-08", "2026-09", "2026-10"].map((month, index) => ({
      month,
      total: [9_000_000, 22_000_000, 11_000_000][index]!,
      by_property: { [propertyId]: [9_000_000, 9_000_000, 4_500_000][index]!, [second]: [0, 13_000_000, 6_500_000][index]! },
    })),
    properties: [
      { id: propertyId, name: "Nhà Nguyễn Trãi", units: 2, rented_units: 1, period_total: 22_500_000, current_month: 4_500_000, previous_month: 9_000_000 },
      { id: second, name: "Căn hộ Sunrise", units: 1, rented_units: 1, period_total: 19_500_000, current_month: 6_500_000, previous_month: 13_000_000 },
    ],
    total: 42_000_000,
    previous_total: 30_000_000,
    average_monthly: 14_000_000,
  });
  await page.route("**/web/api/housing-management/landlord/revenue?*", (route) => {
    calls.push(route.request().url());
    const months = Number(new URL(route.request().url()).searchParams.get("months"));
    return route.fulfill({ json: revenue(months) });
  });
  await page.goto("/landlord");
  await page.locator(".ll-nav").getByRole("button", { name: "Thống kê", exact: true }).click();
  const panel = page.locator(".ll-revenue");
  await expect(panel.getByRole("heading", { name: "Doanh thu ước tính", exact: true })).toBeVisible();
  await expect(panel).toContainText("Không tính tiền cọc.");
  await expect(panel.locator(".ll-status-metrics")).toContainText("42.000.000");
  await expect(panel.locator(".ll-status-metrics")).toContainText("+40%");
  // Two homes, three months: one stacked segment per home with revenue in that month.
  await expect(panel.locator(".ll-revenue-bar")).toHaveCount(5);
  await expect(panel.locator(".ll-chart-legend li")).toHaveText(["Nhà Nguyễn Trãi", "Căn hộ Sunrise"]);
  await expect(panel.getByRole("img", { name: /Tháng 09\/2026: tổng 22\.000\.000/ })).toBeVisible();
  const compare = panel.locator(".ll-revenue-compare");
  await expect(compare.getByRole("row", { name: /Nhà Nguyễn Trãi/ })).toContainText("1/2 phòng · 50%");
  await expect(compare.getByRole("row", { name: /^Tổng/ })).toContainText("2/3 phòng · 67%");
  await panel.getByRole("combobox", { name: "Khoảng thời gian doanh thu" }).selectOption("3");
  await expect.poll(() => calls.some((url) => url.includes("months=3"))).toBe(true);
  await panel.getByRole("combobox", { name: "Lọc doanh thu theo nhà" }).selectOption(second);
  await expect.poll(() => calls.some((url) => url.includes("property_id=" + second))).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .include(".ll-revenue")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((v) => v.id)).toEqual([]);
});

test("revenue colours follow each home's place in the list, not its revenue rank", async ({ page }) => {
  const homes = Array.from({ length: 7 }, (_, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    name: `Nhà ${index + 1}`,
    units: 1,
    rented_units: 1,
  }));
  // The ranking flips between periods: the first home earns most over 3 months, least over 6.
  const answer = (months: number) => {
    const amounts = homes.map((_, index) => (months === 3 ? 7 - index : index + 1) * 1_000_000);
    return {
      months,
      as_of: "2026-10-15",
      estimated: true,
      series: [
        {
          month: "2026-10",
          total: amounts.reduce((sum, value) => sum + value, 0),
          by_property: Object.fromEntries(homes.map((home, index) => [home.id, amounts[index]!])),
        },
      ],
      properties: homes.map((home, index) => ({
        ...home,
        period_total: amounts[index]!,
        current_month: amounts[index]!,
        previous_month: 0,
      })),
      total: amounts.reduce((sum, value) => sum + value, 0),
      previous_total: 0,
      average_monthly: 1,
    };
  };
  await page.route("**/web/api/housing-management/landlord/revenue?*", (route) =>
    route.fulfill({ json: answer(Number(new URL(route.request().url()).searchParams.get("months"))) }),
  );
  await page.goto("/landlord");
  await page.locator(".ll-nav").getByRole("button", { name: "Thống kê", exact: true }).click();
  const legend = page.locator(".ll-revenue .ll-chart-legend li");
  const colours = async () =>
    legend.evaluateAll((items) =>
      items.map((item) => [item.textContent, item.querySelector("i")!.className.match(/ll-revenue-(\d+|other)\b/)![1]]),
    );
  const expected = [
    ["Nhà 1", "1"],
    ["Nhà 2", "2"],
    ["Nhà 3", "3"],
    ["Nhà 4", "4"],
    ["Nhà 5", "5"],
    ["Khác", "other"],
  ];
  await expect.poll(colours).toEqual(expected);
  await page.getByRole("combobox", { name: "Khoảng thời gian doanh thu" }).selectOption("3");
  await expect(page.locator(".ll-revenue .ll-status-metrics")).toContainText("28.000.000");
  await expect.poll(colours).toEqual(expected);
});
