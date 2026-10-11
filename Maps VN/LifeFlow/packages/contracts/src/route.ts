import { z } from 'zod'
import { CoordinateSchema, SourceSchema } from './common.js'

export const RouteProfileSchema = z.enum(['driving', 'motorcycle', 'walking'])

export const RouteRequestSchema = z.object({
  city: z.enum(['hcm', 'hanoi', 'danang']),
  origin: CoordinateSchema,
  destination: CoordinateSchema,
  profile: RouteProfileSchema.default('motorcycle'),
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

export const RouteEndpointSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('housing'), listing_id: z.uuid() }).strict(),
  z.object({ type: z.literal('place'), place_id: z.uuid() }).strict(),
  z.object({ type: z.literal('coordinate'), location: CoordinateSchema }).strict(),
])

export const EntityRouteRequestSchema = z.object({
  city: z.enum(['hcm', 'hanoi', 'danang']),
  origin: RouteEndpointSchema,
  destination: RouteEndpointSchema,
  profile: RouteProfileSchema.default('motorcycle'),
  snap_radius_m: z.number().positive().max(1_000).default(100),
}).strict()

export const RouteEndpointResultSchema = z.object({
  type: z.enum(['housing', 'place', 'coordinate']),
  canonical_id: z.uuid().nullable(),
  location: CoordinateSchema,
  address: z.record(z.string(), z.unknown()).nullable(),
  location_accuracy: z.enum(['rooftop', 'approximate', 'unknown']),
  location_method: z.string().nullable(),
  source: SourceSchema.nullable(),
})

export const EntityRouteResponseSchema = z.object({
  city: z.enum(['hcm', 'hanoi', 'danang']),
  profile: RouteProfileSchema,
  origin: RouteEndpointResultSchema,
  destination: RouteEndpointResultSchema,
  route: RouteResultSchema,
  warnings: z.array(z.object({
    code: z.enum(['APPROXIMATE_LOCATION', 'UNKNOWN_LOCATION_ACCURACY']),
    endpoint: z.enum(['origin', 'destination']),
  })),
})

// Browser-only device directions. No city restriction or agent/MCP fallback;
// Modern browser callers explicitly select auto/local/public routing. Legacy
// requests without a policy remain local-only unless they opted into public.
export const DeviceRoutingPolicySchema = z.enum(['auto', 'local', 'public'])
export const DeviceRouteRequestSchema = z.object({
  origin: z.object({ type: z.literal('coordinate'), location: CoordinateSchema }).strict(),
  destination: z.object({ type: z.literal('housing'), listing_id: z.uuid() }).strict(),
  snap_radius_m: z.number().positive().max(1_000).default(100),
  public_routing_consent: z.boolean().default(false),
  routing_policy: DeviceRoutingPolicySchema.optional(),
}).strict()

export const DeviceRouteResponseSchema = EntityRouteResponseSchema.omit({ city: true }).extend({
  routing_provider: z.enum(['local_osrm', 'public_osrm']),
})

export type RouteEndpoint = z.infer<typeof RouteEndpointSchema>
export type RouteEndpointResult = z.infer<typeof RouteEndpointResultSchema>
export type DeviceRoutingPolicy = z.infer<typeof DeviceRoutingPolicySchema>
