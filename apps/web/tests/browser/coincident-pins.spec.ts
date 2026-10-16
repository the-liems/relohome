import { expect, test } from "@playwright/test";

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

// Tiny synthetic SDF glyph fixture for real symbol placement/hit-testing offline.
// It is not a font-appearance or provider-data test.
function glyphFixture(start: number) {
  const varint = (value: number) => {
    const bytes: number[] = [];
    do {
      const byte = value & 127;
      value >>>= 7;
      bytes.push(byte | (value ? 128 : 0));
    } while (value);
    return Buffer.from(bytes);
  };
  const integer = (tag: number, value: number) =>
    Buffer.concat([varint(tag << 3), varint(value)]);
  const bytes = (tag: number, value: Buffer) =>
    Buffer.concat([varint((tag << 3) | 2), varint(value.length), value]);
  const glyphs = Array.from({ length: 256 }, (_, i) =>
    bytes(
      3,
      Buffer.concat([
        integer(1, start + i),
        bytes(2, Buffer.alloc(14 * 18, 180)),
        integer(3, 8),
        integer(4, 12),
        integer(5, 0),
        integer(6, 24),
        integer(7, 10),
      ]),
    ),
  );
  return bytes(1, Buffer.concat(glyphs));
}

test("shared marker counts homes and keeps distinct selection/comparison through hover and locale/theme changes", async ({
  page,
}) => {
  const homes = [2800000, 5000000, 7000000].map((amount, i) => ({
    id: `home-${i + 1}`,
    listing_id: `home-${i + 1}`,
    title: `Fixture home ${i + 1}`,
    lat: 21.03,
    lng: 105.8,
    location: { lat: 21.03, lng: 105.8 },
    price: { amount, currency: "VND", period: "month" },
    price_vnd: amount,
    location_accuracy: "approximate",
    address: { city: "Hà Nội", street: `Fixture street ${i + 1}` },
    bedrooms: 1,
    bathrooms: 1,
    area_m2: 30,
    amenities: [],
  }));
  const writes: string[] = [];
  await page.route("**/web/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/web/api",
      "",
    );
    const filters = route.request().postDataJSON() || {};
    const filtered = homes.filter(
      (h) =>
        !filters.max_price?.amount ||
        h.price.amount <= filters.max_price.amount,
    );
    if (
      route.request().method() !== "GET" &&
      !path.endsWith("/map") &&
      !path.endsWith("/search")
    )
      writes.push(path);
    const body =
      path === "/platform/housing/map"
        ? {
            features: filtered.map((h) => ({ kind: "listing", ...h })),
            meta: {
              mode: "listings",
              returned_count: filtered.length,
              truncated: false,
            },
          }
        : path === "/platform/housing/search"
          ? {
              results: filtered,
              page: { next_cursor: null, returned_count: filtered.length },
            }
          : path === "/platform/places/map"
            ? { type: "FeatureCollection", features: [] }
            : path === "/roommate/availability"
              ? { enabled: false, demo_enabled: false }
              : path.startsWith("/housing/")
                ? homes.find((h) => h.id === path.split("/").pop())
                : {};
    return route.fulfill({
      status: ["/session", "/status"].includes(path) ? 401 : 200,
      json: body,
    });
  });
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        glyphs: "http://127.0.0.1:5174/pin-glyphs/{fontstack}/{range}.pbf",
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
  await page.route("**/pin-glyphs/**", (route) => {
    const start = Number(
      new URL(route.request().url()).pathname.match(/\/(\d+)-\d+\.pbf$/)?.[1] ||
        0,
    );
    return route.fulfill({
      body: glyphFixture(start),
      contentType: "application/x-protobuf",
    });
  });
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto("/login");
  await page.evaluate(async () =>
    (await import("/tests/browser/fixtures/coincident-host.tsx")).mount(),
  );
  const pins = () =>
    page.evaluate(async () =>
      (await import("/tests/browser/fixtures/coincident-host.tsx")).pins(),
    );
  try {
    await expect
      .poll(async () => (await pins()).map((p: any) => p.properties.label))
      .toEqual(["3 căn"]);
    expect((await pins())[0].geometry.coordinates).toEqual([105.8, 21.03]);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { map } =
            await import("/tests/browser/fixtures/coincident-host.tsx");
          return map
            .queryRenderedFeatures({
              layers: ["ws-listing", "ws-listing-active"],
            })
            .some((f: any) => f.properties.label === "3 căn");
        }),
      )
      .toBe(true);
    const point = await page.evaluate(async () => {
      const { map } =
        await import("/tests/browser/fixtures/coincident-host.tsx");
      const position = map.project([105.8, 21.03]);
      const box = map.getCanvas().getBoundingClientRect();
      return { x: box.left + position.x, y: box.top + position.y };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#coincident-host .ws-list-head h2")).toHaveText(
      "3 căn chung điểm bản đồ",
    );
    const cards = page.locator("#coincident-host .ws-list-body article");
    await expect(cards).toHaveCount(3);
    await cards.nth(2).hover();
    await expect
      .poll(async () => (await pins())[0].properties.state)
      .toBe("hover");
    await expect
      .poll(async () => (await pins())[0].properties.label)
      .toBe("3 căn");
    await cards
      .nth(1)
      .getByRole("button", { name: "Chọn căn này", exact: true })
      .click();
    expect(
      await page.evaluate(
        async () =>
          (await import("/tests/browser/fixtures/coincident-host.tsx")).chosen,
      ),
    ).toEqual(["home-2"]);
    await expect
      .poll(async () => (await pins())[0].properties.state)
      .toBe("selected");
    await expect
      .poll(async () => (await pins())[0].properties.label)
      .toBe("3 căn");
    await cards
      .nth(0)
      .getByRole("button", {
        name: "Thêm so sánh: Fixture home 1",
        exact: true,
      })
      .click();
    await cards
      .nth(2)
      .getByRole("button", {
        name: "Thêm so sánh: Fixture home 3",
        exact: true,
      })
      .click();
    await expect(
      page.locator("#coincident-host .ws-comparison-tray li"),
    ).toHaveCount(2);
    await expect(
      page.locator("#coincident-host .ws-comparison-tray"),
    ).toContainText("Fixture home 1");
    await expect(
      page.locator("#coincident-host .ws-comparison-tray"),
    ).toContainText("Fixture home 3");
    await page.evaluate(async () => {
      const host = await import("/tests/browser/fixtures/coincident-host.tsx");
      host.locale("en");
      host.theme("dark");
    });
    await expect
      .poll(async () => (await pins())[0].properties.label)
      .toBe("3 homes");
    await expect(page.locator("#coincident-host .ws-list-head h2")).toHaveText(
      "3 homes sharing a map pin",
    );
    expect((await pins())[0].geometry.coordinates).toEqual([105.8, 21.03]);
    // Mobile intentionally collapses filter controls behind the filter toggle.
    if (
      !(await page
        .locator("#coincident-host .ws-filterbar select")
        .first()
        .isVisible())
    ) {
      await page.locator("#coincident-host .ws-filter-toggle").click();
    }
    await page
      .locator("#coincident-host .ws-filterbar select")
      .first()
      .selectOption("5000000");
    await expect
      .poll(async () => (await pins())[0].properties.label)
      .toBe("2 homes");
    await expect(cards).toHaveCount(2);
    await expect(page.locator("#coincident-host .ws-list-head h2")).toHaveText(
      "2 homes sharing a map pin",
    );
    await page
      .locator("#coincident-host .ws-filterbar select")
      .first()
      .selectOption("3000000");
    await expect
      .poll(async () => (await pins())[0].properties.label)
      .toBe("2.8 tr");
    await expect(cards).toHaveCount(1);
    expect(
      await page.evaluate(
        async () =>
          (await import("/tests/browser/fixtures/coincident-host.tsx")).chosen,
      ),
    ).toEqual(["home-2"]);
    expect(writes).toEqual([]);
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
