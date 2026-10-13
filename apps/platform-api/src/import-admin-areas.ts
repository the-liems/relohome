import { resolveInputPath } from './runtime-paths.js'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { createDatabasePool, getRuntimeConfig } from '@relohome/housing-query'

interface GeoJsonFeature {
  id?: string | number
  type: 'Feature'
  geometry: { type: string; coordinates: unknown } | null
  properties: Record<string, unknown> | null
}

interface PreparedArea {
  id: string
  name: string
  level: string
  source_id: string
  geometry: { type: string; coordinates: unknown }
  attributes: Record<string, unknown>
}

const config = getRuntimeConfig()
const pool = createDatabasePool(config.ingestDatabaseUrl, 4)
const sourcePath = resolveInputPath(requiredEnvironmentPath('ADMIN_AREA_SOURCE_PATH'))

const batchSize = 100

function requiredEnvironmentPath(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}

async function checksumFile(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function relationSourceId(feature: GeoJsonFeature) {
  const raw = String(feature.id || '')
  const match = raw.match(/^[ar](\d+)$/)
  if (!match) return null
  return `relation/${match[1]}`
}

function prepareArea(feature: GeoJsonFeature): PreparedArea | null {
  const properties = feature.properties || {}
  if (properties.boundary !== 'administrative' || !feature.geometry) return null
  if (!['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) return null

  const sourceId = relationSourceId(feature)
  const name = typeof properties.name === 'string' ? properties.name.trim() : ''
  if (!sourceId || !name) return null

  return {
    id: `osm:${sourceId.replace('/', ':')}`,
    name,
    level:
      typeof properties.admin_level === 'string' && properties.admin_level.trim()
        ? properties.admin_level.trim()
        : 'unknown',
    source_id: sourceId,
    geometry: feature.geometry,
    attributes: { ...properties, '@id': sourceId, _feature_id: feature.id },
  }
}

async function upsertBatch(batch: PreparedArea[]) {
  if (!batch.length) return 0
  const result = await pool.query<{ accepted_count: number }>(
    `WITH input AS (
       SELECT *
       FROM jsonb_to_recordset($1::jsonb) AS area(
         id text,
         name text,
         level text,
         source_id text,
         geometry jsonb,
         attributes jsonb
       )
     ), prepared AS (
       SELECT
         id,
         name,
         level,
         source_id,
         attributes,
         ST_Multi(
           ST_CollectionExtract(
             ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geometry::text), 4326)),
             3
           )
         ) AS geom
       FROM input
     ), upserted AS (
       INSERT INTO geo.administrative_areas (
         id, name, level, source, source_id, geom, attributes, updated_at
       )
       SELECT id, name, level, 'osm', source_id, geom, attributes, now()
       FROM prepared
       WHERE NOT ST_IsEmpty(geom)
       ON CONFLICT (source, source_id) DO UPDATE SET
         name = EXCLUDED.name,
         level = EXCLUDED.level,
         geom = EXCLUDED.geom,
         attributes = EXCLUDED.attributes,
         updated_at = now()
       RETURNING id
     )
     SELECT count(*)::integer AS accepted_count FROM upserted`,
    [JSON.stringify(batch)],
  )
  return Number(result.rows[0]?.accepted_count || 0)
}

async function importAreas() {
  const file = await stat(sourcePath)
  const checksum = await checksumFile(sourcePath)
  const run = await pool.query<{ id: string }>(
    `INSERT INTO geo.import_runs (
       source_type, source_path, source_checksum, status, diagnostics
     ) VALUES (
       'osm_admin_boundary', $1, $2, 'running',
       jsonb_build_object('file_size_bytes', $3::bigint, 'batch_size', $4::integer)
     )
     RETURNING id`,
    [sourcePath, checksum, file.size, batchSize],
  )
  const runId = run.rows[0]!.id
  let inputCount = 0
  let acceptedCount = 0
  let rejectedCount = 0
  let batch: PreparedArea[] = []
  const errors: Array<{ record: number; message: string }> = []

  async function flush() {
    if (!batch.length) return
    const current = batch
    batch = []
    try {
      const accepted = await upsertBatch(current)
      acceptedCount += accepted
      rejectedCount += current.length - accepted
    } catch {
      for (const area of current) {
        try {
          const accepted = await upsertBatch([area])
          acceptedCount += accepted
          rejectedCount += 1 - accepted
        } catch (error) {
          rejectedCount += 1
          if (errors.length < 100) {
            errors.push({
              record: inputCount,
              message: error instanceof Error ? error.message : 'Unknown database error',
            })
          }
        }
      }
    }
  }

  try {
    const lines = createInterface({
      input: createReadStream(sourcePath, { encoding: 'utf8' }),
      crlfDelay: Number.POSITIVE_INFINITY,
    })
    for await (const rawLine of lines) {
      const line = rawLine.replace(/^\u001e/, '').trim()
      if (!line) continue
      inputCount += 1
      try {
        const area = prepareArea(JSON.parse(line) as GeoJsonFeature)
        if (!area) {
          rejectedCount += 1
          continue
        }
        batch.push(area)
        if (batch.length >= batchSize) await flush()
      } catch (error) {
        rejectedCount += 1
        if (errors.length < 100) {
          errors.push({
            record: inputCount,
            message: error instanceof Error ? error.message : 'Invalid GeoJSON sequence record',
          })
        }
      }
      if (inputCount % 1000 === 0) {
        process.stderr.write(`Read ${inputCount} administrative boundaries\n`)
      }
    }
    await flush()

    await pool.query(
      `UPDATE geo.import_runs
       SET status = 'completed',
           completed_at = now(),
           input_count = $2,
           accepted_count = $3,
           rejected_count = $4,
           diagnostics = diagnostics || jsonb_build_object(
             'errors', $5::jsonb,
             'preserved_non_osm_areas', true
           )
       WHERE id = $1`,
      [runId, inputCount, acceptedCount, rejectedCount, JSON.stringify(errors)],
    )
    process.stderr.write(
      `Administrative area import completed: ${acceptedCount} accepted, ${rejectedCount} rejected.\n`,
    )
  } catch (error) {
    await pool.query(
      `UPDATE geo.import_runs
       SET status = 'failed',
           completed_at = now(),
           input_count = $2,
           accepted_count = $3,
           rejected_count = $4,
           diagnostics = diagnostics || jsonb_build_object('error', $5::text)
       WHERE id = $1`,
      [
        runId,
        inputCount,
        acceptedCount,
        rejectedCount,
        error instanceof Error ? error.message : 'Unknown import error',
      ],
    )
    throw error
  }
}

try {
  await importAreas()
} finally {
  await pool.end()
}
