import { describe, expect, it } from 'vitest'
import { EntityRouteRequestSchema } from '../src/route.js'

const point = { type: 'coordinate', location: { lng: 106.7, lat: 10.77 } }
const request = { city: 'hcm', origin: point, destination: point }
describe('entity route request', () => {
  it('defaults to motorcycle and 100m snapping', () => {
    expect(EntityRouteRequestSchema.parse(request)).toMatchObject({ profile: 'motorcycle', snap_radius_m: 100 })
  })
  it.each([
    { ...request, origin: { type: 'housing', listing_id: 'not-a-uuid' } },
    { ...request, origin: { ...point, listing_id: '00000000-0000-4000-8000-000000000001' } },
    { ...request, city: 'hue' },
    { ...request, snap_radius_m: 1001 },
    { ...request, origin: { type: 'coordinate', location: { lng: 200, lat: 10 } } },
  ])('rejects ambiguous or invalid inputs', (input) => {
    expect(EntityRouteRequestSchema.safeParse(input).success).toBe(false)
  })
})
