import { createHash } from 'node:crypto'
import type { QueryExecutor } from './database.js'

interface Member {
  id: string
  name: string | null
  normalized_name: string | null
  category: string
  verification: string
  area: boolean
  housing: boolean
  identities: number
  levels: string[]
  units: string[]
  existing_canonical: string | null
}
export interface PoiAlias {
  alias_place_id: string
  canonical_place_id: string
  osm_identity: string
}

/** Connected components use shared source objects, never name/distance alone. */
export async function previewPoiDedup(db: QueryExecutor) {
  const result = await db.query<{ identity: string; members: Member[] }>(`
    WITH identities AS MATERIALIZED (
      SELECT DISTINCT ps.place_id, catalog.osm_object_identity(ps.source_id) AS identity
      FROM catalog.place_sources ps
      WHERE ps.source_type = 'osm' AND catalog.osm_object_identity(ps.source_id) IS NOT NULL
    ), counts AS (SELECT place_id, count(*)::int n FROM identities GROUP BY place_id)
    SELECT i.identity, jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'normalized_name', lower(btrim(p.name)),
      'category', c.slug, 'verification', p.verification_status,
      'area', EXISTS(SELECT 1 FROM catalog.place_sources s WHERE s.place_id=p.id AND s.source_type='osm' AND s.source_id LIKE 'area/%'),
      'housing', COALESCE(p.attributes->>'entity_role','')='housing_anchor'
        OR EXISTS(SELECT 1 FROM housing.properties hp WHERE hp.place_id=p.id)
        OR EXISTS(SELECT 1 FROM integration.housing_staging hs WHERE hs.canonical_place_id=p.id),
      'identities', counts.n, 'existing_canonical', a.canonical_place_id,
      'levels', ARRAY(SELECT DISTINCT btrim(v) FROM (
        SELECT unnest(ARRAY[p.attributes->>'level',p.attributes->>'floor',p.attributes->>'addr:floor']) v
        UNION ALL SELECT unnest(ARRAY[s.source_payload->'properties'->>'level',
          s.source_payload->'properties'->>'floor',s.source_payload->'properties'->>'addr:floor'])
          FROM catalog.place_sources s WHERE s.place_id=p.id
      ) vals WHERE v IS NOT NULL AND btrim(v)<>'' ORDER BY 1),
      'units', ARRAY(SELECT DISTINCT btrim(v) FROM (
        SELECT unnest(ARRAY[p.attributes->>'addr:unit',p.attributes->>'unit',p.attributes->>'branch']) v
        UNION ALL SELECT unnest(ARRAY[s.source_payload->'properties'->>'addr:unit',
          s.source_payload->'properties'->>'unit',s.source_payload->'properties'->>'branch'])
          FROM catalog.place_sources s WHERE s.place_id=p.id
      ) vals WHERE v IS NOT NULL AND btrim(v)<>'' ORDER BY 1)
    ) ORDER BY p.id) AS members
    FROM identities i JOIN counts ON counts.place_id=i.place_id
    JOIN catalog.places p ON p.id=i.place_id
    JOIN catalog.place_categories c ON c.id=p.category_id
    LEFT JOIN catalog.poi_aliases a ON a.alias_place_id=p.id
    WHERE p.status='active' AND p.deleted_at IS NULL
    GROUP BY i.identity HAVING count(*)>1 ORDER BY i.identity
  `)
  const aliases: PoiAlias[] = []
  const review: { osm_identity: string; reason: string; members: Member[] }[] = []
  const roots = new Map<string, string>()
  const root = (id: string): string => {
    const parent = roots.get(id)
    if (!parent) { roots.set(id, id); return id }
    if (parent === id) return id
    const resolved = root(parent); roots.set(id, resolved); return resolved
  }
  for (const { members } of result.rows) {
    const first = root(members[0]!.id)
    for (const member of members.slice(1)) roots.set(root(member.id), first)
  }
  const components = new Map<string, { identities: Set<string>; members: Map<string, Member> }>()
  for (const group of result.rows) {
    const key = root(group.members[0]!.id)
    const component = components.get(key) || { identities: new Set<string>(), members: new Map<string, Member>() }
    component.identities.add(group.identity)
    for (const member of group.members) component.members.set(member.id, member)
    components.set(key, component)
  }
  let alreadyMapped = 0
  for (const component of components.values()) {
    const identity = [...component.identities].sort().join(',')
    const members = [...component.members.values()].sort((a,b) => a.id.localeCompare(b.id))
    const names = new Set(members.map(m => m.normalized_name).filter(Boolean))
    const categories = new Set(members.map(m => m.category))
    const levels = new Set(members.flatMap(m => m.levels || []))
    const units = new Set(members.flatMap(m => m.units || []))
    const existing = new Set(members.map(m => m.existing_canonical).filter(Boolean))
    const reason = members.some(m => m.housing) ? 'housing_reference'
      : members.some(m => !m.normalized_name) ? 'missing_name'
      : categories.size > 1 ? 'category_conflict'
      : names.size > 1 ? 'name_conflict'
      : levels.size > 1 ? 'floor_conflict'
      : units.size > 1 ? 'unit_or_branch_conflict'
      : members.filter(m => m.verification === 'lifeflow_verified').length > 1 ? 'multiple_verified_places'
      : existing.size > 1 || [...existing].some(id => !members.some(m => m.id === id)) ? 'alias_conflict'
      : null
    if (reason) { review.push({ osm_identity: identity, reason, members }); continue }
    const ranked = [...members].sort((a, b) =>
      Number(b.verification === 'lifeflow_verified') - Number(a.verification === 'lifeflow_verified')
      || Number(Boolean(b.name)) - Number(Boolean(a.name)) || Number(b.area) - Number(a.area)
      || a.id.localeCompare(b.id))
    // Keep the representative stable across repeated runs.
    const canonical = [...existing][0] || ranked[0]!.id
    for (const member of members) {
      if (member.id === canonical) continue
      if (member.existing_canonical === canonical) alreadyMapped++
      aliases.push({ alias_place_id: member.id, canonical_place_id: canonical, osm_identity: identity })
    }
  }
  const manifest_hash = createHash('sha256').update(JSON.stringify(aliases)).digest('hex')
  return { aliases, review, already_mapped: alreadyMapped, duplicate_groups: result.rows.length, manifest_hash }
}

