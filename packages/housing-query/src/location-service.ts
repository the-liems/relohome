import {
  AdministrativeAreaSchema,
  ResolveLocationRequestSchema,
  ResolvedLocationSchema,
  SearchAreasRequestSchema,
  type AdministrativeArea,
  type ResolveLocationRequest,
  type ResolvedLocation,
  type SearchAreasRequest,
} from '@relohome/contracts'
import type { QueryExecutor } from './database.js'
import { poiDisplayName } from './poi-label.js'

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

const matchRank: Record<ResolvedLocation['match_type'], number> = {
  exact: 4,
  prefix: 3,
  contains: 2,
  fuzzy: 1,
}

export class LocationService {
  constructor(private readonly pool: QueryExecutor) {}

  async searchAreas(input: SearchAreasRequest) {
    const request = SearchAreasRequestSchema.parse(input)
    const sql = createSqlBuilder()
    const textParameter = sql.parameter(request.text)
    const conditions: string[] = [
      `(geo.normalize_search(a.name) LIKE '%' || q.value || '%'
        OR geo.normalize_search(a.name) % q.value)`,
    ]

    if (request.levels) {
      conditions.push(`a.level = ANY(${sql.parameter(request.levels)}::text[])`)
    }
    if (request.within_area_id) {
      // A city's bbox can include neighbouring provinces or gaps between islands.
      // Match the same representative-point membership used for the returned parent.
      conditions.push(`EXISTS (
        SELECT 1 FROM geo.administrative_areas scope
        WHERE scope.id = ${sql.parameter(request.within_area_id)}
          AND ST_Covers(scope.geom, ST_PointOnSurface(a.geom))
      )`)
    }
    if (request.bounding_box) {
      const box = request.bounding_box
      conditions.push(
        `ST_Intersects(
          a.geom,
          ST_MakeEnvelope(
            ${sql.parameter(box.west)},
            ${sql.parameter(box.south)},
            ${sql.parameter(box.east)},
            ${sql.parameter(box.north)},
            4326
          )
        )`,
      )
    }
    const limitParameter = sql.parameter(request.limit)
    const result = await this.pool.query(
      `WITH q AS (
         SELECT geo.normalize_search(${textParameter}::text) AS value
       ), matched AS (
         SELECT
           a.*,
           geo.normalize_search(a.name) AS normalized_name,
           similarity(geo.normalize_search(a.name), q.value) AS match_score,
           CASE
             WHEN geo.normalize_search(a.name) = q.value THEN 'exact'
             WHEN geo.normalize_search(a.name) LIKE q.value || '%' THEN 'prefix'
             WHEN geo.normalize_search(a.name) LIKE '%' || q.value || '%' THEN 'contains'
             ELSE 'fuzzy'
           END AS match_type,
           CASE
             WHEN geo.normalize_search(a.name) = q.value THEN 4
             WHEN geo.normalize_search(a.name) LIKE q.value || '%' THEN 3
             WHEN geo.normalize_search(a.name) LIKE '%' || q.value || '%' THEN 2
             ELSE 1
           END AS match_rank
         FROM geo.administrative_areas a
         CROSS JOIN q
         WHERE ${conditions.join(' AND ')}
       )
       SELECT
         a.id AS area_id,
         a.name,
         a.level,
         a.source,
         a.source_id,
         a.attributes,
         a.match_type,
         a.match_score,
         ${request.include_geometry ? 'ST_AsGeoJSON(a.geom, 7)::jsonb' : 'NULL::jsonb'} AS geometry,
         ST_X(ST_PointOnSurface(a.geom)) AS center_lng,
         ST_Y(ST_PointOnSurface(a.geom)) AS center_lat,
         ST_XMin(Box2D(a.geom)) AS west,
         ST_YMin(Box2D(a.geom)) AS south,
         ST_XMax(Box2D(a.geom)) AS east,
         ST_YMax(Box2D(a.geom)) AS north,
         parent.id AS parent_id,
         parent.name AS parent_name,
         parent.level AS parent_level
       FROM matched a
       LEFT JOIN LATERAL (
         SELECT candidate.id, candidate.name, candidate.level
         FROM geo.administrative_areas candidate
         WHERE candidate.id <> a.id
           AND candidate.level ~ '^[0-9]+$'
           AND a.level ~ '^[0-9]+$'
           AND candidate.level::integer < a.level::integer
           AND ST_Covers(candidate.geom, ST_PointOnSurface(a.geom))
         ORDER BY candidate.level::integer DESC, ST_Area(candidate.geom) ASC, candidate.id
         LIMIT 1
       ) parent ON true
       ORDER BY
         a.match_rank DESC,
         a.match_score DESC,
         CASE WHEN a.level ~ '^[0-9]+$' THEN a.level::integer ELSE 999 END,
         a.name,
         a.id
       LIMIT ${limitParameter}`,
      sql.values,
    )

    return {
      query: request.text,
      results: result.rows.map(rowToArea),
    }
  }

