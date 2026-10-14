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
      return route.fulfill({json:{location_token:"confirmed-test-token"}});
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
  await page.locator('.ll-contact-hierarchy .ll-property-list').getByRole('button',{name:/Nhà Nguyễn Trãi/}).click();
  await page.locator('.ll-contact-room').filter({hasText:'P.301'}).click();
}

test("landlord workspace presents real operations clearly on desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/landlord");
  await expect(
    page.getByRole("heading", { name: "Quản lý nhà cho thuê" }),
  ).toBeVisible();
  await expect(page.getByText("148")).toBeVisible();
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
  await expect(page.getByLabel("Giá thuê / tháng")).toHaveValue("4500000");
  await expect(page.locator('textarea[name="description"]')).toHaveValue(
    "Phòng có cửa sổ lớn và nội thất cơ bản.",
  );
  await expect(page.getByLabel("Tên khoản phí").first()).toHaveValue(
    "Tiền điện",
  );
  await expect(page.getByLabel("Số tiền").first()).toHaveValue("4000");
  // An unknown amount stays blank (shown to tenants as "Chưa rõ"), never 0.
  await expect(page.getByLabel("Số tiền").nth(1)).toHaveValue("");
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
      location_token: "confirmed-test-token",
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
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
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

test("Admin uses the existing dark theme and English language controls", async ({
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
  expect(styles.background).toBe(styles.expectedBackground);
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

test("address suggestions allow an entrance pin and private apartment details before confirmation", async ({
  page,
}) => {
  let confirmation: any = null;
  await page.route("**/web/api/housing-management/landlord/locations/confirm", (route) => {
    confirmation = route.request().postDataJSON();
    return route.fulfill({ json: { location_token: "confirmed-entrance" } });
  });
  await page.goto("/landlord");
  await page.getByRole("button", { name: "Thêm nhà", exact: true }).click();
  await page.getByLabel("Tên dễ nhận biết").fill("Nhà thử ghim");
  await page.getByLabel("Địa chỉ đầy đủ").fill("197 Trần Phú");
  // Typing alone loads suggestions; no separate search click is required.
  await page.getByRole("button", { name: "197 Trần Phú, Phường Chợ Quán, TP.HCM", exact: true }).click();
  await expect(
    page.getByText("Hãy kéo chiếc ghim này đặt đúng vào vị trí cửa chính căn hộ của bạn."),
  ).toBeVisible();
  await page.getByLabel("Căn, tầng, tòa nhà (địa chỉ riêng)").fill("Căn 1208, Tòa S2.01");
  await page.getByRole("button", { name: "Điều chỉnh ghim cửa chính bằng phím mũi tên" }).press("ArrowRight");
  await page.getByText("Tinh chỉnh tọa độ cửa chính", { exact: true }).click();
  expect(
    Math.abs(Number(await page.getByLabel("Kinh độ", { exact: true }).inputValue()) - 106.676),
  ).toBeGreaterThan(0.000001);
  await page.getByLabel("Vĩ độ", { exact: true }).fill("10.759");
  await page.getByLabel("Kinh độ", { exact: true }).fill("106.67602");
  await page.getByRole("checkbox", { name: "Tôi đã kiểm tra địa chỉ và vị trí trên bản đồ" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Tôi đã kiểm tra địa chỉ và vị trí trên bản đồ" }),
  ).toBeChecked();
  expect(confirmation.location.lng).toBeCloseTo(106.67602, 6);
  expect(confirmation.private_detail).toBe("Căn 1208, Tòa S2.01");
  await page.locator("form").getByRole("button", { name: "Thêm nhà", exact: true }).click();
  await expect
    .poll(() => propertyPayload)
    .toMatchObject({
      location: { lat: 10.759, lng: 106.67602 },
      location_token: "confirmed-entrance",
      address: { full_address: "Căn 1208, Tòa S2.01, 197 Trần Phú, Phường Chợ Quán, TP.HCM" },
    });
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
  await expect(page.getByRole("heading", { name: "Thêm phòng và tin cho thuê" })).toBeVisible();
  await page.getByLabel("Mã phòng", { exact: true }).fill("P.999");
  await page.getByLabel("Diện tích (m²)", { exact: true }).fill("25");
  await page.getByLabel("Tiêu đề", { exact: true }).fill(listing.title);
  await page.getByLabel("Mô tả", { exact: true }).fill(listing.description);
  await page.getByLabel("Giá thuê / tháng", { exact: true }).fill("5000000");
  await page.getByLabel("Tiền cọc", { exact: true }).fill("5000000");
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
    unit: { unit_code: "P.999", area_m2: 25, bedrooms: 0, bathrooms: 0 },
    listing: { title: listing.title, rent_vnd: 5000000 },
  });
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
  await page.getByRole("button", { name: "Tổng quan", exact: true }).click();
  await page
    .locator(".ll-metrics")
    .getByRole("button", { name: /Yêu cầu mới/ })
    .click();
  await expect(page.getByRole("heading", { name: "Yêu cầu liên hệ theo nhà" })).toBeVisible();
  await expect(page.getByText("Tôi muốn xem phòng vào cuối tuần.")).toHaveCount(0);
  await page
    .locator(".ll-contact-hierarchy .ll-property-list")
    .getByRole("button", { name: /Nhà Nguyễn Trãi/ })
    .click();
  await expect(page.locator(".ll-contact-room").filter({ hasText: "P.301" })).toBeVisible();
  await page.locator(".ll-contact-room").filter({ hasText: "P.301" }).click();
  await expect(page.getByText("Tôi muốn xem phòng vào cuối tuần.")).toBeVisible();
});

test("reopening a private address preserves its full confirmation and address data on save",async({page})=>{
  let saved:any=null;
  const address={full_address:'Căn 1208, Tòa S2.01, Đa Tốn, Hà Nội',raw:'Căn 1208, Tòa S2.01, Đa Tốn, Hà Nội',geocoded_address:'Đa Tốn, Hà Nội',private_detail:'Căn 1208, Tòa S2.01',ward:'Đa Tốn',city:'Hà Nội',street:'Đường nội khu'};
  await page.route(`**/web/api/housing-management/landlord/properties/${propertyId}`,route=>{
    if(route.request().method()==='PATCH'){
      saved=route.request().postDataJSON();return route.fulfill({json:{id:propertyId,revision:2}});
    }
    return route.fulfill({json:{id:propertyId,name:'Nhà Nguyễn Trãi',property_type:'apartment',address,lat:21,lng:105.81,revision:1,management_status:'active',location_confirmed_at:'2026-10-01T00:00:00Z',location_token:'base-lookup',confirmation_token:'full-private-confirmation',units:[]}});
  });
  await page.goto('/landlord');await page.locator('.ll-nav').getByRole('button',{name:/Nhà & phòng/}).click();
  await page.getByRole('button',{name:/Nhà Nguyễn Trãi/}).click();await page.getByRole('button',{name:'Chỉnh sửa nhà',exact:true}).click();
  await expect(page.getByLabel('Địa chỉ đầy đủ')).toHaveValue('Đa Tốn, Hà Nội');
  await expect(page.getByLabel('Căn, tầng, tòa nhà (địa chỉ riêng)')).toHaveValue('Căn 1208, Tòa S2.01');
  await page.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();
  await expect.poll(()=>saved).toMatchObject({address,location_token:'full-private-confirmation',location_confirmed:true});
});
