# Development map

Use **Node 24 / npm 11 and Python 3.11** from the repository root. This map
connects ownership, commands and runbooks; [ADR-025](docs/adr/ADR-025-monorepo-layout.md)
defines functional accountability. It remains Proposed. The owners below are
domains responsible for maintenance, not new CODEOWNERS approval rules.

## Install

Create this checkout's `.venv` with Python 3.11, then install:

```sh
npm ci
PYTHON=$PWD/.venv/bin/python npm run setup:python
```

`make install` delegates to `npm run setup` (both installations). Python projects
are installed editable by `requirements-dev.txt`; reinstall after pulling a
package/source move. See [root tooling](docs/runbooks/root-tooling.md) for Windows,
browser prerequisites and build order, and [Python packaging](docs/integration/python-packaging.md)
for installed-resource checks. All commands below exist in [package.json](package.json)
or [Makefile](Makefile); npm commands run from this root.

## Ownership and development

Ports are local defaults, configurable through the existing environment keys.
An HTTP MCP entrypoint needs its bearer token. Stdio has no listening port.
Python import namespaces use underscores in place of distribution hyphens, except
`relohome-browser-gateway` → `relohome_gateway`, `relohome-intake-api` →
`relohome_intake`, and `relohome-orchestrator-api` → `relohome_orchestrator`.

| Root | npm / Python distribution | Runtime identity / local port | Accountable owner | Root development command |
| --- | --- | --- | --- | --- |
| `apps/web/` | `siu-ai-web` | React Vite 5174; delivered in `web` at 8503 | Web | `npm run dev:web` / `make web` |
| `apps/browser-gateway/` | `relohome-browser-gateway` | `web` gateway 8503, one worker | Gateway | `npm run dev:gateway` / `make gateway` |
| `apps/agent-api/` | `relohome-agent` | `backend` 8000 | Agent/API and checkpoint maintainers | `npm run dev:agent` / `make run` |
| `apps/platform-api/` | `@relohome/platform-api` | `platform-api` 4100 | Housing/location HTTP API | `npm run dev:api` |
| `apps/location-mcp/` | `@relohome/location-mcp` | `lifeflow-location`, HTTP 3000 | Location MCP | `npm run dev:mcp` (stdio), `npm run dev:mcp:http` |
| `apps/moving-api/` | `@relohome/moving-api` | `lifeflow-moving-api` 4200 | Moving HTTP API | `npm run dev:moving-api` |
| `apps/moving-mcp/` | `@relohome/moving-mcp` | `lifeflow-moving`, HTTP 4400 | Moving MCP | `npm run dev:moving-mcp` (stdio), `npm run dev:moving-mcp:http` |
| `apps/flights-mcp/` | `relohome-flights-mcp` | `flights-mcp`, HTTP 8765 | Flight MCP | `npm run dev:flights-mcp` (stdio); HTTP via [local MVP](docs/runbooks/local-mvp.md) |
| `apps/payments-mcp/` | `relohome-payments-mcp` | `payments-mcp`, HTTP 8766 | Payment MCP | `npm run dev:payments-mcp` (stdio); HTTP via [local MVP](docs/runbooks/local-mvp.md) |
| `apps/intake-api/` | `relohome-intake-api` | `lifeflow-intake` 8011 (container 8000) | Standalone-agent maintainers | `npm run dev:intake` |
| `apps/orchestrator-api/` | `relohome-orchestrator-api` | `lifeflow-orchestrator` 8012 (container 8000) | Standalone-agent maintainers | `npm run dev:orchestrator` |
| `packages/contracts/` | `@relohome/contracts` | Shared TS contracts; no service | API/domain contracts | `npm run build:ts` |
| `packages/housing-query/` | `@relohome/housing-query` | Shared PostGIS queries; no service | Housing/location | `npm run build:ts` |
| `packages/mcp-core/` | `@relohome/mcp-core` | Shared TS MCP transport; no service | MCP transport maintainers | `npm run build:ts` |
| `packages/moving-service/` | `@relohome/moving-service` | Shared Moving domain; no service | Moving | `npm run build:moving` |
| `packages/python/agent-services/` | `relohome-agent-services` | Shared standalone contracts/LLM; no service | Standalone-agent maintainers | `npm run test:python` |
| `packages/python/contracts/` | `relohome-contracts` | Shared Python API contracts; no service | API contracts | `npm run test:python` |
| `packages/python/flight/` | `relohome-flight` | Flight domain/catalog; no service | Flight | `npm run test:python` |
| `packages/python/mcp-http/` | `relohome-mcp-http` | Shared Python MCP HTTP; no service | MCP transport maintainers | `npm run test:python` |
| `packages/python/payment/` | `relohome-payment` | Payment domain/providers; no service | Payment | `npm run test:python` |
| `packages/python/privacy/` | `relohome-privacy` | Shared PII predicates; no service | Agent privacy | `npm run test:python` |
| `packages/python/roommate/` | `relohome-roommate` | Shared Roommate domain/storage; no service | Roommate | `npm run test:python` |
| `examples/map-app/` | `@relohome/map-app` | ReloHome Map, Vite 5173 | Location/map demo | `npm run dev:map` / `make map` |
| `examples/location-streamlit/` | `relohome-location-demo` | Location agent 8501 / tool lab 8502 | Location demo | `npm run dev:location-demo` / `make ui-location`; `npm run dev:location-tool-lab` / `make ui-location-tools` |
| `examples/streamlit/` | `relohome-demos` | Flight/chat 8501; Payment 8502 | Flight/Payment and agent demo owners | `npm run dev:flight-demo` / `make ui`; `npm run dev:payment-demo` / `make ui-payment`; `npm run dev:agent-chat` / `make ui-agent-chat` |
| `examples/design-reference/` | None | Static HTML/JS/screenshots; no supported service | Design-reference maintainers | No development target |
| `deploy/database/` | None | SQL for Location/Moving migration images; no listener | SQL migration/ingestion owners | `npm run db:migrate`; `npm run db:migrate:moving` (build first; writes DB) |
| `deploy/location/` | None | Existing `lifeflow` project, PostGIS and Location MCP | Location infrastructure | `npm run db:up`; `npm run mcp:up` (Docker) |
| `deploy/moving/` | None | Existing `lifeflow-moving` project and images | Moving infrastructure | `npm run moving:up`, `npm run moving:status`, `npm run moving:verify`, `npm run moving:down` |
| `deploy/provisioner/` | None | S3 blob provisioning for Git-pinned Coolify Applications; no listener | Deployment maintainers | `make deployment-check`; delivery runbooks below |

