# ADR-025: Application layout and migration contract

Date: 2026-10-12
Status: Proposed; naming decision in #118 precedes implementation in #110–#116
Review: application/domain maintainers and repository CODEOWNERS

Publication base: `263c4a9`; the [base reconciliation](../integration/monorepo-baseline/current-base.md)
adds shared MCP HTTP packaging and supersedes historical deployment details.

Related: [#108](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/108),
[#109](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/109), ADR-001,
ADR-004, ADR-013, ADR-014, ADR-016, ADR-019. This changes source ownership, not topology.

On acceptance, this ADR will supersede the source-layout portions of ADR-001
and ADR-013, preserving their domain/transport decisions. #110 owns the ADR-001
status cross-reference, #114 owns ADR-013 and its layout test, and #115 verifies
both updates after acceptance. Until then, this proposal does not supersede them.

## Context and alternatives

At `9b2b2dbddee8e55d7219be7de3348e815b1e50f4`, the browser source and gateway
share `Frontend/`, eight Node workspaces live inside `Maps VN/LifeFlow/`,
and Python imports depend on the checkout's `src` namespace. Three independent
npm lockfiles exist. Docker, CI filters, Windows launchers, resource loaders,
tests and persistent-path defaults embed those locations.

Keeping the layout avoids migration cost but leaves ownership and root commands
ambiguous. Moving directories alone breaks imports, worker asset preparation,
image COPY instructions and persistent paths. Introducing a new build orchestrator
adds an unrelated dependency/tool migration. Choose incremental relocation with
npm workspaces and installable Python distributions, preserving existing tools.

## Naming contract (#118)

The final naming choice is **ReloHome** for display text, **relohome** for
machine-facing source names, **@relohome/** for private npm workspaces, and
hyphenated `relohome-*` Python distributions with underscore `relohome_*`
imports. This contract is ready for review; acceptance occurs when this ADR
change merges. It does not authorize publishing packages or renaming deployed
identities. The broader layout ADR retains its review status.

The [exact rename/preserve matrix and package map](../integration/monorepo-baseline/naming-inventory.md)
are a **normative part of this ADR**: M01–M26 and the token decisions in
`naming-occurrences.tsv` cover the complete pinned inventory. Rename source
references using the target maps, never by replacing a directory recursively.
M08, M10–M21 and M24–M25 preserve compatibility; M07 separates new prompt text
from provider audit comments; M23 preserves historical evidence. M05 renames
internal symbols and their consumers atomically, without speculative aliases.
No persisted or external interface is renamed merely because its spelling includes LifeFlow.

Exact npm suffix changes are `@lifeflow/mcp-server` → `@relohome/location-mcp`
and `@lifeflow/moving-mcp-server` → `@relohome/moving-mcp`; the other six scoped
suffixes are unchanged. Root `lifeflow-platform` becomes `relohome` through
#110's root consolidation; #115 has relocated `lifeflow-map-app` to
`examples/map-app/` as `@relohome/map-app`. Existing `siu-ai-web` remains unchanged
(no broader SIU rename).

Python application distributions/imports and shared-library targets below are
final names, not provisional LifeFlow packages to introduce first. Shared MCP
HTTP is `relohome-mcp-http` / `relohome_mcp_http`. Python telemetry uses official
packages pinned in `requirements-observability.txt`; there is no application
observability distribution. Node telemetry is configured through the
`@relohome/telemetry/register` preload. Scripts now live in `scripts/relohome/`;
`Start-LifeFlow.ps1` / `Stop-LifeFlow.ps1` have become `Start-ReloHome.ps1` /
`Stop-ReloHome.ps1`; `dev:lifeflow` / `predev:lifeflow` have become `dev:relohome` /
`predev:relohome`; the map browser test is now `tests/relohome.spec.ts`.

#110–#116 implementation and alias/removal ownership are recorded in the
[naming handoff](../integration/monorepo-baseline/naming-inventory.md#handoff-and-sequencing).
The external-consumer assessment found no published instance of the eight
scoped packages in the public registry, but private consumers remain unknown.
Preserve TS exported behavior; add compatibility shims only for identified
consumers and use the documented consumer gate before removing any shim.
Historical paths and baseline commands below remain exact.

## Target locations

The [inventory](../integration/monorepo-inventory.md) and its
[file-by-file map](../integration/monorepo-baseline/path-map.tsv) are part of this
proposal. Prefix mappings preserve every relative suffix unless an explicit
file/symbol exception is listed. The TSV covers every tracked baseline file,
including files intentionally retained. It is a review artifact, **not a move
script**; split files, lockfiles, tests and Docker contexts require hand review.
Untracked/ignored files are excluded, including `design-comparison/`, local data,
`.env`, virtual environments, generated output and extracted project snapshots.

| Existing root | Target | Ownership / disposition |
| --- | --- | --- |
| `Frontend/` browser TS, assets, npm/Playwright/Vite config | `apps/web/` | Web; supported product |
| `Frontend/{__init__,server,store,roommate_gateway}.py` | `apps/browser-gateway/src/relohome_gateway/` | Gateway; supported, same web image |
| `src/{main.py,config.py,api,agents,checkout,services}` | `apps/agent-api/src/relohome_agent/` | Agent/API; exceptions below |
| `Maps VN/LifeFlow/platform-api/` | `apps/platform-api/` | Housing/location HTTP API |
| `Maps VN/LifeFlow/mcp-server/` | `apps/location-mcp/` | Location MCP |
| `Maps VN/LifeFlow/moving-api/` | `apps/moving-api/` | Moving HTTP API |
| `Maps VN/LifeFlow/moving-mcp-server/` | `apps/moving-mcp/` | Moving MCP |
| `Maps VN/LifeFlow/packages/{contracts,housing-query,mcp-core,moving-service}/` | `packages/{contracts,housing-query,mcp-core,moving-service}/` | Existing domain owners; npm names fixed by the naming contract above |
| `src/mcp_servers/flights/` transport and tool assembly | `apps/flights-mcp/src/relohome_flights_mcp/` | Flight MCP; domain library below |
| `src/mcp_servers/payments/` transport and tool assembly | `apps/payments-mcp/src/relohome_payments_mcp/` | Payment MCP; domain library below |
| `src/agent_services/intake/` except models | `apps/intake-api/src/relohome_intake/` | Standalone-agent maintainers |
| `src/agent_services/orchestrator/` | `apps/orchestrator-api/src/relohome_orchestrator/` | Standalone-agent maintainers |
| `src/ui/` | `examples/streamlit/src/relohome_demos/` | Retained supported Flight, Payment and agent-chat demos |
| `Maps VN/LifeFlow/demo/` | `examples/location-streamlit/src/relohome_location_demo/` | Retained supported Streamlit location agent/tool lab |
| `Maps VN/LifeFlow/map-app/` | `examples/map-app/` | Retained supported map demo; npm workspace |
| `Maps VN/LifeFlow/database/` | `deploy/database/` | SQL migration/ingestion owners; preserve ordering and both `008_*` files |
| `Maps VN/LifeFlow/infra/` | `deploy/location/` | Location infrastructure; bind sources explicitly preserved |
| `Maps VN/LifeFlow/compose.moving*.yaml`, `Dockerfile.moving*` | `deploy/moving/` (same basenames) | Moving infrastructure |
| `Maps VN/LifeFlow/scripts/`, `*.ps1` | `scripts/relohome/` | Maintainers of invoked services |
| `Maps VN/LifeFlow/config/` | `config/location/` | POI extraction configuration |
| `Maps VN/LifeFlow/docs/`, README, STREAMLIT_MVP | `docs/location/` | Current operational documentation |
| `Maps VN/LifeFlow/reports/` | `eval/location/` | Historical evidence; no runtime dependency |
| `Frontend MVP planning questions/` | `examples/design-reference/` | Static design references, not supported applications |
| `Maps VN/Cities/`, `.dvc*`, `data/`, `config/`, `eval/`, `deploy/coolify/` | Same paths | Retain data/artifact identities and operations contracts |
| Root scripts, Makefile, Compose, requirements, Dockerfile*, `.github/`, docs, tasks, presentation, governance and agent-tool metadata | Same paths | Stable root entrypoints; contents updated in each dependent move |

Standalone Intake/Orchestrator remain supported **compatibility harnesses** with
existing images and CI smoke tests. They do not replace the integrated graph;
ADR-006 remains superseded. Retaining them under `apps/` reflects maintained
runnable services, not a decision to add them to production.

## Python packages and dependency direction

Each target Python project uses `pyproject.toml` and a `src/<import-name>/`
layout, with explicit dependencies and package-data declarations. Distribution
names use hyphens; import names use underscores. No permanent `PYTHONPATH` or
`sys.path` additions. Tests must also pass against installed wheels outside the
checkout. Root requirements remain the compatible developer installation entry.

| Existing modules / symbols | Distribution → import namespace | Exact target root | Consumers / accountable domain |
| --- | --- | --- | --- |
| `src.models.*` | `relohome-contracts` → `relohome_contracts.*` | `packages/python/contracts/src/relohome_contracts/` | Gateway, agent; API contracts |
| `src.agents.intake.{redact_pii,looks_like_pii}` plus public `contains_contact_pii(value)`; private `_EMAIL`, `_LONG_DIGITS`, `_ID_NUMBER`, `_PHONE` constants | `relohome-privacy` → `relohome_privacy.{redact_pii,looks_like_pii,contains_contact_pii}` | `packages/python/privacy/src/relohome_privacy/__init__.py` | Gateway, MovingOptions, intake; agent privacy owner |
| `src.roommate.*` except `runtime.py` | `relohome-roommate` → `relohome_roommate.*` | `packages/python/roommate/src/relohome_roommate/` | Gateway media/error/projection and agent domain services; Roommate |
| `src.roommate.runtime` | `relohome-agent` → `relohome_agent.roommate_runtime` | `apps/agent-api/src/relohome_agent/roommate_runtime.py` | Backend composition of Settings, private store and domain library |
| Flight `booking_engine`, `catalog`, `catalog_data/`, `errors`, `schemas`, `search/`, `settings`, `storage` | `relohome-flight` → `relohome_flight.*` | `packages/python/flight/src/relohome_flight/` | Checkout age rules, gateway passengers, Flight MCP and demo; Flight |
| Payment `engine`, `errors`, `gateways/`, `privacy`, `schemas`, `settings`, `storage` | `relohome-payment` → `relohome_payment.*` | `packages/python/payment/src/relohome_payment/` | Payment MCP and retained demo; Payment |
| `src.agent_services.common`, `.llm`, `.intake.models` | `relohome-agent-services` → `relohome_agent_services.{common,llm,intake_models}` | `packages/python/agent-services/src/relohome_agent_services/` | Both standalone services; standalone-agent contracts |

`relohome-agent`, `relohome-browser-gateway`, `relohome-flights-mcp`,
`relohome-payments-mcp`, `relohome-intake-api`, `relohome-orchestrator-api` and
`relohome-demos` are the final application/example distribution names. Their imports
are respectively `relohome_agent`, `relohome_gateway`, `relohome_flights_mcp`,
`relohome_payments_mcp`, `relohome_intake`, `relohome_orchestrator`,
`relohome_demos`. The location Streamlit distribution is `relohome-location-demo`
and its collision-free import is `relohome_location_demo` (replacing `demo`).

Applications depend on shared packages; packages never import applications.
`relohome_contracts` depends on `relohome_privacy` (MovingOptions currently lazily
imports intake). `relohome_roommate` is independent of backend Settings after
moving the runtime composer into the agent app. Flight and Payment packages
contain reusable domain code, including existing provider implementations, but
not MCP server creation. This avoids splitting every demonstrated demo import
into another tiny package. Their settings/env interfaces remain unchanged.
The Flight catalog JSON and agent subagent fixture JSON must be included as
wheel package data, not databases to relocate. Installed-resource tests must
exercise both; external registry/config and user datasets remain explicit paths.
Agent graph, checkout and adapters stay together: their internal coupling is not
evidence of cross-application reuse. Agent-task schema exports retain one owner;
this migration must not redesign the TypeScript/Python contract authority.

The final gateway import boundaries are `relohome_privacy.redact_pii`,
`relohome_flight.schemas.{Contact,Passenger}`, `relohome_contracts.*`, and
`relohome_roommate.{access,agent_projection,media}`. Gateway-to-agent business
operations continue over HTTP. Browser TS cannot import gateway/server modules.
No app-to-app Python imports are permitted in the final layout.

Ownership above is functional accountability, not a new GitHub approval rule.
Existing `.github/CODEOWNERS` remains authoritative; each move author must obtain
the affected domain review. The #115 slices have retired the temporary
`src.*`/`Frontend.*` source forwarders after caller migration and installed-package/image
checks. The sole retained `src.agents.models` alias is an in-memory persisted-checkpoint
contract, owned by agent/checkpoint maintainers. #116 owns the private-consumer
census and staging existing-data/digest rollback gates; see the
[final audit](../integration/monorepo-final-audit.md).

Privacy extraction in #112 moves `looks_like_pii` with `redact_pii`. Keep all
regexes private in the library. Add public `contains_contact_pii(value)` with the
existing email-or-phone semantics for intake reference facts; replace both
remaining intake regex uses through these public predicates. Preserve the
different long-digit behavior of `looks_like_pii`; do not copy patterns or import
private library constants across the boundary.

#112 adds explicit `__init__.py` files for currently implicit namespaces at
`packages/python/roommate/src/relohome_roommate/{__init__.py,services/__init__.py}`
and `apps/agent-api/src/relohome_agent/agents/subagents/services/__init__.py`
(final #118 names). These are planned new files, absent from the
baseline map. Each wheel must have an expected module/JSON manifest and be
import-tested outside the checkout without PYTHONPATH, including Roommate
services and subagent services. #112/#114 own any transitional `src.mcp_servers`
namespace and its parent `src` shim; #115 has removed both on-disk namespaces.
Installed-wheel/image evidence and the retained persisted alias are recorded in
the final audit.

#114 updates `tests/test_mcp_servers_layout.py` to discover the new application
roots while retaining health, non-root USER, EXPOSE, transport and entrypoint
assertions. Current backend Flight/Payment clients are HTTP-only; server
launches requiring relocation are in `scripts/local-integration.py` and Docker
CMDs. Flight checkout still consumes schemas and booking age rules;
`src/services/adapters/mcp.py` no longer imports the airport catalog at this base.

## Root command contract

After this naming contract merges, #110 adds commands before moves, preserving existing Make targets and component
flags. Root `npm ci` installs all TS applications/packages/examples from one
lockfile. Preserve versions from all three locks; explicitly review incompatible
resolutions. Frontend and map-app worker preparation must resolve MapLibre from
the installed dependency graph rather than assume a local `node_modules/`.

Required stable root targets:

- `make install`: Python developer dependencies plus root `npm ci`.
- `make build`: TS libraries in dependency order, services, web and map demo.
- `make lint`: Python CI scope plus existing TS lint where provided; expand only
  after baseline findings are explicitly resolved. Never silently omit a suite.
- `make format-check`: non-mutating formatting check; `make format` remains an
  explicit write. Existing `make check` currently runs the mutating format target;
  #110 replaces that edge with `format-check` and records pre-existing drift.
- `make test`: portable Python, Node and pure frontend contracts; includes
  `Frontend/tests` successors (currently missing from the Make target).
- `make test-browser`: deterministic Playwright desktop/mobile journeys.
- `make test-integration`: isolated database/container checks, with prerequisites
  documented; no implicit provider calls or writes.
- `make test-live`: explicit provider opt-in preserving current flags/credentials.
- `make image-check`, `make deployment-check`: build/import/health and offline
  deployment rendering/selector checks, never deploy or promote.
- `make run`, `make ui`, `make ui-payment`, `make mcp-build/up/down`: retain
  meanings, ports and opt-ins. Local integration selectors remain available from
  `scripts/local-integration.py`; add discoverable web/map/agent-chat commands.

Tests migrate by ownership: Python domain tests beside packages, application
unit tests beside apps, and multi-service/deployment/contract tests under root
`tests/`. The file map records these assignments. Relocate or explicitly share
the relevant `conftest.py` fixtures so app-local tests do not depend on accidental
root test discovery. Tests combining gateway, backend, UI and image paths remain
integration tests until split deliberately.

## Runtime and persistent-path contract

Keep the combined `web` image serving built React assets and gateway routes at
8503 with one worker. Source separation does not create a second deployment.
Keep backend 8000/one worker; all routes, MCP transports, health checks, service
DNS names, feature flags, tokens and secret interfaces remain identical.
See the inventory for exact image/build contexts and service identifiers.

Default paths must be resolved independently of new module depth. In particular:

| Existing path/interface | Required compatibility |
| --- | --- |
| `SIU_WEB_DB`, default repository `data/siu-web.sqlite3` | Open the same database after the move; never initialize `apps/data/` |
| `SIU_TRAVELER_KEY_FILE`, default DB sibling `siu-web-traveler.key` | Preserve key and DB pairing |
| `SIU_HOUSING_MEDIA_DIR`, default `Frontend/data/housing-media` | Preserve old local default explicitly; container remains `/app/data/housing-media` |
| `AGENT_STATE_DIR`, default `data/agent-runtime` | Preserve `runtime.sqlite3`, `checkpoints.sqlite3`, `pii.key` together |
| `ROOMMATE_STATE_DIR`, default `logs/private-roommate` | Preserve `roommate.sqlite3` and `contact.key`; maintain rejection of public data/assets after source move |
| `FLIGHT_DB_PATH`, `PAYMENT_DB_PATH` | Keep `./data/flights.db`, `./data/payments.db`; integration payment path remains `data/integration-payments.db` |
| `ORCHESTRATOR_DB_PATH`, registry path | Keep `data/orchestrator.sqlite3`, `config/agent-services/registry.json` |
| `DATABASE_URL`, `CHROMA_PERSIST_DIR` defaults | Keep `./data/app.db`, `./data/chroma` even if unused in current flow |
| `Maps VN/Cities/`, local `Maps VN/Extracts/`, routing graphs, DVC/LFS assets | No storage relocation; resolve old bind sources explicitly when Compose moves |
| `Maps VN/LifeFlow/.runtime/` | Preserve `moving-secrets.json`, service PID/log paths; never regenerate database credentials because a launcher moved |
| `Maps VN/Routing/`, `Maps VN/Extracts/POI/vietnam-260922/` | Preserve routing graphs and extraction outputs independently of new PowerShell script location |
| `data/integration.env`, `.env`, `LIFEFLOW_ENV_FILE` | Preserve launcher precedence and scoped credential handling |

Gateway defaults are file-relative today: `ROOT.parent/data/siu-web.sqlite3`
and `ROOT/data/housing-media`, where ROOT is the old Frontend directory. Running
from repository root does not preserve them after moving the module. #112 must
define an explicit runtime-root/configuration resolver before #113/#114. Preserve
the same absolute legacy defaults when launched from root, Frontend or an
unrelated directory; test an installed wheel in each case without PYTHONPATH.
Installed entrypoints must not infer repository roots by walking `__file__.parents`.
Verify the existing database, paired key and media are used, with no new empty
database, key or media directory created. A configured existing database with a
missing encryption key must
fail, never silently generate a replacement. No DB-engine or schema changes.

Keep Compose project/volume identities even when a Compose file moves. Preserve
`web-data`, `agent-data`, `roommate-private`, `flights-data`, `payments-data`,
`location-data`, `moving-data`, `routing-data`, `orchestrator-state`, `lifeflow-postgis-data` and any
explicit external names. Source-root changes cannot create new empty volumes.
#66 owns storage backup/Postgres; #77 owns routing artifacts.

## Delivery and rollback

Each slice updates imports, scripts, tests, Docker/ignore contexts, Compose,
workflow paths, root wrappers and current runbooks in the same PR. Use focused
rename commits; package extractions precede app moves. Maintain ARM64 builds,
runner isolation (#61), immutable release tags/digest promotion and staging
release selection. Preserve image suffixes despite new directory names.

Before merging a slice, record base/head commands and failure IDs, image imports
and health evidence. Keep a map of old paths, compatibility shims and consumers.
Rollback is a code revert plus redeployment of the previously published digest
using the existing release process; databases, keys and volume names remain in
place. Do not rerun migrations/imports or restore/reset databases to undo a move.
Retain prior images and verify their ability to read unchanged state on staging.
#116 requires explicit staging evidence of existing data and digest rollback;
CI deployment submission alone does not prove this. No production rollout,
database migration, data deletion or demo removal is authorized here.

## Coordination and implementation gates

The [follow-on scope register](../integration/monorepo-inventory.md#follow-on-scope-register)
records concrete additions for #118, #110–#116 and PR #107/#76. Re-inventory the chosen
merge base before each slice. This ADR is proposed until reviewed; #109 moves
no application source or data and does not claim unfinished migration checks
already pass.
