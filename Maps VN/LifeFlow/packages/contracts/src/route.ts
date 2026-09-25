import { z } from 'zod'
import { CoordinateSchema } from './common.js'

export const RouteProfileSchema = z.enum(['driving', 'motorcycle', 'walking'])

export const RouteRequestSchema = z.object({
  city: z.enum(['hcm', 'hanoi', 'danang']),
  origin: CoordinateSchema,
  destination: CoordinateSchema,
  profile: RouteProfileSchema.default('driving'),
  steps: z.boolean().default(false),
  snap_radius_m: z.number().positive().max(1_000).optional(),
})

export const GeoJsonLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
})

export const RouteResultSchema = z.object({
  code: z.literal('Ok'),
  distance_meters: z.number().nonnegative(),
  duration_seconds: z.number().nonnegative(),
  geometry: GeoJsonLineStringSchema,
  snap_distances_meters: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).optional(),
})

export type RouteRequest = z.infer<typeof RouteRequestSchema>
export type RouteResult = z.infer<typeof RouteResultSchema>
