# ReloHome root development tooling (#110)

Use **Node 24**, **npm 11**, and **Python 3.11**. `.nvmrc` selects Node 24;
the legacy MVP workflow now uses the same runtime as service images and CI.
The root workspace is `relohome`. TypeScript services and libraries now live in
`apps/` and `packages/` with `@relohome/*` names; `siu-ai-web` remains unchanged.
The map demo is `@relohome/map-app`. See the [TypeScript relocation runbook](typescript-relocation.md)
for retained assets, compatibility, database checks, and rollback.

## Install from a clean checkout

```sh
nvm use                         # or install Node 24 using your usual manager
python3.11 -m venv .venv
. .venv/bin/activate
make install                    # npm ci; python -m pip install -r requirements-dev.txt
make build
```

PowerShell: `py -3.11 -m venv .venv`, `.\.venv\Scripts\Activate.ps1`, then
`npm run setup` and `npm run build`. All npm commands below run at repository
root. Python commands use an activated environment, the root `.venv`, or an
explicit `PYTHON=/absolute/path/to/python` override. No global pip install or
new Python package manager is required. `requirements-dev.txt` includes the
existing pytest/pytest-asyncio/Ruff toolchain, standalone-agent requirements,
mypy and retained location-demo UI dependencies. Runtime requirements retain their
domain behavior; shared Python packages from #112 and application/example moves
from #113–#115 are installed by root requirements.

`package-lock.json` is the only authoritative npm lock. It covers eight service
and library workspaces, `apps/web`, and the supported map demo. The map workspace is `examples/map-app/` (`@relohome/map-app`). The nested
scripts-only wrapper has been retired; every operation has a root equivalent.
Use root `npm ci` even when working on one app. Root launchers explicitly load
`.env.local`; ports and persistent `Maps VN/LifeFlow/.runtime/` files are unchanged.
There is no duplicate old/new workspace during a rename.

Excluded intentionally: Python projects (pip), static HTML design references
(no npm project), ignored/untracked `design-comparison/` and extracted local
snapshots (user artifacts). No supported npm application is excluded.

## Commands

| Make | npm | Scope |
| --- | --- | --- |
| `make install` | `npm run setup` | Root npm clean install + Python dev dependencies |
| `make build` | `npm run build` | Libraries in dependency order, services, web, map; verify worker assets |
| `make lint` | `npm run lint` | Existing CI Python scope and existing map oxlint; no new whole-repository lint gate |
| `make format-check` | `npm run format:check` | Read-only Ruff format check of Python applications/examples/tests |
| `make format` | `npm run format` | Explicit formatting write |
| `make test` | `npm test` | Python root/gateway/location-demo contracts, portable TS and pure frontend contracts |
| `make test-browser` | `npm run test:browser` | Existing web desktop/mobile Chrome journeys; providers skipped unless explicitly enabled |
| `make test-map` | `npm run test:map` | Existing map integration journeys; requires configured Platform/data/OSRM |
| `make test-integration` | `npm run test:integration` | Full TS test scripts, including real database suites |
| `make deployment-check` | `npm run deployment:check` | Offline deployment/config/image selection contracts |
| `make image-check` | `npm run image:check` | Build/check the default image set; explicit Python service selectors are also supported |
| `make check` | `npm run check` | Lint, read-only formatting check, portable tests; never invokes `format` |

`npm run build:ts`, `build:web`, `build:map`, `build:moving`, `test:python`,
`test:ts`, `test:contracts`, and `check:assets` allow focused work. Build before
TS tests because consumers import compiled workspace exports. Portable TS
coverage retains CI's contracts/mcp-core/Moving suites plus the Location HTTP
contract. Housing-query/platform/stdio database suites remain in
`test:integration`; their omission from portable CI is explicit, not a green
claim for database integration. Live test skips remain visible.

