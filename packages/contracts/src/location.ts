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

const PositionSchema = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)])
const RingSchema = z.array(PositionSchema).min(4).refine(
  ring => Boolean(ring[0] && ring[ring.length - 1] && ring[0][0] === ring[ring.length - 1]![0] && ring[0][1] === ring[ring.length - 1]![1]),
  'Polygon rings must be closed.',
)
export const AreaGeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(RingSchema).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(RingSchema).min(1)).min(1) }),
])

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
  geometry: AreaGeometrySchema.optional(),
})

export const SearchAreasRequestSchema = z.object({
  text: z.string().trim().min(1).max(200),
  levels: z.array(z.string().trim().min(1)).min(1).max(20).optional(),
  bounding_box: BoundingBoxSchema.optional(),
  // Restrict candidates to a known administrative polygon before ranking/limit.
  within_area_id: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  // Render geometry only when requested, never in ordinary LLM lookups.
  include_geometry: z.boolean().default(false),
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
  // Additive display metadata; IDs and coordinate semantics remain unchanged.
  display_name: z.string().optional(),
  city: z.string().nullable().optional(),
  alias_ids: z.array(z.string()).optional(),
})

export const ResolveLocationResponseSchema = z.object({
  query: z.string().min(1),
  ambiguous: z.boolean(),
  results: z.array(ResolvedLocationSchema),
})

export type AdministrativeArea = z.infer<typeof AdministrativeAreaSchema>
export type SearchAreasRequest = z.input<typeof SearchAreasRequestSchema>
export type ResolveLocationRequest = z.infer<typeof ResolveLocationRequestSchema>
export type ResolvedLocation = z.infer<typeof ResolvedLocationSchema>