/** Caller supplies transaction/locks. Repoint sources/media, then delete duplicate POIs. */
export async function applyPoiDedup(db: QueryExecutor, expectedHash: string) {
  const preview = await previewPoiDedup(db)
  if (preview.manifest_hash !== expectedHash) throw new Error('POI manifest changed; create and inspect a new dry-run.')
  if (!preview.aliases.length) return { run_id: null, alias_count: 0, deleted_count: 0 }
  const run = await db.query<{ id: string }>(
    `INSERT INTO geo.import_runs(source_type,source_path,source_checksum,status,input_count,diagnostics)
      VALUES('poi_cleanup','catalog.places',$1,'running',$2,$3::jsonb) RETURNING id`,
    [preview.manifest_hash, preview.aliases.length, JSON.stringify({ operation:'physical_poi_cleanup',review_groups:preview.review.length })],
  )
  // Discard projection-only mappings for physical rows, including preserved unnamed/floor groups.
  // Their real rows remain available; no query-time hiding is needed after physical cleanup.
  await db.query(`DELETE FROM catalog.poi_aliases a WHERE EXISTS(
    SELECT 1 FROM catalog.places p WHERE p.id=a.alias_place_id)`)
  await db.query(`INSERT INTO catalog.poi_aliases(alias_place_id,canonical_place_id,run_id,osm_identity,reason,legacy_name,legacy_geom)
    SELECT x.alias_place_id,x.canonical_place_id,$1,x.osm_identity,'same_osm_identity',p.name,p.geom
    FROM jsonb_to_recordset($2::jsonb) x(alias_place_id uuid,canonical_place_id uuid,osm_identity text)
    JOIN catalog.places p ON p.id=x.alias_place_id
    ON CONFLICT(alias_place_id) DO UPDATE SET canonical_place_id=EXCLUDED.canonical_place_id,
      run_id=EXCLUDED.run_id,osm_identity=EXCLUDED.osm_identity,
      legacy_name=COALESCE(catalog.poi_aliases.legacy_name,EXCLUDED.legacy_name),
      legacy_geom=COALESCE(catalog.poi_aliases.legacy_geom,EXCLUDED.legacy_geom)`,
  [run.rows[0]!.id, JSON.stringify(preview.aliases)])
  const runId = run.rows[0]!.id
  // Retarget any earlier legacy IDs without changing their saved points.
  await db.query(`UPDATE catalog.poi_aliases earlier SET canonical_place_id=current.canonical_place_id
    FROM catalog.poi_aliases current WHERE current.run_id=$1
      AND earlier.canonical_place_id=current.alias_place_id`, [runId])
  await db.query(`WITH donor AS (
    SELECT DISTINCT ON(a.canonical_place_id) a.canonical_place_id,p.*
    FROM catalog.poi_aliases a JOIN catalog.places p ON p.id=a.alias_place_id
    WHERE a.run_id=$1 ORDER BY a.canonical_place_id,(p.name IS NOT NULL) DESC,p.id
  ) UPDATE catalog.places c SET name=COALESCE(c.name,d.name),
    address=d.address || c.address,phone=COALESCE(c.phone,d.phone),
    website=COALESCE(c.website,d.website),opening_hours=COALESCE(c.opening_hours,d.opening_hours),
    attributes=d.attributes || c.attributes
  FROM donor d WHERE c.id=d.canonical_place_id AND c.verification_status<>'lifeflow_verified'`, [runId])
  await db.query(`UPDATE catalog.place_sources s SET place_id=a.canonical_place_id
    FROM catalog.poi_aliases a WHERE a.run_id=$1 AND s.place_id=a.alias_place_id`, [runId])
  await db.query(`UPDATE catalog.place_media m SET place_id=a.canonical_place_id
    FROM catalog.poi_aliases a WHERE a.run_id=$1 AND m.place_id=a.alias_place_id`, [runId])
  await db.query(`UPDATE integration.source_records s SET entity_id=a.canonical_place_id
    FROM catalog.poi_aliases a WHERE a.run_id=$1 AND s.entity_type='place' AND s.entity_id=a.alias_place_id`, [runId])
  await db.query(`UPDATE geo.poi_staging s SET canonical_place_id=a.canonical_place_id
    FROM catalog.poi_aliases a WHERE a.run_id=$1 AND s.canonical_place_id=a.alias_place_id`, [runId])
  const deleted = await db.query(`DELETE FROM catalog.places p USING catalog.poi_aliases a
    WHERE a.run_id=$1 AND p.id=a.alias_place_id RETURNING p.id`, [runId])
  if (deleted.rowCount !== preview.aliases.length) throw new Error('POI deletion count mismatch')
  await db.query(`UPDATE geo.import_runs SET status='completed',completed_at=now(),
    accepted_count=$2,duplicate_count=$2,diagnostics=diagnostics || jsonb_build_object('deleted_count',$2::int)
    WHERE id=$1`, [runId,deleted.rowCount])
  return { run_id:runId,alias_count:preview.aliases.length,deleted_count:deleted.rowCount }
}
