import { z } from 'zod'
import { BoundingBoxSchema, CoordinateSchema } from './common.js'

export const LocationMatchTypeSchema = z.enum(['exact', 'prefix', 'contains', 'fuzzy'])

export const AdministrativeAreaSourceSchema = z.object({
  type: z.enum(['osm', 'local_boundary', 'import']),
  source_id: z.string().min(1),
  source_url: z.url().nullable(),
})

export const AdministrativeAreaParentSchema = z.object({
  area_id: z.string().min(1),
  name: z.string().min(1),
  level: z.string().min(1),
})

export const AdministrativeAreaSchema = z.object({
  area_id: z.string().min(1),
  name: z.string().min(1),
  level: z.string().min(1),
  parent: AdministrativeAreaParentSchema.nullable(),
  center: CoordinateSchema,
  bounding_box: BoundingBoxSchema,
  source: AdministrativeAreaSourceSchema,
  match_type: LocationMatchTypeSchema,
  match_score: z.number().min(0).max(1),
  attributes: z.record(z.string(), z.unknown()).default({}),
})

export const SearchAreasRequestSchema = z.object({
  text: z.string().trim().min(1).max(200),
  levels: z.array(z.string().trim().min(1)).min(1).max(20).optional(),
  bounding_box: BoundingBoxSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
})

export const SearchAreasResponseSchema = z.object({
  query: z.string().min(1),
  results: z.array(AdministrativeAreaSchema),
})

export const ResolveLocationRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(200),
    entity_types: z
      .array(z.enum(['administrative_area', 'place']))
      .min(1)
      .max(2)
      .default(['administrative_area', 'place']),
    categories: z.array(z.string().trim().min(1)).min(1).max(50).optional(),
    levels: z.array(z.string().trim().min(1)).min(1).max(20).optional(),
    bounding_box: BoundingBoxSchema.optional(),
    center: CoordinateSchema.optional(),
    radius_m: z.number().positive().max(100_000).optional(),
    limit: z.number().int().min(1).max(50).default(10),
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

export const ResolvedLocationSourceSchema = z.object({
  type: z.enum(['osm', 'partner', 'user', 'lifeflow_admin', 'import', 'local_boundary']),
  source_id: z.string().min(1),
  source_url: z.url().nullable(),
})

export const ResolvedLocationSchema = z.object({
  entity_type: z.enum(['administrative_area', 'place']),
  canonical_id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1).nullable(),
  administrative_level: z.string().min(1).nullable(),
  location: CoordinateSchema,
  bounding_box: BoundingBoxSchema.nullable(),
  parent: AdministrativeAreaParentSchema.nullable(),
  source: ResolvedLocationSourceSchema,
  match_type: LocationMatchTypeSchema,
  match_score: z.number().min(0).max(1),
})

export const ResolveLocationResponseSchema = z.object({
  query: z.string().min(1),
  ambiguous: z.boolean(),
  results: z.array(ResolvedLocationSchema),
})

export type AdministrativeArea = z.infer<typeof AdministrativeAreaSchema>
export type SearchAreasRequest = z.infer<typeof SearchAreasRequestSchema>
export type ResolveLocationRequest = z.infer<typeof ResolveLocationRequestSchema>
export type ResolvedLocation = z.infer<typeof ResolvedLocationSchema>
