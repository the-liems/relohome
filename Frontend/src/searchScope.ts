import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { Data } from "./types";

// This is the actual query envelope, not an invented administrative boundary.
export function searchScopeFeature(
  scope?: Data,
): Feature<Polygon | MultiPolygon> | null {
  const geometry = scope?.geometry;
  if (geometry) {
    if (!["Polygon", "MultiPolygon"].includes(geometry.type)) return null;
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.coordinates;
    const position = (p: unknown) =>
      Array.isArray(p) &&
      p.length === 2 &&
      p.every(Number.isFinite) &&
      Math.abs(p[0]) <= 180 &&
      Math.abs(p[1]) <= 90;
    if (
      Array.isArray(polygons) &&
      polygons.length &&
      polygons.every(
        (polygon: unknown) =>
          Array.isArray(polygon) &&
          polygon.length &&
          polygon.every(
            (ring: unknown) =>
              Array.isArray(ring) &&
              ring.length >= 4 &&
              ring.every(position) &&
              ring[0][0] === ring[ring.length - 1][0] &&
              ring[0][1] === ring[ring.length - 1][1],
          ),
      )
    ) {
      return {
        type: "Feature",
        properties: {
          basis: "administrative_boundary",
          area_id: scope?.area_id,
        },
        geometry,
      };
    }
    return null;
  }
  const center = scope?.center,
    radius = scope?.radius_m;
  if (
    center &&
    Number.isFinite(center.lat) &&
    Number.isFinite(center.lng) &&
    Number.isFinite(radius) &&
    radius > 0 &&
    Math.abs(center.lat) <= 90 &&
    Math.abs(center.lng) <= 180
  ) {
    const lat = (center.lat * Math.PI) / 180,
      lng = (center.lng * Math.PI) / 180;
    const angle = radius / 6371008.8;
    const ring = Array.from({ length: 65 }, (_, i) => {
      const bearing = ((i % 64) * Math.PI) / 32;
      const y = Math.asin(
        Math.sin(lat) * Math.cos(angle) +
          Math.cos(lat) * Math.sin(angle) * Math.cos(bearing),
      );
      const x =
        lng +
        Math.atan2(
          Math.sin(bearing) * Math.sin(angle) * Math.cos(lat),
          Math.cos(angle) - Math.sin(lat) * Math.sin(y),
        );
      return [(x * 180) / Math.PI, (y * 180) / Math.PI];
    });
    return {
      type: "Feature",
      properties: { basis: "search_radius" },
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  }
  const b = scope?.bounding_box;
  if (scope?.boundary_unavailable) return null;
  if (
    !b ||
    ![b.west, b.south, b.east, b.north].every(Number.isFinite) ||
    b.west >= b.east ||
    b.south >= b.north ||
    b.west < -180 ||
    b.east > 180 ||
    b.south < -90 ||
    b.north > 90
  )
    return null;
  return {
    type: "Feature",
    properties: { basis: "search_envelope_not_administrative_boundary" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [b.west, b.south],
          [b.east, b.south],
          [b.east, b.north],
          [b.west, b.north],
          [b.west, b.south],
        ],
      ],
    },
  };
}
