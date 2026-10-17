# Housing nearby SQL batching — issue #222

## Scope and invariants

Start from `main` at `91148e69a8eb7d11de04aa3e9d8c2529298fa7f0`. This change
reduces database round trips when enriching housing results with nearby POIs.
It does not change agent prompts, routing, current-offer selection, housing
visibility, candidate limits, search ordering, filters, cursors or response schemas.

- Keep the existing four-candidate batch / stop boundary; do not fetch POIs for
  the whole candidate budget before knowing whether another batch is needed.
- Preserve one result slot per origin and the original constraint order,
  including repeated categories with different radii and repeated constraints.
- Keep `ST_DWithin` geography filtering and the existing geography `<->`, then
  place-ID tie-break. The returned distance remains `ST_Distance` in meters.
- Inactive/deleted places and `housing_anchor` records stay excluded. No match
  remains absent, rather than a null/fabricated POI.
- Choose source metadata only after selecting the winning POI, with the same
  `observed_at DESC, id` order and fallback when no source exists.
- No cache, stale prices, new external calls, LLM calls or environment flags.
  Use the existing operation budget and bounded database executor. An error
  still propagates; cancellation is checked before and after the query.

## Implementation

`PlaceService.findNearbyBatch` unnests parameterized origin and constraint arrays
with ordinality. A lateral nearest-place lookup runs for each origin/constraint
pair inside one SQL statement. Source metadata is loaded for winners only.
`findNearby` delegates to this method with one origin. `HousingQueryService`
shares the lookup across each existing candidate batch, then maps the individual
housing results. Searches without nearby constraints issue no additional query.

For 20 returned candidates and two POI categories, enrichment uses **5 rather
than 40 SQL statements**. The initial housing candidate query is not included
in either number. The database still checks each required origin/category pair;
batching does not mean that spatial work disappears.

## Local verification (2026-10-17)

PostGIS `postgis/postgis:16-3.5`, PostgreSQL 16, Docker Desktop on Windows,
container limited to 2 CPU / 2 GiB. A disposable database was restored from the
2026-10-11 dump supplied on 2026-10-17 (38,222 housing listings, 169,413 places),
then migrated through 028. Existing local/staging/production databases were not
modified. A separate migrated empty database was used for synthetic fixtures.

### Reproduction

Build TypeScript, set the repository's location DB variables to an isolated,
migrated snapshot, then run:

```sh
npm run build:ts
node scripts/relohome/verify-nearby-performance.mjs 91148e6
```

The script executes SELECTs in one repeatable-read, read-only transaction with
a statement timeout, loads reference classes directly from the selected Git
revision, and throws on any response difference. It does not print connection
strings, query parameters, coordinates, POI names or contact data. Temporary
compiled reference modules are generated under ignored `node_modules/.cache`.

216 comparisons passed: 180 per-origin nearby comparisons (three cities,
20 origins, three scenarios) and 36 housing response comparisons including
second-page cursors, air-conditioning filters, zero/one/two nearby constraints.
Nearby scenarios cover one category, two categories, repeated categories with
different radii and a missing category. Synthetic integration tests additionally
cover distance ties, exact-radius edges, duplicate origins, hidden/deleted/anchor
POIs, source metadata selection, query counts and cancellation.

Seven warm samples per variant, alternating old/new order, median elapsed time
for **the nearby enrichment portion only**, over a single local DB connection:

| City / 20 origins | One category: old → new | Two categories: old → new | Duplicate/missing categories: old → new |
| --- | --- | --- | --- |
| Hanoi | 39.33 → 10.94 ms | 76.77 → 16.01 ms | 108.89 → 18.08 ms |
| HCM | 30.14 → 13.29 ms | 59.53 → 21.21 ms | 79.09 → 21.57 ms |
| Danang | 28.27 → 9.71 ms | 53.79 → 14.21 ms | 75.13 → 14.69 ms |

Statement counts: 20 → 5 for one category, 40 → 5 for two, 60 → 5 for three.
This excludes pool acquisition and the per-query transaction wrappers of the
deployed bounded executor; these are local measurements, not cloud p95 or total
chat latency. LLM latency and the initial candidate-filter query remain separate.

Summed `EXPLAIN (ANALYZE, BUFFERS)` results for the two-category scenario:

| City | SQL execution old → new | Shared blocks accessed old → new |
| --- | --- | --- |
| Hanoi | 13.92 → 10.89 ms | 2,429 → 2,063 |
| HCM | 17.84 → 15.49 ms | 3,546 → 3,016 |
| Danang | 12.09 → 8.64 ms | 2,581 → 1,467 |

Both variants used existing place geography/category/source indexes; neither
spilled to temporary blocks. Shared buffer hits/reads are page accesses, not a
measurement of physical disk I/O saved.

### Index experiments not shipped

On the same isolated snapshot, test-only indexes were created inside a
transaction and rolled back: GIN on `housing.map_points(amenities)` and B-tree
on `(updated_at DESC,id)`. Eighteen representative searches/maps covered the
three cities, air conditioning, air conditioning + parking, elevator and a
monthly VND 5-million ceiling. Neither trial index was selected in these plans;
shared-page work was unchanged. The existing offer selection / point-PK join
plan remained dominant. Timing fluctuation alone was not treated as a win.

Consequently this PR ships **no index or migration**. This does not establish
that such indexes are useless for all distributions, filters or future volumes.
Revisit with measured candidate-filter plans, not by forcing index usage or
globally replacing current-offer selection with a lateral query.

### Test results and existing limitations

- `housing-query`: 69 passed, 9 existing optional POI-canonical tests skipped.
- Contracts: 38 passed; complete TypeScript workspace build passed.
- Imported-data Platform API: 12 passed on the isolated snapshot.
- Location MCP: 7 passed on that snapshot.
- On an empty DB, five Platform and three MCP tests failed because imported
  reference data was absent; all corresponding snapshot runs passed. A further
  concurrent empty-DB MCP source assertion encountered a user fixture rather
  than partner inventory; the isolated snapshot run passed.
- The wider Platform suite has an existing landlord unit-save idempotency
  failure (`housing-management.integration.test.ts:1089`, property revision
  14 rather than 11). The whole file was rerun with the unchanged reference
  housing/place modules: 11 passed, the same test failed at the same assertion.
  No landlord code/assertion was changed in this PR.
- `runtime-paths.test.ts` also has an existing Windows-only POSIX absolute-path
  expectation (`/tmp/housing.jsonl` versus `E:\tmp\housing.jsonl`). It is unrelated
  to these query changes. CI runs Linux; the new unit tests are included in the
  existing database-free `test:ts` command.

## Rollout and rollback

Deploy normal Platform/Location images after CI/review. No DB DDL, data import,
env edits or cache invalidation is required. Rollback is code-only. Measure SQL
statement counts, end-to-end API latency, pool waits and DB CPU under concurrent
load on staging before claiming production latency improvements. Broad-area
nearby candidate filtering, OSRM and LLM latency are not solved by this change.
