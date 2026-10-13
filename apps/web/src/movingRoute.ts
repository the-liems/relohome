import type { LineString } from "geojson";
import { api } from "./api";
import { cityForPoint } from "./mapScope";

type Endpoint = { lat: number; lng: number };
const previews = new Map<string, { until: number; geometry: LineString }>();

/** Read-only route preview. AhaMove quotes, coordinates and bookings are untouched. */
export async function loadMovingRoute(
  pickup: Endpoint,
  destination: Endpoint,
  signal: AbortSignal,
): Promise<LineString> {
  const city = cityForPoint([pickup.lng, pickup.lat]);
  if (!city || city !== cityForPoint([destination.lng, destination.lat])) {
    throw new Error(
      "Tuyến đường chỉ hỗ trợ hai điểm trong cùng khu vực TP.HCM, Đà Nẵng hoặc Hà Nội.",
    );
  }
  const key = JSON.stringify([
    city,
    "driving",
    pickup.lat,
    pickup.lng,
    destination.lat,
    destination.lng,
  ]);
  const cached = previews.get(key);
  if (cached && cached.until > Date.now())
    return structuredClone(cached.geometry);
  const response = await api<{ route?: { geometry?: LineString } }>(
    "/platform/routes/entities",
    "POST",
    {
      city,
      profile: "driving",
      snap_radius_m: 100,
      origin: {
        type: "coordinate",
        location: { lat: pickup.lat, lng: pickup.lng },
      },
      destination: {
        type: "coordinate",
        location: { lat: destination.lat, lng: destination.lng },
      },
    },
    signal,
  );
  const geometry = response.route?.geometry;
  if (
    geometry?.type !== "LineString" ||
    geometry.coordinates.length < 2 ||
    geometry.coordinates.some(
      (p) => p.length !== 2 || !p.every(Number.isFinite),
    )
  ) {
    throw new Error("Chưa lấy được tuyến đường hợp lệ.");
  }
  // Only completed, validated OSRM geometry. Never cache AhaMove prices or orders here.
  previews.delete(key);
  previews.set(key, {
    until: Date.now() + 60_000,
    geometry: structuredClone(geometry),
  });
  if (previews.size > 16) previews.delete(previews.keys().next().value!);
  return geometry;
}
