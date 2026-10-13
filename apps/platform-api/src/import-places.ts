import { resolveInputPath } from './runtime-paths.js'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { createDatabasePool, getRuntimeConfig } from '@relohome/housing-query'

interface GeoJsonFeature {
  id?: string | number
  type: 'Feature'
  geometry: { type: string; coordinates: unknown } | null
  properties: Record<string, unknown> | null
}

interface FeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

const config = getRuntimeConfig()
const pool = createDatabasePool(config.ingestDatabaseUrl, 4)
function requiredEnvironmentPath(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}
const poiPath = resolveInputPath(requiredEnvironmentPath('POI_SOURCE_PATH'))
const boundaryDirectory = resolveInputPath(requiredEnvironmentPath('BOUNDARY_SOURCE_DIR'))

function stableUuid(value: string) {
  const bytes = Buffer.from(createHash('sha256').update(value).digest('hex').slice(0, 32), 'hex')
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function sourceId(feature: GeoJsonFeature) {
  const properties = feature.properties || {}
  const explicit = feature.id ?? properties['@id'] ?? properties.osm_id
  if (explicit !== undefined && explicit !== null) return String(explicit)
  return `sha256:${createHash('sha256').update(JSON.stringify(feature)).digest('hex')}`
}

function category(properties: Record<string, unknown>) {
  const value = properties.tourism || properties.amenity || properties.shop
  if (typeof value !== 'string') return 'accommodation'
  return value.trim().toLowerCase().replaceAll(' ', '_') || 'accommodation'
}

function categoryParent(slug: string) {
  return [
    'hotel',
    'hostel',
    'guest_house',
    'motel',
    'homestay',
    'apartment',
    'chalet',
    'camp_site',
  ].includes(slug)
    ? 'accommodation'
    : null
}

function address(properties: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => key.startsWith('addr:') && value !== null),
  )
}

async function importBoundaries() {
  const files = (await readdir(boundaryDirectory)).filter((file) => extname(file).toLowerCase() === '.geojson')
  for (const file of files) {
    const slug = basename(file, extname(file)).toLowerCase()
    const data = JSON.parse(await readFile(resolve(boundaryDirectory, file), 'utf8')) as FeatureCollection
    let index = 0
    for (const feature of data.features) {
      if (!feature.geometry) continue
      await pool.query(
        `INSERT INTO geo.administrative_areas (id, name, level, source, source_id, geom, attributes)
         VALUES (
           $1, $2, 'city', 'local_boundary', $3,
           ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)), 3)),
           $5::jsonb
         )
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           geom = CASE
             WHEN $6::boolean THEN EXCLUDED.geom
             ELSE ST_Multi(ST_UnaryUnion(ST_Collect(geo.administrative_areas.geom, EXCLUDED.geom)))
           END,
           attributes = EXCLUDED.attributes,
           updated_at = now()`,
        [
          slug,
          String(feature.properties?.name || slug),
          `${slug}:${index}`,
          JSON.stringify(feature.geometry),
          JSON.stringify(feature.properties || {}),
          index === 0,
        ],
      )
      index += 1
    }
  }
}

