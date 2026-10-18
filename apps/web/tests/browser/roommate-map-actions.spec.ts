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

async function fixture(
  page: Page,
  posterIds: string[],
  options: {
    viewing?: boolean;
    failInitially?: boolean;
    failAvailability?: boolean;
    homeCount?: number;
  } = {},
) {
  const overlay = {
    failing: options.failInitially || false,
    availabilityFailing: options.failAvailability || false,
    wait: null as Promise<void> | null,
    requests: [] as string[][],
  };
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
  const homes = Array.from({ length: options.homeCount || 1 }, (_, i) =>
    i === 0
      ? home
      : {
          ...home,
          id: `other-home-${i}`,
          listing_id: `other-home-${i}`,
          title: `Phòng khác ${i}`,
          lat: home.lat + i * 0.00001,
          location: { lat: home.lat + i * 0.00001, lng: home.lng },
        },
  );
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/web/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/web/api",
      "",
    );
    if (path === "/roommate/availability" && overlay.availabilityFailing)
      return route.fulfill({
        status: 503,
        json: { detail: { code: "service_unavailable" } },
      });
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
    if (path === "/roommate/map/rooms") {
      overlay.requests.push(route.request().postDataJSON().listing_ids);
      if (overlay.wait) await overlay.wait;
      if (overlay.failing)
        return route.fulfill({
          status: 503,
          json: { detail: { code: "service_unavailable" } },
        });
    }
    const json =
      path === "/roommate/map/rooms"
        ? {
            items: posterIds
              .map((id) => ({
                listing_id: home.id,
                profile_id: id,
                display_name: "Người đăng " + id,
                source_kind: "real",
                label:
                  "Đang tìm bạn trọ — thông tin tự khai; chưa xác minh quyền ở phòng",
              }))
              .filter((item) =>
                route
                  .request()
                  .postDataJSON()
                  .listing_ids.includes(item.listing_id),
              ),
          }
        : path === "/roommate/availability"
          ? { enabled: true }
          : path === "/platform/housing/map"
            ? {
                features: homes.map((h) => ({ kind: "listing", ...h })),
                meta: { mode: "listings", returned_count: homes.length },
              }
            : path === "/platform/housing/search"
              ? {
                  results: homes,
                  page: { next_cursor: null, returned_count: homes.length },
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
  await page.evaluate(
    async (viewing) =>
      (await import("/tests/browser/fixtures/coincident-host.tsx")).mount(
        viewing,
      ),
    options.viewing || false,
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
    .toEqual(
      homes.map((_, i) => i === 0 && !overlay.failing && posterIds.length > 0),
    );
  if (!overlay.failing && !overlay.availabilityFailing)
    await expect(
      page.locator(".ws-card").first().locator(".ws-select-small"),
    ).toBeEnabled();
  return { writes, errors, overlay };
}

async function refreshOverlay(page: Page) {
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
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

test("failed overlay refresh never restores rental actions; only a successful empty retry can", async ({
  page,
}) => {
  const posters = ["poster-a"];
  const { overlay, writes, errors } = await fixture(page, posters);
  const card = page.locator(".ws-card");
  await page
    .getByRole("button", { name: "Xem Phòng có người ở", exact: true })
    .click();
  const detail = page.getByRole("complementary", {
    name: "Chi tiết nhà",
    exact: true,
  });
  await detail.getByRole("button", { name: "Thông tin chi tiết ›" }).click();
  const full = page.getByRole("dialog", { name: "Chi tiết nhà", exact: true });
  overlay.failing = true;
  await refreshOverlay(page);
  await expect(
    full.getByRole("button", {
      name: "Chưa xác minh được tin ở ghép",
      exact: true,
    }),
  ).toBeDisabled();
  for (const surface of [card, detail, full]) {
    await expect(
      surface.getByRole("link", {
        name: "Liên hệ người đăng",
        includeHidden: true,
      }),
    ).toHaveCount(0);
    await expect(
      surface.getByRole("button", {
        name: "Chọn căn này",
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
  }
  await expect(full.locator(".housing-decision-tools")).toHaveCount(0);
  await expect(full).toContainText("Chưa xác minh được trạng thái ở ghép");
  expect(
    await page.evaluate(
      async () =>
        (await import("/tests/browser/fixtures/coincident-host.tsx")).chosen,
    ),
  ).toEqual([]);
  await full.getByRole("button", { name: "Đóng", exact: true }).click();
  overlay.failing = false;
  posters.length = 0;
  let release!: () => void;
  overlay.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page
    .getByRole("button", { name: "Thử lại ghép trọ", exact: true })
    .click();
  await expect(
    detail.getByRole("button", {
      name: "Đang kiểm tra tin ở ghép…",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    card.getByRole("button", { name: "Chọn căn này", exact: true }),
  ).toHaveCount(0);
  release();
  overlay.wait = null;
  await expect(
    detail.getByRole("button", { name: "Chọn căn này", exact: true }),
  ).toBeEnabled();
  await detail
    .getByRole("button", { name: "Chọn căn này", exact: true })
    .click();
  expect(
    await page.evaluate(
      async () =>
        (await import("/tests/browser/fixtures/coincident-host.tsx")).chosen,
    ),
  ).toEqual(["linked-room"]);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("an initial overlay failure is unknown, not an empty roommate catalog", async ({
  page,
}) => {
  const { overlay, errors } = await fixture(page, [], { failInitially: true });
  const card = page.locator(".ws-card");
  await expect(
    card.getByRole("button", {
      name: "Chưa xác minh được tin ở ghép",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    card.getByRole("button", { name: "Chọn căn này", exact: true }),
  ).toHaveCount(0);
  overlay.failing = false;
  await page
    .getByRole("button", { name: "Thử lại ghép trọ", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Chọn căn này", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("failed availability cannot be treated as Roommate explicitly disabled", async ({
  page,
}) => {
  const { overlay, errors } = await fixture(page, [], {
    failAvailability: true,
  });
  const card = page.locator(".ws-card");
  await expect(
    card.getByRole("button", {
      name: "Chưa xác minh được tin ở ghép",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    card.getByRole("button", { name: "Chọn căn này", exact: true }),
  ).toHaveCount(0);
  overlay.availabilityFailing = false;
  await page
    .getByRole("button", { name: "Thử lại ghép trọ", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Chọn căn này", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

for (const failure of [false, true]) {
  test(`viewing selection remains removable after a roommate post appears (overlay failure: ${failure})`, async ({
    page,
  }, testInfo) => {
    const posters: string[] = [];
    const { overlay, errors } = await fixture(page, posters, { viewing: true });
    const card = page.locator(".ws-card");
    await card
      .getByRole("button", { name: "Chọn căn này", exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "Bỏ chọn", exact: true }),
    ).toBeEnabled();
    posters.push("poster-a");
    await refreshOverlay(page);
    await expect(
      card.getByRole("link", { name: "Liên hệ người đăng" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Bỏ chọn", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Xem Phòng có người ở", exact: true })
      .click();
    const detail = page.getByRole("complementary", {
      name: "Chi tiết nhà",
      exact: true,
    });
    await expect(
      detail.getByRole("button", { name: "Bỏ chọn", exact: true }),
    ).toBeEnabled();
    await detail.getByRole("button", { name: "Thông tin chi tiết ›" }).click();
    const full = page.getByRole("dialog", {
      name: "Chi tiết nhà",
      exact: true,
    });
    await expect(
      full.getByRole("link", { name: "Liên hệ người đăng" }),
    ).toBeVisible();
    await expect
      .poll(() => full.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("roommate-contact-and-remove.png"),
    });
    if (failure) {
      overlay.failing = true;
      await refreshOverlay(page);
      await expect(
        full.getByRole("button", {
          name: "Chưa xác minh được tin ở ghép",
          exact: true,
        }),
      ).toBeDisabled();
    }
    await full.getByRole("button", { name: "Bỏ chọn", exact: true }).click();
    await expect(
      full.getByRole("button", { name: "Bỏ chọn", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        async () =>
          (await import("/tests/browser/fixtures/coincident-host.tsx"))
            .unselected,
      ),
    ).toEqual(["linked-room"]);
    expect(
      await page.evaluate(
        async () =>
          (await import("/tests/browser/fixtures/coincident-host.tsx")).chosen,
      ),
    ).toEqual(["linked-room"]);
    await full.getByRole("button", { name: "Đóng", exact: true }).click();
    await expect(
      card.getByRole("button", { name: "Bỏ chọn", exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("overlay verifies every batch before allowing rental actions beyond 250 listings", async ({
  page,
}) => {
  const { overlay, errors } = await fixture(page, [], { homeCount: 251 });
  const last = page.locator(".ws-card").filter({ hasText: "Phòng khác 250" });
  await expect(
    last.getByRole("button", { name: "Chọn căn này", exact: true }),
  ).toBeEnabled();
  expect(overlay.requests.some((ids) => ids.includes("other-home-250"))).toBe(
    true,
  );
  expect(overlay.requests.every((ids) => ids.length <= 250)).toBe(true);
  expect(errors).toEqual([]);
});
