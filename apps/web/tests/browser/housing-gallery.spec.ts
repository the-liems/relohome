import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { waitForUiMotion } from "./helpers/ui-motion";

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

test("chat/account detail upgrades the cover to the full API gallery", async ({
  page,
}, testInfo) => {
  const house = {
    id: "dialog-home",
    title: "Dialog fixture",
    address: "Fixture address",
    thumbnail_url: "http://127.0.0.1:5174/dialog-photo/1.svg",
  };
  await page.route("**/web/api/**", (route) =>
    route.fulfill({
      status: route.request().url().endsWith("/session") ? 401 : 200,
      json: route.request().url().endsWith("/housing/dialog-home")
        ? {
            ...house,
            images: [1, 2, 3].map((i) => ({
              url: `http://127.0.0.1:5174/dialog-photo/${i}.svg`,
            })),
          }
        : {},
    }),
  );
  await page.route("**/dialog-photo/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#d1fae5"/></svg>',
    }),
  );
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto("/login");
  await page.evaluate(
    async (home) =>
      (await import("/tests/browser/fixtures/housing-gallery-host.tsx")).mount(
        home,
      ),
    house,
  );
  try {
    const dialog = page.getByRole("dialog", {
      name: "Chi tiết nhà",
      exact: true,
    });
    await expect(
      dialog
        .getByRole("status", { name: "", exact: true })
        .filter({ hasText: "Ảnh 1 / 3" }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Xem ảnh 3", exact: true })
      .click();
    await expect(dialog.locator(".house-gallery-stage img")).toHaveAttribute(
      "src",
      /\/3\.svg$/,
    );
    await dialog
      .getByRole("button", { name: "Ảnh tiếp theo", exact: true })
      .click();
    await expect(dialog.locator(".house-gallery-stage img")).toHaveAttribute(
      "src",
      /\/1\.svg$/,
    );
    await waitForUiMotion(page);
    await page.screenshot({ path: testInfo.outputPath("dialog-gallery.png") });
    expect(
      (
        await new AxeBuilder({ page })
          .include(".house-gallery")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  } finally {
    if (!page.isClosed())
      await page
        .evaluate(async () =>
          (
            await import("/tests/browser/fixtures/housing-gallery-host.tsx")
          ).unmount(),
        )
        .catch(() => {});
  }
});

test("housing detail shows every safe photo and keeps nearby/selection actions on the map", async ({
  page,
}, testInfo) => {
  const origin = "http://127.0.0.1:5174";
  const homes = ["gallery-home", "single-home", "empty-home"].map((id, i) => ({
    id,
    listing_id: id,
    title: `Gallery fixture ${i + 1}`,
    lat: 21.03,
    lng: 105.8,
    location: { lat: 21.03, lng: 105.8 },
    price: { amount: 4500000, currency: "VND", period: "month" },
    address: { city: "Hà Nội", street: "Fixture street" },
    amenities: ["balcony"],
    thumbnail_url: i === 2 ? undefined : `${origin}/gallery-photo/1.svg`,
    images:
      i === 0
        ? [
            { url: `${origin}/gallery-photo/1.svg`, alt: "Living room" },
            `${origin}/gallery-photo/2.svg`,
            { url: `${origin}/gallery-photo/3.svg`, alt: "Kitchen" },
            { url: `${origin}/gallery-photo/broken.svg` },
            { url: "javascript:alert(1)" },
            { url: `${origin}/gallery-photo/1.svg` },
          ]
        : [],
  }));
  const listHomes = homes.map(({ images, ...home }) => home);
  const roomRequests: Record<string, unknown>[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/web/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/web/api",
      "",
    );
    if (path === "/roommate/map/rooms") {
      roomRequests.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          items: [
            {
              listing_id: "gallery-home",
              profile_id: "user-anna",
              display_name: "Anna",
              source_kind: "real",
              label: "Đang tìm bạn trọ",
            },
            {
              listing_id: "gallery-home",
              profile_id: "demo_old",
              display_name: "DEMO old profile",
              source_kind: "demo",
              label: "DEMO",
            },
          ],
        },
      });
    }
    return route.fulfill({
      status: ["/session", "/status"].includes(path) ? 401 : 200,
      json:
        path === "/platform/housing/map"
          ? {
              features: listHomes.map((h) => ({ kind: "listing", ...h })),
              meta: { mode: "listings", returned_count: 3 },
            }
          : path === "/platform/housing/search"
            ? {
                results: listHomes,
                page: { next_cursor: null, returned_count: 3 },
              }
            : path === "/platform/places/map"
              ? { type: "FeatureCollection", features: [] }
              : path === "/roommate/availability"
                ? { enabled: true, demo_enabled: true }
                : path.startsWith("/housing/")
                  ? homes.find((h) => h.id === path.split("/").pop())
                  : {},
    });
  });
  await page.route("**/gallery-photo/**", (route) =>
    route.request().url().includes("broken")
      ? route.fulfill({ status: 404, body: "" })
      : route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#d1fae5"/></svg>',
        }),
  );
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
  try {
    const detail = page.getByRole("complementary", {
      name: /^(Chi tiết nhà|Home details)$/,
    });
    await page
      .getByRole("button", { name: "Xem Gallery fixture 1", exact: true })
      .click();
    await expect(detail).toBeVisible();
    await expect(detail.locator(".ws-roommate-badge")).toHaveCount(1);
    await expect(
      detail.getByRole("link", { name: "Xem nhu cầu ở ghép" }),
    ).toHaveAttribute("href", "/roommate/profiles/user-anna");
    await expect(page.getByText(/DEMO/)).toHaveCount(0);
    expect(roomRequests.length).toBeGreaterThan(0);
    expect(roomRequests.every((body) => !("include_demo" in body))).toBe(true);
    await expect(
      detail.getByRole("button", { name: "Ảnh tiếp theo", exact: true }),
    ).toBeVisible();
    await expect(detail.getByRole("status")).toHaveText("Ảnh 1 / 4");
    const auditGallery = async () => {
      await waitForUiMotion(page);
      expect(
        (
          await new AxeBuilder({ page })
            .include(".house-gallery")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    };
    await auditGallery();
    await expect(detail.locator(".house-gallery-stage img")).toHaveJSProperty(
      "complete",
      true,
    );
    await page.screenshot({ path: testInfo.outputPath("detail-initial.png") });
    await detail
      .getByRole("button", { name: "Ảnh tiếp theo", exact: true })
      .click();
    await expect(detail.locator(".house-gallery-stage img")).toHaveAttribute(
      "src",
      `${origin}/gallery-photo/2.svg`,
    );
    await detail
      .getByRole("button", { name: "Xem ảnh 3", exact: true })
      .click();
    await expect(detail.locator(".house-gallery-stage img")).toHaveAttribute(
      "alt",
      "Kitchen",
    );
    const stage = detail.locator(".house-gallery-stage");
    await stage.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(detail.getByRole("status")).toHaveText("Ảnh 2 / 4");
    await stage.dispatchEvent("pointerdown", {
      pointerType: "touch",
      pointerId: 1,
      clientX: 200,
      clientY: 150,
    });
    await stage.dispatchEvent("pointerup", {
      pointerType: "touch",
      pointerId: 1,
      clientX: 100,
      clientY: 151,
    });
    await expect(detail.getByRole("status")).toHaveText("Ảnh 3 / 4");
    await detail
      .getByRole("button", { name: "Xem ảnh 4", exact: true })
      .click();
    await expect(stage.getByText("Không tải được ảnh này")).toBeVisible();
    await detail
      .getByRole("button", { name: "Ảnh tiếp theo", exact: true })
      .click();
    await expect(detail.getByRole("status")).toHaveText("Ảnh 1 / 4");
    await expect(
      detail.getByRole("heading", { name: "Tiện ích xung quanh", exact: true }),
    ).toHaveCount(0);
    await expect(detail).not.toContainText("Toạ độ:");
    await detail
      .getByRole("button", { name: "Xem các tiện ích xung quanh", exact: true })
      .click();
    await expect(detail).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { map } =
            await import("/tests/browser/fixtures/coincident-host.tsx");
          return map.getZoom();
        }),
      )
      .toBeGreaterThanOrEqual(15.4);
    await expect(
      detail.getByRole("button", { name: "Chọn căn này", exact: true }),
    ).toHaveCount(0);
    await expect(
      detail.getByRole("link", { name: "Liên hệ người đăng", exact: true }),
    ).toHaveAttribute("href", "/roommate/profiles/user-anna");
    expect(
      await page.evaluate(
        async () =>
          (await import("/tests/browser/fixtures/coincident-host.tsx")).chosen,
      ),
    ).toEqual([]);
    await page.evaluate(async () =>
      (await import("/tests/browser/fixtures/coincident-host.tsx")).theme(
        "dark",
      ),
    );
    await auditGallery();
    await page.screenshot({ path: testInfo.outputPath("detail-dark.png") });
    expect(
      await detail.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.evaluate(async () =>
      (await import("/tests/browser/fixtures/coincident-host.tsx")).locale(
        "en",
      ),
    );
    await expect(
      detail.getByRole("button", { name: "Next photo", exact: true }),
    ).toBeVisible();
    await expect(detail.getByRole("status")).toHaveText("Photo 1 / 4");
    await page.evaluate(async () =>
      (await import("/tests/browser/fixtures/coincident-host.tsx")).locale(
        "vi",
      ),
    );
    await detail
      .getByRole("button", { name: "Đóng chi tiết", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Xem Gallery fixture 2", exact: true })
      .click();
    await expect(detail.locator(".house-gallery-stage img")).toHaveAttribute(
      "src",
      `${origin}/gallery-photo/1.svg`,
    );
    await expect(
      detail.getByRole("button", { name: "Ảnh tiếp theo", exact: true }),
    ).toHaveCount(0);
    await detail
      .getByRole("button", { name: "Chọn căn này", exact: true })
      .click();
    expect(
      await page.evaluate(
        async () =>
          (await import("/tests/browser/fixtures/coincident-host.tsx")).chosen,
      ),
    ).toEqual(["single-home"]);
    await detail
      .getByRole("button", { name: "Đóng chi tiết", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Xem Gallery fixture 3", exact: true })
      .click();
    await expect(
      detail.getByText("Chưa có ảnh", { exact: true }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    if (!page.isClosed())
      await page
        .evaluate(async () =>
          (
            await import("/tests/browser/fixtures/coincident-host.tsx")
          ).unmount(),
        )
        .catch(() => {});
  }
});
