// Validation only; no fabricated GPS/provider response or network call.
import { describe, expect, it } from 'vitest'
import { DeviceRouteRequestSchema } from '../src/route.js'

const listingId = '00000000-0000-4000-8000-000000000001'
const input = {
  origin: { type: 'coordinate', location: { lat: 21.0278, lng: 105.8432 } },
  destination: { type: 'housing', listing_id: listingId },
}

describe('consented device route contract', () => {
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
  it('rejects an implicit consent string, unsafe radius, and client-provided destination coordinate', () => {
    for (const extra of [{ public_routing_consent: 'true' }, { snap_radius_m: 1001 }, { snap_radius_m: 0 },
      { destination: input.origin }, { provider_url: 'https://example.invalid/' }]) {
      expect(DeviceRouteRequestSchema.safeParse({ ...input, ...extra }).success).toBe(false)
    }
  })
})
