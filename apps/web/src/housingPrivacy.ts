import type { Data } from "./types";
// The center is already obfuscated by the server. Never draw a public circle at a private coordinate.
export function housingPrivacyAreas(houses: Data[]) {
  const seen = new Set<string>();
  return {
    type: "FeatureCollection" as const,
    features: houses.flatMap((house) => {
      const radius = Number(
        house.privacy_radius_m ||
          (house.location_method === "privacy_radius_500" ? 500 : 0),
      );
      const lat = house.lat ?? house.location?.lat,
        lng = house.lng ?? house.location?.lng;
      if (
        !radius ||
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      )
        return [];
      const key = lat + ":" + lng + ":" + radius;
      if (seen.has(key)) return [];
      seen.add(key);
      const ring = Array.from({ length: 65 }, (_, i) => {
        const angle = (i / 64) * 2 * Math.PI;
        return [
          lng +
            (Math.cos(angle) * radius) /
              (111320 * Math.cos((lat * Math.PI) / 180)),
          lat + (Math.sin(angle) * radius) / 111320,
        ];
      });
      return [
        {
          type: "Feature" as const,
          properties: { radius_m: radius },
          geometry: { type: "Polygon" as const, coordinates: [ring] },
        },
      ];
    }),
  };
}
