import { z } from 'zod'
import {
  BoundingBoxSchema,
  CoordinateSchema,
  CursorPageSchema,
  SourceSchema,
  VerificationSchema,
} from './common.js'
import { NearbyPlaceConstraintSchema, NearbyPlaceMatchSchema } from './place.js'
import { RouteProfileSchema, RouteResultSchema } from './route.js'

export const CurrencySchema = z.enum(['VND', 'USD'])
export const PricePeriodSchema = z.enum(['day', 'week', 'month', 'year', 'total'])
export const ListingTypeSchema = z.enum(['rent', 'sale', 'short_stay'])
export const PropertyTypeSchema = z.enum([
  'apartment',
  'house',
  'room',
  'studio',
  'serviced_apartment',
  'homestay',
  'other',
])

export const MoneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: CurrencySchema,
  period: PricePeriodSchema,
})

const StringOrListSchema = <T extends z.ZodType>(item: T) =>
  z.union([item, z.array(item).min(1).max(50)])

export const CommuteConstraintSchema = z.object({
  destination: CoordinateSchema,
  max_duration_seconds: z.number().int().positive().max(86_400).optional(),
  max_distance_m: z.number().positive().max(100_000).optional(),
  min_distance_m: z.number().nonnegative().max(100_000).optional(),
  direction: z.enum(['listing_to_destination', 'destination_to_listing']).default('listing_to_destination'),
  profile: RouteProfileSchema.default('driving'),
  city: z.enum(['hcm', 'hanoi', 'danang']).optional(),
}).superRefine((commute, context) => {
  if (commute.max_duration_seconds === undefined && commute.max_distance_m === undefined) {
    context.addIssue({ code: 'custom', message: 'A commute requires a maximum duration or distance.', path: ['max_distance_m'] })
  }
  if (commute.min_distance_m !== undefined &&
      (commute.max_distance_m === undefined || commute.min_distance_m > commute.max_distance_m)) {
    context.addIssue({ code: 'custom', message: 'min_distance_m requires max_distance_m and cannot exceed it.', path: ['min_distance_m'] })
  }
})

export const HousingSortSchema = z.object({
  field: z.enum([
    'price_amount',
    'area_m2',
    'bedrooms',
    'created_at',
    'verified_at',
    'distance_meters',
  ]),
  direction: z.enum(['asc', 'desc']),
})

export const HousingSearchRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(300).optional(),
    property_type: StringOrListSchema(PropertyTypeSchema).optional(),
    listing_type: StringOrListSchema(ListingTypeSchema).optional(),
    district: z.string().trim().min(1).max(150).optional(),
    administrative_area_ids: z.array(z.string().min(1)).min(1).max(20).optional(),
    bounding_box: BoundingBoxSchema.optional(),
    center: CoordinateSchema.optional(),
    radius_m: z.number().positive().max(100_000).optional(),
    min_price: MoneySchema.optional(),
    max_price: MoneySchema.optional(),
    currency: CurrencySchema.optional(),
    price_period: PricePeriodSchema.optional(),
    min_bedrooms: z.number().int().nonnegative().max(100).optional(),
    max_bedrooms: z.number().int().nonnegative().max(100).optional(),
    min_bathrooms: z.number().nonnegative().max(100).optional(),
    min_area_m2: z.number().positive().max(1_000_000).optional(),
    max_area_m2: z.number().positive().max(1_000_000).optional(),
    amenities: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
    availability_from: z.iso.date().optional(),
    availability_to: z.iso.date().optional(),
    verification_requirement: z.enum(['any', 'verified_only']).default('any'),
    source_filters: z.array(z.string().min(1)).min(1).max(20).optional(),
    nearby: z.array(NearbyPlaceConstraintSchema).max(10).optional(),
    commute: CommuteConstraintSchema.optional(),
    pagination: CursorPageSchema.default({ limit: 25, cursor: null }),
    sort: z.array(HousingSortSchema).min(1).max(3).optional(),
    soft_preferences: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  })
  .superRefine((request, context) => {
    if ((request.center && !request.radius_m) || (!request.center && request.radius_m)) {
      context.addIssue({
        code: 'custom',
        message: 'center and radius_m must be provided together.',
        path: ['radius_m'],
      })
    }
    if (request.bounding_box && request.center) {
      context.addIssue({
        code: 'custom',
        message: 'Use either bounding_box or center/radius_m, not both.',
        path: ['bounding_box'],
      })
    }
    if (
      request.min_price &&
      request.max_price &&
      (request.min_price.currency !== request.max_price.currency ||
        request.min_price.period !== request.max_price.period)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'min_price and max_price must use the same currency and period.',
        path: ['max_price'],
      })
    }
    if (request.min_price && request.max_price && request.min_price.amount > request.max_price.amount) {
      context.addIssue({
        code: 'custom',
        message: 'min_price cannot exceed max_price.',
        path: ['min_price'],
      })
    }
    if (
      request.min_bedrooms !== undefined &&
      request.max_bedrooms !== undefined &&
      request.min_bedrooms > request.max_bedrooms
    ) {
      context.addIssue({
        code: 'custom',
        message: 'min_bedrooms cannot exceed max_bedrooms.',
        path: ['min_bedrooms'],
      })
    }
    if (
      request.min_area_m2 !== undefined &&
      request.max_area_m2 !== undefined &&
      request.min_area_m2 > request.max_area_m2
    ) {
      context.addIssue({
        code: 'custom',
        message: 'min_area_m2 cannot exceed max_area_m2.',
        path: ['min_area_m2'],
      })
    }
    if (
      request.availability_from &&
      request.availability_to &&
      request.availability_from > request.availability_to
    ) {
      context.addIssue({
        code: 'custom',
        message: 'availability_from cannot be after availability_to.',
        path: ['availability_from'],
      })
    }
  })