`packages/python/` groups the seven libraries and the compatibility register; it
has no separate distribution. Intake/Orchestrator are supported compatibility
harnesses, not replacements for the integrated graph. Flight and agent-chat
share 8501 and run separately; Location examples can also collide on 8501/8502.
See [web](apps/web/README.md), [agent](apps/agent-api/README.md),
[Location/map](docs/location/README.md), [Location lab](docs/location/STREAMLIT_MVP.md),
[Streamlit demos](examples/streamlit/README.md), [Moving](docs/runbooks/moving-containers.md),
and [standalone services](docs/runbooks/agent-services.md) for configuration.

## Test modes

Build compiled TS exports first with `make build` or `npm run build:ts`.

| Target | Mode / prerequisites |
| --- | --- |
| `make test` | Python, portable TS and pure web contracts; socket tests need local bind permission; provider opt-ins remain unset |
| `make test-browser` | Deterministic web Chrome desktop/mobile journeys; install browser prerequisites in root tooling |
| `make test-map` | Map browser integration; configured Platform API/data/OSRM |
| `make test-integration` | Full TS workspace tests; isolated PostGIS/roles and each suite's fixture flags |
| `make test-live` | Explicit provider opt-in and credentials; `SUITE=python`, `moving` or `browser`, with `RELOHOME_LIVE_CHECKS=1` and suite-specific flags |
| `make image-check` | Docker build/import/startup checks; no deploy; see [image checker](scripts/check-workspace-images.py) for default scope and explicit Python service selectors |
| `make deployment-check` | Offline deployment, provisioner, settings, image selector and web layout checks |

Use `npm run test:python`, `npm run lint`, and `make format-check` for focused
checks. Existing format drift and staging gates are recorded in the
[final consolidation audit](docs/integration/monorepo-final-audit.md).

## Data and configuration

Follow [local MVP setup](docs/runbooks/local-mvp.md) for credentials, snapshots,
service startup and recovery, and [map data](docs/runbooks/map-data.md) for DVC,
catalogs and routing prerequisites. Source moves do not relocate persistent state:

- `data/` retains web DB/key pairs, Flight/Payment DBs, agent checkpoints/PII key,
  integration state and other configured stores; private Roommate state defaults
  to `logs/private-roommate` ([Roommate runbook](docs/runbooks/roommate.md)).
- `Maps VN/Cities/`, `Maps VN/Routing/`, `Maps VN/Extracts/` and raw artifacts stay
  fixed. Keep DVC dataset identities and existing graph/extraction outputs.
- `Maps VN/LifeFlow/.runtime/` retains launcher PIDs/logs and `moving-secrets.json`.
  `Frontend/data/housing-media` remains the local media default;
  container media remains `/app/data/housing-media`.
- `.env.local` is explicitly loaded by root development commands. Preserve root
  `.env`, `data/integration.env`, legacy `Maps VN/LifeFlow/.env`,
  `LIFEFLOW_ENV_FILE` and their initializer/launcher precedence. Start from
  [.env.example](.env.example) and the runbooks; do not regenerate existing keys
  or credentials because source moved. `npm run dev:init` writes local setup.

## Delivery and rollback

The [image catalog](config/ci/application-images.json) and
[CI workflow](.github/workflows/ci.yml) define affected image selection/builds.
Use the [Coolify delivery contract](docs/architecture/infrastructure.md),
[Coolify deployment runbook](deploy/README.md),
[staging Moving configuration](docs/runbooks/moving-coolify.md), and
[runner runbook](docs/runbooks/self-hosted-ci.md) for release prerequisites.
Successful main push CI runs trigger staging deployment through `deploy.yml`;
manual dispatch selects staging or production and an optional main commit SHA.
Compose, application image tags and blob pins come from that commit.

Rollback dispatches the workflow with an older main SHA, with
matching source/configuration when reverting a move. Keep databases, paired keys,
volume names and migration history in place; do not rerun imports or reset state
to undo a source relocation. #116 owns staging evidence that existing data is
read and the previous release can be restored. See the
[slice rollback evidence](docs/integration/location-relocation.md#remaining-references-and-rollback)
and [shim/checkpoint contract](docs/integration/python-examples-and-shims.md#single-retained-alias-and-ownership).
