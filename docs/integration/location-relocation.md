# Location relocation (#115, location slice)

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Base: `b714b7bbd57c521598191f0d958b48a17b270f47` (`origin/main`), branch
`codex/issue-115-location-relocation`. Executed 2026-10-13, macOS ARM64,
Python 3.11.16, Node 26.0.0/npm 11.12.1. Node 24 remains the supported runtime;
the installed host Node emits the existing engine warning.

This slice implements the location rows of ADR-025 and the #118 naming map.
`src/`, `Frontend/`, `src/ui`, and `Frontend MVP planning questions/` belong to
another slice and are unchanged. Existing application compatibility shims and
the persisted-checkpoint alias are outside this slice; no shim-removal gate is
claimed. ADR-001 and ADR-013 already link pending ADR-025 supersession; ADR-025
is still Proposed, so their historical status was not changed.

No provider call or deploy was performed. No existing Docker stack or database was modified.

## File accounting

[src-accounting.tsv](location-relocation/src-accounting.tsv) has exactly one
row for each of the **108** files under `Maps VN/LifeFlow/` at the base. Each
row records the old path, destination/disposition, original SHA-256 and reason.
The base tree and hashes were compared against all rows.

| Former source | Destination / disposition |
| --- | --- |
| map-app | `examples/map-app/`, private `@relohome/map-app` |
| demo Python | `examples/location-streamlit/src/relohome_location_demo/` |
| demo test / requirements | `examples/location-streamlit/tests/` / project-root `requirements.txt` |
| database | `deploy/database/` (26 byte-identical SQL files, including both `008_*`) |
| infra | `deploy/location/` |
| Moving Compose and Dockerfile/ignore | `deploy/moving/`, same basenames |
| scripts and PowerShell | `scripts/relohome/`; Start/Stop become ReloHome |
| config | `config/location/` |
| docs, README, STREAMLIT_MVP | `docs/location/` |
| reports | `eval/location/` (bytes preserved) |
| package.json | Retired: all 31 wrapper commands exist at repository root |
| .env.example | Retired: already delegated to root `.env.example`; no credential values removed |
| .gitignore | Retired: needed rules merged into root/new locations, including old generated artifacts |
| .dockerignore | Retired: obsolete nested build context; root and Dockerfile-specific root-context filters own builds |

**104 files moved, four retired.** Relative suffixes are preserved except the
explicit browser-test, Start/Stop, Python test and requirements exceptions.


Untracked/ignored files were not moved. Cities, DVC/LFS, `data/`, routing graphs,
extracts, `.runtime`, and `design-comparison/` remain in place. Legacy generated
map workers and node_modules remain ignored at their old locations. Installing
the relocated workspace populated its new dependencies from the existing npm
cache; it did not move the old ignored dependency directory.

## Behavior and naming decisions

The map's scripts are `predev:relohome` / `dev:relohome`, and its browser test is
`tests/relohome.spec.ts`. Display text uses ReloHome. M20 map source/layer IDs and
`__LIFEFLOW_MAP__`, M21 safety prefixes, all env keys and operational identities
remain unchanged. The historical eight location records and old README
transcript carry notices linking the current guide; dated integration evidence,
eval reports, pinned inventory and ADR history retain their text.

`prepare:data` accepts CLI input/output or exported `RELOHOME_POI_INPUT` and
`RELOHOME_POI_OUTPUT`, with CLI precedence. Both are required and failure is
explicit. Output must be outside the repository and differ from the input.
It never overwrites the tracked sample or imports local data into source. The
map uses the Platform API; conversion is an optional offline utility. No local
input was used during validation, only a tiny synthetic `/tmp` fixture.

The installable location demo has distribution `relohome-location-demo`, import
`relohome_location_demo`, its own requirements and `pyproject.toml`. It is an
editable dev requirement, participates in package-boundary discovery, and has
root `dev:location-demo` / `dev:location-tool-lab` commands plus Make targets.
Private client/root symbols use ReloHome; MCP `clientInfo=lifeflow-streamlit`
stays M17. Wheel launches can explicitly supply `RELOHOME_RUNTIME_ROOT`.

