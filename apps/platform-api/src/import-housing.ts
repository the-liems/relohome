import { resolveInputPath } from './runtime-paths.js'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { createInterface } from 'node:readline'
import { createDatabasePool, getRuntimeConfig } from '@relohome/housing-query'
import { z } from 'zod'

const PricePeriodSchema = z.enum(['night', 'day', 'week', 'month', 'year', 'total'])
const RawHousingSchema = z.object({
  source_type: z.string().trim().min(1),
  source_listing_id: z.union([z.string(), z.number()]).transform(String),
  source_url: z.string().nullable().optional(),
  observed_at: z.iso.datetime(),
  title: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  listing_type: z.enum(['rent', 'sale', 'short_stay']),
  property_type: z.enum(['apartment', 'house', 'room', 'studio', 'serviced_apartment', 'homestay', 'other']),
  status: z.enum(['active', 'inactive', 'stale']),
  address_raw: z.string().nullable().optional(),
  address_normalized: z.record(z.string(), z.unknown()).default({}),
  location: z.object({
    longitude: z.number().finite().min(-180).max(180),
    latitude: z.number().finite().min(-90).max(90),
    accuracy: z.string().nullable().optional(),
    method: z.string().nullable().optional(),
  }),
  unit: z.object({
    unit_code: z.string().nullable().optional(),
    bedrooms: z.number().nonnegative().nullable().optional(),
    bathrooms: z.number().nonnegative().nullable().optional(),
    area_m2: z.number().positive().nullable().optional(),
    amenities: z.array(z.string()).default([]),
    attributes: z.record(z.string(), z.unknown()).default({}),
  }),
  offer: z.object({
    price_amount: z.number().nonnegative(),
    currency: z.enum(['VND', 'USD']),
    price_period: PricePeriodSchema,
    deposit_amount: z.number().nonnegative().nullable().optional(),
    availability_from: z.string().nullable().optional(),
    availability_to: z.string().nullable().optional(),
    valid_from: z.iso.datetime().nullable().optional(),
    attributes: z.record(z.string(), z.unknown()).default({}),
  }),
  media: z.array(z.object({ url: z.string(), alt: z.string().nullable().optional() })).default([]),
  verification: z.object({
    status: z.enum(['unverified', 'source_verified', 'lifeflow_verified']).default('unverified'),
    checked_by: z.string().nullable().optional(),
    checked_at: z.string().nullable().optional(),
  }).default({ status: 'unverified' }),
  unknown_fields: z.record(z.string(), z.unknown()).default({}),
  derived: z.record(z.string(), z.unknown()).default({}),
  quality: z.object({
    publishable: z.boolean().default(true),
    flags: z.array(z.unknown()).default([]),
  }).passthrough().default({ publishable: true, flags: [] }),
}).passthrough()

type RawHousing = z.infer<typeof RawHousingSchema>
type ValidationStatus = 'accepted' | 'rejected' | 'duplicate' | 'quarantined'

interface StagingRow {
  provider: string
  sourceListingId: string
  sourceUrl: string | null
  observedAt: string | null
  longitude: number | null
  latitude: number | null
  payload: Record<string, unknown>
  payloadHash: string
  validationStatus: ValidationStatus
  validationErrors: string[]
  canonicalPlaceId: string | null
  canonicalPropertyId: string | null
  canonicalUnitId: string | null
  canonicalListingId: string | null
  canonicalOfferId: string | null
  publishAction: 'pending' | 'duplicate' | 'rejected' | 'quarantined'
}

const BATCH_SIZE = 500
const config = getRuntimeConfig()
const pool = createDatabasePool(config.ingestDatabaseUrl, 4)
const sourcePath = resolveInputPath(requiredEnvironment('HOUSING_SOURCE_PATH'))
const sourceVersion = process.env.HOUSING_SOURCE_VERSION || basename(sourcePath)

