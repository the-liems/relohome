import {
  PlaceSchema,
  PlaceMapRequestSchema,
  PlaceSearchRequestSchema,
  type Coordinate,
  type NearbyPlaceConstraint,
  type NearbyPlaceMatch,
  type Place,
  type PlaceSearchRequest,
} from '@lifeflow/contracts'
import type { QueryExecutor } from './database.js'
import { decodeCursor, encodeCursor } from './cursor.js'
import { QueryValidationError } from './errors.js'

interface SqlBuilder {
  values: unknown[]
  parameter(value: unknown): string
}

function createSqlBuilder(): SqlBuilder {
  const values: unknown[] = []
  return {
    values,
    parameter(value) {
      values.push(value)
      return `$${values.length}`
    },
  }
}

export class PlaceService {
  constructor(private readonly pool: QueryExecutor) {}

  async map(input: unknown) {
    const { bounding_box: box } = PlaceMapRequestSchema.parse(input)
    const result = await this.pool.query(
      `SELECT p.id, p.name, c.slug AS category, COALESCE(c.parent_slug, c.slug) AS poi_group,
              ST_X(p.geom) AS lng, ST_Y(p.geom) AS lat,
              p.address, p.phone, p.website, p.opening_hours
       FROM catalog.places p
       JOIN catalog.place_categories c ON c.id = p.category_id
       WHERE p.status = 'active' AND p.deleted_at IS NULL
         AND COALESCE(p.attributes->>'entity_role', '') <> 'housing_anchor'
         AND ST_Intersects(p.geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
       ORDER BY p.id
       LIMIT 50001`,
      [box.west, box.south, box.east, box.north],
    )
    if (result.rows.length > 50_000) {
      throw new QueryValidationError('Map area exceeds 50000 places; request a smaller bounding box.')
    }
    return {
      type: 'FeatureCollection',
      features: result.rows.map((row) => ({
        type: 'Feature',
        id: row.id,
        geometry: { type: 'Point', coordinates: [Number(row.lng), Number(row.lat)] },
        properties: {
          ...(row.address as Record<string, unknown> || {}),
          place_id: row.id,
          name: row.name,
          category: row.category,
          group: row.poi_group,
          phone: row.phone,
          website: row.website,
          opening_hours: row.opening_hours,
        },
      })),
    }
  }

  async search(input: PlaceSearchRequest) {
    const request = PlaceSearchRequestSchema.parse(input)
    const sql = createSqlBuilder()
    const conditions = [
      "p.status = 'active'",
      'p.deleted_at IS NULL',
      "COALESCE(p.attributes->>'entity_role', '') <> 'housing_anchor'",
    ]

    if (request.text) {
      const parameter = sql.parameter(`%${request.text}%`)
      conditions.push(`(p.name ILIKE ${parameter} OR p.address::text ILIKE ${parameter})`)
    }
    if (request.categories) {
      conditions.push(`c.slug = ANY(${sql.parameter(request.categories)}::text[])`)
    }
    if (request.administrative_area_ids) {
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM geo.administrative_areas area
          WHERE area.id = ANY(${sql.parameter(request.administrative_area_ids)}::text[])
            AND ST_Covers(area.geom, p.geom)
        )`,
      )
    }
    if (request.bounding_box) {
      const box = request.bounding_box
      conditions.push(
        `ST_Intersects(p.geom, ST_MakeEnvelope(${sql.parameter(box.west)}, ${sql.parameter(box.south)}, ${sql.parameter(box.east)}, ${sql.parameter(box.north)}, 4326))`,
      )
    }
    if (request.center && request.radius_m) {
      conditions.push(
        `ST_DWithin(p.geog, ST_SetSRID(ST_MakePoint(${sql.parameter(request.center.lng)}, ${sql.parameter(request.center.lat)}), 4326)::geography, ${sql.parameter(request.radius_m)})`,
      )
    }
    if (request.verification_requirement === 'verified_only') {
      conditions.push("p.verification_status <> 'unverified'")
    }
    if (request.source_filters) {
      conditions.push(
        `EXISTS (SELECT 1 FROM catalog.place_sources psf WHERE psf.place_id = p.id AND psf.source_type = ANY(${sql.parameter(request.source_filters)}::text[]))`,
      )
    }

    const offset = decodeCursor(request.pagination.cursor)
    const limitParameter = sql.parameter(request.pagination.limit + 1)
    const offsetParameter = sql.parameter(offset)
    const result = await this.pool.query(
      `SELECT
         p.id AS place_id,
         p.name,
         c.slug AS category,
         ST_X(p.geom) AS lng,
         ST_Y(p.geom) AS lat,
         p.address,
         p.phone,
         p.website,
         p.opening_hours,
         p.verification_status,
         p.verified_at,
         p.verified_by,
         p.attributes,
         source.source_type,
         source.source_id,
         source.source_url,
         source.observed_at
       FROM catalog.places p
       JOIN catalog.place_categories c ON c.id = p.category_id
       LEFT JOIN LATERAL (
         SELECT ps.source_type, ps.source_id, ps.source_url, ps.observed_at
         FROM catalog.place_sources ps
         WHERE ps.place_id = p.id
         ORDER BY ps.observed_at DESC, ps.id
         LIMIT 1
       ) source ON true
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.name ASC NULLS LAST, p.id ASC
       LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
      sql.values,
    )

