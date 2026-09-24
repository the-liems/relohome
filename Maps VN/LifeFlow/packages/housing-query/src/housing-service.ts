import { randomUUID } from 'node:crypto'
import {
  HousingDetailSchema,
  HousingSearchRequestSchema,
  HousingSearchResponseSchema,
  type HousingDetail,
  type HousingSearchResponse,
  type HousingSearchResult,
  type ParsedHousingSearchRequest,
  type RouteResult,
} from '@lifeflow/contracts'
import type { RuntimeConfig } from './config.js'
import { decodeCursor, encodeCursor } from './cursor.js'
import type { QueryExecutor } from './database.js'
import { NotFoundError, QueryValidationError, RouteServiceError } from './errors.js'
import { PlaceService } from './place-service.js'
import { RouteService } from './route-service.js'

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
    const request = HousingSearchRequestSchema.parse(input)
    validateSort(request)
    const offset = decodeCursor(request.pagination.cursor)
    const rows = await this.selectCandidates(request, offset)
    const coarseCandidateCount = rows.length
    const mapped = await Promise.all(rows.map((row) => this.mapCandidate(row, request)))

    let commuteEvaluatedCount = 0
    let excludedUnknownCount = 0
    const evaluated: HousingSearchResult[] = []
    for (const item of mapped) {
      if (request.nearby && item.nearby.length !== request.nearby.length) {
        excludedUnknownCount += 1
        continue
      }
      if (request.commute) {
        commuteEvaluatedCount += 1
        if (!item.commute || item.commute.duration_seconds > request.commute.max_duration_seconds) continue
      }
      evaluated.push(item)
    }

    const pageStart = request.commute ? offset : 0
    const page = evaluated.slice(pageStart, pageStart + request.pagination.limit + 1)
    const hasNext = page.length > request.pagination.limit
    const results = page.slice(0, request.pagination.limit)

    return HousingSearchResponseSchema.parse({
      query_id: randomUUID(),
      contract_version: '1.0.0',
      results,
      page: {
        next_cursor: hasNext ? encodeCursor(offset + request.pagination.limit) : null,
        returned_count: results.length,
      },
      diagnostics: {
        coarse_candidate_count: coarseCandidateCount,
        commute_evaluated_count: commuteEvaluatedCount,
        excluded_unknown_count: excludedUnknownCount,
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
    return HousingDetailSchema.parse({
      ...result,
      description: row.description,
      images: [],
      extra_attributes: row.listing_attributes || {},
    })
  }

  private async selectCandidates(
    request: ParsedHousingSearchRequest,
    offset: number,
    listingId?: string,
  ): Promise<CandidateRow[]> {
    const sql = createSqlBuilder()
    const conditions = [
      "l.status = 'active'",
      'l.deleted_at IS NULL',
      'p.deleted_at IS NULL',
      'cp.deleted_at IS NULL',
      "cp.status = 'active'",
    ]

    if (listingId) conditions.push(`l.id = ${sql.parameter(listingId)}`)
    if (request.text) {
      const parameter = sql.parameter(`%${request.text}%`)
      conditions.push(`(l.title ILIKE ${parameter} OR l.description ILIKE ${parameter} OR cp.address::text ILIKE ${parameter})`)
    }
    const propertyTypes = list(request.property_type)
    if (propertyTypes) conditions.push(`p.property_type = ANY(${sql.parameter(propertyTypes)}::text[])`)
    const listingTypes = list(request.listing_type)
    if (listingTypes) conditions.push(`l.listing_type = ANY(${sql.parameter(listingTypes)}::text[])`)

    if (request.district) {
      conditions.push(
        `EXISTS (SELECT 1 FROM geo.administrative_areas a WHERE lower(a.name) = lower(${sql.parameter(request.district)}) AND ST_Covers(a.geom, cp.geom))`,
      )
    }
    if (request.administrative_area_ids) {
      conditions.push(
        `EXISTS (SELECT 1 FROM geo.administrative_areas a WHERE a.id = ANY(${sql.parameter(request.administrative_area_ids)}::text[]) AND ST_Covers(a.geom, cp.geom))`,
      )
    }
    if (request.bounding_box) {
      const box = request.bounding_box
      conditions.push(
        `ST_Intersects(cp.geom, ST_MakeEnvelope(${sql.parameter(box.west)}, ${sql.parameter(box.south)}, ${sql.parameter(box.east)}, ${sql.parameter(box.north)}, 4326))`,
      )
    }
    if (request.center && request.radius_m) {
      conditions.push(
        `ST_DWithin(cp.geog, ST_SetSRID(ST_MakePoint(${sql.parameter(request.center.lng)}, ${sql.parameter(request.center.lat)}), 4326)::geography, ${sql.parameter(request.radius_m)})`,
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
    if (request.min_bedrooms !== undefined) conditions.push(`u.bedrooms >= ${sql.parameter(request.min_bedrooms)}`)
    if (request.max_bedrooms !== undefined) conditions.push(`u.bedrooms <= ${sql.parameter(request.max_bedrooms)}`)
    if (request.min_bathrooms !== undefined) conditions.push(`u.bathrooms >= ${sql.parameter(request.min_bathrooms)}`)
    if (request.min_area_m2 !== undefined) conditions.push(`u.area_m2 >= ${sql.parameter(request.min_area_m2)}`)
    if (request.max_area_m2 !== undefined) conditions.push(`u.area_m2 <= ${sql.parameter(request.max_area_m2)}`)
    if (request.amenities) conditions.push(`u.amenities @> ${sql.parameter(request.amenities)}::text[]`)
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
            AND ST_DWithin(np.geog, cp.geog, ${sql.parameter(nearby.max_distance_m)})
        )`,
      )
    }

    let distanceExpression = 'NULL::double precision'
    if (request.center) {
      distanceExpression = `ST_Distance(cp.geog, ST_SetSRID(ST_MakePoint(${sql.parameter(request.center.lng)}, ${sql.parameter(request.center.lat)}), 4326)::geography)`
    }

    const orderBy = buildOrderBy(request)
    const queryLimit = request.commute ? this.config.commuteCandidateLimit : request.pagination.limit + 1
    const limitParameter = sql.parameter(queryLimit)
    const offsetClause = request.commute ? '' : `OFFSET ${sql.parameter(offset)}`

    const result = await this.pool.query(
      `SELECT
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
         l.attributes AS listing_attributes,
         l.created_at,
         ${distanceExpression} AS distance_meters
       FROM housing.listings l
       JOIN housing.properties p ON p.id = l.property_id
       LEFT JOIN housing.units u ON u.id = l.unit_id AND u.deleted_at IS NULL
       JOIN housing.current_offers o ON o.listing_id = l.id
       JOIN catalog.places cp ON cp.id = p.place_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${limitParameter} ${offsetClause}`,
      sql.values,
    )
    return result.rows as CandidateRow[]
  }

  private async mapCandidate(
    row: CandidateRow,
    request: ParsedHousingSearchRequest,
  ): Promise<HousingSearchResult> {
    const location = { lng: Number(row.lng), lat: Number(row.lat) }
    const nearby = request.nearby ? await this.placeService.findNearby(location, request.nearby) : []
    let commute: RouteResult | null = null
    if (request.commute) {
      try {
        commute = await this.routeService.calculate({
          city: request.commute.city || this.routeService.inferCity(location),
          origin: location,
          destination: request.commute.destination,
          profile: request.commute.profile,
          steps: false,
        })
      } catch (error) {
        if (!(error instanceof RouteServiceError)) throw error
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
      property_type: row.property_type as HousingSearchResult['property_type'],
      listing_type: row.listing_type as HousingSearchResult['listing_type'],
      location,
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
        observed_at: new Date(String(row.created_at)).toISOString(),
      },
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

function buildOrderBy(request: ParsedHousingSearchRequest) {
  const expressions: Record<string, string> = {
    price_amount: 'o.price_amount',
    area_m2: 'u.area_m2',
    bedrooms: 'u.bedrooms',
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