function requiredEnvironment(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function stableUuid(value: string) {
  const bytes = Buffer.from(createHash('sha256').update(value).digest('hex').slice(0, 32), 'hex')
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function hashFile(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function* readJsonRecords(path: string) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  let buffer = ''
  let depth = 0
  let inString = false
  let escaped = false

  for await (const line of lines) {
    for (const character of line) {
      if (depth === 0 && !buffer && /\s/.test(character)) continue
      buffer += character

      if (inString) {
        if (escaped) {
          escaped = false
        } else if (character === '\\') {
          escaped = true
        } else if (character === '"') {
          inString = false
        }
        continue
      }

      if (character === '"') {
        inString = true
      } else if (character === '{') {
        depth += 1
      } else if (character === '}') {
        depth -= 1
        if (depth === 0) {
          yield buffer.trim()
          buffer = ''
        }
      }
    }

    if (buffer) {
      if (inString) {
        buffer += '\\n'
        escaped = false
      } else {
        buffer += '\n'
      }
    }
  }

  if (buffer.trim()) yield buffer.trim()
}

function flagCodes(record: RawHousing) {
  return record.quality.flags.map((flag) => {
    if (typeof flag === 'string') return flag
    if (flag && typeof flag === 'object' && 'code' in flag) return String(flag.code)
    return ''
  }).filter(Boolean)
}

function safeJsonStringify(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== 'string') return item
    return item.replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      '\uFFFD',
    )
  })
}

function stagingRow(rawLine: string, lineNumber: number, seen: Set<string>): StagingRow {
  const payloadHash = createHash('sha256').update(rawLine).digest('hex')
  let unparsed: unknown
  try {
    unparsed = JSON.parse(rawLine)
  } catch (error) {
    return rejectedLine(lineNumber, payloadHash, rawLine, error instanceof Error ? error.message : 'invalid_json')
  }

  const parsed = RawHousingSchema.safeParse(unparsed)
  if (!parsed.success) {
    const raw = unparsed && typeof unparsed === 'object' ? unparsed as Record<string, unknown> : { value: unparsed }
    return {
      ...rejectedLine(lineNumber, payloadHash, rawLine, 'schema_validation_failed'),
      provider: typeof raw.source_type === 'string' ? raw.source_type : 'invalid',
      sourceListingId: raw.source_listing_id === undefined ? `line:${lineNumber}` : String(raw.source_listing_id),
      payload: raw,
      validationErrors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    }
  }

  const record = parsed.data
  const identity = `${record.source_type}:${record.source_listing_id}`
  const duplicate = seen.has(identity)
  seen.add(identity)
  const quarantineReasons = [
    ...(!record.quality.publishable ? ['quality_publishable_false'] : []),
    ...(flagCodes(record).includes('likely_commercial') ? ['likely_commercial'] : []),
  ]
  const status: ValidationStatus = duplicate ? 'duplicate' : quarantineReasons.length ? 'quarantined' : 'accepted'
  const listingKey = `${record.source_type}:${record.source_listing_id}`
  const offerKey = [
    listingKey,
    record.offer.price_amount,
    record.offer.currency,
    record.offer.price_period,
    record.offer.valid_from || record.observed_at,
  ].join(':')

  return {
    provider: record.source_type,
    sourceListingId: record.source_listing_id,
    sourceUrl: record.source_url || null,
    observedAt: record.observed_at,
    longitude: record.location.longitude,
    latitude: record.location.latitude,
    payload: record as unknown as Record<string, unknown>,
    payloadHash,
    validationStatus: status,
    validationErrors: duplicate ? ['duplicate_source_id_in_import'] : quarantineReasons,
    canonicalPlaceId: stableUuid(`housing-place:${listingKey}`),
    canonicalPropertyId: stableUuid(`housing-property:${listingKey}`),
    canonicalUnitId: stableUuid(`housing-unit:${listingKey}`),
    canonicalListingId: stableUuid(`housing-listing:${listingKey}`),
    canonicalOfferId: stableUuid(`housing-offer:${offerKey}`),
    publishAction: duplicate ? 'duplicate' : quarantineReasons.length ? 'quarantined' : 'pending',
  }
}

function rejectedLine(lineNumber: number, payloadHash: string, rawLine: string, error: string): StagingRow {
  return {
    provider: 'invalid',
    sourceListingId: `line:${lineNumber}`,
    sourceUrl: null,
    observedAt: null,
    longitude: null,
    latitude: null,
    payload: { raw_line: rawLine },
    payloadHash,
    validationStatus: 'rejected',
    validationErrors: [error],
    canonicalPlaceId: null,
    canonicalPropertyId: null,
    canonicalUnitId: null,
    canonicalListingId: null,
    canonicalOfferId: null,
    publishAction: 'rejected',
  }
}

