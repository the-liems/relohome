import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("legacy photos can be viewed and individually deleted without upload or attachment", async ({
  page,
}) => {
  await setup(page);
  let photos = [
    {
      media_id: "legacy-photo",
      status: "approved",
      mime: "image/png",
      created: 1,
    },
  ];
  const writes: string[] = [];
  await page.route("**/web/api/roommate/me/media", (route) =>
    route.fulfill({ json: { items: photos } }),
  );
  await page.route("**/web/api/roommate/media/legacy-photo", (route) => {
    if (route.request().method() === "DELETE") {
      writes.push("DELETE legacy-photo");
      photos = [];
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1eIAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });
  page.on("request", (req) => {
    if (
      (req.method() === "POST" && req.url().endsWith("/roommate/media")) ||
      (req.method() === "PUT" && req.url().endsWith("/profile/avatar"))
    )
      writes.push("unexpected photo write");
  });
  await page.goto("/roommate?tab=profile");
  const gallery = page.getByRole("region", {
    name: "Ảnh đã lưu trước đây",
    exact: true,
  });
  await expect(gallery).toBeVisible();
  await expect(gallery.locator("img")).toHaveCount(1);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await gallery
    .getByRole("button", { name: "Xóa ảnh này", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hủy", exact: true })
    .click();
  expect(writes).toEqual([]);
  await gallery
    .getByRole("button", { name: "Xóa ảnh này", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Xóa ảnh", exact: true })
    .click();
  await expect(gallery).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Bản giới thiệu của bạn", exact: true }),
  ).toBeVisible();
  expect(writes).toEqual(["DELETE legacy-photo"]);
});

test("linked room picker scopes search without granting location consent", async ({
  page,
}) => {
  await setup(page);
  let payload: Record<string, unknown> | null = null;
  await page.route("**/web/api/platform/housing/search", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      json: {
        results: [
          {
            listing_id: "test-room",
            title: "Phòng Duy Tân",
            address: { raw: "Hà Nội" },
            price: { amount: 3000000, currency: "VND", period: "month" },
            thumbnail_url: null,
          },
        ],
      },
    });
  });
  await page.goto("/roommate?tab=profile");
  await page
    .getByLabel("Thành phố muốn ở", { exact: true })
    .selectOption("hanoi");
  await page
    .getByLabel("Nhu cầu của bạn", { exact: true })
    .selectOption("has_room");
  await page.getByText("Thông tin bổ sung", { exact: true }).click();
  await page
    .getByText("Hiện phòng trên map (tùy chọn)", { exact: true })
    .click();
  await page.getByLabel("Tìm tên đường hoặc tên tin").fill("Duy Tân");
  await page
    .getByRole("button", { name: "Tìm phòng của bạn", exact: true })
    .click();
  await page.getByRole("radio", { name: /Phòng Duy Tân/ }).check();
  expect(payload).toMatchObject({
    text: "Duy Tân",
    bounding_box: { west: 105.28, south: 20.55, east: 106.04, north: 21.4 },
  });
  await expect(
    page.getByLabel(
      "Tôi đồng ý công khai vị trí phòng này và xác nhận đang tìm bạn trọ.",
    ),
  ).not.toBeChecked();
  await page
    .getByLabel("Thành phố muốn ở", { exact: true })
    .selectOption("hcm");
  await expect(
    page.getByLabel(
      "Tôi đồng ý công khai vị trí phòng này và xác nhận đang tìm bạn trọ.",
    ),
  ).toBeDisabled();
});

async function setup(page: import("@playwright/test").Page, moderator = false) {
  await page.route("**/web/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/web/api",
      "",
    );
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 2 * 86400000).toISOString();
    let json: unknown = {};
    if (path === "/session")
      json = {
        id: "viewer",
        name: "Minh",
        email: "minh@example.test",
        preferences: {},
      };
    else if (path === "/threads" || path === "/saved") json = [];
    else if (path === "/roommate/availability")
      json = {
        enabled: true,
        cities: ["hcm"],
        terms_version: "roommate-1.0",
        features: [
          "notifications",
          "media",
          "moderation",
          "privacy",
          "operation_drafts",
        ],
      };
    else if (path === "/roommate/access")
      json = { eligible: true, terms_version: "roommate-1.0", moderator };
    else if (path === "/roommate/notifications")
      json = {
        items: [
          {
            id: "event1",
            kind: "request_received",
            resource_id: "request1",
            created_at: now,
            read: false,
          },
        ],
        unread: 1,
        total: 1,
        offset: 0,
        limit: 20,
      };
    else if (path === "/roommate/me/requests")
      json = {
        items: [
          {
            request_id: "request1",
            direction: "received",
            state: "pending",
            expires_at: expires,
            created_at: now,
            grant_state: null,
            grant_expires_at: null,
            available: true,
            counterparty: { display_name: "Lan Nguyễn", avatar_id: null },
            preview: "Muốn cùng tìm nhà và thống nhất việc dọn dẹp.",
            unread: true,
          },
        ],
        received_pending: 1,
        total: 1,
        offset: 0,
        limit: 12,
        profile_reminder: { expires_at: expires },
      };
    else if (path === "/roommate/me/blocks")
      json = { items: [{ profile_id: "blocked-one" }] };
    else if (path === "/roommate/me/contacts") json = { channels: [] };
    else if (path === "/roommate/me/privacy") json = { version: null };
    else if (path === "/roommate/me/operation-drafts") json = { items: [] };
    else if (path === "/roommate/me/media") json = { items: [] };
    else if (
      path === "/roommate/me/intro" ||
      path === "/roommate/me/profile" ||
      path === "/roommate/me/criteria"
    )
      json = null;
    else if (path.startsWith("/roommate/areas/"))
      json = { areas: [{ area_id: "city:hcm", city: "hcm" }] };
    else if (path === "/roommate/search")
      json = { items: [], total: 0, offset: 0, limit: 12 };
    else if (path === "/roommate/moderation/reports")
      json = {
        items: [
          {
            id: "report1",
            actor: "reporter",
            target: "reported-user",
            reason: "Tin không đúng",
            created: Date.now() / 1000,
            status: "open",
          },
        ],
        total: 1,
      };
    else if (path === "/roommate/moderation/media")
      json = { items: [], total: 0 };
    else if (path === "/roommate/moderation/summary")
      json = {
        active_profiles: 3,
        pending_reports: 1,
        pending_media: 0,
        pending_requests: 2,
      };
    await route.fulfill({ json });
  });
}

