import type { BoundingBox, Coordinate } from '@relohome/contracts'

/** A conservative proof of an EMPTY viewport ∩ geodesic-radius intersection.
 * Not a search boundary or distance estimate. Uncertain/polar/dateline cases
 * always fall through to PostGIS. Never trims a possibly valid listing.
 */
export function definitelyDisjointScope(request: { bounding_box?: BoundingBox; center?: Coordinate; radius_m?: number }): boolean {
  const { bounding_box: box, center, radius_m: radius } = request
  if (!box || !center || !radius) return false
  // Below the minimum WGS84 meridional radius: overestimates the angular extent.
  const angle = radius / 6_330_000
  if (angle >= Math.PI / 2) return false
  const degrees = 180 / Math.PI
  const latitudeExtent = angle * degrees
  if (box.south > center.lat + latitudeExtent || box.north < center.lat - latitudeExtent) return true
  if (Math.abs(center.lat) + latitudeExtent >= 90) return false
  const longitudeExtent = Math.asin(Math.sin(angle) / Math.cos(center.lat / degrees)) * degrees
  const west = center.lng - longitudeExtent, east = center.lng + longitudeExtent
  if (west < -180 || east > 180) return false
  return box.west > east || box.east < west
}