Both SQL resolvers were updated together: Platform local `resourceRoot` is
`deploy/`, Moving local SQL is `deploy/database/`; images retain `/app/database`.
Migrations, checksum bytes, ordering, history table and advisory lock identity
are unchanged. Report defaults now follow the moved report under
`eval/location/`; image reports retain `/app/reports`. Relative importer inputs
from the Platform npm workspace retain the former workspace base regardless of
whether the legacy source directory exists. Absolute inputs and explicit CWDs
keep their meaning.

Root commands, local-integration, snapshot migration launch, asset verification,
CI catalog/tests, Moving shell `case` filters, Docker COPY/allowlists, current
guides and CODEOWNERS now reference the destinations. The offline registry
exporter already used canonical paths and verified all 13 contracts unchanged.
Image selection recognizes relocated SQL/Dockerfiles before excluding other
`deploy/` configuration; test/docs-only paths still avoid image rebuilds.
Moving CI uses root CWD and `/dev/null` as its env file, with explicit job env;
operator runbooks use `.env.local` explicitly.

## Persistent paths and Compose identities

PowerShell resolves the repository root from `scripts/relohome/`, then explicitly
uses `Maps VN/LifeFlow/.runtime/` for PIDs/logs, `Maps VN/Routing/` for graphs,
`Maps VN/Raw/` and `Maps VN/Extracts/POI/vietnam-260922/` for extraction.
The moved OSRM profile and POI filter resolve from `deploy/location/` and
`config/location/`. Existing `moving-secrets.json`, root `.env`,
`data/integration.env` and old `.env` paths/precedence remain unchanged in the
initializer. It was not run; no credentials were generated. Current service
loaders continue reading process environment only (#130/#133), and root
entrypoints explicitly pass `.env.local`. `LIFEFLOW_ENV_FILE` is preserved.

Four before/after render pairs are checked in beside this document. Projection
records the command, project name, named volumes, images, container names,
absolute build contexts and service mounts; secret environment values are not
recorded. Both existing `name:` declarations remain explicit. Moving qualified
volume remains `lifeflow-moving_moving-data`; Location volume remains explicitly
`lifeflow-postgis-data`. The four moved Compose configurations contain **no bind
mounts**; their named mounts compare exactly. The Location root context changed
from `../../..` to `../..`, resolving to the same checkout. Moving already used
`../..`; only its Dockerfile source path changes. Dataset binds in unchanged
root infrastructure stay unchanged; moved Windows launchers resolve them
explicitly, but Windows execution is not verified here.

Reproduce the read-only pinned-base comparison:

```sh
env -u VIRTUAL_ENV ./.venv/bin/python docs/integration/location-relocation/check-compose.py
```

The helper renders Location, Moving base, base+CI and base+staging-write with
synthetic configuration and `--env-file /dev/null`, comparing project, images,
containers, volumes, bind sources and build context. It normalizes only the
Moving Dockerfile source relocation. **All four comparisons passed.** It runs
`docker compose config`, never `up`, import or migrations.

## Validation commands and observed results

Run on the branch head by Claude: macOS arm64 host, Python 3.11.16, Node 26
(the repository contract is Node 24), Docker linux/aarch64, this worktree's own
`.venv` and `node_modules`. The Codex implementation sandbox could not reach the
Docker socket or bind local ports, so every socket/Docker gate below was rerun
outside it.

| Command | Result |
| --- | --- |
| `npm run test:python` | **937 passed, 103 skipped, 136 subtests passed, 0 failed** (#139 head: 932; relocated location demo + runtime-path tests added) |
| `npm run build` | All workspace builds passed; MapLibre worker/shared assets match for `apps/web` and `examples/map-app` |
| `npm run test:ts` | Exit 0: contracts 38, mcp-core 19, Moving/Location/housing-query suites as at base (DB/provider suites skip), platform `runtime-paths.test.ts` 3 passed |
| `npm run lint` | Passed (Python scope and TS workspaces incl. `@relohome/map-app`) |
| `npm run deployment:check` | 55 passed, 84 subtests passed |
| `python scripts/check-workspace-images.py platform location moving-api moving-mcp location-migrate moving-migrate` | All six images built; platform, location, moving-api, moving-mcp default-CMD HTTP startup passed; both migrate images find their SQL at `/app/database/...` |
| `docker build -f apps/platform-api/Dockerfile --target location-migrate` + `scripts/test-migration-image.py location-migrate` | **Run 1 and run 2 passed** schema, history and role checks (rerun reports every migration already applied) |
| `docker build -f deploy/moving/Dockerfile.moving --target moving-migrate` + `scripts/test-migration-image.py moving-migrate` | **Run 1 and run 2 passed** schema, history and role checks |
| `docker compose config --format json` for location, moving, moving+ci and moving+staging-write, base vs head, dummy secrets | Location identical; Moving variants differ **only** in `build.dockerfile` (`deploy/moving/Dockerfile.moving`). Project `lifeflow`/`lifeflow-moving`, containers, images, volumes (`lifeflow-postgis-data`, `lifeflow-moving_moving-data`) and bind sources unchanged |
| `python docs/integration/location-relocation/check-compose.py` | Four comparisons passed (recorded JSON beside it) |
| `git check-ignore` on `Maps VN/LifeFlow/.runtime/moving-secrets.json`, `Maps VN/LifeFlow/.env`, map-app `public/maplibre`/`dist`/`.env` | All still ignored |
| Relative Markdown link check over all tracked `*.md` | No new broken links (142 at head vs 150 at base) |

`package-lock.json` was regenerated offline from manifests; the diff is only the
map workspace path/name/link normalization; external versions, URLs and
integrity values are unchanged. The location wheel builds and imports from
`/tmp` in `-I` mode with `RELOHOME_RUNTIME_ROOT` set.

Not run: `npm run test:map` (needs a configured `.env.local` and a running
Platform API; same prerequisite as base), Windows PowerShell execution of the
renamed launchers (inspected only), and live provider checks. CI on the PR covers
the multi-arch build/publish jobs; staging existing-data and digest rollback
evidence stays with #116.

## Remaining references and rollback

Combined-tree refresh: [final #115 audit](monorepo-final-audit.md#reproduction-and-counts)
supersedes the slice-only counts below. It reuses these TSV decisions; the two
agent-chat display hits are fixed by #142. Original rows remain historical evidence.

[path-audit.tsv](location-relocation/path-audit.tsv) classifies every line from
`git grep -n "Maps VN/LifeFlow"`; [lifeflow-audit.tsv](location-relocation/lifeflow-audit.tsv)
classifies the case-insensitive audit. Only audit derivatives/logs themselves
are excluded to avoid recursion; file-accounting and Compose evidence are included.
Each hit is runtime-data path, preserved identifier, historical, or bug.
Runtime paths protect state, credentials and old importer inputs. Preserved
identifiers cover M08/M10–M21/M25. Historical hits include pinned evidence,
former-source accounting, immutable SQL comments and archived transcripts.
Audit totals: 1,263 path hits (1,254 historical, nine runtime-data paths);
2,434 branding hits (2,143 historical, 264 preserved identifiers, 25
runtime-data paths, two out-of-scope bugs).

Two display-brand hits remain in `src/ui/agent_chat.py`, owned by the parallel
Streamlit/shim slice of #115 (which renames them when it moves the demo); its env
key is preserved. There are no known remaining operational old-source path bugs
in this location slice.

Rollback: revert these source changes, reinstall the reverted root npm lock and
Python requirements, then rebuild/redeploy prior image digests through the
existing release process. Restore old launcher names/paths from the revert;
keep state, credentials, paired keys, datasets, routing graphs, named volumes,
SQL history and checksums in place. No data migration or credential regeneration
is part of this move or its rollback.
