# City map datasets

[`catalog.json`](catalog.json) records the city IDs, boundary checksums, coordinate
reference system, extent, and source provenance. Git commits version the catalog.
The SHA-256 identifies the exact boundary bytes; it is not a source snapshot date.

## Storage layout

| Data | Local location | Versioning / shared storage |
|---|---|---|
| City catalog, licenses, extraction recipes | `Maps VN/Cities/` | Git |
| Small administrative boundaries | `Maps VN/Cities/boundaries/<city-id>.geojson` | Git, with catalog checksums |
| Raw OSM snapshots | `Maps VN/Raw/` | DVC pointers in Git; bytes in the team's S3-compatible storage |
| Extracted POIs and other intermediate datasets | `Maps VN/Extracts/` | DVC pointers in Git; bytes in object storage |
| Built OSRM graphs | `Maps VN/Routing/` | DVC pointers in Git; bytes in object storage |
| Database backups | Existing backup storage | Separate backup policy; never mix customer data into the map dataset remote |

The current three boundaries total 948,621 bytes. Keep these small reference files
available on clone. The repository budget is 5 MiB per boundary and 20 MiB total;
these are project policy limits, not industry or hosting limits. Move boundaries
to DVC before exceeding those limits or if frequent updates make Git history grow
too quickly. Upload and verify retrieval before removing any Git-tracked data.

Large local directories are ignored by Git, while `.dvc` pointers remain trackable.
DVC initialization and remote configuration are described in the
[map data runbook](../../docs/runbooks/map-data.md). Remote setup requires the team's
bucket/prefix and endpoint; no dataset has been uploaded as part of this cleanup.

## Validate before importing

From the repository root, using Python 3.11 or newer:

```sh
python3 scripts/verify-map-data.py
```

The check verifies hashes, sizes, unique IDs, provenance fields, catalog/file
agreement, Polygon/MultiPolygon structure, closed rings, coordinate ranges, and
bounding boxes. It runs in CI without network access or storage credentials.
It does not check polygon topology or certify administrative correctness; inspect
new boundaries on a map and validate topology in PostGIS/GDAL before release.

Set `BOUNDARY_SOURCE_DIR` to the absolute path of this `boundaries/` directory in
your local ReloHome environment. The existing places importer reads every GeoJSON
there. Filenames become database IDs: preserve `hcm`, `hanoi`, and `danang`.
Do not place temporary, historical, or unregistered GeoJSON files in this directory.

### Where the application loads these files

From the repository root, `npm run db:import:places` invokes
[`platform-api/src/import-places.ts`](../../apps/platform-api/src/import-places.ts).
It reads `BOUNDARY_SOURCE_DIR`, enumerates `.geojson` files, and calls
`importBoundaries()` to upsert their polygons into PostGIS's
`geo.administrative_areas`. The same command then imports POIs and therefore also
requires `POI_SOURCE_PATH` and database configuration. It is a database mutation,
not a validation command.

Runtime spatial queries read that table, for example in
[`housing-service.ts`](../../packages/housing-query/src/housing-service.ts)
and [`place-service.ts`](../../packages/housing-query/src/place-service.ts).
This importer requires local files; it does not fetch S3 URLs or read the catalog.
If boundaries later move to DVC, run `dvc pull` before validation and import.

## Add or update a city

1. Assign a stable lowercase ID. For new cities, use a country-prefixed ID such as
   `vn-hue`; keep the three existing IDs unchanged for compatibility.
2. Record the actual source URL, provider, license, attribution, upstream snapshot
   timestamp, retrieval timestamp, and reproducible extraction recipe. Include OSM
   relation IDs or extraction bounds and the tool version/command. Store recipes
   alongside the catalog, and point `source.recipe` at the relative file path.
3. Save a reviewed GeoJSON FeatureCollection at `boundaries/<city-id>.geojson`,
   in longitude/latitude order (`OGC:CRS84`), using Polygon/MultiPolygon geometry.
   Preserve source precision; simplification is a separate derived dataset.
4. Add/update the catalog entry with SHA-256, byte size, feature count, and bbox
   calculated from the actual file. Set `provenance_status` to `documented`. Review
   geometry and metadata together; never update a checksum just to silence CI.
5. Run the validator and publish any associated large datasets through DVC as
   described in the runbook. Include source version and recipe in the PR.
6. Configure and test service support separately: POI/admin ingestion, routing
   extracts and all supported OSRM profiles, city configuration, coverage bounds,
   and map UI. Adding a catalog entry alone does not enable a city in the product.

The catalog bbox describes the full administrative geometry, including islands.
It is **not** a service coverage promise or a replacement for routing bounds.

## Existing data provenance

The three imported boundaries have OSM tags and are described as OSM data in the
existing repository documentation. Their original source snapshot dates, download
URLs, and extraction recipes were not recorded. The catalog explicitly marks these
as `legacy-incomplete`; Git commit dates must not be presented as source dates.
New cities must supply documented provenance.

OSM-derived data uses [OpenStreetMap's ODbL terms and attribution](https://www.openstreetmap.org/copyright),
separately from the repository's MIT code license. Preserve `© OpenStreetMap
contributors` attribution when displaying or redistributing the data. This catalog
records the inferred origin; it does not reconstruct the missing extraction history.
