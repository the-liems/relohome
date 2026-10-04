import type { LineString } from "geojson";
import { api } from "./api";
import { cityForPoint } from "./mapScope";

type Endpoint = { lat: number; lng: number };

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
  return geometry;
}