  async resolve(input: ResolveLocationRequest) {
    const request = ResolveLocationRequestSchema.parse(input)
    const includeAreas = request.entity_types.includes('administrative_area')
    const includePlaces = request.entity_types.includes('place')
    const [areaResponse, places] = await Promise.all([
      includeAreas
        ? this.searchAreas({
            text: request.text,
            levels: request.levels,
            bounding_box: request.bounding_box,
            limit: request.limit,
            include_geometry: false,
          })
        : Promise.resolve({ query: request.text, results: [] as AdministrativeArea[] }),
      includePlaces ? this.resolvePlaces(request) : Promise.resolve([]),
    ])

    const results: ResolvedLocation[] = [
      ...areaResponse.results.map(areaToResolvedLocation),
      ...places,
    ]
      .sort(
        (left, right) =>
          matchRank[right.match_type] - matchRank[left.match_type] ||
          right.match_score - left.match_score ||
          Number(left.entity_type === 'place') - Number(right.entity_type === 'place') ||
          left.name.localeCompare(right.name, 'vi') ||
          left.canonical_id.localeCompare(right.canonical_id),
      )
      .slice(0, request.limit)

    return {
      query: request.text,
      ambiguous: results.length > 1,
      results,
    }
  }

  private async resolvePlaces(request: ResolveLocationRequest): Promise<ResolvedLocation[]> {
    const sql = createSqlBuilder()
    const textParameter = sql.parameter(request.text)
    const conditions = [
      "p.status = 'active'",
      'p.deleted_at IS NULL',
      "COALESCE(p.attributes->>'entity_role', '') <> 'housing_anchor'",
      'p.name IS NOT NULL',
      `(geo.normalize_search(p.name) LIKE '%' || q.value || '%'
        OR geo.normalize_search(p.name) % q.value
        OR geo.normalize_search(p.address::text) LIKE '%' || q.value || '%')`,
    ]

    if (request.categories) {
      conditions.push(`c.slug = ANY(${sql.parameter(request.categories)}::text[])`)
    }
    if (request.bounding_box) {
      const box = request.bounding_box
      conditions.push(
        `ST_Intersects(
          p.geom,
          ST_MakeEnvelope(
            ${sql.parameter(box.west)},
            ${sql.parameter(box.south)},
            ${sql.parameter(box.east)},
            ${sql.parameter(box.north)},
            4326
          )
        )`,
      )
    }
    if (request.center && request.radius_m) {
      conditions.push(
        `ST_DWithin(
          p.geog,
          ST_SetSRID(
            ST_MakePoint(
              ${sql.parameter(request.center.lng)},
              ${sql.parameter(request.center.lat)}
            ),
            4326
          )::geography,
          ${sql.parameter(request.radius_m)}
        )`,
      )
    }
    const limitParameter = sql.parameter(request.limit)
    const result = await this.pool.query(
      `WITH q AS (
         SELECT geo.normalize_search(${textParameter}::text) AS value
       ), matched AS (
         SELECT
           p.*,
           c.slug AS category,
           similarity(geo.normalize_search(p.name), q.value) AS match_score,
           CASE
             WHEN geo.normalize_search(p.name) = q.value THEN 'exact'
             WHEN geo.normalize_search(p.name) LIKE q.value || '%' THEN 'prefix'
             WHEN geo.normalize_search(p.name) LIKE '%' || q.value || '%' THEN 'contains'
             ELSE 'fuzzy'
           END AS match_type,
           CASE
             WHEN geo.normalize_search(p.name) = q.value THEN 4
             WHEN geo.normalize_search(p.name) LIKE q.value || '%' THEN 3
             WHEN geo.normalize_search(p.name) LIKE '%' || q.value || '%' THEN 2
             ELSE 1
           END AS match_rank
         FROM catalog.places p
         JOIN catalog.place_categories c ON c.id = p.category_id
         CROSS JOIN q
         WHERE ${conditions.join(' AND ')}
       )
       SELECT
         p.id AS place_id,
         p.name,
         p.category,
         city.name AS city_name,
         ARRAY(SELECT a.alias_place_id::text FROM catalog.poi_aliases a
           WHERE a.canonical_place_id=p.id ORDER BY a.alias_place_id) AS alias_ids,
         ST_X(p.geom) AS lng,
         ST_Y(p.geom) AS lat,
         p.match_type,
         p.match_score,
         source.source_type,
         source.source_id,
         source.source_url,
         parent.id AS parent_id,
         parent.name AS parent_name,
         parent.level AS parent_level
       FROM matched p
       LEFT JOIN LATERAL (
         SELECT ps.source_type, ps.source_id, ps.source_url
         FROM catalog.place_sources ps
         WHERE ps.place_id = p.id
         ORDER BY ps.observed_at DESC, ps.id
         LIMIT 1
       ) source ON true
       LEFT JOIN LATERAL (
         SELECT area.id, area.name, area.level
         FROM geo.administrative_areas area
         WHERE ST_Covers(area.geom, p.geom)
         ORDER BY
           CASE WHEN area.level ~ '^[0-9]+$' THEN area.level::integer ELSE -1 END DESC,
           ST_Area(area.geom) ASC,
           area.id
         LIMIT 1
       ) parent ON true
       LEFT JOIN LATERAL (
         SELECT area.name FROM geo.administrative_areas area
         WHERE area.level IN ('4','6') AND ST_Covers(area.geom,p.geom)
         ORDER BY area.level::integer, ST_Area(area.geom), area.id LIMIT 1
       ) city ON true
       ORDER BY p.match_rank DESC, p.match_score DESC, p.name, p.id
       LIMIT ${limitParameter}`,
      sql.values,
    )

    return result.rows.map((row) =>
      ResolvedLocationSchema.parse({
        entity_type: 'place',
        canonical_id: row.place_id,
        name: row.name,
        display_name: poiDisplayName(row.name, row.category, row.city_name, row.parent_name),
        city: row.city_name || null,
        alias_ids: row.alias_ids || [],
        category: row.category,
        administrative_level: null,
        location: { lng: Number(row.lng), lat: Number(row.lat) },
        bounding_box: null,
        parent: row.parent_id
          ? { area_id: row.parent_id, name: row.parent_name, level: row.parent_level }
          : null,
        source: {
          type: row.source_type || 'import',
          source_id: row.source_id || row.place_id,
          source_url: row.source_url || null,
        },
        match_type: row.match_type,
        match_score: Number(row.match_score),
      }),
    )
  }
}

