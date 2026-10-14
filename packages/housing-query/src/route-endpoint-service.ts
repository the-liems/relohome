import {
  DeviceRouteRequestSchema, DeviceRouteResponseSchema,
  EntityRouteRequestSchema, EntityRouteResponseSchema, RouteEndpointResultSchema,
  type RouteEndpoint, type RouteEndpointResult,
} from '@relohome/contracts'
import type { QueryExecutor } from './database.js'
import { NotFoundError } from './errors.js'
import { RouteService } from './route-service.js'
import { deviceRoutingPolicy } from './device-routing-policy.js'

/** Resolves only explicit identifiers; never selects a search candidate on behalf of a caller. */
export class RouteEndpointService {
  constructor(private readonly pool: QueryExecutor, private readonly routes: RouteService) {}

  async calculateDevice(input: unknown) {
    const request = DeviceRouteRequestSchema.parse(input)
    const origin = await this.resolve(request.origin, 'origin')
    const destination = await this.resolve(request.destination, 'destination')
    const routeInput = {
      profile: 'driving' as const, origin: origin.location, destination: destination.location,
      snap_radius_m: request.snap_radius_m, steps: false,
    }
    const routed = await this.routes.calculateDeviceDriving(routeInput, deviceRoutingPolicy(request))
    return DeviceRouteResponseSchema.parse({
      profile: 'driving', origin, destination, ...routed,
      warnings: (['origin', 'destination'] as const).flatMap((endpoint) => {
        const accuracy = (endpoint === 'origin' ? origin : destination).location_accuracy
        return accuracy === 'rooftop' ? [] : [{
          endpoint, code: accuracy === 'approximate' ? 'APPROXIMATE_LOCATION' : 'UNKNOWN_LOCATION_ACCURACY',
        }]
      }),
    })
  }

  async calculate(input: unknown) {
    const request = EntityRouteRequestSchema.parse(input)
    const origin = await this.resolve(request.origin, 'origin')
    const destination = await this.resolve(request.destination, 'destination')
    const route = await this.routes.calculate({
      city: request.city, profile: request.profile, origin: origin.location,
      destination: destination.location, snap_radius_m: request.snap_radius_m, steps: false,
    })
    const warnings = (['origin', 'destination'] as const).flatMap((endpoint) => {
      const accuracy = (endpoint === 'origin' ? origin : destination).location_accuracy
      return accuracy === 'rooftop' ? [] : [{
        endpoint,
        code: accuracy === 'approximate' ? 'APPROXIMATE_LOCATION' as const : 'UNKNOWN_LOCATION_ACCURACY' as const,
      }]
    })
    return EntityRouteResponseSchema.parse({ city: request.city, profile: request.profile, origin, destination, route, warnings })
  }

  private async resolve(endpoint: RouteEndpoint, side: string): Promise<RouteEndpointResult> {
    if (endpoint.type === 'coordinate') return {
      type: 'coordinate', canonical_id: null, location: endpoint.location, address: null,
      location_accuracy: 'unknown', location_method: null, source: null,
    }
    const housing = endpoint.type === 'housing'
    const id = housing ? endpoint.listing_id : endpoint.place_id
    // The two fixed query variants share output columns and never interpolate user-supplied SQL.
    const result = await this.pool.query(housing ? `
      SELECT l.id AS canonical_id, ST_X(cp.geom) AS lng, ST_Y(cp.geom) AS lat,
        cp.address, l.attributes, l.source_type, l.source_listing_id AS source_id,
        l.source_url, l.attributes->>'observed_at' AS observed_at
      FROM housing.listings l
      JOIN housing.properties p ON p.id = l.property_id
      JOIN catalog.places cp ON cp.id = p.place_id
      JOIN housing.current_offers o ON o.listing_id = l.id
      WHERE l.id = $1 AND NOT EXISTS(SELECT 1 FROM housing.managed_listing_visibility v WHERE v.listing_id=l.id AND NOT v.is_public) AND l.status = 'active' AND l.deleted_at IS NULL
        AND p.deleted_at IS NULL AND cp.status = 'active' AND cp.deleted_at IS NULL
    ` : `
      SELECT COALESCE(legacy.alias_place_id,cp.id) AS canonical_id,
        ST_X(COALESCE(legacy.legacy_geom,cp.geom)) AS lng, ST_Y(COALESCE(legacy.legacy_geom,cp.geom)) AS lat,
        cp.address, cp.attributes, s.source_type, s.source_id, s.source_url, s.observed_at
      FROM catalog.places cp
      LEFT JOIN catalog.poi_aliases legacy ON legacy.alias_place_id=$1 AND legacy.canonical_place_id=cp.id
      LEFT JOIN LATERAL (
        SELECT source_type, source_id, source_url, observed_at FROM catalog.place_sources
        WHERE place_id = cp.id ORDER BY observed_at DESC, id LIMIT 1
      ) s ON true
      WHERE cp.id = COALESCE((SELECT canonical_place_id FROM catalog.poi_aliases WHERE alias_place_id=$1),$1)
        AND cp.status = 'active' AND cp.deleted_at IS NULL
        AND COALESCE(cp.attributes->>'entity_role', '') <> 'housing_anchor'
    `, [id])
    const row = result.rows[0]
    if (!row) throw new NotFoundError(`${side}: active ${endpoint.type} not found: ${id}`)
    const attributes = row.attributes || {}
    return RouteEndpointResultSchema.parse({
      type: endpoint.type, canonical_id: row.canonical_id,
      location: { lng: Number(row.lng), lat: Number(row.lat) }, address: row.address || {},
      location_accuracy: ['rooftop', 'approximate'].includes(attributes.location_accuracy) ? attributes.location_accuracy : 'unknown',
      location_method: typeof attributes.location_method === 'string' ? attributes.location_method : null,
      source: row.source_type && row.source_id ? {
        type: row.source_type, source_id: row.source_id, source_url: row.source_url || null,
        observed_at: row.observed_at ? new Date(row.observed_at).toISOString() : null,
      } : null,
    })
  }
}
