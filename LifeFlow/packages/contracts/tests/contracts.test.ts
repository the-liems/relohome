import { describe, expect, it } from 'vitest'
import { HousingSearchRequestSchema } from '../src/housing.js'

const validRequest = {
  administrative_area_ids: ['district_7'],
  listing_type: 'rent',
  max_price: { amount: 15_000_000, currency: 'VND', period: 'month' },
  min_bedrooms: 2,
  min_area_m2: 60,
  nearby: [{ category: 'hospital', max_distance_m: 3_000 }],
  commute: {
    destination: { lng: 106.7009, lat: 10.7769 },
    max_duration_seconds: 1_800,
    profile: 'driving',
  },
}

describe('HousingSearchRequestSchema', () => {
  it('accepts the agreed hard-constraint request', () => {
    expect(HousingSearchRequestSchema.parse(validRequest)).toMatchObject(validRequest)
  })

  it.each([
    ['negative price', { ...validRequest, max_price: { amount: -1, currency: 'VND', period: 'month' } }],
    ['unsupported currency', { ...validRequest, max_price: { amount: 1, currency: 'EUR', period: 'month' } }],
    ['invalid longitude', { ...validRequest, commute: { ...validRequest.commute, destination: { lng: 181, lat: 10 } } }],
    ['invalid latitude', { ...validRequest, commute: { ...validRequest.commute, destination: { lng: 106, lat: 91 } } }],
    ['negative radius', { center: { lng: 106, lat: 10 }, radius_m: -1 }],
    ['negative bedrooms', { min_bedrooms: -1 }],
    ['malformed bounding box', { bounding_box: { west: 107, south: 11, east: 106, north: 10 } }],
  ])('rejects %s', (_name, value) => {
    expect(HousingSearchRequestSchema.safeParse(value).success).toBe(false)
  })

  it('rejects mismatched price currency or period', () => {
    const result = HousingSearchRequestSchema.safeParse({
      min_price: { amount: 5_000_000, currency: 'VND', period: 'month' },
      max_price: { amount: 1_000, currency: 'USD', period: 'month' },
    })
    expect(result.success).toBe(false)
  })
})
