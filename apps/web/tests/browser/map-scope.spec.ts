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

test("map allows nationwide Vietnam navigation and fits cross-city points", async ({
  page,
}) => {
  await page.route("**/web/api/**", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    // Exercise the real MapLibre camera with a local blank style; no tiles/providers needed.
    const { Map, LngLat, setWorkerUrl } =
      await import("/@id/maplibre-gl");
    const scope = await import("/src/mapScope.ts");
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;inset:0;z-index:10000";
    document.body.append(container);
    const map = new Map({
      container,
      style: { version: 8, sources: {}, layers: [] },
      ...scope.scopedMapOptions(container, "hcm"),
    });
    scope.installMapScope(map, "hcm");
    await new Promise<void>((resolve) => map.once("load", resolve));
    const checks: { city: string; action: string; contained: boolean }[] = [];
    function record(action: string) {
      const city = scope.mapCity(map),
        [sw, ne] = scope.VIETNAM_MAP_BOUNDS;
      const b = map.getBounds(),
        tolerance = 0.00001;
      checks.push({
        city,
        action,
        contained:
          b.getWest() >= sw[0] - tolerance &&
          b.getEast() <= ne[0] + tolerance &&
          b.getSouth() >= sw[1] - tolerance &&
          b.getNorth() <= ne[1] + tolerance,
      });
    }
    for (const city of ["hcm", "danang", "hanoi"] as const) {
      scope.setMapCity(map, city);
      for (const center of [
        [112, 16.5],
        [114, 10],
        [-100, 40],
        [0, 0],
      ]) {
        map.jumpTo({ center, zoom: 0 });
        record("outside-center/zoom-out");
      }
      for (const [width, height] of [
        [390, 844],
        [1440, 960],
        [3840, 2160],
      ]) {
        container.style.width = width + "px";
        container.style.height = height + "px";
        map.resize();
        map.setZoom(0);
        record("resize/zoom-out");
        map.panBy([100000, -100000], { duration: 0 });
        record("pan");
      }
    }
    container.style.width = "1000px";
    container.style.height = "960px";
    map.resize();
    // Both cities now remain in view instead of discarding a distant candidate.
    scope.fitMapPoints(
      map,
      [
        [105.84, 21.02],
        [106.7, 10.77],
      ],
      { duration: 0 },
    );
    record("cross-city-candidates");
    const fittedBounds = map.getBounds();
    const bothCitiesVisible = [
      [105.84, 21.02],
      [106.7, 10.77],
    ].every(
      ([lng, lat]) =>
        lng >= fittedBounds.getWest() - 1e-7 &&
        lng <= fittedBounds.getEast() + 1e-7 &&
        lat >= fittedBounds.getSouth() - 1e-7 &&
        lat <= fittedBounds.getNorth() + 1e-7,
    );
    const crossCityBounds = map.getBounds().toArray();
    await new Promise<void>((resolve) => {
      map.once("moveend", resolve);
      scope.focusMapPoint(map, [106.7, 10.77], 17);
    });
    const selectedCity = scope.mapCity(map);
    record("chosen-HCM-pin");
    await new Promise<void>((resolve) => {
      map.once("moveend", resolve);
      scope.focusMapPoint(map, [108.44, 11.946], 15);
    });
    const provincePointVisible =
      map.getCenter().distanceTo(new LngLat(108.44, 11.946)) < 1;
    const provinceCamera = {
      center: map.getCenter().toArray(),
      zoom: map.getZoom(),
    };
    const nationwideZoom = map.getMinZoom() < 8;
    scope.fitMapBox(
      map,
      { west: 107.7, south: 15.8, east: 108.8, north: 16.5 },
      { duration: 0 },
    );
    record("oversized-chat-area");
    const noCityButton = container.querySelector("select") === null;
    map.remove();
    container.remove();
    return {
      checks,
      selectedCity,
      noCityButton,
      bothCitiesVisible,
      crossCityBounds,
      provincePointVisible,
      provinceCamera,
      nationwideZoom,
    };
  });
  expect(result.checks.filter((c) => !c.contained)).toEqual([]);
  expect(result.selectedCity).toBe("hcm");
  expect(result.noCityButton).toBe(true);
  expect(result.bothCitiesVisible, JSON.stringify(result.crossCityBounds)).toBe(
    true,
  );
  expect(
    result.provincePointVisible,
    JSON.stringify(result.provinceCamera),
  ).toBe(true);
  expect(result.nationwideZoom).toBe(true);
});

test("moving preview uses OSRM geometry and never routes across cities", async ({
  page,
}) => {
  await page.route("**/web/api/**", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  const geometry = {
    type: "LineString",
    coordinates: [
      [106.698, 10.7725],
      [106.699, 10.774],
      [106.696, 10.777],
      [106.7, 10.78],
    ],
  };
  const calls: unknown[] = [];
  await page.route("**/web/api/platform/routes/entities", (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({ json: { route: { geometry } } });
  });
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const { loadMovingRoute } = await import("/src/movingRoute.ts");
    const pickup = { lng: 106.698, lat: 10.7725 },
      destination = { lng: 106.7, lat: 10.78 };
    const line = await loadMovingRoute(
      pickup,
      destination,
      new AbortController().signal,
    );
    let unsupported = false;
    try {
      await loadMovingRoute(
        pickup,
        { lng: 105.84, lat: 21.02 },
        new AbortController().signal,
      );
    } catch {
      unsupported = true;
    }
    return { line, unsupported, pickup, destination };
  });
  expect(result.line).toEqual(geometry);
  expect(result.unsupported).toBe(true);
  expect(calls).toEqual([
    {
      city: "hcm",
      profile: "driving",
      snap_radius_m: 100,
      origin: { type: "coordinate", location: result.pickup },
      destination: { type: "coordinate", location: result.destination },
    },
  ]);
});
