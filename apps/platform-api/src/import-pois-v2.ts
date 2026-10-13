import { resolveInputPath } from './runtime-paths.js'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { createInterface } from 'node:readline'
import { createDatabasePool, getRuntimeConfig } from '@relohome/housing-query'
import {
  normalizePoiCategory,
  normalizedAddress,
  optionalTag,
  parseOsmIdentity,
  type OsmTags,
} from './poi-normalization.js'

interface GeoJsonFeature {
  type: 'Feature'
  id?: unknown
  geometry: { type: string; coordinates: unknown } | null
  properties: OsmTags | null
}

interface StagingRow {
  sourceId: string
  osmFeatureId: string | null
  osmType: string | null
  osmId: number | null
  geometry: unknown
  rawTags: OsmTags
  payloadHash: string
  categorySlug: string | null
  name: string | null
  address: Record<string, unknown>
  phone: string | null
  website: string | null
  openingHours: string | null
  validationStatus: 'accepted' | 'rejected' | 'duplicate'
  validationErrors: string[]
  canonicalPlaceId: string | null
  publishAction: 'pending' | 'duplicate' | 'rejected'
}

const BATCH_SIZE = 500
const config = getRuntimeConfig()
const pool = createDatabasePool(config.ingestDatabaseUrl, 4)
const sourcePath = resolveInputPath(requiredPath('POI_V2_SOURCE_PATH'))
const pbfPath = resolveInputPath(requiredPath('OSM_PBF_PATH'))
const sourceVersion = process.env.OSM_SOURCE_VERSION || basename(pbfPath)

