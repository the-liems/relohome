// Validation only; no fabricated GPS/provider response or network call.
import { describe, expect, it } from 'vitest'
import { DeviceRouteRequestSchema } from '../src/route.js'

const listingId = '00000000-0000-4000-8000-000000000001'
const input = {
  origin: { type: 'coordinate', location: { lat: 21.0278, lng: 105.8432 } },
  destination: { type: 'housing', listing_id: listingId },
}

describe('browser device route contract', () => {
  it('never defaults to external routing and keeps the supplied coordinate', () => {
    const request = DeviceRouteRequestSchema.parse(input)
    expect(request.public_routing_consent).toBe(false)
    expect(request.snap_radius_m).toBe(100)
    expect(request.origin.location).toEqual(input.origin.location)
  })
  it('accepts an explicit consent and a bounded radius without a city restriction', () => {
    expect(DeviceRouteRequestSchema.parse({ ...input, public_routing_consent: true, snap_radius_m: 500 }))
      .toMatchObject({ public_routing_consent: true, snap_radius_m: 500 })
  })
  it('accepts explicit browser routing policies without rewriting input coordinates', () => {
    for (const policy of ['auto', 'local', 'public']) {
      const request = DeviceRouteRequestSchema.parse({ ...input, routing_policy: policy })
      expect(request.routing_policy).toBe(policy)
      expect(request.origin.location).toEqual(input.origin.location)
      expect(request.snap_radius_m).toBe(100)
    }
    for (const policy of ['unknown', '', null, true])
      expect(DeviceRouteRequestSchema.safeParse({ ...input, routing_policy: policy }).success).toBe(false)
  })
  it('rejects an implicit consent string, unsafe radius, and client-provided destination coordinate', () => {
    for (const extra of [{ public_routing_consent: 'true' }, { snap_radius_m: 1001 }, { snap_radius_m: 0 },
      { destination: input.origin }, { provider_url: 'https://example.invalid/' }]) {
      expect(DeviceRouteRequestSchema.safeParse({ ...input, ...extra }).success).toBe(false)
    }
  })
})