async function insertStagingBatch(runId: string, rows: StagingRow[]) {
  if (!rows.length) return
  await pool.query(
    `INSERT INTO integration.housing_staging (
       import_run_id, provider, source_listing_id, source_url, observed_at, longitude, latitude,
       payload, payload_hash, validation_status, validation_errors, canonical_place_id,
       canonical_property_id, canonical_unit_id, canonical_listing_id, canonical_offer_id, publish_action
     )
     SELECT $1, x.provider, x.source_listing_id, x.source_url, x.observed_at,
       x.longitude, x.latitude, x.payload, x.payload_hash, x.validation_status,
       x.validation_errors, x.canonical_place_id, x.canonical_property_id,
       x.canonical_unit_id, x.canonical_listing_id, x.canonical_offer_id, x.publish_action
     FROM jsonb_to_recordset($2::jsonb) AS x(
       provider text, source_listing_id text, source_url text, observed_at timestamptz,
       longitude double precision, latitude double precision, payload jsonb, payload_hash text,
       validation_status text, validation_errors jsonb, canonical_place_id uuid,
       canonical_property_id uuid, canonical_unit_id uuid, canonical_listing_id uuid,
       canonical_offer_id uuid, publish_action text
     )`,
    [runId, safeJsonStringify(rows.map((row) => ({
      provider: row.provider,
      source_listing_id: row.sourceListingId,
      source_url: row.sourceUrl,
      observed_at: row.observedAt,
      longitude: row.longitude,
      latitude: row.latitude,
      payload: row.payload,
      payload_hash: row.payloadHash,
      validation_status: row.validationStatus,
      validation_errors: row.validationErrors,
      canonical_place_id: row.canonicalPlaceId,
      canonical_property_id: row.canonicalPropertyId,
      canonical_unit_id: row.canonicalUnitId,
      canonical_listing_id: row.canonicalListingId,
      canonical_offer_id: row.canonicalOfferId,
      publish_action: row.publishAction,
    })))],
  )
}

