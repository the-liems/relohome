// Real provider-layer check only, NOT browser GPS or canonical Housing DB E2E.
// Public reference coordinates, no user coordinates and no invented response.
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { RouteService } from '../../packages/housing-query/dist/route-service.js'
import { withinOperation } from '../../packages/housing-query/dist/execution.js'
import { resolvePublicDrivingOsrmUrl } from '../../packages/housing-query/dist/config.js'

if (process.env.RUN_DEVICE_ROUTE_LIVE !== '1') {
  console.log('Skipped: set RUN_DEVICE_ROUTE_LIVE=1 to make up to 3 read-only public OSRM requests.')
  process.exit(0)
}
// An actually closed local port tests real connection refusal, not a fetch stub.
const probe = createServer()
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
const local = `http://127.0.0.1:${probe.address().port}`
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
const profiles = { driving: local, motorcycle: local, walking: local }
const service = new RouteService({ hanoi: profiles, hcm: profiles, danang: profiles }, resolvePublicDrivingOsrmUrl(undefined))
const destination = { lng: 105.853, lat: 21.018 }
for (const [label, origin] of [
  ['hanoi-local-offline', { lng: 105.8432, lat: 21.0278 }],
  ['haiphong-outside-local', { lng: 106.6882, lat: 20.8449 }],
  ['hcm-long-distance', { lng: 106.7009, lat: 10.7769 }],
]) {
  const input = { profile: 'driving', origin, destination, snap_radius_m: 500 }
  const before = JSON.stringify(input), start = Date.now()
  const result = await withinOperation(() => service.calculateDeviceDriving(input, 'auto'), undefined, 20000)
  assert.equal(result.routing_provider, 'public_osrm')
  assert.equal(JSON.stringify(input), before)
  assert.ok(result.route.distance_meters > 0 && result.route.duration_seconds > 0)
  assert.ok(result.route.geometry.coordinates.length > 2)
  assert.ok(result.route.snap_distances_meters.every(distance => distance >= 0 && distance <= 500))
  if (label === 'hcm-long-distance') assert.ok(result.route.distance_meters > 1_000_000)
  console.log(JSON.stringify({ case: label, provider: result.routing_provider,
    distance_km: Math.round(result.route.distance_meters / 1000), elapsed_ms: Date.now() - start }))
}
