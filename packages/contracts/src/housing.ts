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
export const PricePeriodSchema = z.enum(['night', 'day', 'week', 'month', 'year', 'total'])
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

export const LocationAccuracySchema = z.enum(['rooftop', 'approximate', 'unknown'])
export const DepositSchema = z.object({ amount: z.number().nonnegative(), currency: CurrencySchema })

const StringOrListSchema = <T extends z.ZodType>(item: T) =>
  z.union([item, z.array(item).min(1).max(50)])

export const CommuteConstraintSchema = z.object({
  destination: CoordinateSchema,
  max_duration_seconds: z.number().int().positive().max(86_400).optional(),
  max_distance_m: z.number().positive().max(100_000).optional(),
  min_distance_m: z.number().nonnegative().max(100_000).optional(),
  direction: z.enum(['listing_to_destination', 'destination_to_listing']).default('listing_to_destination'),
  profile: RouteProfileSchema.default('motorcycle'),
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
    for (const key of ['min_price', 'max_price'] as const) {
      const price = request[key]
      if (price && ((request.currency && price.currency !== request.currency) ||
          (request.price_period && price.period !== request.price_period))) {
        context.addIssue({ code: 'custom', message: 'Price bounds must match currency and price_period.', path: [key] })
      }
    }
    if ((request.center && !request.radius_m) || (!request.center && request.radius_m)) {
      context.addIssue({
        code: 'custom',
        message: 'center and radius_m must be provided together.',
        path: ['radius_m'],
      })
    }
    // Viewport AND proximity filter are both applied by the query layer.
    // Panning must not silently remove the user's radius.
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
  location_accuracy: LocationAccuracySchema,
  location_method: z.string().nullable(),
  deposit: DepositSchema.nullable(),
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
  thumbnail_url: z.url().nullable().default(null),
  matched_constraints: z.array(z.string()),
  unknown_fields: z.array(z.string()),
  quality_flags: z.array(z.string()).default([]),
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
  fees: z.array(z.object({
    code: z.string(),
    label: z.string(),
    amount: z.number().nonnegative().nullable(),
    billing_unit: z.enum(['month', 'one_time', 'kwh', 'm3', 'person_month', 'vehicle_month']),
    required: z.boolean(),
    refundable: z.boolean(),
  })).default([]),
  management: z.object({
    publication_status: z.enum(['draft', 'pending_review', 'published', 'hidden', 'rejected', 'deleted']),
    availability_status: z.enum(['vacant', 'rented', 'paused']),
    accepts_contact_requests: z.boolean(),
    availability_confirmed_at: z.iso.datetime().nullable(),
    // Poster label for tenants; identity fields stay private (host-mode-design §3.4).
    poster_type: z.enum(['owner', 'manager', 'broker', 'business']).nullable().default(null),
    poster_name: z.string().nullable().default(null),
    host_verified: z.boolean().default(false),
      host_rating: z.number().min(1).max(5).nullable().optional(),
      host_review_count: z.number().int().nonnegative().optional(),
  }).nullable().default(null),
})

export const HousingMapRequestSchema = z.object({
  bounding_box: BoundingBoxSchema,
  zoom: z.number().finite().min(0).max(24),
  // Omitted preserves existing clients; false requests individual listings.
  cluster: z.boolean().optional(),
  listing_ids: z.array(z.uuid()).min(1).max(2_000).optional(),
  property_type: z.array(PropertyTypeSchema).min(1).max(20).optional(),
  listing_type: z.array(ListingTypeSchema).min(1).max(10).optional(),
  text: HousingSearchRequestSchema.shape.text,
  district: HousingSearchRequestSchema.shape.district,
  administrative_area_ids: HousingSearchRequestSchema.shape.administrative_area_ids,
  center: HousingSearchRequestSchema.shape.center,
  radius_m: HousingSearchRequestSchema.shape.radius_m,
  min_price: HousingSearchRequestSchema.shape.min_price,
  max_price: HousingSearchRequestSchema.shape.max_price,
  currency: HousingSearchRequestSchema.shape.currency,
  price_period: HousingSearchRequestSchema.shape.price_period,
  min_bedrooms: HousingSearchRequestSchema.shape.min_bedrooms,
  max_bedrooms: HousingSearchRequestSchema.shape.max_bedrooms,
  min_bathrooms: HousingSearchRequestSchema.shape.min_bathrooms,
  min_area_m2: HousingSearchRequestSchema.shape.min_area_m2,
  max_area_m2: HousingSearchRequestSchema.shape.max_area_m2,
  amenities: HousingSearchRequestSchema.shape.amenities,
  availability_from: HousingSearchRequestSchema.shape.availability_from,
  availability_to: HousingSearchRequestSchema.shape.availability_to,
  verification_requirement: HousingSearchRequestSchema.shape.verification_requirement,
  source_filters: HousingSearchRequestSchema.shape.source_filters,
  nearby: HousingSearchRequestSchema.shape.nearby,
  limit: z.number().int().min(1).max(2_000).default(500),
}).strict().superRefine((request, context) => {
  // Reuse cross-field validation. Unsupported filters (e.g. commute) must not
  // silently disappear and turn an exploratory map into misleading matches.
  const result = HousingSearchRequestSchema.safeParse(request)
  if (!result.success) for (const issue of result.error.issues) {
    context.addIssue({ code: 'custom', message: issue.message, path: issue.path })
  }
})

export const HousingMapMarkerSchema = z.object({
  kind: z.literal('listing'),
  listing_id: z.uuid(),
  location: CoordinateSchema,
  title: z.string().min(1),
  property_type: PropertyTypeSchema,
  listing_type: ListingTypeSchema,
  price: MoneySchema,
  bedrooms: z.number().nonnegative().nullable(),
  bathrooms: z.number().nonnegative().nullable(),
  area_m2: z.number().positive().nullable(),
  address: z.record(z.string(), z.unknown()),
  amenities: z.array(z.string()),
  source_url: z.url().nullable(),
  thumbnail_url: z.url().nullable(),
  location_accuracy: z.enum(['rooftop', 'approximate', 'unknown']),
})

export const HousingMapClusterSchema = z.object({
  kind: z.literal('cluster'),
  cluster_id: z.string().min(1),
  location: CoordinateSchema,
  count: z.number().int().positive(),
  min_price_amount: z.number().nonnegative(),
  currency: CurrencySchema,
  price_period: PricePeriodSchema,
})

export const HousingMapResponseSchema = z.object({
  features: z.array(z.discriminatedUnion('kind', [HousingMapMarkerSchema, HousingMapClusterSchema])),
  meta: z.object({
    mode: z.enum(['clusters', 'listings']),
    returned_count: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
})

export type HousingSearchRequest = z.input<typeof HousingSearchRequestSchema>
export type ParsedHousingSearchRequest = z.output<typeof HousingSearchRequestSchema>
export type HousingSearchResponse = z.infer<typeof HousingSearchResponseSchema>
export type HousingSearchResult = z.infer<typeof HousingSearchResultSchema>
export type HousingDetail = z.infer<typeof HousingDetailSchema>
export type CommuteConstraint = z.infer<typeof CommuteConstraintSchema>
export type HousingMapRequest = z.infer<typeof HousingMapRequestSchema>
export type HousingMapResponse = z.infer<typeof HousingMapResponseSchema>