async function publish(runId: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE integration.housing_staging s
       SET canonical_listing_id = l.id,
           canonical_property_id = l.property_id,
           canonical_unit_id = COALESCE(l.unit_id, s.canonical_unit_id),
           canonical_place_id = p.place_id,
           publish_action = CASE WHEN l.verification_status = 'lifeflow_verified' THEN 'protected' ELSE 'updated' END
       FROM housing.listings l
       JOIN housing.properties p ON p.id = l.property_id
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted'
         AND l.source_type = 'partner'
         AND l.source_listing_id = s.provider || ':' || s.source_listing_id`,
      [runId],
    )

    await client.query(
      `INSERT INTO catalog.places (id, category_id, name, geom, address, status, attributes, updated_at)
       SELECT s.canonical_place_id, c.id,
         COALESCE(NULLIF(s.payload #>> '{unit,attributes,project}', ''), s.payload->>'title'),
         ST_SetSRID(ST_MakePoint(s.longitude, s.latitude), 4326),
         COALESCE(s.payload->'address_normalized', '{}'::jsonb)
           || jsonb_build_object('raw', s.payload->>'address_raw'),
         s.payload->>'status',
         jsonb_build_object(
           'entity_role', 'housing_anchor',
           'provider', s.provider,
           'location_accuracy', COALESCE(s.payload #>> '{location,accuracy}', 'unknown'),
           'location_method', s.payload #>> '{location,method}',
           'observed_at', s.observed_at
         ), now()
       FROM integration.housing_staging s
       JOIN catalog.place_categories c ON c.slug = 'accommodation'
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted' AND s.publish_action <> 'protected'
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, geom = EXCLUDED.geom, address = EXCLUDED.address,
         status = EXCLUDED.status, attributes = EXCLUDED.attributes, updated_at = now()
       WHERE catalog.places.verification_status <> 'lifeflow_verified'`,
      [runId],
    )

    await client.query(
      `INSERT INTO catalog.place_sources (
         place_id, import_run_id, source_type, source_id, source_url, source_payload, observed_at
       )
       SELECT s.canonical_place_id, s.import_run_id, s.provider, s.source_listing_id, s.source_url,
         jsonb_build_object('listing_id', s.canonical_listing_id, 'location', s.payload->'location'),
         COALESCE(s.observed_at, now())
       FROM integration.housing_staging s
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted'
       ON CONFLICT (source_type, source_id) DO UPDATE SET
         place_id = EXCLUDED.place_id, import_run_id = EXCLUDED.import_run_id,
         source_url = EXCLUDED.source_url, source_payload = EXCLUDED.source_payload,
         observed_at = EXCLUDED.observed_at`,
      [runId],
    )

    await client.query(
      `INSERT INTO housing.properties (id, place_id, property_type, name, attributes, updated_at)
       SELECT s.canonical_property_id, s.canonical_place_id, s.payload->>'property_type',
         COALESCE(NULLIF(s.payload #>> '{unit,attributes,project}', ''), s.payload->>'title'),
         COALESCE(s.payload #> '{unit,attributes}', '{}'::jsonb)
           || jsonb_build_object('provider', s.provider), now()
       FROM integration.housing_staging s
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted' AND s.publish_action <> 'protected'
       ON CONFLICT (id) DO UPDATE SET
         place_id = EXCLUDED.place_id, property_type = EXCLUDED.property_type,
         name = EXCLUDED.name, attributes = EXCLUDED.attributes, updated_at = now()`,
      [runId],
    )

    await client.query(
      `INSERT INTO housing.units (
         id, property_id, unit_code, bedrooms, bathrooms, area_m2, amenities, attributes, updated_at
       )
       SELECT s.canonical_unit_id, s.canonical_property_id,
         COALESCE(NULLIF(s.payload #>> '{unit,unit_code}', ''), 'source:' || s.provider || ':' || s.source_listing_id),
         NULLIF(s.payload #>> '{unit,bedrooms}', '')::numeric,
         NULLIF(s.payload #>> '{unit,bathrooms}', '')::numeric,
         NULLIF(s.payload #>> '{unit,area_m2}', '')::numeric,
         ARRAY(SELECT jsonb_array_elements_text(COALESCE(s.payload #> '{unit,amenities}', '[]'::jsonb))),
         COALESCE(s.payload #> '{unit,attributes}', '{}'::jsonb)
           || jsonb_build_object('synthetic_unit', NULLIF(s.payload #>> '{unit,unit_code}', '') IS NULL),
         now()
       FROM integration.housing_staging s
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted' AND s.publish_action <> 'protected'
       ON CONFLICT (id) DO UPDATE SET
         property_id = EXCLUDED.property_id, unit_code = EXCLUDED.unit_code,
         bedrooms = EXCLUDED.bedrooms, bathrooms = EXCLUDED.bathrooms,
         area_m2 = EXCLUDED.area_m2, amenities = EXCLUDED.amenities,
         attributes = EXCLUDED.attributes, updated_at = now()`,
      [runId],
    )

    await client.query(
      `INSERT INTO housing.listings (
         id, property_id, unit_id, listing_type, title, description, source_type,
         source_listing_id, source_url, status, verification_status, verified_at,
         verified_by, attributes, published_at, updated_at
       )
       SELECT s.canonical_listing_id, s.canonical_property_id, s.canonical_unit_id,
         s.payload->>'listing_type', s.payload->>'title', s.payload->>'description',
         'partner', s.provider || ':' || s.source_listing_id, s.source_url,
         s.payload->>'status',
         COALESCE(s.payload #>> '{verification,status}', 'unverified'),
         NULLIF(s.payload #>> '{verification,checked_at}', '')::timestamptz,
         NULLIF(s.payload #>> '{verification,checked_by}', ''),
         jsonb_build_object(
           'provider', s.provider,
           'original_source_listing_id', s.source_listing_id,
           'observed_at', s.observed_at,
           'location_accuracy', COALESCE(s.payload #>> '{location,accuracy}', 'unknown'),
           'location_method', s.payload #>> '{location,method}',
           'quality', COALESCE(s.payload->'quality', '{}'::jsonb),
           'derived', COALESCE(s.payload->'derived', '{}'::jsonb),
           'unknown_fields', COALESCE(s.payload->'unknown_fields', '{}'::jsonb),
           'last_import_run_id', s.import_run_id
         ),
         COALESCE(NULLIF(s.payload #>> '{derived,published_at}', '')::timestamptz, s.observed_at),
         now()
       FROM integration.housing_staging s
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted' AND s.publish_action <> 'protected'
       ON CONFLICT (id) DO UPDATE SET
         property_id = EXCLUDED.property_id, unit_id = EXCLUDED.unit_id,
         listing_type = EXCLUDED.listing_type, title = EXCLUDED.title,
         description = EXCLUDED.description, source_url = EXCLUDED.source_url,
         status = EXCLUDED.status, verification_status = EXCLUDED.verification_status,
         verified_at = EXCLUDED.verified_at, verified_by = EXCLUDED.verified_by,
         attributes = EXCLUDED.attributes, published_at = EXCLUDED.published_at,
         updated_at = now()
       WHERE housing.listings.verification_status <> 'lifeflow_verified'`,
      [runId],
    )

    await client.query(
      `UPDATE housing.offers old_offer
       SET is_active = false, valid_to = COALESCE(old_offer.valid_to, now())
       FROM integration.housing_staging s
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted'
         AND s.publish_action <> 'protected'
         AND old_offer.listing_id = s.canonical_listing_id
         AND old_offer.is_active AND old_offer.id <> s.canonical_offer_id`,
      [runId],
    )

    await client.query(
      `INSERT INTO housing.offers (
         id, listing_id, price_amount, currency, price_period, deposit_amount,
         availability_from, availability_to, valid_from, is_active, attributes
       )
       SELECT s.canonical_offer_id, s.canonical_listing_id,
         (s.payload #>> '{offer,price_amount}')::numeric,
         s.payload #>> '{offer,currency}', s.payload #>> '{offer,price_period}',
         NULLIF(s.payload #>> '{offer,deposit_amount}', '')::numeric,
         NULLIF(s.payload #>> '{offer,availability_from}', '')::date,
         NULLIF(s.payload #>> '{offer,availability_to}', '')::date,
         COALESCE(NULLIF(s.payload #>> '{offer,valid_from}', '')::timestamptz, s.observed_at, now()),
         true, COALESCE(s.payload #> '{offer,attributes}', '{}'::jsonb)
       FROM integration.housing_staging s
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted' AND s.publish_action <> 'protected'
       ON CONFLICT (id) DO UPDATE SET
         price_amount = EXCLUDED.price_amount, currency = EXCLUDED.currency,
         price_period = EXCLUDED.price_period, deposit_amount = EXCLUDED.deposit_amount,
         availability_from = EXCLUDED.availability_from,
         availability_to = EXCLUDED.availability_to,
         valid_from = EXCLUDED.valid_from, valid_to = NULL, is_active = true,
         attributes = EXCLUDED.attributes`,
      [runId],
    )

    await client.query(
      `INSERT INTO housing.listing_media (
         listing_id, url, alt_text, position, is_primary, source_type, attributes
       )
       SELECT s.canonical_listing_id, media.item->>'url', media.item->>'alt',
         (media.ordinality - 1)::integer, media.ordinality = 1, s.provider,
         jsonb_build_object('import_run_id', s.import_run_id)
       FROM integration.housing_staging s
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.payload->'media', '[]'::jsonb))
         WITH ORDINALITY AS media(item, ordinality)
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted'
         AND s.publish_action <> 'protected'
         AND NULLIF(media.item->>'url', '') IS NOT NULL
       ON CONFLICT (listing_id, url) DO UPDATE SET
         alt_text = EXCLUDED.alt_text, position = EXCLUDED.position,
         is_primary = EXCLUDED.is_primary, attributes = EXCLUDED.attributes,
         updated_at = now()`,
      [runId],
    )

    await client.query(
      `INSERT INTO integration.source_records (
         import_run_id, entity_type, entity_id, source_type, source_id, payload,
         payload_hash, validation_status, validation_errors, geom, first_seen_at,
         last_seen_at, source_version, status
       )
       SELECT s.import_run_id, 'housing_listing',
         CASE WHEN s.validation_status = 'accepted' THEN s.canonical_listing_id ELSE NULL END,
         s.provider, s.source_listing_id, s.payload, s.payload_hash,
         s.validation_status, s.validation_errors,
         CASE WHEN s.longitude IS NULL OR s.latitude IS NULL THEN NULL
           ELSE ST_SetSRID(ST_MakePoint(s.longitude, s.latitude), 4326) END,
         now(), now(), $2, 'active'
       FROM integration.housing_staging s WHERE s.import_run_id = $1
       ON CONFLICT (source_type, source_id, payload_hash) DO UPDATE SET
         import_run_id = EXCLUDED.import_run_id,
         entity_id = COALESCE(EXCLUDED.entity_id, integration.source_records.entity_id),
         validation_status = CASE
           WHEN integration.source_records.validation_status = 'accepted' THEN 'accepted'
           ELSE EXCLUDED.validation_status END,
         validation_errors = CASE
           WHEN integration.source_records.validation_status = 'accepted'
             THEN integration.source_records.validation_errors
           ELSE EXCLUDED.validation_errors END,
         geom = EXCLUDED.geom, last_seen_at = now(), source_version = EXCLUDED.source_version,
         status = 'active'`,
      [runId, sourceVersion],
    )

    await client.query(
      `UPDATE integration.housing_staging
       SET publish_action = CASE WHEN publish_action = 'pending' THEN 'published' ELSE publish_action END
       WHERE import_run_id = $1`,
      [runId],
    )

    const result = await client.query<{
      input_count: string
      accepted_count: string
      rejected_count: string
      duplicate_count: string
      quarantined_count: string
      published_count: string
      updated_count: string
      protected_count: string
    }>(
      `SELECT count(*) AS input_count,
         count(*) FILTER (WHERE validation_status = 'accepted') AS accepted_count,
         count(*) FILTER (WHERE validation_status = 'rejected') AS rejected_count,
         count(*) FILTER (WHERE validation_status = 'duplicate') AS duplicate_count,
         count(*) FILTER (WHERE validation_status = 'quarantined') AS quarantined_count,
         count(*) FILTER (WHERE publish_action = 'published') AS published_count,
         count(*) FILTER (WHERE publish_action = 'updated') AS updated_count,
         count(*) FILTER (WHERE publish_action = 'protected') AS protected_count
       FROM integration.housing_staging WHERE import_run_id = $1`,
      [runId],
    )
    const final = result.rows[0]!
    await client.query(
      `UPDATE geo.import_runs SET status = 'completed', completed_at = now(),
         input_count = $2, staged_count = $2, accepted_count = $3,
         rejected_count = $4, duplicate_count = $5, published_count = $6,
         unchanged_count = $7,
         diagnostics = diagnostics || jsonb_build_object(
           'quarantined_count', $8::integer,
           'updated_count', $9::integer,
           'protected_count', $10::integer,
           'source_file_preserved', true
         )
       WHERE id = $1`,
      [runId, final.input_count, final.accepted_count, final.rejected_count,
        final.duplicate_count, final.published_count,
        Number(final.updated_count) + Number(final.protected_count), final.quarantined_count,
        final.updated_count, final.protected_count],
    )

    await client.query('COMMIT')
    return final
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function main() {
  const checksum = await hashFile(sourcePath)
  const run = await pool.query<{ id: string }>(
    `INSERT INTO geo.import_runs (
       source_type, source_path, source_checksum, source_version, status, diagnostics
     ) VALUES ('housing_partner', $1, $2, $3, 'running',
       jsonb_build_object('source_file_preserved', true, 'batch_size', $4::integer))
     RETURNING id`,
    [sourcePath, checksum, sourceVersion, BATCH_SIZE],
  )
  const runId = run.rows[0]!.id
  const seen = new Set<string>()
  let batch: StagingRow[] = []
  let lineCount = 0

  try {
    for await (const rawLine of readJsonRecords(sourcePath)) {
      lineCount += 1
      batch.push(stagingRow(rawLine, lineCount, seen))
      if (batch.length >= BATCH_SIZE) {
        await insertStagingBatch(runId, batch)
        batch = []
        if (lineCount % 5_000 === 0) process.stderr.write(`Staged ${lineCount} housing records\n`)
      }
    }
    await insertStagingBatch(runId, batch)
    const final = await publish(runId)
    process.stderr.write(`Housing import completed (${runId}): ${JSON.stringify(final)}\n`)
  } catch (error) {
    await pool.query(
      `UPDATE geo.import_runs SET status = 'failed', completed_at = now(),
         diagnostics = diagnostics || jsonb_build_object('error', $2::text, 'source_file_preserved', true)
       WHERE id = $1`,
      [runId, error instanceof Error ? error.message : 'Unknown import error'],
    )
    throw error
  }
}

try {
  await main()
} finally {
  await pool.end()
}
