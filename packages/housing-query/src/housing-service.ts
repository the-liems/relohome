import { randomUUID } from 'node:crypto'
import {
  HousingDetailSchema,
  HousingMapRequestSchema,
  HousingMapResponseSchema,
  HousingSearchRequestSchema,
  HousingSearchResponseSchema,
  type HousingDetail,
  type HousingMapResponse,
  type HousingSearchResponse,
  type HousingSearchResult,
  type NearbyPlaceMatch,
  type ParsedHousingSearchRequest,
  type RouteResult,
} from '@relohome/contracts'
import type { RuntimeConfig } from './config.js'
import { decodeCursor, encodeCursor } from './cursor.js'
import type { QueryExecutor } from './database.js'
import { NotFoundError, QueryValidationError, RouteServiceError } from './errors.js'
import { PlaceService } from './place-service.js'
import { RouteService } from './route-service.js'
import { checkOperation, withinOperation } from './execution.js'
import { definitelyDisjointScope } from './spatial-scope.js'
import { hostReviewSummary } from './review-summary.js'
import { candidateFrom } from './current-offer.js'

const COMMUTE_SNAP_RADIUS_M = 100
const ROUTE_CONCURRENCY = 4
// District-level unit types used as name prefixes in Vietnamese addresses. Comparing names without
// them lets "Hà Đông" match a listing stored as "Quận Hà Đông" (legacy district name).
const DISTRICT_KEY = (expression: string) =>
  `regexp_replace(lower(trim(${expression})), '^(quận|huyện|thị xã|thành phố|tp\\.?)\\s+', '')`

interface SqlBuilder {
  values: unknown[]
  parameter(value: unknown): string
}

