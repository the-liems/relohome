import { z } from 'zod'
import {
  BoundingBoxSchema,
  CoordinateSchema,
  CursorPageSchema,
  SourceSchema,
  VerificationSchema,
} from './common.js'

export const PlaceMapRequestSchema = z.object({
  bounding_box: BoundingBoxSchema.refine(
    (box) => box.east - box.west <= 2 && box.north - box.south <= 2,
    'Map requests must cover at most 2 degrees per axis.',
  ),
})

export const PlaceSchema = z.object({
  place_id: z.uuid(),
  name: z.string().min(1).nullable(),
  category: z.string().min(1),
  location: CoordinateSchema,
  address: z.record(z.string(), z.unknown()).default({}),
  phone: z.string().nullable(),
  website: z.string().trim().min(1).nullable(),
  opening_hours: z.string().trim().min(1).nullable(),
  verification: VerificationSchema,
  source: SourceSchema,
  attributes: z.record(z.string(), z.unknown()).default({}),
})

export const PlaceSearchRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(200).optional(),
    categories: z.array(z.string().min(1)).min(1).max(50).optional(),
    administrative_area_ids: z.array(z.string().min(1)).min(1).max(50).optional(),
    bounding_box: BoundingBoxSchema.optional(),
    center: CoordinateSchema.optional(),
    radius_m: z.number().positive().max(100_000).optional(),
    verification_requirement: z.enum(['any', 'verified_only']).default('any'),
    source_filters: z.array(z.string().min(1)).min(1).max(20).optional(),
    pagination: CursorPageSchema.default({ limit: 25, cursor: null }),
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
  })

export const NearbyPlaceConstraintSchema = z.object({
  category: z.string().trim().min(1).max(100),
  max_distance_m: z.number().positive().max(100_000),
})

export const NearbyPlaceMatchSchema = z.object({
  place_id: z.uuid(),
  name: z.string().min(1).nullable(),
  category: z.string().min(1),
  distance_meters: z.number().nonnegative(),
  location: CoordinateSchema.nullable().default(null),
  distance_kind: z.literal('straight_line').default('straight_line'),
  verification: VerificationSchema,
  source: SourceSchema,
})

export type Place = z.infer<typeof PlaceSchema>
export type PlaceSearchRequest = z.infer<typeof PlaceSearchRequestSchema>
export type NearbyPlaceConstraint = z.infer<typeof NearbyPlaceConstraintSchema>
export type NearbyPlaceMatch = z.infer<typeof NearbyPlaceMatchSchema>
