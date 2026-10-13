// Opt-in, read-only live checks. Known public city-center coordinates are route
// inputs, NOT simulated browser GPS. Destination is read from the real database.
import assert from 'node:assert/strict'

if (process.env.RUN_DEVICE_ROUTE_LIVE !== '1') {
  console.log('Skipped: set RUN_DEVICE_ROUTE_LIVE=1 to allow up to 3 FOSSGIS public route requests.')
  process.exit(0)
}
const base = process.env.DEVICE_ROUTE_API_URL || 'http://127.0.0.1:4100/v1'
async function post(path, body) {
  const response = await fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25_000),
  })
  return { status: response.status, data: await response.json() }
}
const homes = await post('/housing/search', {
  listing_type: 'rent', price_period: 'month',
  bounding_box: { west: 105.9, east: 105.96, south: 20.98, north: 21.04 },
  pagination: { limit: 1 },
})
assert.equal(homes.status, 200)
const home = homes.data.results[0]
assert.ok(home?.listing_id, 'Requires at least one real Hanoi rental in the imported dataset')
const destination = { type: 'housing', listing_id: home.listing_id }
const hcm = { lng: 106.7009, lat: 10.7769 }
const denied = await post('/routes/device', { origin: { type: 'coordinate', location: hcm }, destination })
assert.equal(denied.status, 422)
assert.equal(denied.data.code, 'OUTSIDE_ROUTING_AREA')
console.log(JSON.stringify({ case: 'legacy_local_only', status: denied.status, code: denied.data.code }))
for (const [name, location] of [
  ['hanoi_to_actual_home', { lng: 105.8432, lat: 21.0278 }],
  ['hcm_to_hanoi_home', hcm],
  ['haiphong_to_hanoi_home', { lng: 106.6882, lat: 20.8449 }],
]) {
  const start = performance.now()
  const result = await post('/routes/device', {
    origin: { type: 'coordinate', location }, destination,
    routing_policy: 'auto', snap_radius_m: 500,
  })
  assert.equal(result.status, 200, `${name}: ${JSON.stringify(result.data)}`)
  const { route, origin, routing_provider } = result.data
  assert.ok(['local_osrm', 'public_osrm'].includes(routing_provider))
  if (name !== 'hanoi_to_actual_home') assert.equal(routing_provider, 'public_osrm')
  assert.deepEqual(origin.location, location, 'Input coordinate must not be replaced by a fabricated origin')
  assert.equal(result.data.destination.canonical_id, home.listing_id)
  assert.ok(route.distance_meters > 0 && route.duration_seconds > 0)
  assert.ok(route.geometry.coordinates.length > 2)
  assert.ok(route.snap_distances_meters.every((m) => m >= 0 && m <= 500))
  if (name === 'hcm_to_hanoi_home') assert.ok(route.distance_meters > 1_000_000)
  console.log(JSON.stringify({
    case: name, provider: routing_provider, listing_id: home.listing_id,
    km: Math.round(route.distance_meters / 100) / 10,
    minutes: Math.round(route.duration_seconds / 60),
    elapsed_ms: Math.round(performance.now() - start), snap_m: route.snap_distances_meters,
  }))
}