interface CandidateRow extends Record<string, unknown> {
  listing_id: string
  property_id: string
  unit_id: string | null
  offer_id: string
  place_id: string
  lng: string | number
  lat: string | number
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

function list(value: string | string[] | undefined) {
  if (!value) return undefined
  return Array.isArray(value) ? value : [value]
}

function qualityFlags(attributes: unknown): string[] {
  if (!attributes || typeof attributes !== 'object') return []
  const quality = (attributes as Record<string, unknown>).quality
  if (!quality || typeof quality !== 'object') return []
  const flags = (quality as Record<string, unknown>).flags
  if (!Array.isArray(flags)) return []
  return flags.flatMap((flag) => {
    if (typeof flag === 'string') return [flag]
    if (flag && typeof flag === 'object' && typeof flag.code === 'string') return [flag.code]
    return []
  })
}

function candidateConditions(request: ParsedHousingSearchRequest, sql: SqlBuilder, listingId?: string, indexed = false): string[] {
  const p = indexed ? 'l' : 'p', u = indexed ? 'l' : 'u', cp = indexed ? 'l' : 'cp'
  const conditions = indexed ? ["NOT EXISTS(SELECT 1 FROM housing.managed_listing_visibility v WHERE v.listing_id=l.id AND NOT v.is_public)"] : [
    "NOT EXISTS(SELECT 1 FROM housing.managed_listing_visibility v WHERE v.listing_id=l.id AND NOT v.is_public)",
    "l.status = 'active'",
    'l.deleted_at IS NULL',
    'p.deleted_at IS NULL',
    'cp.deleted_at IS NULL',
    "cp.status = 'active'",
  ]

  if (listingId) conditions.push(`l.id = ${sql.parameter(listingId)}`)
  if (request.text) {
    const parameter = sql.parameter(`%${request.text}%`)
    // OR across joined relations prevents independent trigram lookups. Union
    // the matching listing IDs first, preserving each original ILIKE field.
    conditions.push(`l.id IN (
      SELECT id FROM housing.listings
      WHERE status='active' AND deleted_at IS NULL
        AND (title ILIKE ${parameter} OR description ILIKE ${parameter})
      UNION
      SELECT al.id FROM catalog.places ap
      JOIN housing.properties hp ON hp.place_id=ap.id
      JOIN housing.listings al ON al.property_id=hp.id
      WHERE ap.deleted_at IS NULL AND ap.address::text ILIKE ${parameter}
    )`)
  }
  const propertyTypes = list(request.property_type)
  if (propertyTypes) conditions.push(`${p}.property_type = ANY(${sql.parameter(propertyTypes)}::text[])`)
  const listingTypes = list(request.listing_type)
  if (listingTypes) conditions.push(`l.listing_type = ANY(${sql.parameter(listingTypes)}::text[])`)

  if (request.district) {
    const district = sql.parameter(request.district)
    conditions.push(
      // Some snapshots retain legacy district names in normalized listing
      // addresses, but only current administrative polygons. Do not silently
      // turn a valid legacy district into zero results. Prefer polygons when
      // available; otherwise require an exact normalized-address match.
      // Address comparison ignores the administrative unit-type prefix on both sides
      // ("Hà Đông" = "Quận Hà Đông"); the name itself must still match exactly.
      // Covered listings are found once per query by a spatial join from the few matching areas
      // (map_points mirrors each active listing's place point), then checked by a hashed lookup,
      // instead of probing the administrative-area index once per listing.
      `(l.id IN (SELECT m.id FROM geo.administrative_areas a JOIN housing.map_points m ON ST_Covers(a.geom, m.geom)
          WHERE lower(a.name) = lower(${district}))
        OR (NOT EXISTS (SELECT 1 FROM geo.administrative_areas a WHERE lower(a.name) = lower(${district}))
          AND ${DISTRICT_KEY(`${cp}.address->>'district'`)} = ${DISTRICT_KEY(district)}))`,
    )
  }
  if (request.administrative_area_ids) {
    conditions.push(
      `EXISTS (SELECT 1 FROM geo.administrative_areas a WHERE a.id = ANY(${sql.parameter(request.administrative_area_ids)}::text[]) AND ST_Covers(a.geom, ${cp}.geom))`,
    )
  }
  if (request.bounding_box) {
    const box = request.bounding_box
    conditions.push(
      `ST_Intersects(${cp}.geom, ST_MakeEnvelope(${sql.parameter(box.west)}, ${sql.parameter(box.south)}, ${sql.parameter(box.east)}, ${sql.parameter(box.north)}, 4326))`,
    )
  }
  if (request.center && request.radius_m) {
    conditions.push(
      `ST_DWithin(${cp}.geog, ST_SetSRID(ST_MakePoint(${sql.parameter(request.center.lng)}, ${sql.parameter(request.center.lat)}), 4326)::geography, ${sql.parameter(request.radius_m)})`,
    )
  }

  if (request.commute?.max_distance_m !== undefined) {
    const destination = request.commute.destination
    // OSRM measures between snapped road points. Include both snap radii and a
    // conservative geodesic/model margin so the coarse filter cannot trim the edge.
    const coarseRadius = (request.commute.max_distance_m + 2 * COMMUTE_SNAP_RADIUS_M) * 1.01
    conditions.push(
      `ST_DWithin(${cp}.geog, ST_SetSRID(ST_MakePoint(${sql.parameter(destination.lng)}, ${sql.parameter(destination.lat)}), 4326)::geography, ${sql.parameter(coarseRadius)})`,
    )
  }

  if (request.min_price) {
    conditions.push(`o.price_amount >= ${sql.parameter(request.min_price.amount)}`)
    conditions.push(`o.currency = ${sql.parameter(request.min_price.currency)}`)
    conditions.push(`o.price_period = ${sql.parameter(request.min_price.period)}`)
  }
  if (request.max_price) {
    conditions.push(`o.price_amount <= ${sql.parameter(request.max_price.amount)}`)
    conditions.push(`o.currency = ${sql.parameter(request.max_price.currency)}`)
    conditions.push(`o.price_period = ${sql.parameter(request.max_price.period)}`)
  }
  if (request.currency) conditions.push(`o.currency = ${sql.parameter(request.currency)}`)
  if (request.price_period) conditions.push(`o.price_period = ${sql.parameter(request.price_period)}`)
  if (request.min_bedrooms !== undefined) conditions.push(`${u}.bedrooms >= ${sql.parameter(request.min_bedrooms)}`)
  if (request.max_bedrooms !== undefined) conditions.push(`${u}.bedrooms <= ${sql.parameter(request.max_bedrooms)}`)
  if (request.min_bathrooms !== undefined) conditions.push(`${u}.bathrooms >= ${sql.parameter(request.min_bathrooms)}`)
  if (request.min_area_m2 !== undefined) conditions.push(`${u}.area_m2 >= ${sql.parameter(request.min_area_m2)}`)
  if (request.max_area_m2 !== undefined) conditions.push(`${u}.area_m2 <= ${sql.parameter(request.max_area_m2)}`)
  if (request.amenities) conditions.push(`${u}.amenities @> ${sql.parameter(request.amenities)}::text[]`)
  if (request.availability_from) {
    conditions.push(`(o.availability_from IS NULL OR o.availability_from <= ${sql.parameter(request.availability_from)}::date)`)
  }
  if (request.availability_to) {
    conditions.push(`(o.availability_to IS NULL OR o.availability_to >= ${sql.parameter(request.availability_to)}::date)`)
  }
  if (request.verification_requirement === 'verified_only') {
    conditions.push("l.verification_status <> 'unverified'")
  }
  if (request.source_filters) conditions.push(`l.source_type = ANY(${sql.parameter(request.source_filters)}::text[])`)

  for (const nearby of request.nearby || []) {
    conditions.push(
      `EXISTS (
        SELECT 1
        FROM catalog.places np
        JOIN catalog.place_categories nc ON nc.id = np.category_id
        WHERE np.status = 'active'
          AND np.deleted_at IS NULL
          AND nc.slug = ${sql.parameter(nearby.category)}
          AND ST_DWithin(np.geog, ${cp}.geog, ${sql.parameter(nearby.max_distance_m)})
      )`,
    )
  }

  return conditions
}

export class HousingQueryService {
  private readonly placeService: PlaceService

