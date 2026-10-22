-- Read-only catalog inspection. Run with an existing authorized DB connection:
-- psql ... -v query='Ocean Park' -f scripts/relohome/diagnose-location-name.sql
-- Do not paste connection strings, private data or credentials into a PR/chat.
\set ON_ERROR_STOP on
\if :{?query}
\else
  \echo 'Pass -v query=... with the location name to inspect.'
  \quit
\endif

BEGIN READ ONLY;

-- Include inactive/deleted/housing-anchor rows to explain resolver exclusions.
-- These are diagnostic candidates, not verified aliases or authorized locations.
SELECT p.id, p.name, c.slug AS category, p.status,
       p.deleted_at IS NOT NULL AS deleted,
       p.attributes->>'entity_role' AS entity_role,
       ST_X(p.geom) AS lng, ST_Y(p.geom) AS lat,
       source.source_type, source.source_id, source.source_url
FROM catalog.places p
JOIN catalog.place_categories c ON c.id = p.category_id
LEFT JOIN LATERAL (
  SELECT ps.source_type, ps.source_id, ps.source_url
  FROM catalog.place_sources ps
  WHERE ps.place_id = p.id
  ORDER BY ps.observed_at DESC, ps.id
  LIMIT 1
) source ON true
WHERE geo.normalize_search(p.name) LIKE
      '%' || replace(geo.normalize_search(:'query'), ' ', '%') || '%'
ORDER BY p.name, p.id
LIMIT 50;

SELECT id, name, level,
       ST_XMin(Box2D(geom)) AS west, ST_YMin(Box2D(geom)) AS south,
       ST_XMax(Box2D(geom)) AS east, ST_YMax(Box2D(geom)) AS north
FROM geo.administrative_areas
WHERE geo.normalize_search(name) LIKE
      '%' || replace(geo.normalize_search(:'query'), ' ', '%') || '%'
ORDER BY name, id
LIMIT 50;

ROLLBACK;
