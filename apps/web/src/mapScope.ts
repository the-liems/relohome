import type { FitBoundsOptions, Map, MapOptions } from "maplibre-gl";

export type MapCity = "hcm" | "danang" | "hanoi";
export type MapPoint = [number, number];
type Box = { west: number; south: number; east: number; north: number };

// Routing coverage stays separate from the nationwide display envelope.
// These service boxes are the same as ReloHome/OSRM, not camera limits.
export const MAP_CITIES: Record<
  MapCity,
  {
    label: string;
    center: MapPoint;
    bounds: [MapPoint, MapPoint];
  }
> = {
  hcm: {
    label: "TP.HCM",
    center: [106.7009, 10.7769],
    bounds: [
      [106.34, 10.34],
      [107.05, 11.2],
    ],
  },
  danang: {
    label: "Đà Nẵng",
    center: [108.2208, 16.0678],
    bounds: [
      [107.78, 15.88],
      [108.42, 16.3],
    ],
  },
  hanoi: {
    label: "Hà Nội",
    center: [105.8432, 21.0278],
    bounds: [
      [105.28, 20.55],
      [106.04, 21.4],
    ],
  },
};

// A display envelope covering Vietnam, including the offshore overview.
// This rectangle is not an administrative or territorial boundary polygon.
export const VIETNAM_MAP_BOUNDS: [MapPoint, MapPoint] = [
  [101, 7],
  [118, 24.5],
];

export function withinVietnamView(point: readonly number[]) {
  const [sw, ne] = VIETNAM_MAP_BOUNDS;
  return (
    point.length >= 2 &&
    point.every(Number.isFinite) &&
    point[0] >= sw[0] &&
    point[0] <= ne[0] &&
    point[1] >= sw[1] &&
    point[1] <= ne[1]
  );
}

export function cityForPoint(point: readonly number[]): MapCity | undefined {
  return (Object.keys(MAP_CITIES) as MapCity[]).find((id) => {
    const [sw, ne] = MAP_CITIES[id].bounds;
    return (
      point[0] >= sw[0] &&
      point[0] <= ne[0] &&
      point[1] >= sw[1] &&
      point[1] <= ne[1]
    );
  });
}

export function cityForBox(
  box?: Box | null,
  fallback: MapCity = "hcm",
): MapCity {
  if (!box) return fallback;
  // Use overlap rather than requiring an administrative area's center to be
  // inside the service envelope (post-2025 administrative areas can be larger).
  let best = fallback,
    area = 0;
  for (const id of Object.keys(MAP_CITIES) as MapCity[]) {
    const [sw, ne] = MAP_CITIES[id].bounds;
    const overlap =
      Math.max(0, Math.min(box.east, ne[0]) - Math.max(box.west, sw[0])) *
      Math.max(0, Math.min(box.north, ne[1]) - Math.max(box.south, sw[1]));
    if (overlap > area) {
      area = overlap;
      best = id;
    }
  }
  return best;
}

function mercatorY(lat: number) {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

export function scopeMinZoom(width: number, height: number) {
  const [sw, ne] = VIETNAM_MAP_BOUNDS;
  const x = (ne[0] - sw[0]) / 360;
  const y = (mercatorY(ne[1]) - mercatorY(sw[1])) / (2 * Math.PI);
  // Include a small margin so a large/resized viewport stays wholly inside.
  return Math.max(
    4,
    Math.log2(Math.max(width / (512 * x), height / (512 * y))) + 0.05,
  );
}

export function scopedMapOptions(
  container: HTMLElement,
  city: MapCity,
  viewport?: { center: MapPoint; zoom: number } | null,
): Partial<MapOptions> {
  const minZoom = scopeMinZoom(container.clientWidth, container.clientHeight);
  return {
    center:
      viewport && withinVietnamView(viewport.center)
        ? viewport.center
        : MAP_CITIES[city].center,
    zoom: Math.max(minZoom, viewport?.zoom ?? 13),
    minZoom,
    maxBounds: VIETNAM_MAP_BOUNDS,
    renderWorldCopies: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    bearing: 0,
    pitch: 0,
  };
}

const scopes = new WeakMap<Map, { city: MapCity }>();
export function mapCity(map: Map): MapCity {
  return scopes.get(map)?.city ?? "hcm";
}

export function setMapCity(map: Map, city: MapCity) {
  const scope = scopes.get(map);
  if (!scope || scope.city === city) return;
  scope.city = city;
}

export function installMapScope(map: Map, city: MapCity) {
  scopes.set(map, { city });
  map.touchZoomRotate.disableRotation();
  const resize = () => {
    const zoom = scopeMinZoom(
      map.getContainer().clientWidth,
      map.getContainer().clientHeight,
    );
    if (Math.abs(zoom - map.getMinZoom()) > 0.001) map.setMinZoom(zoom);
  };
  const observer = new ResizeObserver(() => {
    const canvas = map.getCanvas(),
      container = map.getContainer();
    // An initial/redundant resize interrupts MapLibre camera animations.
    if (
      canvas.clientWidth !== container.clientWidth ||
      canvas.clientHeight !== container.clientHeight
    )
      map.resize();
  });
  observer.observe(map.getContainer());
  map.on("resize", resize);
  map.on("remove", () => {
    observer.disconnect();
    map.off("resize", resize);
    scopes.delete(map);
  });
}

export function focusMapPoint(map: Map, point: MapPoint, zoom = 17) {
  if (!withinVietnamView(point)) return;
  const city = cityForPoint(point);
  if (city) setMapCity(map, city);
  map.easeTo({ center: point, zoom });
}

export function fitMapPoints(
  map: Map,
  points: readonly (readonly number[])[],
  options: FitBoundsOptions = {},
) {
  const visible = points.filter(withinVietnamView);
  if (!visible.length) return;
  const city = visible.map(cityForPoint).find((id) => id !== undefined);
  if (city) setMapCity(map, city);
  const xs = visible.map((p) => p[0]),
    ys = visible.map((p) => p[1]);
  map.fitBounds(
    [
      [Math.min(...xs), Math.min(...ys)],
      [Math.max(...xs), Math.max(...ys)],
    ],
    { maxZoom: 16, ...options },
  );
}

export function fitMapBox(map: Map, box: Box, options: FitBoundsOptions = {}) {
  const city = cityForBox(box, mapCity(map));
  setMapCity(map, city);
  const [sw, ne] = VIETNAM_MAP_BOUNDS;
  const west = Math.max(sw[0], box.west),
    south = Math.max(sw[1], box.south);
  const east = Math.min(ne[0], box.east),
    north = Math.min(ne[1], box.north);
  if (west >= east || south >= north) return;
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { maxZoom: 16, ...options },
  );
}