  constructor(
    private readonly pool: QueryExecutor,
    private readonly routeService: RouteService,
    private readonly config: Pick<RuntimeConfig, 'commuteCandidateLimit'>,
  ) {
    this.placeService = new PlaceService(pool)
  }

  async search(input: unknown): Promise<HousingSearchResponse> {
    return withinOperation(() => this.searchWithinBudget(input))
  }

  private async searchWithinBudget(input: unknown): Promise<HousingSearchResponse> {
    const request = HousingSearchRequestSchema.parse(input)
    validateSort(request)
    const offset = decodeCursor(request.pagination.cursor)
    const rows = await this.selectCandidates(request, offset)
    let commuteEvaluatedCount = 0
    let excludedUnknownCount = 0
    let scanned = 0
    const results: HousingSearchResult[] = []
    const scanLimit = request.commute ? this.config.commuteCandidateLimit : request.pagination.limit
    const candidates = rows.slice(0, scanLimit)
    for (let start = 0; start < candidates.length && results.length < request.pagination.limit; start += ROUTE_CONCURRENCY) {
      checkOperation()
      const batch = candidates.slice(start, start + ROUTE_CONCURRENCY)
      const nearby = request.nearby?.length
        ? await this.placeService.findNearbyBatch(
            batch.map(row => ({ lng: Number(row.lng), lat: Number(row.lat) })), request.nearby,
          )
        : batch.map(() => [])
      checkOperation()
      const mapped = await Promise.all(batch.map((row, index) => this.mapCandidate(row, request, nearby[index])))
      if (request.commute) commuteEvaluatedCount += batch.length
      for (const item of mapped) {
        scanned += 1
        if (request.nearby && item.nearby.length !== request.nearby.length) {
          excludedUnknownCount += 1
          continue
        }
        if (request.commute) {
          if (!item.commute) {
            excludedUnknownCount += 1
            continue
          }
          const constraint = request.commute
          if (constraint.max_duration_seconds !== undefined && item.commute.duration_seconds > constraint.max_duration_seconds) continue
          if (constraint.max_distance_m !== undefined && item.commute.distance_meters > constraint.max_distance_m) continue
          if (constraint.min_distance_m !== undefined && item.commute.distance_meters < constraint.min_distance_m) continue
        }
        results.push(item)
        if (results.length === request.pagination.limit) break
      }
    }
    // The cursor advances through SQL candidates, not through already-filtered matches.
    // A scan-budget page may be empty; its cursor still exposes the remaining candidates.
    const hasNext = rows.length > scanned

    return HousingSearchResponseSchema.parse({
      query_id: randomUUID(),
      contract_version: '1.0.0',
      results,
      page: {
        next_cursor: hasNext ? encodeCursor(offset + scanned) : null,
        returned_count: results.length,
      },
      diagnostics: {
        coarse_candidate_count: scanned,
        commute_evaluated_count: commuteEvaluatedCount,
        excluded_unknown_count: excludedUnknownCount,
        candidate_limit_reached: hasNext && results.length < request.pagination.limit,
      },
    })
  }