async function importPois() {
  const raw = await readFile(poiPath, 'utf8')
  const checksum = createHash('sha256').update(raw).digest('hex')
  const data = JSON.parse(raw) as FeatureCollection
  const run = await pool.query<{ id: string }>(
    `INSERT INTO geo.import_runs (source_type, source_path, source_checksum, status, input_count)
     VALUES ('osm', $1, $2, 'running', $3)
     RETURNING id`,
    [poiPath, checksum, data.features.length],
  )
  const runId = run.rows[0]!.id
  let accepted = 0
  let rejected = 0
  let duplicateCount = 0
  const seenSourceIds = new Set<string>()

  try {
    for (const [index, feature] of data.features.entries()) {
      if (!feature.geometry) {
        rejected += 1
        continue
      }
      const properties = feature.properties || {}
      const featureSourceId = sourceId(feature)
      const placeId = stableUuid(`osm:${featureSourceId}`)
      const categorySlug = category(properties)
      const payloadHash = createHash('sha256').update(JSON.stringify(feature)).digest('hex')
      if (seenSourceIds.has(featureSourceId)) {
        duplicateCount += 1
        await pool.query(
          `INSERT INTO integration.source_records (
             import_run_id, entity_type, entity_id, source_type, source_id,
             payload, payload_hash, validation_status
           ) VALUES ($1, 'place', $2, 'osm', $3, $4::jsonb, $5, 'duplicate')
           ON CONFLICT (source_type, source_id, payload_hash) DO UPDATE SET
             import_run_id = EXCLUDED.import_run_id,
             validation_status = 'duplicate'`,
          [runId, placeId, featureSourceId, JSON.stringify(feature), payloadHash],
        )
        continue
      }
      seenSourceIds.add(featureSourceId)
      const osmUrl = /^(node|way|relation)\//.test(featureSourceId)
        ? `https://www.openstreetmap.org/${featureSourceId}`
        : null

      try {
        await pool.query(
          `WITH category AS (
             INSERT INTO catalog.place_categories (slug, name, parent_slug)
             VALUES ($1, $1, $13)
             ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
             RETURNING id
           ), upsert_place AS (
             INSERT INTO catalog.places (
               id, category_id, name, geom, address, phone, website, attributes, updated_at
             )
             SELECT
               $2, category.id, $3,
               ST_PointOnSurface(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))),
               $5::jsonb, $6, $7, $8::jsonb, now()
             FROM category
             ON CONFLICT (id) DO UPDATE SET
               category_id = EXCLUDED.category_id,
               name = EXCLUDED.name,
               geom = EXCLUDED.geom,
               address = EXCLUDED.address,
               phone = EXCLUDED.phone,
               website = EXCLUDED.website,
               attributes = EXCLUDED.attributes,
               status = 'active',
               updated_at = now()
             WHERE catalog.places.verification_status <> 'lifeflow_verified'
             RETURNING id
           )
           INSERT INTO catalog.place_sources (
             place_id, import_run_id, source_type, source_id, source_url, source_payload, observed_at
           )
           VALUES ($2, $9, 'osm', $10, $11, $12::jsonb, now())
           ON CONFLICT (source_type, source_id) DO UPDATE SET
             place_id = EXCLUDED.place_id,
             import_run_id = EXCLUDED.import_run_id,
             source_url = EXCLUDED.source_url,
             source_payload = EXCLUDED.source_payload,
             observed_at = now()`,
          [
            categorySlug,
            placeId,
            typeof properties.name === 'string' ? properties.name : null,
            JSON.stringify(feature.geometry),
            JSON.stringify(address(properties)),
            properties.phone || properties['contact:phone'] || null,
            properties.website || properties['contact:website'] || null,
            JSON.stringify(properties),
            runId,
            featureSourceId,
            osmUrl,
            JSON.stringify(feature),
            categoryParent(categorySlug),
          ],
        )
        await pool.query(
          `INSERT INTO integration.source_records (
             import_run_id, entity_type, entity_id, source_type, source_id,
             payload, payload_hash, validation_status
           ) VALUES ($1, 'place', $2, 'osm', $3, $4::jsonb, $5, 'accepted')
           ON CONFLICT (source_type, source_id, payload_hash) DO UPDATE SET
             import_run_id = EXCLUDED.import_run_id,
             entity_id = EXCLUDED.entity_id,
             validation_status = 'accepted'`,
          [runId, placeId, featureSourceId, JSON.stringify(feature), payloadHash],
        )
        accepted += 1
      } catch (error) {
        rejected += 1
        await pool.query(
          `INSERT INTO integration.source_records (
             import_run_id, entity_type, source_type, source_id,
             payload, payload_hash, validation_status, validation_errors
           ) VALUES ($1, 'place', 'osm', $2, $3::jsonb, $4, 'rejected', $5::jsonb)
           ON CONFLICT (source_type, source_id, payload_hash) DO NOTHING`,
          [
            runId,
            featureSourceId,
            JSON.stringify(feature),
            payloadHash,
            JSON.stringify([error instanceof Error ? error.message : 'Unknown import error']),
          ],
        )
      }

      if ((index + 1) % 1000 === 0) process.stderr.write(`Imported ${index + 1}/${data.features.length} POIs\n`)
    }

    await pool.query(
      `UPDATE geo.import_runs
       SET status = 'completed', completed_at = now(), accepted_count = $2,
           rejected_count = $3, duplicate_count = $4
       WHERE id = $1`,
      [runId, accepted, rejected, duplicateCount],
    )
    process.stderr.write(
      `POI import completed: ${accepted} accepted, ${duplicateCount} duplicate, ${rejected} rejected.\n`,
    )
  } catch (error) {
    await pool.query(
      `UPDATE geo.import_runs
       SET status = 'failed', completed_at = now(), accepted_count = $2, rejected_count = $3,
           diagnostics = jsonb_build_object('error', $4::text)
       WHERE id = $1`,
      [runId, accepted, rejected, error instanceof Error ? error.message : 'Unknown error'],
    )
    throw error
  }
}

try {
  await importBoundaries()
  await importPois()
} finally {
  await pool.end()
}