For `test:integration`, provision an isolated PostGIS database and the existing
application/admin roles via the [local runbook](local-mvp.md). Review each
suite's `RUN_POI_*` flags and fixture/database setup before enabling it. Do not
point these tests at a retained developer or production database. Migration
image database checks remain `python scripts/test-migration-image.py
<location-migrate|moving-migrate> <image>`; this creates and removes only its
own temporary database container/network. `image:check` uses no mounts,
published ports or provider access. Platform's `/health` requires PostGIS,
so the isolated startup probe verifies its HTTP listener with `/` (404);
full database readiness is a separate integration check.

Development commands: `dev:web`, `dev:map`, `dev:gateway`, `dev:agent`,
`dev:api`, `dev:mcp`, `dev:mcp:http`, `dev:moving-api`, `dev:moving-mcp`,
`dev:moving-mcp:http`, `dev:flights-mcp`, `dev:payments-mcp`, `dev:intake`,
`dev:orchestrator`, `dev:flight-demo`, `dev:payment-demo`, `dev:agent-chat`.
Pass component arguments after `--`. Existing `make run`, `ui`, `ui-payment`,
`mcp-build`, `mcp-up`, and `mcp-down` retain their behavior.

## Chrome and provider prerequisites

Run `npm run setup:browser` to install system Chrome with Playwright. On Linux,
provision its OS libraries with `npm exec --offline --workspace apps/web --
playwright install-deps chrome`. OS installation may need administrator access;
self-hosted runners should be provisioned by their administrator, not install
system packages from an untrusted PR job.

Alternatively install a pinned official Chrome for Testing build in a user
writable directory and set `PLAYWRIGHT_CHROME_EXECUTABLE_PATH` to its executable.
The default remains `channel: chrome`; record the exact Chrome version for both
base/head runs. This override is supported by the web and map default configs.
Stop existing dev servers on 5174 (web) and 5173 (map) before running tests.
Do not substitute pure frontend contracts for browser journeys.

Leave existing `RUN_*`, `LIFEFLOW_LIVE_LLM`, and provider write flags unset for
portable/browser baseline checks. Root provider invocation requires an extra
acknowledgement without automatically enabling any existing flag:

```sh
RELOHOME_LIVE_CHECKS=1 npm run test:live -- python
RELOHOME_LIVE_CHECKS=1 npm run test:live -- moving
RELOHOME_LIVE_CHECKS=1 npm run test:live -- browser --config playwright.live.config.ts
# make equivalent: RELOHOME_LIVE_CHECKS=1 make test-live SUITE=python
```

Each suite still requires its documented credentials, service endpoints and
specific opt-ins (`RUN_LIVE_MOVING_BROWSER`, `RUN_LIVE_MOVING_AGENT`, etc.).
Consult the domain runbooks before enabling any provider write.

## Images, validation and rollback

Build every affected Dockerfile with repository root as context. Compose and
the image catalog already point there. For TS images, `scripts/docker-npm.mjs`
derives an **uncommitted image-local view** of root workspace paths after COPY.
It preserves every external locked version/integrity and keeps the deployed
`/app/packages`, application directories, SQL resources, CMDs and identities
unchanged. This is not another lockfile to maintain. The adapter uses the relocated
workspace paths from #111. The web runtime remains a combined
React/gateway image with the same data paths and port.

See [validation and resolution review](../integration/monorepo-tooling/validation.md)
for exact commands, base/head results and B2/B3/B5 triage. Existing formatting
and browser failures are reported, not suppressed or silently fixed here.
The `lifeflow-typescript` CI key and all deployed/persisted identifiers stay
unchanged. No deployment or production promotion is part of this change.

Rollback: revert the #110 tooling commit(s) together, including root/child
manifests and locks, CI selectors, Dockerfiles/allowlists and Compose contexts.
Run the restored per-project `npm ci` commands to replace generated dependency
trees, then rebuild. No database, media, key, volume, environment file, or
runtime `.runtime` directory needs restoration. Previously published image
digests remain usable through the existing release process.

Streamlit demos are installed with root requirements; `make ui` starts Flight
on 8501, `make ui-payment` starts Payment on 8502, and `make ui-agent-chat` starts
local chat on 8501. Flight and chat use the same default port and run separately.
See [demo configuration](../../examples/streamlit/README.md) and
[shim retirement](../integration/python-examples-and-shims.md).
