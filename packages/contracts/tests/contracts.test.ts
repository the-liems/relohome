import { describe, expect, it } from 'vitest'
import { HousingMapRequestSchema, HousingSearchRequestSchema, PricePeriodSchema } from '../src/housing.js'
import {
  ResolveLocationRequestSchema,
  SearchAreasRequestSchema,
} from '../src/location.js'
import { PlaceSearchRequestSchema } from '../src/place.js'
import { RouteRequestSchema } from '../src/route.js'

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
  it('accepts nightly accommodation prices', () => {
    expect(PricePeriodSchema.parse('night')).toBe('night')
  })

  it('accepts distance-only commute constraints and an explicit direction', () => {
    const commute = {
      destination: { lng: 105.8431, lat: 21.007 },
      min_distance_m: 1_000,
      max_distance_m: 2_000,
      direction: 'destination_to_listing',
    }
    const parsed = HousingSearchRequestSchema.parse({ commute }).commute
    expect(parsed).toMatchObject(commute)
    expect(parsed?.profile).toBe('motorcycle')
  })

  it.each([
    {},
    { max_distance_m: 0 },
    { min_distance_m: 1_000 },
    { max_distance_m: 2_000, min_distance_m: 3_000 },
    { max_distance_m: 2_000, direction: 'both' },
  ])('rejects invalid commute thresholds %j', (thresholds) => {
    expect(HousingSearchRequestSchema.safeParse({
      commute: { destination: { lng: 105.8431, lat: 21.007 }, ...thresholds },
    }).success).toBe(false)
  })

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

describe('HousingMapRequestSchema', () => {
  it('preserves supported search filters and validates their ranges', () => {
    const viewport = { bounding_box: { west: 106.6, south: 10.7, east: 106.8, north: 10.9 }, zoom: 12 }
    const filters = {
      district: 'Quận 7', administrative_area_ids: ['city:hcm'],
      min_price: { amount: 1, currency: 'VND', period: 'month' },
      max_price: { amount: 15_000_000, currency: 'VND', period: 'month' },
      currency: 'VND', price_period: 'month', min_bedrooms: 2, max_bedrooms: 3,
      min_bathrooms: 1, min_area_m2: 60, max_area_m2: 90, amenities: ['parking'],
      nearby: [{ category: 'hospital', max_distance_m: 1000 }],
    }
    expect(HousingMapRequestSchema.parse({ ...viewport, ...filters })).toMatchObject(filters)
    for (const invalid of [
      { min_bedrooms: 3, max_bedrooms: 2 },
      { min_area_m2: 90, max_area_m2: 60 },
      { ...filters, currency: 'USD' },
      { ...filters, price_period: 'night' },
      { ...filters, min_price: { amount: 20_000_000, currency: 'VND', period: 'month' } },
      { commute: { destination: { lat: 10.8, lng: 106.7 }, max_duration_seconds: 900 } },
      { listing_ids: [] },
    ]) expect(HousingMapRequestSchema.safeParse({ ...viewport, ...invalid }).success).toBe(false)
  })

  it('accepts viewport-driven map requests', () => {
    expect(HousingMapRequestSchema.parse({
      bounding_box: { west: 106.6, south: 10.7, east: 106.8, north: 10.9 },
      zoom: 13,
    })).toMatchObject({ zoom: 13, limit: 500 })
  })

  it('rejects unsafe map limits', () => {
    expect(HousingMapRequestSchema.safeParse({
      bounding_box: { west: 106.6, south: 10.7, east: 106.8, north: 10.9 },
      zoom: 13,
      limit: 10_000,
    }).success).toBe(false)
  })
})

describe('location contracts', () => {
  it('accepts accent-insensitive area search constraints', () => {
    expect(
      SearchAreasRequestSchema.parse({
        text: 'go vap',
        levels: ['6'],
        bounding_box: { west: 106.5, south: 10.7, east: 106.8, north: 11 },
      }),
    ).toMatchObject({ text: 'go vap', levels: ['6'], limit: 10 })
  })

  it('requires center and radius together when resolving a location', () => {
    expect(
      ResolveLocationRequestSchema.safeParse({
        text: 'Gò Vấp',
        center: { lng: 106.68, lat: 10.84 },
      }).success,
    ).toBe(false)
  })

  it('accepts canonical administrative area filters for place search', () => {
    expect(
      PlaceSearchRequestSchema.parse({
        administrative_area_ids: ['osm:relation:38522189'],
      }).administrative_area_ids,
    ).toEqual(['osm:relation:38522189'])
  })
})

describe('route contracts', () => {
  it('defaults to the motorcycle profile', () => {
    expect(
      RouteRequestSchema.parse({
        city: 'hcm',
        origin: { lng: 106.7009, lat: 10.7769 },
        destination: { lng: 106.7218, lat: 10.7952 },
      }).profile,
    ).toBe('motorcycle')
  })

  it.each(['driving', 'motorcycle', 'walking'] as const)('accepts the %s profile', (profile) => {
    expect(
      RouteRequestSchema.parse({
        city: 'hcm',
        origin: { lng: 106.7009, lat: 10.7769 },
        destination: { lng: 106.7218, lat: 10.7952 },
        profile,
      }).profile,
    ).toBe(profile)
  })
})