  async get(listingId: string): Promise<HousingDetail> {
    const rows = await this.selectCandidates(
      HousingSearchRequestSchema.parse({ pagination: { limit: 1, cursor: null } }),
      0,
      listingId,
    )
    const row = rows[0]
    if (!row) throw new NotFoundError(`Housing listing not found: ${listingId}`)
    const result = await this.mapCandidate(row, HousingSearchRequestSchema.parse({}))
    const [media, fees, management] = await Promise.all([
      this.pool.query(
        `SELECT url, alt_text FROM housing.listing_media
         WHERE listing_id = $1 AND moderation_status='approved' AND deleted_at IS NULL ORDER BY position, id`,
        [listingId],
      ),
      this.pool.query(
        `SELECT code,label,amount::float,billing_unit,required,refundable FROM housing.listing_fees
         WHERE listing_id=$1 AND valid_to IS NULL ORDER BY required DESC,label`,
        [listingId],
      ),
      this.pool.query(
        `SELECT ml.publication_status,ml.availability_status,ml.availability_confirmed_at,
          (ml.publication_status='published' AND ml.availability_status='vacant') AS accepts_contact_requests,
          hp.poster_type,hp.display_name AS poster_name,coalesce(hp.status='verified',false) AS host_verified,
          (SELECT mm.user_id FROM housing.management_members mm WHERE mm.property_id=(SELECT property_id FROM housing.listings WHERE id=ml.listing_id)
            AND mm.role='owner' AND mm.status<>'revoked' ORDER BY mm.requested_at,mm.user_id LIMIT 1) AS rating_host_user_id
         FROM housing.managed_listings ml LEFT JOIN housing.host_profiles hp ON hp.user_id=ml.created_by
         WHERE ml.listing_id=$1`,
        [listingId],
      ),
    ])
    const managementRow = management.rows[0]
    const hostSummary = managementRow?.rating_host_user_id
      ? await hostReviewSummary(this.pool, managementRow.rating_host_user_id)
      : null
    return HousingDetailSchema.parse({
      ...result,
      description: row.description,
      images: media.rows.map((image) => ({ url: image.url, alt: image.alt_text })),
      extra_attributes: row.listing_attributes || {},
      fees: fees.rows,
      // pg returns timestamptz as Date; the read contract carries ISO strings.
      management: management.rows[0]
        ? {
            ...management.rows[0],
            host_rating: hostSummary?.rating ?? null,
            host_review_count: hostSummary?.count ?? 0,
            availability_confirmed_at: management.rows[0].availability_confirmed_at
              ? new Date(management.rows[0].availability_confirmed_at).toISOString()
              : null,
          }
        : null,
    })
  }

  async map(input: unknown): Promise<HousingMapResponse> {
    return withinOperation(() => this.mapWithinBudget(input))
  }