export const HousingSearchResultSchema = z.object({
  listing_id: z.uuid(),
  property_id: z.uuid(),
  unit_id: z.uuid().nullable(),
  offer_id: z.uuid(),
  place_id: z.uuid(),
  title: z.string().min(1),
  property_type: PropertyTypeSchema,
  listing_type: ListingTypeSchema,
  location: CoordinateSchema,
  address: z.record(z.string(), z.unknown()),
  price: MoneySchema,
  bedrooms: z.number().nonnegative().nullable(),
  bathrooms: z.number().nonnegative().nullable(),
  area: z
    .object({
      value: z.number().positive(),
      unit: z.literal('m2'),
    })
    .nullable(),
  amenities: z.array(z.string()),
  verification: VerificationSchema,
  source: SourceSchema,
  matched_constraints: z.array(z.string()),
  unknown_fields: z.array(z.string()),
  nearby: z.array(NearbyPlaceMatchSchema),
  commute: RouteResultSchema.nullable(),
  created_at: z.iso.datetime(),
  verified_at: z.iso.datetime().nullable(),
})

export const HousingSearchResponseSchema = z.object({
  query_id: z.uuid(),
  contract_version: z.literal('1.0.0'),
  results: z.array(HousingSearchResultSchema),
  page: z.object({
    next_cursor: z.string().nullable(),
    returned_count: z.number().int().nonnegative(),
  }),
  diagnostics: z.object({
    coarse_candidate_count: z.number().int().nonnegative(),
    commute_evaluated_count: z.number().int().nonnegative(),
    excluded_unknown_count: z.number().int().nonnegative(),
    candidate_limit_reached: z.boolean().default(false),
  }),
})

export const HousingDetailSchema = HousingSearchResultSchema.extend({
  description: z.string().nullable(),
  images: z.array(z.object({ url: z.url(), alt: z.string().nullable() })),
  extra_attributes: z.record(z.string(), z.unknown()),
})

export type HousingSearchRequest = z.input<typeof HousingSearchRequestSchema>
export type ParsedHousingSearchRequest = z.output<typeof HousingSearchRequestSchema>
export type HousingSearchResponse = z.infer<typeof HousingSearchResponseSchema>
export type HousingSearchResult = z.infer<typeof HousingSearchResultSchema>
export type HousingDetail = z.infer<typeof HousingDetailSchema>
export type CommuteConstraint = z.infer<typeof CommuteConstraintSchema>