function requiredPath(name: string) {
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

function toStagingRow(feature: GeoJsonFeature, rawLine: string, duplicate: boolean): StagingRow {
  const tags = feature.properties || {}
  const identity = parseOsmIdentity(feature.id)
  const categorySlug = normalizePoiCategory(tags)
  const errors: string[] = []
  if (!identity) errors.push('missing_or_invalid_osm_identity')
  if (!feature.geometry) errors.push('missing_geometry')
  if (!categorySlug) errors.push('unsupported_category')

  const validationStatus = duplicate ? 'duplicate' : errors.length ? 'rejected' : 'accepted'
  const sourceId = identity?.sourceId || `invalid:${createHash('sha256').update(rawLine).digest('hex')}`

  return {
    sourceId,
    osmFeatureId: typeof feature.id === 'string' ? feature.id : null,
    osmType: identity?.osmType || null,
    osmId: identity?.osmId || null,
    geometry: feature.geometry,
    rawTags: tags,
    payloadHash: createHash('sha256').update(rawLine).digest('hex'),
    categorySlug,
    name: optionalTag(tags, 'name'),
    address: normalizedAddress(tags),
    phone: optionalTag(tags, 'phone', 'contact:phone'),
    website: optionalTag(tags, 'website', 'contact:website'),
    openingHours: optionalTag(tags, 'opening_hours'),
    validationStatus,
    validationErrors: duplicate ? ['duplicate_source_id_in_import'] : errors,
    // Keep the exported source ID for provenance; identity is the underlying OSM object.
    canonicalPlaceId: validationStatus === 'accepted' ? stableUuid(`osm:${identity!.osmType}/${identity!.osmId}`) : null,
    publishAction: duplicate ? 'duplicate' : errors.length ? 'rejected' : 'pending',
  }
}

async function insertStagingBatch(runId: string, rows: StagingRow[]) {
  if (!rows.length) return
  await pool.query(
    `WITH input AS (
       SELECT *
       FROM jsonb_to_recordset($2::jsonb) AS x(
         source_id text, osmium_feature_id text, osm_type text, osm_id bigint, geometry jsonb, raw_tags jsonb,
         payload_hash text, category_slug text, name text, address jsonb, phone text,
         website text, opening_hours text, validation_status text,
         validation_errors jsonb, canonical_place_id uuid, publish_action text
       )
     ), parsed AS (
       SELECT input.*,
         CASE WHEN geometry IS NULL THEN NULL ELSE
           ST_Force2D(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geometry::text), 4326)))
         END AS source_geom
       FROM input
     )
     INSERT INTO geo.poi_staging (
       import_run_id, source_type, source_id, osmium_feature_id, osm_type, osm_id, source_geom,
       representative_geom, raw_tags, payload_hash, category_slug, name, address,
       phone, website, opening_hours, validation_status, validation_errors,
       canonical_place_id, publish_action
     )
     SELECT
       $1, 'osm', source_id, osmium_feature_id, osm_type, osm_id, source_geom,
       CASE WHEN source_geom IS NULL THEN NULL ELSE ST_PointOnSurface(source_geom) END,
       raw_tags, payload_hash, category_slug, name, address, phone, website,
       opening_hours, validation_status, validation_errors, canonical_place_id,
       publish_action
     FROM parsed`,
    [runId, JSON.stringify(rows.map((row) => ({
      source_id: row.sourceId,
      osmium_feature_id: row.osmFeatureId,
      osm_type: row.osmType,
      osm_id: row.osmId,
      geometry: row.geometry,
      raw_tags: row.rawTags,
      payload_hash: row.payloadHash,
      category_slug: row.categorySlug,
      name: row.name,
      address: row.address,
      phone: row.phone,
      website: row.website,
      opening_hours: row.openingHours,
      validation_status: row.validationStatus,
      validation_errors: row.validationErrors,
      canonical_place_id: row.canonicalPlaceId,
      publish_action: row.publishAction,
    })))],
  )
}

async function publish(runId: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(1042026,11)')
    // Conflicting representations require review; don't choose an arbitrary name/category.
    await client.query(`WITH conflicts AS (
      SELECT osm_type,osm_id FROM geo.poi_staging
      WHERE import_run_id=$1 AND validation_status='accepted'
      GROUP BY osm_type,osm_id
      HAVING count(DISTINCT category_slug)>1 OR count(DISTINCT lower(btrim(name)))>1
        OR count(DISTINCT catalog.poi_unit_signature(raw_tags))>1
    ) UPDATE geo.poi_staging s SET validation_status='rejected',publish_action='rejected',
      validation_errors=s.validation_errors || '["osm_identity_conflict"]'::jsonb
    FROM conflicts c WHERE s.import_run_id=$1 AND s.osm_type=c.osm_type AND s.osm_id=c.osm_id
      AND s.validation_status='accepted'`, [runId])

    const accounting = await client.query<{
      total: string
      accepted: string
      rejected: string
      duplicate: string
      invalid_geometry: string
    }>(
      `SELECT
         count(*) AS total,
         count(*) FILTER (WHERE validation_status = 'accepted') AS accepted,
         count(*) FILTER (WHERE validation_status = 'rejected') AS rejected,
         count(*) FILTER (WHERE validation_status = 'duplicate') AS duplicate,
         count(*) FILTER (
           WHERE validation_status = 'accepted'
             AND (source_geom IS NULL OR representative_geom IS NULL
               OR NOT ST_IsValid(source_geom) OR ST_SRID(source_geom) <> 4326
               OR ST_SRID(representative_geom) <> 4326)
         ) AS invalid_geometry
       FROM geo.poi_staging WHERE import_run_id = $1`,
      [runId],
    )
    const counts = accounting.rows[0]!
    if (Number(counts.total) !== Number(counts.accepted) + Number(counts.rejected) + Number(counts.duplicate)) {
      throw new Error('Import accounting mismatch before publish.')
    }
    if (Number(counts.invalid_geometry) !== 0) throw new Error('Accepted staging rows contain invalid geometry.')

    await client.query(
      `UPDATE geo.poi_staging s
       SET canonical_place_id = p.id,
           publish_action = CASE
             WHEN p.verification_status = 'lifeflow_verified' THEN 'protected'
             ELSE 'updated'
           END
       FROM catalog.place_sources ps
       JOIN catalog.places p ON p.id = ps.place_id
       WHERE s.import_run_id = $1
         AND s.validation_status = 'accepted'
         AND s.publish_action = 'pending'
         AND ps.source_type = s.source_type
         AND ps.source_id = s.source_id`,
      [runId],
    )

    await client.query(`WITH unique_objects AS (
      SELECT catalog.osm_object_identity(ps.source_id) AS identity,
        min(ps.place_id::text)::uuid AS place_id
      FROM catalog.place_sources ps
      WHERE ps.source_type='osm' AND catalog.osm_object_identity(ps.source_id) IS NOT NULL
      GROUP BY catalog.osm_object_identity(ps.source_id)
      HAVING count(DISTINCT ps.place_id)=1
    ) UPDATE geo.poi_staging s SET canonical_place_id=p.id,
      publish_action=CASE WHEN p.verification_status='lifeflow_verified' THEN 'protected' ELSE 'updated' END
    FROM unique_objects u JOIN catalog.places p ON p.id=u.place_id
    WHERE s.import_run_id=$1 AND s.validation_status='accepted' AND s.publish_action='pending'
      AND u.identity=s.osm_type || '/' || s.osm_id`, [runId])

    await client.query(
      `WITH candidates AS (
         SELECT s.id AS staging_id, p.id AS place_id,
           count(*) OVER (PARTITION BY s.id) AS candidate_count,
           count(*) OVER (PARTITION BY p.id) AS incoming_count,
           p.verification_status
         FROM geo.poi_staging s
         JOIN catalog.place_categories c ON c.slug = s.category_slug
         JOIN catalog.places p ON p.category_id = c.id
           AND p.deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM catalog.place_sources existing_source
             WHERE existing_source.place_id = p.id AND existing_source.source_type = 'osm'
           )
           AND ST_DWithin(p.geog, s.representative_geom::geography,
             CASE WHEN s.name IS NULL THEN 0.5 ELSE 3 END)
           AND catalog.poi_unit_signature(p.attributes)=catalog.poi_unit_signature(s.raw_tags)
           AND (
             (s.name IS NOT NULL AND p.name IS NOT NULL
               AND geo.normalize_search(p.name) = geo.normalize_search(s.name))
             OR (s.name IS NULL AND p.name IS NULL)
           )
         WHERE s.import_run_id = $1
           AND s.validation_status = 'accepted'
           AND s.publish_action = 'pending'
       ), unique_candidates AS (
         SELECT * FROM candidates WHERE candidate_count = 1 AND incoming_count = 1
       )
       UPDATE geo.poi_staging s
       SET canonical_place_id = c.place_id,
           publish_action = CASE
             WHEN c.verification_status = 'lifeflow_verified' THEN 'protected'
             ELSE 'matched_existing'
           END
       FROM unique_candidates c
       WHERE s.id = c.staging_id`,
      [runId],
    )

    await client.query(
      `UPDATE geo.poi_staging s
       SET possible_duplicate = true
       WHERE s.import_run_id = $1
         AND s.validation_status = 'accepted'
         AND s.publish_action = 'pending'
         AND EXISTS (
           SELECT 1
           FROM catalog.places p
           JOIN catalog.place_categories c ON c.id = p.category_id
           WHERE c.slug = s.category_slug
             AND p.deleted_at IS NULL
             AND ST_DWithin(p.geog, s.representative_geom::geography, 25)
             AND s.name IS NOT NULL AND p.name IS NOT NULL
             AND geo.normalize_search(p.name) = geo.normalize_search(s.name)
         )`,
      [runId],
    )

    await client.query(
      `UPDATE geo.poi_staging s
       SET publish_action = CASE
         WHEN p.verification_status = 'lifeflow_verified' THEN 'protected'
         ELSE 'updated'
       END
       FROM catalog.places p
       WHERE s.import_run_id = $1
         AND s.validation_status = 'accepted'
         AND s.publish_action = 'pending'
         AND p.id = s.canonical_place_id`,
      [runId],
    )

    await client.query(
      `INSERT INTO catalog.places (
         id, category_id, name, geom, address, phone, website, opening_hours,
         attributes, status, updated_at
       )
       SELECT DISTINCT ON (s.canonical_place_id)
         s.canonical_place_id, c.id, s.name, s.representative_geom, s.address,
         s.phone, s.website, s.opening_hours,
         s.raw_tags || jsonb_build_object(
           'source_geometry_type', ST_GeometryType(s.source_geom),
           'possible_duplicate', s.possible_duplicate
         ), 'active', now()
       FROM geo.poi_staging s
       JOIN catalog.place_categories c ON c.slug = s.category_slug
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted'
       ORDER BY s.canonical_place_id,
         CASE WHEN s.name IS NULL OR btrim(s.name) = '' THEN 1 ELSE 0 END,
         CASE WHEN s.source_id LIKE 'area/%' THEN 0 ELSE 1 END,
         s.created_at, s.id
       ON CONFLICT (id) DO UPDATE SET
         category_id = EXCLUDED.category_id,
         name = EXCLUDED.name,
         geom = EXCLUDED.geom,
         address = EXCLUDED.address,
         phone = EXCLUDED.phone,
         website = EXCLUDED.website,
         opening_hours = EXCLUDED.opening_hours,
         attributes = EXCLUDED.attributes,
         status = 'active',
         updated_at = now()
       WHERE catalog.places.verification_status <> 'lifeflow_verified'`,
      [runId],
    )

    await client.query(
      `UPDATE geo.poi_staging
       SET publish_action = 'published'
       WHERE import_run_id = $1 AND validation_status = 'accepted' AND publish_action = 'pending'`,
      [runId],
    )

    await client.query(
      `INSERT INTO catalog.place_sources (
         place_id, import_run_id, source_type, source_id, source_url, source_payload, observed_at
       )
       SELECT s.canonical_place_id, s.import_run_id, s.source_type, s.source_id,
         'https://www.openstreetmap.org/' || s.osm_type || '/' || s.osm_id,
         jsonb_build_object(
           'type', 'Feature', 'id', s.source_id,
           'osmium_feature_id', s.osmium_feature_id,
           'geometry', ST_AsGeoJSON(s.source_geom)::jsonb,
           'properties', s.raw_tags
         ), now()
       FROM geo.poi_staging s
       WHERE s.import_run_id = $1 AND s.validation_status = 'accepted'
       ON CONFLICT (source_type, source_id) DO UPDATE SET
         place_id = EXCLUDED.place_id,
         import_run_id = EXCLUDED.import_run_id,
         source_url = EXCLUDED.source_url,
         source_payload = EXCLUDED.source_payload,
         observed_at = now()`,
      [runId],
    )

    await client.query(
      `INSERT INTO integration.source_records (
         import_run_id, entity_type, entity_id, source_type, source_id, payload,
         payload_hash, validation_status, validation_errors, osm_type, osm_id,
         geom, first_seen_at, last_seen_at, source_version, status
       )
       SELECT DISTINCT ON (s.source_type, s.source_id, s.payload_hash)
         s.import_run_id, 'place', s.canonical_place_id, s.source_type, s.source_id,
         jsonb_build_object(
           'type', 'Feature', 'id', s.source_id,
           'osmium_feature_id', s.osmium_feature_id,
           'geometry', CASE WHEN s.source_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(s.source_geom)::jsonb END,
           'properties', s.raw_tags
         ), s.payload_hash, s.validation_status, s.validation_errors, s.osm_type,
         s.osm_id, s.source_geom, now(), now(), $2, 'active'
       FROM geo.poi_staging s WHERE s.import_run_id = $1
       ORDER BY s.source_type, s.source_id, s.payload_hash,
         CASE s.validation_status WHEN 'accepted' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
         s.created_at, s.id
       ON CONFLICT (source_type, source_id, payload_hash) DO UPDATE SET
         import_run_id = EXCLUDED.import_run_id,
         entity_id = COALESCE(EXCLUDED.entity_id, integration.source_records.entity_id),
         validation_status = CASE
           WHEN integration.source_records.validation_status = 'accepted' THEN 'accepted'
           ELSE EXCLUDED.validation_status
         END,
         validation_errors = CASE
           WHEN integration.source_records.validation_status = 'accepted'
             THEN integration.source_records.validation_errors
           ELSE EXCLUDED.validation_errors
         END,
         geom = EXCLUDED.geom,
         last_seen_at = now(),
         source_version = EXCLUDED.source_version,
         status = 'active'`,
      [runId, sourceVersion],
    )

    const result = await client.query<{
      input_count: string
      accepted_count: string
      rejected_count: string
      duplicate_count: string
      published_count: string
      unchanged_count: string
    }>(
      `SELECT
         count(*) AS input_count,
         count(*) FILTER (WHERE validation_status = 'accepted') AS accepted_count,
         count(*) FILTER (WHERE validation_status = 'rejected') AS rejected_count,
         count(*) FILTER (WHERE validation_status = 'duplicate') AS duplicate_count,
         count(*) FILTER (WHERE publish_action = 'published') AS published_count,
         count(*) FILTER (WHERE validation_status = 'accepted' AND publish_action <> 'published') AS unchanged_count
       FROM geo.poi_staging WHERE import_run_id = $1`,
      [runId],
    )
    const final = result.rows[0]!
    await client.query(
      `UPDATE geo.import_runs SET
         status = 'completed', completed_at = now(), input_count = $2,
         staged_count = $2, accepted_count = $3, rejected_count = $4,
         duplicate_count = $5, published_count = $6, unchanged_count = $7,
         diagnostics = diagnostics || jsonb_build_object(
           'accounting_valid', ($2::integer = $3::integer + $4::integer + $5::integer)
         )
       WHERE id = $1`,
      [runId, final.input_count, final.accepted_count, final.rejected_count,
        final.duplicate_count, final.published_count, final.unchanged_count],
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
  const [artifactChecksum, pbfChecksum] = await Promise.all([hashFile(sourcePath), hashFile(pbfPath)])
  const run = await pool.query<{ id: string }>(
    `INSERT INTO geo.import_runs (
       source_type, source_path, source_checksum, source_version, status, diagnostics
     ) VALUES (
       'osm', $1, $2, $3, 'running',
       jsonb_build_object('extract_path', $4::text, 'extract_checksum', $5::text)
     ) RETURNING id`,
    [pbfPath, pbfChecksum, sourceVersion, sourcePath, artifactChecksum],
  )
  const runId = run.rows[0]!.id
  const seen = new Set<string>()
  let batch: StagingRow[] = []
  let lineCount = 0

  try {
    const lines = createInterface({ input: createReadStream(sourcePath), crlfDelay: Infinity })
    for await (const value of lines) {
      const rawLine = value.replace(/^\x1e/, '').trim()
      if (!rawLine) continue
      lineCount += 1
      let row: StagingRow
      try {
        const feature = JSON.parse(rawLine) as GeoJsonFeature
        const identity = parseOsmIdentity(feature.id)
        const duplicate = identity ? seen.has(identity.sourceId) : false
        if (identity) seen.add(identity.sourceId)
        row = toStagingRow(feature, rawLine, duplicate)
      } catch (error) {
        row = {
          sourceId: `invalid-line:${lineCount}`,
          osmFeatureId: null,
          osmType: null,
          osmId: null,
          geometry: null,
          rawTags: {},
          payloadHash: createHash('sha256').update(rawLine).digest('hex'),
          categorySlug: null,
          name: null,
          address: {},
          phone: null,
          website: null,
          openingHours: null,
          validationStatus: 'rejected',
          validationErrors: [error instanceof Error ? error.message : 'invalid_json'],
          canonicalPlaceId: null,
          publishAction: 'rejected',
        }
      }
      batch.push(row)
      if (batch.length >= BATCH_SIZE) {
        await insertStagingBatch(runId, batch)
        batch = []
        if (lineCount % 10_000 === 0) process.stderr.write(`Staged ${lineCount} POIs\n`)
      }
    }
    await insertStagingBatch(runId, batch)
    const final = await publish(runId)
    process.stderr.write(`POI v2 import completed (${runId}): ${JSON.stringify(final)}\n`)
  } catch (error) {
    await pool.query(
      `UPDATE geo.import_runs SET status = 'failed', completed_at = now(),
         diagnostics = diagnostics || jsonb_build_object('error', $2::text)
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