test("inbox presents people, unread and renewal instead of only request IDs", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/roommate?tab=inbox");
  await expect(page.getByText("Lan Nguyễn", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Muốn cùng tìm nhà và thống nhất việc dọn dẹp.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Xác nhận còn tìm" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Thông báo.*1/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Thông báo.*1/ }).click();
  await expect(
    page.getByRole("link", { name: "Có yêu cầu kết nối mới" }),
  ).toBeVisible();
});

test("settings expose private contact management and unblock without publishing a profile", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/roommate?tab=settings");
  await expect(
    page.getByRole("heading", { name: "Liên hệ và quyền riêng tư" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Bỏ chặn" })).toBeVisible();
});

test("moderator gets an actionable private reports queue", async ({ page }) => {
  await setup(page, true);
  await page.goto("/roommate/moderation");
  await expect(
    page.getByRole("heading", { name: "Hồ sơ và báo cáo" }),
  ).toBeVisible();
  await expect(page.getByText("Tin không đúng", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Xem báo cáo" })).toBeVisible();
});

test("a normal user cannot open moderation workspace", async ({ page }) => {
  await setup(page);
  await page.goto("/roommate/moderation");
  await expect(
    page.getByText("Bạn không có quyền quản lý cộng đồng.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Tin không đúng", { exact: true })).toHaveCount(
    0,
  );
});

test("reloading an uncertain contact write offers explicit recovery with the original key", async ({
  page,
}) => {
  await setup(page);
  let draft: {
    path: string;
    method: string;
    body: Record<string, unknown>;
  } | null = null;
  const writes: Record<string, unknown>[] = [];
  await page.route("**/web/api/roommate/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/web/api/roommate",
      "",
    );
    if (path === "/me/contacts") {
      if (route.request().method() === "GET")
        return route.fulfill({
          json: {
            channels: [
              {
                channel_id: "phone1",
                kind: "phone",
                version: 1,
                value: "0901234567",
              },
            ],
          },
        });
      writes.push(route.request().postDataJSON());
      if (writes.length === 1)
        return route.fulfill({
          status: 502,
          json: { detail: { code: "operation_unknown" } },
        });
      return route.fulfill({ json: { channel_id: "phone1", version: 2 } });
    }
    if (path === "/operation-drafts" && route.request().method() === "PUT") {
      draft = route.request().postDataJSON();
      return route.fulfill({ json: { saved: true } });
    }
    if (path === "/me/operation-drafts")
      return route.fulfill({
        json: {
          items: draft
            ? [
                {
                  operation_key: draft.body.operation_key,
                  expires_at: new Date(Date.now() + 1800000).toISOString(),
                },
              ]
            : [],
        },
      });
    if (path.startsWith("/operation-drafts/"))
      return route.fulfill({ json: { status: "ready", draft } });
    await route.fallback();
  });
  await page.goto("/roommate?tab=settings");
  await page.getByRole("button", { name: "Xóa kênh", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Xóa kênh", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Kiểm tra trạng thái" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Kiểm tra thao tác 1" }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "Kiểm tra thao tác 1" }).click();
  await page
    .getByRole("button", { name: "Xác nhận gửi lại cùng thao tác" })
    .click();
  await expect(
    page.getByText("Thao tác đã hoàn tất. Không cần gửi lại."),
  ).toBeVisible();
  expect(writes[1]).toEqual(writes[0]);
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  expect(storage).not.toContain("0901234567");
  expect(storage).not.toContain(String(writes[0].operation_key));
});

test("restricted accounts keep owner data controls but cannot discover people", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/web/api/roommate/access", (route) =>
    route.fulfill({
      json: {
        eligible: false,
        reason: "service_restricted",
        terms_version: "roommate-1.0",
      },
    }),
  );
  await page.goto("/roommate");
  await expect(
    page.getByRole("button", { name: "Tải thông tin của tôi" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tìm người phù hợp" }),
  ).toHaveCount(0);
});

test("settings and moderation are accessible and fit the viewport", async ({
  page,
}, info) => {
  await setup(page, true);
  for (const tab of ["/roommate?tab=settings", "/roommate/moderation"]) {
    await page.goto(tab);
    await expect(
      page.getByRole("heading", {
        name: tab.includes("settings")
          ? "Liên hệ và quyền riêng tư"
          : "Hồ sơ và báo cáo",
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBeLessThanOrEqual(2);
    expect(
      (
        await new AxeBuilder({ page })
          .include(".rm-workspace")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.locator(".rm-workspace").screenshot({
      path: info.outputPath(
        tab.includes("settings") ? "settings.png" : "moderation.png",
      ),
    });
  }
  await page.getByRole("button", { name: "EN", exact: true }).focus();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page
    .getByRole("button", { name: /Switch to dark|Chuyển sang tối/ })
    .click();
  for (const tab of ["/roommate?tab=settings", "/roommate/moderation"]) {
    await page.goto(tab);
    await expect(
      page.getByRole("heading", {
        name: tab.includes("settings")
          ? "Contacts and privacy"
          : "Profiles and reports",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .include(".rm-workspace")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.locator(".rm-workspace").screenshot({
      path: info.outputPath(
        tab.includes("settings")
          ? "settings-dark-en.png"
          : "moderation-dark-en.png",
      ),
    });
  }
});