  private async mapWithinBudget(input: unknown): Promise<HousingMapResponse> {
    const request = HousingMapRequestSchema.parse(input)
    const aggregate = request.cluster !== false && request.zoom < 13
    if (definitelyDisjointScope(request)) return HousingMapResponseSchema.parse({
      features: [], meta: { mode: aggregate ? 'clusters' : 'listings', returned_count: 0, truncated: false },
    })
    const sql = createSqlBuilder()
    // Text keeps its exact title/description/address semantics on source tables.
    const indexed = !request.text
    const cp = indexed ? 'l' : 'cp'
    const conditions = candidateConditions(HousingSearchRequestSchema.parse(request), sql, undefined, indexed)
    if (request.listing_ids) conditions.push(`l.id = ANY(${sql.parameter(request.listing_ids)}::uuid[])`)

    const limit = request.limit + 1
    if (aggregate) {
      const gridSize = Math.max(0.002, 60 * 360 / (256 * 2 ** request.zoom))
      const result = await this.pool.query(
        `WITH candidates AS (
           SELECT ${cp}.geom, o.price_amount, o.currency, o.price_period,
             ST_SnapToGrid(${cp}.geom, ${sql.parameter(gridSize)}) AS grid_cell
           ${candidateFrom(indexed)}
           WHERE ${conditions.join(' AND ') || 'true'}
         )
         SELECT md5(ST_AsText(grid_cell) || ':' || currency || ':' || price_period) AS cluster_id,
           AVG(ST_X(geom)) AS lng, AVG(ST_Y(geom)) AS lat,
           count(*) AS count, min(price_amount) AS min_price_amount, currency, price_period
         FROM candidates
         GROUP BY grid_cell, currency, price_period
         ORDER BY count(*) DESC, cluster_id
         LIMIT ${sql.parameter(limit)}`,
        sql.values,
      )
      const truncated = result.rows.length > request.limit
      const features = result.rows.slice(0, request.limit).map((row) => ({
        kind: 'cluster' as const,
        cluster_id: String(row.cluster_id),
        location: { lng: Number(row.lng), lat: Number(row.lat) },
        count: Number(row.count),
        min_price_amount: Number(row.min_price_amount),
        currency: row.currency,
        price_period: row.price_period,
      }))
      return HousingMapResponseSchema.parse({
        features,
        meta: { mode: 'clusters', returned_count: features.length, truncated },
      })
    }

    const result = await this.pool.query(
      `WITH page AS MATERIALIZED (
         SELECT l.id AS listing_id,o.price_amount,o.currency,o.price_period
         ${candidateFrom(indexed)}
         WHERE ${conditions.join(' AND ') || 'true'}
         ORDER BY l.updated_at DESC,l.id LIMIT ${sql.parameter(limit)}
       )
       SELECT l.id AS listing_id, l.title, l.listing_type, l.source_url,
         l.property_type, ST_X(l.geom) AS lng, ST_Y(l.geom) AS lat, l.address,
         o.price_amount, o.currency, o.price_period,
         l.bedrooms, l.bathrooms, l.area_m2, l.amenities,l.location_accuracy,
         thumbnail.url AS thumbnail_url
       FROM housing.map_points l
       JOIN page o ON o.listing_id=l.id
       LEFT JOIN LATERAL (
         SELECT lm.url FROM housing.listing_media lm
         WHERE lm.listing_id = l.id AND lm.moderation_status='approved' AND lm.deleted_at IS NULL ORDER BY lm.is_primary DESC, lm.position, lm.id LIMIT 1
       ) thumbnail ON true
       ORDER BY l.updated_at DESC, l.id`,
      sql.values,
    )
    const truncated = result.rows.length > request.limit
    const features = result.rows.slice(0, request.limit).map((row) => ({
      kind: 'listing' as const,
      listing_id: String(row.listing_id),
      location: { lng: Number(row.lng), lat: Number(row.lat) },
      title: String(row.title),
      property_type: row.property_type,
      listing_type: row.listing_type,
      price: { amount: Number(row.price_amount), currency: row.currency, period: row.price_period },
      bedrooms: row.bedrooms === null ? null : Number(row.bedrooms),
      bathrooms: row.bathrooms === null ? null : Number(row.bathrooms),
      area_m2: row.area_m2 === null ? null : Number(row.area_m2),
      address: row.address || {},
      amenities: row.amenities || [],
      source_url: row.source_url || null,
      thumbnail_url: row.thumbnail_url ? String(row.thumbnail_url) : null,
      location_accuracy: ['rooftop', 'approximate'].includes(row.location_accuracy)
        ? row.location_accuracy
        : 'unknown',
    }))
    return HousingMapResponseSchema.parse({
      features,
      meta: { mode: 'listings', returned_count: features.length, truncated },
    })
  }