function osmAreaUrl(source: unknown, sourceId: unknown) {
  if (source !== 'osm' || typeof sourceId !== 'string') return null
  const match = sourceId.match(/^relation\/(\d+)$/)
  return match ? `https://www.openstreetmap.org/relation/${match[1]}` : null
}

function rowToArea(row: Record<string, unknown>): AdministrativeArea {
  return AdministrativeAreaSchema.parse({
    area_id: row.area_id,
    name: row.name,
    level: row.level,
    parent: row.parent_id
      ? { area_id: row.parent_id, name: row.parent_name, level: row.parent_level }
      : null,
    center: { lng: Number(row.center_lng), lat: Number(row.center_lat) },
    bounding_box: {
      west: Number(row.west),
      south: Number(row.south),
      east: Number(row.east),
      north: Number(row.north),
    },
    source: {
      type: row.source,
      source_id: row.source_id,
      source_url: osmAreaUrl(row.source, row.source_id),
    },
    match_type: row.match_type,
    match_score: Number(row.match_score),
    attributes: row.attributes || {},
    ...(row.geometry ? { geometry: row.geometry } : {}),
  })
}

function areaToResolvedLocation(area: AdministrativeArea): ResolvedLocation {
  return ResolvedLocationSchema.parse({
    entity_type: 'administrative_area',
    canonical_id: area.area_id,
    name: area.name,
    category: null,
    administrative_level: area.level,
    location: area.center,
    bounding_box: area.bounding_box,
    parent: area.parent,
    source: area.source,
    match_type: area.match_type,
    match_score: area.match_score,
  })
}
