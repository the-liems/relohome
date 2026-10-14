// Map workspace rules shared by the component and tests. Thresholds are data-driven (viewport count),
// not a fixed zoom: housing density differs ~10x between districts (see docs/integration report).
import type { Data, House } from "./types";

export const MAP_WORKSPACE = {
  // Show individual listings only when the current viewport holds at most this many (after filters).
  listMax: 500,
  // A specific request (few matches) is listed at any zoom; a vague one (many matches) is shown
  // as an area on the map until the user zooms in or adds criteria.
  specificMax: 50,
  // Below this zoom the viewport spans a whole city: always ask the user to zoom in.
  minZoom: 13,
  pageSize: 10,
  debounceMs: 350,
  // Map endpoint limit; a truncated response means "more than listMax".
  mapLimit: 500,
};

export const SORTS: { key: string; label: string; sort: Data[] }[] = [
  {
    key: "newest",
    label: "Mới đăng",
    sort: [{ field: "created_at", direction: "desc" }],
  },
  {
    key: "price_asc",
    label: "Giá thấp → cao",
    sort: [{ field: "price_amount", direction: "asc" }],
  },
  {
    key: "price_desc",
    label: "Giá cao → thấp",
    sort: [{ field: "price_amount", direction: "desc" }],
  },
  {
    key: "area_desc",
    label: "Diện tích lớn",
    sort: [{ field: "area_m2", direction: "desc" }],
  },
  {
    key: "verified",
    label: "Mới xác minh",
    sort: [{ field: "verified_at", direction: "desc" }],
  },
];

// Filters the Platform map/search endpoints both accept; anything else from chat is not applied here.
const AREA_FILTER_KEYS = [
  "currency",
  "price_period",
  "min_price",
  "max_price",
  "min_bedrooms",
  "max_bedrooms",
  "min_bathrooms",
  "min_area_m2",
  "max_area_m2",
  "district",
  "administrative_area_ids",
  "center",
  "radius_m",
  "amenities",
  "listing_type",
  "property_type",
  "availability_from",
  "availability_to",
  "verification_requirement",
  "source_filters",
  "nearby",
];

export function filtersFromSearch(request: Data | undefined): Data {
  const out: Data = {
    listing_type: "rent",
    currency: "VND",
    price_period: "month",
  };
  for (const key of AREA_FILTER_KEYS)
    if (request?.[key] !== undefined && request?.[key] !== null)
      out[key] = request[key];
  return out;
}

const asList = (v: unknown) =>
  v === undefined ? undefined : Array.isArray(v) ? v : [v];

export function mapRequest(
  filters: Data,
  bounding_box: Data,
  zoom: number,
): Data {
  return {
    ...filters,
    listing_type: asList(filters.listing_type),
    property_type: asList(filters.property_type),
    bounding_box,
    zoom,
    cluster: false,
    limit: MAP_WORKSPACE.mapLimit,
  };
}

export function searchRequest(
  filters: Data,
  bounding_box: Data,
  sortKey: string,
  cursor?: string | null,
): Data {
  return {
    ...filters,
    bounding_box,
    sort: (SORTS.find((s) => s.key === sortKey) || SORTS[0]).sort,
    pagination: { limit: MAP_WORKSPACE.pageSize, cursor: cursor || null },
  };
}

// Count listings in the viewport from the map response: cluster counts + individual markers.
// A truncated response means at least the limit, i.e. over the list threshold.
export function viewportCount(response: Data): number {
  if (response?.meta?.truncated) return MAP_WORKSPACE.listMax + 1;
  return (response?.features || []).reduce(
    (sum: number, f: Data) => sum + (f.kind === "cluster" ? f.count || 0 : 1),
    0,
  );
}

export function listMode(count: number, zoom: number): boolean {
  if (count <= MAP_WORKSPACE.specificMax) return true;
  return zoom >= MAP_WORKSPACE.minZoom && count <= MAP_WORKSPACE.listMax;
}

export function formatAddress(address: unknown): string {
  if (typeof address === "string") return address;
  const a = (address || {}) as Data;
  const parts = [a.housenumber, a.street, a.ward, a.district, a.city].filter(
    Boolean,
  );
  return parts.length ? parts.join(", ") : a.raw || "Chưa có địa chỉ";
}

// Normalise a Platform search result or map marker into the card shape. Coordinates are the
// provider's; `location_accuracy` tells whether they are exact.
export function toHouse(row: Data): House {
  return {
    ...row,
    id: row.listing_id || row.id,
    title: row.title,
    address: formatAddress(row.address),
    lat: row.location?.lat ?? row.lat,
    lng: row.location?.lng ?? row.lng,
    area_m2: row.area?.value ?? row.area_m2,
    exploratory: true,
  } as House;
}

export function individualListings(markers: House[]) {
  // One feature per listing; collision handling hides labels, not data.
  // Never invent offsets to separate approximate source coordinates.
  return markers
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng))
    .map((h) => ({ key: h.id, lat: h.lat!, lng: h.lng!, houses: [h] }));
}

// Display one counted pin only for exactly identical source coordinates. Keep
// original House objects/IDs; no proximity clustering, rounding or moved positions.
export function coincidentListings(markers: House[]) {
  const groups = new Map<
    string,
    { key: string; lat: number; lng: number; houses: House[] }
  >();
  const seen = new Set<string>();
  for (const h of markers) {
    if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng) || seen.has(h.id))
      continue;
    seen.add(h.id);
    const key = JSON.stringify([h.lat, h.lng]);
    let group = groups.get(key);
    if (!group) {
      group = { key, lat: h.lat!, lng: h.lng!, houses: [] };
      groups.set(key, group);
    }
    group.houses.push(h);
  }
  return [...groups.values()];
}

// Legacy helper for consumers still using coincident-pin grouping.
export function stackListings(
  markers: House[],
): { key: string; lat: number; lng: number; houses: House[] }[] {
  const groups = new Map<
    string,
    { key: string; lat: number; lng: number; houses: House[] }
  >();
  for (const h of markers) {
    if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng)) continue;
    const key = `${h.lat!.toFixed(5)},${h.lng!.toFixed(5)}`;
    const group = groups.get(key) || {
      key,
      lat: h.lat!,
      lng: h.lng!,
      houses: [],
    };
    group.houses.push(h);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function shortPrice(h: House): string {
  const amount = h.price?.amount ?? h.price_vnd;
  if (typeof amount !== "number") return "?";
  return amount >= 1_000_000
    ? `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)} tr`
    : `${Math.round(amount / 1000)}k`;
}

export function directionsUrl(h: House): string | undefined {
  return Number.isFinite(h.lat) && Number.isFinite(h.lng)
    ? `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`
    : undefined;
}
