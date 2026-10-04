# Versioned map datasets

The [city catalog](../../Maps%20VN/Cities/README.md) owns stable city IDs and boundary
provenance. Small boundaries stay in Git. Large OSM sources, extracts, and OSRM
graphs use DVC with the team's S3-compatible object storage. DVC stores content
hashes in Git and materializes the corresponding bytes at existing local paths.
See [DVC's storage model](https://doc.dvc.org/user-guide) and
[S3-compatible remote configuration](https://doc.dvc.org/user-guide/data-management/remote-storage/amazon-s3).

## Connect the team storage

Run from the repository root. Install the optional data tooling in a separate
Python environment; application services do not need DVC:

```sh
python3 -m venv .venv-map-data
.venv-map-data/bin/python -m pip install -r requirements-map-data.txt
```

On Windows, use `.venv-map-data\Scripts\python.exe` and the corresponding `dvc.exe`.
The commands below assume the environment is activated.

The repository is initialized for DVC. The shared remote still needs the actual
bucket/prefix and endpoint supplied by the storage owner. Substitute real values:

```sh
dvc remote add -d maps s3://BUCKET/MAP-PREFIX
# For R2 or MinIO; omit for ordinary AWS S3.
dvc remote modify maps endpointurl https://YOUR-S3-ENDPOINT
```

Commit `.dvc/config` containing the non-secret location. Use AWS environment
variables, a local AWS profile, or `.dvc/config.local` for credentials. For a named
profile: `dvc remote modify --local maps profile YOUR-PROFILE`. Never put credentials
in catalog URLs, `.dvc/config`, recipes, or PR descriptions. Keep TLS verification
enabled; configure a local CA bundle for a private MinIO endpoint when necessary.

## Publish a dataset version

Use a dedicated prefix in the existing bucket. DVC manages its object keys;
do not manually rename them or run remote garbage collection without a retention
plan. Retain all objects referenced by supported releases.

1. Obtain an immutable upstream snapshot and record its URL, date, checksum,
   license, and exact extraction/build recipe. Record tool/container versions and
   routing profiles. Keep source files separate from generated outputs.
2. Build in a new version directory, preserving the version serving traffic.
   Validate geometry, record counts, coverage, and sample routes before promotion.
3. Add the intended dataset to DVC. Examples (replace versions/cities as needed):

   ```sh
   dvc add "Maps VN/Raw/vietnam-YYYYMMDD.osm.pbf"
   dvc add "Maps VN/Extracts/vn-hue/YYYYMMDD"
   dvc add "Maps VN/Routing/vn-hue/YYYYMMDD"
   dvc push -r maps "Maps VN/Raw/vietnam-YYYYMMDD.osm.pbf.dvc"
   dvc push -r maps "Maps VN/Extracts/vn-hue/YYYYMMDD.dvc"
   dvc push -r maps "Maps VN/Routing/vn-hue/YYYYMMDD.dvc"
   ```

4. Commit the generated `.dvc` pointers, ignore rules, recipes, and catalog changes.
   Review staged files: the raw/derived bytes must remain untracked by Git.
5. Verify `dvc pull` from a clean checkout/cache before merging the pointer changes.
   A successful local build does not prove teammates can retrieve the artifacts.

No large dataset has been registered or uploaded by this cleanup: those bytes are
not in the checkout, and the team remote has not yet been supplied. The commands
above are the workflow for publishing actual datasets, not evidence of publication.

## Retrieve and roll back

Checkout the desired Git revision and pull only the datasets needed for your city:

```sh
dvc pull -r maps "Maps VN/Routing/vn-hue/YYYYMMDD.dvc"
python3 scripts/verify-map-data.py
```

Use the pointer paths present in that revision. Keep downloaded data at its recorded
path and point importer/OSRM configuration there. Code checkout plus `dvc pull`
restores the referenced files; switching running containers and databases is a
separate deployment step. Restore the prior deployment if acceptance checks fail.

Boundary CI uses only the small Git files and needs no bucket credentials. Remote
publication and retrieval must be verified by a maintainer with access; avoid
making ordinary contributor PR checks depend on private storage.