    const hasNext = result.rows.length > request.pagination.limit
    const rows = result.rows.slice(0, request.pagination.limit)
    return {
      results: rows.map(rowToPlace),
      next_cursor: hasNext ? encodeCursor(offset + request.pagination.limit) : null,
    }
  }

  async get(placeId: string): Promise<Place | null> {
    const result = await this.pool.query(
      `SELECT
         p.id AS place_id,
         p.name,
         c.slug AS category,
         ST_X(p.geom) AS lng,
         ST_Y(p.geom) AS lat,
         p.address,
         p.phone,
         p.website,
         p.opening_hours,
         p.verification_status,
         p.verified_at,
         p.verified_by,
         p.attributes,
         source.source_type,
         source.source_id,
         source.source_url,
         source.observed_at
       FROM catalog.places p
       JOIN catalog.place_categories c ON c.id = p.category_id
       LEFT JOIN LATERAL (
         SELECT ps.source_type, ps.source_id, ps.source_url, ps.observed_at
         FROM catalog.place_sources ps
         WHERE ps.place_id = p.id
         ORDER BY ps.observed_at DESC, ps.id
         LIMIT 1
       ) source ON true
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [placeId],
    )
    return result.rowCount ? rowToPlace(result.rows[0]) : null
  }

  async findNearby(origin: Coordinate, constraints: NearbyPlaceConstraint[]): Promise<NearbyPlaceMatch[]> {
    const matches: NearbyPlaceMatch[] = []
    for (const constraint of constraints) {
      const result = await this.pool.query(
        `SELECT
           p.id AS place_id,
           p.name,
           c.slug AS category,
           ST_X(p.geom) AS lng, ST_Y(p.geom) AS lat,
           ST_Distance(
             p.geog,
             ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
           ) AS distance_meters,
           p.verification_status,
           p.verified_at,
           p.verified_by,
           source.source_type,
           source.source_id,
           source.source_url,
           source.observed_at
         FROM catalog.places p
         JOIN catalog.place_categories c ON c.id = p.category_id
         LEFT JOIN LATERAL (
           SELECT ps.source_type, ps.source_id, ps.source_url, ps.observed_at
           FROM catalog.place_sources ps
           WHERE ps.place_id = p.id
           ORDER BY ps.observed_at DESC, ps.id
           LIMIT 1
         ) source ON true
         WHERE p.status = 'active'
           AND p.deleted_at IS NULL
           AND COALESCE(p.attributes->>'entity_role', '') <> 'housing_anchor'
           AND c.slug = $3
           AND ST_DWithin(
             p.geog,
             ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
             $4
           )
         ORDER BY p.geog <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, p.id
         LIMIT 1`,
        [origin.lng, origin.lat, constraint.category, constraint.max_distance_m],
      )
      if (result.rowCount) matches.push(rowToNearbyMatch(result.rows[0]))
    }
    return matches
  }
}

function rowToPlace(row: Record<string, unknown>): Place {
  return PlaceSchema.parse({
    place_id: row.place_id,
    name: row.name,
    category: row.category,
    location: { lng: Number(row.lng), lat: Number(row.lat) },
    address: row.address || {},
    phone: row.phone,
    website: row.website,
    opening_hours: row.opening_hours ?? null,
    verification: {
      status: row.verification_status,
      verified_at: row.verified_at ? new Date(String(row.verified_at)).toISOString() : null,
      verified_by: row.verified_by,
    },
    source: sourceFromRow(row),
    attributes: row.attributes || {},
  })
}

function rowToNearbyMatch(row: Record<string, unknown>): NearbyPlaceMatch {
  return {
    place_id: String(row.place_id),
    name: row.name === null ? null : String(row.name),
    category: String(row.category),
    distance_meters: Number(row.distance_meters),
    location: { lng: Number(row.lng), lat: Number(row.lat) },
    distance_kind: 'straight_line',
    verification: {
      status: row.verification_status as NearbyPlaceMatch['verification']['status'],
      verified_at: row.verified_at ? new Date(String(row.verified_at)).toISOString() : null,
      verified_by: row.verified_by === null ? null : String(row.verified_by),
    },
    source: sourceFromRow(row),
  }
}

function sourceFromRow(row: Record<string, unknown>) {
  return {
    type: (row.source_type || 'import') as 'osm' | 'partner' | 'user' | 'lifeflow_admin' | 'import',
    source_id: String(row.source_id || row.place_id),
    source_url: row.source_url ? String(row.source_url) : null,
    observed_at: row.observed_at ? new Date(String(row.observed_at)).toISOString() : null,
  }
}
