# TypeScript relocation validation (#111)

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Base: `09ac457` (merged #110). Executed 2026-10-12 on macOS ARM64.
Native checks used Node 26.0.0/npm 11.12.1. A clean eight-workspace install,
build and portable test run also passed in a disposable Node 24.14.0 container
(60 passed, 14 provider-dependent skips). Image builds/runtime checks used the
repository's Node 24 images. Node 24 remains the supported developer runtime.
Python checks used the existing Python 3.11 validation environment.

| Check | Result |
| --- | --- |
| Base `npm ci --ignore-scripts`, `npm run build:ts` | Pass |
| Base and head `npm run test:ts` | Both 60 passed, 14 provider-dependent skipped |
| Head root clean install and `npm run build` | All ten workspace builds and MapLibre asset verification pass |
| `npm run test:contracts` | 21 passed |
| Isolated PostGIS housing-query suite | 62 passed, including canonicalization/importer checks |
| Isolated PostGIS platform suite | 56 passed, including POI v2, dataset roundtrip and resource-path checks |
| Isolated PostGIS location MCP suite | 7 passed, HTTP and stdio |
| Deployment/configuration and retained Python demo tests | 57 passed, 84 subtests |
| Six affected image builds | Pass: platform, location, moving-api, moving-mcp, location-migrate, moving-migrate |
| Four runtime image startup probes | Pass at existing ports/health routes |
| Internal Docker network | All four readiness routes pass; both MCP endpoints initialize/list tools; Location MCP database read passes |
| Both migration image integration checks | First run and rerun pass schema, history and runtime-role checks |
| Registry exporter | 13 actual Moving tool contracts verified, offline |
| Lock comparison | External versions, resolved URLs and integrity values unchanged |
| SQL comparison | All migrations byte-identical to base |
| Changed Python lint, shell/Node syntax, whitespace | Pass |

Initial native HTTP tests failed because the sandbox forbade local port binding;
base and head passed when rerun with local-port permission. Empty-database platform
checks initially lacked imported POIs/administrative areas. The new
`scripts/test-ts-database.py` supplies synthetic inputs to the actual importers,
then runs the unchanged assertions.

Reproduce native checks from repository root:

```sh
npm ci
npm run build
npm run test:ts
npm run test:contracts
npm run test:ts:database
python -m pytest tests/test_ci_images.py tests/test_coolify_deployment.py \
  tests/test_deployment_settings.py tests/test_web_image_layout.py \
  'Maps VN/LifeFlow/demo/test_demo.py' -q
node scripts/export-agent-registry.mjs
```

Reproduce image and migration checks:

```sh
python scripts/check-workspace-images.py platform location moving-api moving-mcp location-migrate moving-migrate
docker build -f apps/platform-api/Dockerfile --target location-migrate -t relohome-location-migrate:test .
python scripts/test-migration-image.py location-migrate relohome-location-migrate:test
docker build -f 'Maps VN/LifeFlow/Dockerfile.moving' --target moving-migrate -t relohome-moving-migrate:test .
python scripts/test-migration-image.py moving-migrate relohome-moving-migrate:test
```

No provider credentials, real bookings, production deployments, existing databases
or local state were used. Provider opt-ins remain skipped; Windows execution and
staging state continuity/digest rollback require those environments. See the
[rollback and compatibility runbook](../runbooks/typescript-relocation.md).

The internal-network check used a new `--internal` Docker network, tmpfs PostGIS,
both actual migration images and all four actual runtime images. A Node fetch
probe inside the Location image reached `platform:4100/health`,
`lifeflow-location-mcp:3000/readyz`, `moving-api:4200/ready`, and
`moving-mcp:4400/ready`. Authenticated JSON-RPC `initialize` and `tools/list`
succeeded on both `/mcp` endpoints (nine read-role tools each); `search_areas`
completed against PostGIS. Only generated database credentials and synthetic
MCP/webhook tokens were supplied; the internal network prevented provider access.
The first probe attempts exposed missing test-harness prerequisites (a pruned
development client library, then an omitted synthetic webhook secret), corrected
in the probe without changing application behavior. All probe containers and its
network were removed after the run.

## Claude review follow-up

The `.env` lookup this PR originally adjusted was removed on main by #133, so
the rebased branch carries main's loaders and environment-isolation tests
unchanged. The three runtime-path tests run in the portable `test:ts` CI command.

Removed unused legacy directory re-includes and the duplicate packages entry
from the Location image allowlist. The #115 resource resolver handoff is recorded
in the relocation runbook; migration asset locations remain unchanged here.

Follow-up validation: `npm run build:ts` passed for all eight workspaces;
`npm run test:ts` passed 71 tests with the same 14 provider-dependent skips.
The Location image rebuilt successfully and passed its default runtime startup
probe after the allowlist cleanup.

## Root-command review follow-up

Claude identified two root commands whose direct Node invocation selected the
backend `.env` before the legacy service file. After rebasing onto #133, every
root and nested Moving command passes `.env.local` explicitly, so no command
depends on its working directory for configuration and the forwarding fix and
its regression test were dropped.

The database runner now handles SIGTERM/SIGINT with exit codes 143/130 so its
existing `finally` cleanup executes. Two subprocess tests deliver actual signals
with Docker calls intercepted; both pass without touching Docker or databases.
Changed Python lint and whitespace checks pass.
