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

test("dark map covers bridges and updates markers in place; light paint and camera survive toggling", async ({
  page,
}) => {
  await page.route("**/web/api/**", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const { Map, setWorkerUrl } = await import("/@id/maplibre-gl");
    const { tuneBasemap, registerMapImages, PILL } =
      await import("/src/mapStyle.ts");
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;inset:0;z-index:10000";
    document.body.append(container);
    document.documentElement.dataset.theme = "light";
    const map = new Map({
      container,
      center: [105.8, 21.03],
      zoom: 14,
      style: {
        version: 8,
        sources: {
          openmaptiles: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
          streets: {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [105.79, 21.02],
                      [105.81, 21.04],
                    ],
                  },
                },
              ],
            },
          },
        },
        layers: [
          {
            id: "highway-shield-non-us",
            type: "symbol",
            source: "openmaptiles",
            paint: { "text-color": "#777777", "text-halo-color": "#ffffff" },
          },
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#ffffff" },
          },
          ...[
            "highway_minor",
            "highway_major_inner",
            "highway_motorway_casing",
            "highway_motorway_inner",
            "highway_motorway_bridge_casing",
            "highway_motorway_bridge_inner",
            "tunnel_motorway_inner",
            "aeroway-runway",
            "railway_dashline",
            "route",
          ].map((id) => ({
            id,
            type: "line" as const,
            source: "streets",
            paint: {
              "line-color": id === "route" ? "#347fd6" : "#ffffff",
              "line-width": 3,
            },
          })),
        ],
      },
    });
    const errors: string[] = [];
    map.on("error", (e) => errors.push(e.error.message));
    await new Promise<void>((resolve) => map.once("load", resolve));
    tuneBasemap(map);
    registerMapImages(map);
    map.addLayer({
      id: "ws-listing",
      type: "symbol",
      source: "streets",
      layout: { "icon-image": PILL.normal },
      paint: { "text-color": "#0b675e" },
    });
    const colors = () =>
      Object.fromEntries(
        map
          .getStyle()
          .layers.filter((l) => l.type === "line")
          .map((l) => [l.id, map.getPaintProperty(l.id, "line-color")]),
      );
    const pixels = () => Array.from(map.getImage(PILL.normal)!.data!.data);
    const light = colors(),
      lightImage = pixels(),
      source = map.getSource("streets"),
      center = map.getCenter().toArray(),
      zoom = map.getZoom();
    document.documentElement.dataset.theme = "dark";
    window.dispatchEvent(new Event("siu:appearance-change"));
    const dark = colors(),
      darkImage = pixels(),
      darkText = map.getPaintProperty("ws-listing", "text-color");
    const darkShield = map.getPaintProperty(
      "highway-shield-non-us",
      "text-color",
    );
    const darkBackground = map.getPaintProperty(
      "background",
      "background-color",
    );
    document.documentElement.dataset.theme = "light";
    window.dispatchEvent(new Event("siu:appearance-change"));
    const restored = colors(),
      restoredImage = pixels();
    // Repeated toggles must restore exactly, rather than saving the dark paint as the original.
    document.documentElement.dataset.theme = "dark";
    window.dispatchEvent(new Event("siu:appearance-change"));
    document.documentElement.dataset.theme = "light";
    window.dispatchEvent(new Event("siu:appearance-change"));
    const unchanged =
      source === map.getSource("streets") &&
      JSON.stringify(center) === JSON.stringify(map.getCenter().toArray()) &&
      zoom === map.getZoom();
    const final = colors();
    map.remove();
    container.remove();
    return {
      light,
      dark,
      restored,
      final,
      darkBackground,
      darkShield,
      darkText,
      imageChanged: JSON.stringify(lightImage) !== JSON.stringify(darkImage),
      imageRestored:
        JSON.stringify(lightImage) === JSON.stringify(restoredImage),
      unchanged,
      errors,
    };
  });
  expect(result.dark.highway_motorway_bridge_inner).not.toBe("#ffffff");
  expect(result.dark.highway_motorway_casing).not.toBe("#ffffff");
  expect(result.dark.tunnel_motorway_inner).not.toBe("#ffffff");
  expect(result.dark["aeroway-runway"]).not.toBe("#ffffff");
  expect(result.dark.railway_dashline).not.toBe("#ffffff");
  expect(result.dark.route).toBe(result.light.route);
  expect(result.darkBackground).toBe("#182332");
  expect(result.darkShield).toBe("#263548");
  expect(JSON.stringify(result.darkText)).toContain("#c5f4e3");
  expect(result.imageChanged).toBe(true);
  expect(result.imageRestored).toBe(true);
  expect(result.restored).toEqual(result.light);
  expect(result.final).toEqual(result.light);
  expect(result.unchanged).toBe(true);
  expect(result.errors).toEqual([]);
});