  private async selectCandidates(
    request: ParsedHousingSearchRequest,
    offset: number,
    listingId?: string,
  ): Promise<CandidateRow[]> {
    if (definitelyDisjointScope(request)) return []
    const sql = createSqlBuilder()
    const indexed = !request.text
    const conditions = candidateConditions(request, sql, listingId, indexed)

    let distanceExpression = 'NULL::double precision'
    if (request.center) {
      distanceExpression = `ST_Distance(${indexed ? 'l' : 'cp'}.geog, ST_SetSRID(ST_MakePoint(${sql.parameter(request.center.lng)}, ${sql.parameter(request.center.lat)}), 4326)::geography)`
    }

    const orderBy = buildOrderBy(request)
    const candidateOrder = buildOrderBy(request, indexed)
    const queryLimit = request.commute ? this.config.commuteCandidateLimit + 1 : request.pagination.limit + 1
    const limitParameter = sql.parameter(queryLimit)
    const offsetClause = `OFFSET ${sql.parameter(offset)}`

    const result = await this.pool.query(
      `WITH page AS MATERIALIZED (
         SELECT l.id AS listing_id,o.id AS offer_id,
           ${distanceExpression} AS distance_meters
         ${candidateFrom(indexed)}
         WHERE ${conditions.join(' AND ') || 'true'}
         ORDER BY ${candidateOrder} LIMIT ${limitParameter} ${offsetClause}
       )
       SELECT
         l.id AS listing_id,
         p.id AS property_id,
         u.id AS unit_id,
         o.id AS offer_id,
         cp.id AS place_id,
         l.title,
         l.description,
         p.property_type,
         l.listing_type,
         ST_X(cp.geom) AS lng,
         ST_Y(cp.geom) AS lat,
         cp.address,
         o.price_amount,
         o.deposit_amount,
         o.currency,
         o.price_period,
         u.bedrooms,
         u.bathrooms,
         u.area_m2,
         COALESCE(u.amenities, '{}') AS amenities,
         l.verification_status,
         l.verified_at,
         l.verified_by,
         l.source_type,
         l.source_listing_id,
         l.source_url,
         thumbnail.url AS thumbnail_url,
         l.attributes AS listing_attributes,
         l.attributes->>'observed_at' AS observed_at,
         l.created_at,
         page.distance_meters
       FROM housing.listings l
       JOIN page ON page.listing_id=l.id
       JOIN housing.properties p ON p.id = l.property_id
       LEFT JOIN housing.units u ON u.id = l.unit_id AND u.deleted_at IS NULL
       JOIN housing.offers o ON o.id=page.offer_id
       JOIN catalog.places cp ON cp.id = p.place_id
       LEFT JOIN LATERAL (
         SELECT lm.url FROM housing.listing_media lm
         WHERE lm.listing_id = l.id AND lm.moderation_status='approved' AND lm.deleted_at IS NULL ORDER BY lm.is_primary DESC, lm.position, lm.id LIMIT 1
       ) thumbnail ON true
       ORDER BY ${orderBy}`,
      sql.values,
    )
    return result.rows as CandidateRow[]
  }

