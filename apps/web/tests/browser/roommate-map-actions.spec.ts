import { test, expect, type Page } from "@playwright/test";

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  },
});

async function fixture(page: Page, posterIds: string[]) {
  const home = {
    id: "linked-room",
    listing_id: "linked-room",
    title: "Phòng có người ở",
    lat: 21.03,
    lng: 105.8,
    location: { lat: 21.03, lng: 105.8 },
    price: { amount: 2000000, currency: "VND", period: "month" },
    address: { city: "Hà Nội" },
    management: { accepts_contact_requests: true },
  };
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/web/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/web/api",
      "",
    );
    const readOnlyPosts = [
      "/roommate/map/rooms",
      "/platform/housing/map",
      "/platform/housing/search",
      "/platform/places/map",
    ];
    // Platform queries use POST; detail-view analytics are not a contact/booking.
    if (
      route.request().method() !== "GET" &&
      !readOnlyPosts.includes(path) &&
      path !== "/housing-management/housing/linked-room/events"
    )
      writes.push(path);
    const json =
      path === "/roommate/map/rooms"
        ? {
            items: posterIds.map((id) => ({
              listing_id: home.id,
              profile_id: id,
              display_name: "Người đăng " + id,
              source_kind: "real",
              label:
                "Đang tìm bạn trọ — thông tin tự khai; chưa xác minh quyền ở phòng",
            })),
          }
        : path === "/roommate/availability"
          ? { enabled: true }
          : path === "/platform/housing/map"
            ? {
                features: [{ kind: "listing", ...home }],
                meta: { mode: "listings", returned_count: 1 },
              }
            : path === "/platform/housing/search"
              ? {
                  results: [home],
                  page: { next_cursor: null, returned_count: 1 },
                }
              : path === "/platform/places/map"
                ? { type: "FeatureCollection", features: [] }
                : path.startsWith("/housing/")
                  ? { ...home, address: "Hà Nội" }
                  : {};
    return route.fulfill({
      status: ["/session", "/status"].includes(path) ? 401 : 200,
      json,
    });
  });
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
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto("/login");
  await page.evaluate(async () =>
    (await import("/tests/browser/fixtures/coincident-host.tsx")).mount(),
  );
  await expect(
    page.getByRole("button", { name: "Xem Phòng có người ở", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await import("/tests/browser/fixtures/coincident-host.tsx"))
          .pins()
          .map((p: any) => p.properties.roommate),
      ),
    )
    .toEqual([posterIds.length > 0]);
  return { writes, errors };
}

test.afterEach(async ({ page }) => {
  await page
    .evaluate(async () =>
      (await import("/tests/browser/fixtures/coincident-host.tsx")).unmount(),
    )
    .catch(() => {});
});

test("linked room contacts its Roommate poster from card and both details, never selects or contacts landlord", async ({
  page,
}, testInfo) => {
  const { writes, errors } = await fixture(page, ["poster-a"]);
  const card = page.locator(".ws-card");
  await expect(
    card.getByRole("link", { name: "Liên hệ người đăng" }),
  ).toHaveAttribute("href", "/roommate/profiles/poster-a");
  await expect(card.getByRole("button", { name: "Chọn căn này" })).toHaveCount(
    0,
  );
  await expect(card.getByRole("button", { name: /so sánh/i })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Xem Phòng có người ở", exact: true })
    .click();
  const detail = page.getByRole("complementary", {
    name: /^(Chi tiết nhà|Home details)$/,
    exact: true,
  });
  await expect(
    detail.getByRole("link", { name: "Liên hệ người đăng" }),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Chọn căn này" }),
  ).toHaveCount(0);
  await expect(detail.getByRole("button", { name: /so sánh/i })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("roommate-map-contact.png"),
  });
  await page.evaluate(async () =>
    (await import("/tests/browser/fixtures/coincident-host.tsx")).locale("en"),
  );
  await expect(
    detail.getByRole("link", { name: "Contact poster" }),
  ).toHaveAttribute("href", "/roommate/profiles/poster-a");
  await page.evaluate(async () =>
    (await import("/tests/browser/fixtures/coincident-host.tsx")).locale("vi"),
  );
  await detail.getByRole("button", { name: "Thông tin chi tiết ›" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Chi tiết nhà",
    exact: true,
  });
  await expect(
    dialog.getByRole("link", { name: "Liên hệ người đăng" }),
  ).toBeVisible();
  await expect(dialog.locator(".housing-decision-tools")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Chọn căn này" }),
  ).toHaveCount(0);
  await expect(dialog).toContainText("đây không phải yêu cầu thuê căn");
  await dialog.getByRole("link", { name: "Liên hệ người đăng" }).click();
  await expect(page).toHaveURL(/\/roommate\/profiles\/poster-a$/);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      async () =>
        (await import("/tests/browser/fixtures/coincident-host.tsx")).chosen,
    ),
  ).toEqual([]);
});

test("shared room asks which poster instead of choosing or connecting automatically", async ({
  page,
}) => {
  const { writes, errors } = await fixture(page, ["poster-a", "poster-b"]);
  await page
    .locator(".ws-card")
    .getByRole("button", { name: "Liên hệ người đăng" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Chọn người đăng để kết nối",
  });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Chi tiết nhà", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("link", { name: "Xem nhu cầu ở ghép" }),
  ).toHaveCount(2);
  await expect(dialog).toContainText("Chưa có yêu cầu nào được gửi");
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await page
    .getByRole("button", { name: "Xem Phòng có người ở", exact: true })
    .click();
  await page
    .getByRole("complementary", { name: "Chi tiết nhà", exact: true })
    .getByRole("button", { name: "Thông tin chi tiết ›" })
    .click();
  await page
    .getByRole("dialog", { name: "Chi tiết nhà", exact: true })
    .getByRole("button", { name: "Liên hệ người đăng" })
    .click();
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Chi tiết nhà", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("link", { name: "Xem nhu cầu ở ghép" }),
  ).toHaveCount(2);
  await dialog
    .locator(".ws-roommate-badge")
    .filter({ hasText: "Người đăng poster-b" })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/roommate\/profiles\/poster-b$/);
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .not.toBe("hidden");
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("room without visible Roommate posts keeps normal housing selection and no yellow pin", async ({
  page,
}) => {
  const { errors } = await fixture(page, []);
  await expect(
    page.locator(".ws-card").getByRole("link", { name: "Liên hệ người đăng" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Xem Phòng có người ở", exact: true })
    .click();
  const detail = page.getByRole("complementary", {
    name: "Chi tiết nhà",
    exact: true,
  });
  await expect(detail.locator(".ws-roommate-badge")).toHaveCount(0);
  await detail
    .getByRole("button", { name: "Chọn căn này", exact: true })
    .click();
  expect(
    await page.evaluate(
      async () =>
        (await import("/tests/browser/fixtures/coincident-host.tsx")).chosen,
    ),
  ).toEqual(["linked-room"]);
  expect(errors).toEqual([]);
});