  private async mapCandidate(
    row: CandidateRow,
    request: ParsedHousingSearchRequest,
    nearbyMatches?: NearbyPlaceMatch[],
  ): Promise<HousingSearchResult> {
    const location = { lng: Number(row.lng), lat: Number(row.lat) }
    const nearby = nearbyMatches ?? (request.nearby ? await this.placeService.findNearby(location, request.nearby) : [])
    let commute: RouteResult | null = null
    if (request.commute) {
      try {
        commute = await this.routeService.calculate({
          city: request.commute.city || this.routeService.inferCity(location),
          origin: request.commute.direction === 'destination_to_listing' ? request.commute.destination : location,
          destination: request.commute.direction === 'destination_to_listing' ? location : request.commute.destination,
          profile: request.commute.profile,
          steps: false,
          ...(request.commute.max_distance_m !== undefined ? { snap_radius_m: COMMUTE_SNAP_RADIUS_M } : {}),
        })
      } catch (error) {
        if (!(error instanceof RouteServiceError) || !['NO_ROUTE', 'OUTSIDE_ROUTING_AREA'].includes(error.code)) throw error
      }
    }

    const unknownFields = [
      row.bedrooms === null ? 'bedrooms' : null,
      row.bathrooms === null ? 'bathrooms' : null,
      row.area_m2 === null ? 'area' : null,
    ].filter((value): value is string => Boolean(value))

    return {
      listing_id: row.listing_id,
      property_id: row.property_id,
      unit_id: row.unit_id,
      offer_id: String(row.offer_id),
      place_id: row.place_id,
      title: String(row.title),
      quality_flags: qualityFlags(row.listing_attributes),
      property_type: row.property_type as HousingSearchResult['property_type'],
      listing_type: row.listing_type as HousingSearchResult['listing_type'],
      location,
      location_accuracy: ['rooftop', 'approximate'].includes(String((row.listing_attributes as Record<string, unknown> | null)?.location_accuracy))
        ? (row.listing_attributes as Record<string, unknown>).location_accuracy as 'rooftop' | 'approximate'
        : 'unknown',
      location_method: typeof (row.listing_attributes as Record<string, unknown> | null)?.location_method === 'string'
        ? String((row.listing_attributes as Record<string, unknown>).location_method) : null,
      deposit: row.deposit_amount == null ? null : {
        amount: Number(row.deposit_amount), currency: row.currency as HousingSearchResult['price']['currency'],
      },
      address: (row.address || {}) as Record<string, unknown>,
      price: {
        amount: Number(row.price_amount),
        currency: row.currency as HousingSearchResult['price']['currency'],
        period: row.price_period as HousingSearchResult['price']['period'],
      },
      bedrooms: row.bedrooms === null ? null : Number(row.bedrooms),
      bathrooms: row.bathrooms === null ? null : Number(row.bathrooms),
      area: row.area_m2 === null ? null : { value: Number(row.area_m2), unit: 'm2' },
      amenities: (row.amenities || []) as string[],
      verification: {
        status: row.verification_status as HousingSearchResult['verification']['status'],
        verified_at: row.verified_at ? new Date(String(row.verified_at)).toISOString() : null,
        verified_by: row.verified_by === null ? null : String(row.verified_by),
      },
      source: {
        type: row.source_type as HousingSearchResult['source']['type'],
        source_id: String(row.source_listing_id),
        source_url: row.source_url ? String(row.source_url) : null,
        observed_at: new Date(String(row.observed_at || row.created_at)).toISOString(),
      },
      thumbnail_url: row.thumbnail_url ? String(row.thumbnail_url) : null,
      matched_constraints: matchedConstraints(request),
      unknown_fields: unknownFields,
      nearby,
      commute,
      created_at: new Date(String(row.created_at)).toISOString(),
      verified_at: row.verified_at ? new Date(String(row.verified_at)).toISOString() : null,
    }
  }
}

function validateSort(request: ParsedHousingSearchRequest) {
  if (request.sort?.some((sort) => sort.field === 'distance_meters') && !request.center) {
    throw new QueryValidationError('distance_meters sorting requires center and radius_m.')
  }
}

function buildOrderBy(request: ParsedHousingSearchRequest, indexed = false) {
  const expressions: Record<string, string> = {
    price_amount: 'o.price_amount',
    area_m2: indexed ? 'l.area_m2' : 'u.area_m2',
    bedrooms: indexed ? 'l.bedrooms' : 'u.bedrooms',
    created_at: 'l.created_at',
    verified_at: 'l.verified_at',
    distance_meters: 'distance_meters',
  }
  const sorts = request.sort?.length
    ? request.sort
    : [{ field: 'price_amount' as const, direction: 'asc' as const }]
  return [
    ...sorts.map((sort) => `${expressions[sort.field]} ${sort.direction.toUpperCase()} NULLS LAST`),
    'l.id ASC',
  ].join(', ')
}

function matchedConstraints(request: ParsedHousingSearchRequest) {
  const keys: Array<keyof ParsedHousingSearchRequest> = [
    'text',
    'property_type',
    'listing_type',
    'district',
    'administrative_area_ids',
    'bounding_box',
    'center',
    'min_price',
    'max_price',
    'currency',
    'price_period',
    'min_bedrooms',
    'max_bedrooms',
    'min_bathrooms',
    'min_area_m2',
    'max_area_m2',
    'amenities',
    'availability_from',
    'availability_to',
    'verification_requirement',
    'source_filters',
    'nearby',
    'commute',
  ]
  return keys.filter((key) => {
    const value = request[key]
    if (key === 'verification_requirement') return value === 'verified_only'
    return value !== undefined && value !== null
  })
}

export async function requireHousing(service: HousingQueryService, listingId: string) {
  try {
    return await service.get(listingId)
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw error
  }
}
