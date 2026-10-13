# Python package boundaries (#112)

Base: `09ac457` (root tooling #124). Naming contract: #118 / #121 and ADR-025.
This slice extracts shared libraries before the physical application moves in
#113/#114. It introduces no database migration or deployment identity change.

## Packages and ownership

All distributions are private local projects, version `0.1.0`, requiring Python
3.11+. They are installed together; nothing is published to a package registry.

| Distribution / import | Source project | Accountable owner and scope |
| --- | --- | --- |
| `relohome-privacy` / `relohome_privacy` | `packages/python/privacy` | Agent privacy: redaction and PII predicates, private regexes |
| `relohome-contracts` / `relohome_contracts` | `packages/python/contracts` | API contracts: shared forms and schemas; depends on privacy |
| `relohome-roommate` / `relohome_roommate` | `packages/python/roommate` | Roommate: domain, media sanitization, projections, errors and storage |
| `relohome-flight` / `relohome_flight` | `packages/python/flight` | Flight: schemas, booking rules, search providers and catalog JSON |
| `relohome-payment` / `relohome_payment` | `packages/python/payment` | Payment: schemas, engine, provider implementations and storage |
| `relohome-agent-services` / `relohome_agent_services` | `packages/python/agent-services` | Standalone services: common HTTP/settings, LLM adapter and intake contracts |
| `relohome-mcp-http` / `relohome_mcp_http` | `packages/python/mcp-http` | MCP transport: shared bearer authentication and HTTP service behavior |
| `relohome-agent` / `relohome_agent` | `src/pyproject.toml` | Integrated agent API, graph, checkout and runtime composition |
| `relohome-browser-gateway` / `relohome_gateway` | `Frontend/pyproject.toml` | Browser gateway; calls backend business operations over HTTP |
| `relohome-flights-mcp` / `relohome_flights_mcp` | `src/mcp_servers/flights/pyproject.toml` | Flight MCP transport and tools |
| `relohome-payments-mcp` / `relohome_payments_mcp` | `src/mcp_servers/payments/pyproject.toml` | Payment MCP transport and tools |
| `relohome-intake-api` / `relohome_intake` | `src/agent_services/intake/pyproject.toml` | Standalone intake compatibility harness |
| `relohome-orchestrator-api` / `relohome_orchestrator` | `src/agent_services/orchestrator/pyproject.toml` | Standalone orchestrator compatibility harness |

Shared projects use the final `src/relohome_*` layout. Application projects use
explicit setuptools package mappings over their existing source directories.
This is a temporary source-layout arrangement, not a path injection. #113/#114
move those sources to the ADR's `apps/*/src/relohome_*` roots and remove the
package mappings. The installed namespace stays unchanged across that move.
Retained demo source runners move/package in #115. No observability package is
introduced: the conditional telemetry implementation is absent at this base.

Applications may depend on shared libraries, never another application's
implementation. Roommate's Settings/runtime composer belongs to `relohome_agent.roommate_runtime`.
The gateway no longer imports agent intake or MCP application code. Contracts
use public privacy functions, including function-local imports. `looks_like_pii`
retains its broader long-digit heuristic; `contains_contact_pii` retains the
email-or-phone semantics of intake reference facts.

## Install, develop and validate

Run installation commands from the repository root:

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm run test:python
npm run test:packages
npm run dev:agent
npm run dev:gateway
```

Use `.venv/Scripts/python.exe` on Windows. `requirements-dev.txt` installs the
local projects editable so source edits are visible immediately. The legacy
`requirements.txt` command delegates to this same editable developer setup;
`requirements-runtime.txt` contains the existing common third-party runtime
ranges. Ruff, pytest, pytest-asyncio and deployment-test PyYAML moved to the dev
file without changing their constraints. Standalone dependency pins are retained
in their owning project metadata and `requirements-agents.txt`.

Each Docker build installs its own application and shared dependencies as wheels.
Existing source copies/CMDs remain temporarily supported; the wheel import gate
also runs from outside `/app`. Image/service names, ports, worker counts, health
routes, volume identities and same-origin web serving remain unchanged.

`packages/python/manifest.json` is the reviewed, exact Python/JSON content list
for every wheel, including Flight catalogs, subagent fixtures, Roommate services
and subagent services. `npm run test:packages` builds wheels, compares their
contents, then independently installs every wheel in its own fresh venv with only
its declared dependencies, runs `pip check`, and imports every module outside the
checkout without `PYTHONPATH`. Function-local dependencies are checked too. Builds
use temporary source copies excluding old `build/` and `*.egg-info` artifacts;
deleted modules cannot leak back into a wheel from previous build output. It exercises
catalog/fixture loading, privacy behavior and gateway persistence. The
Orchestrator registry is copied as explicit external configuration, not bundled
as package data. `tests/test_python_package_boundaries.py` enforces dependency
direction and shared compatibility-module identity. Root `pytest.ini` keeps
fixture scopes stable as application pyprojects are added.

The live efficiency comparison must install each revision in its own environment;
`RUN_EFFICIENCY_PYTHON` selects its interpreter and `RUN_EFFICIENCY_APP` can select
a pre-migration source entrypoint. `RUN_EFFICIENCY_SOURCE_ROOT` supplies runtime
configuration, not an import-path override. These checks remain opt-in. Demo
source-runner path compatibility is tracked under #115.

Schema export now requires an explicit destination:

```sh
python -m relohome_agent.agents.contracts.export_schema --output-dir docs/api/agent-contract
```

## Runtime paths and existing state

Set `RELOHOME_RUNTIME_ROOT` to the **absolute existing checkout/deployment root**
when launching installed applications directly. Root npm/Make commands and the
local integration launcher set it; Python images set `/app`. It is configuration,
not a source or import path. Wheels never infer a checkout by walking their
installation directory. The old source gateway can still supply its checkout
default while `Frontend/pyproject.toml` is present; #113 removes that fallback.

Gateway paths relative to this root remain:

- `data/siu-web.sqlite3` for the database;
- the database sibling `siu-web-traveler.key` for its encryption key;
- `Frontend/data/housing-media` for local media;
- `Frontend/dist` for browser assets until #113.

Existing `SIU_WEB_DB`, `SIU_TRAVELER_KEY_FILE`, `SIU_TRAVELER_KEY`, and
`SIU_HOUSING_MEDIA_DIR` overrides remain supported. Relative path overrides are
anchored to the configured runtime root. Compose's absolute container media
path remains unchanged. Opening an existing database without its encryption key
fails before opening the store; it never creates a replacement key. Copy the
existing paired key when restoring a database.

All three application resolvers expand `~`, require an absolute configured root,
and resolve it before use (the explicit gateway source-launch fallback remains).
They stay application-owned to avoid adding a generic shared package outside the
ADR scope; their deployment configuration contract is the same.

Orchestrator registry/database relative paths resolve against the configured
root, preserving `config/agent-services/registry.json` and
`data/orchestrator.sqlite3`. Roommate public-path rejection uses the configured
root rather than an installed module's parent directories; enabling Roommate
requires that absolute root. Relative private-state, catalog and demo paths are
anchored there. Other service path
and environment interfaces are unchanged; keep their existing working directory
or explicit storage paths when launching them directly.

## Compatibility register and removal gate

Owner: the #112 implementer, handed to #113/#114 move authors; removal owner #115.
`packages/python/compatibility.json` enumerates every extracted module's old and
canonical name. Individual shared module shims alias the canonical module, so
models, exception classes and monkeypatch targets keep identity. Package-level
compatibility modules retain their child shim paths. No model is copied.

Identified callers retained in this slice:

- root domain tests use `src.models`, `src.roommate`, Flight/Payment domain and
  standalone-common shims to verify compatibility;
- `Frontend/tests` uses Roommate shims;
- existing Docker CMDs and external/local callers may use `src.main`,
  `src.agent_services.*`, `src.mcp_servers.*`, and `Frontend.server` source
  entrypoints; application internals, root npm commands and Python launchers now
  use canonical installed names;
- `src.roommate.runtime` forwards to the agent-owned runtime composer;
- demos retain their own `src.ui` imports until #115 but use extracted domain
  packages rather than copied schemas.

Application source modules are not a supported second public class namespace;
new consumers must import the canonical installed namespaces. Retained source
entrypoints are launch compatibility only. Parent `src` and `src.mcp_servers`
remain owned by #112/#114 during migration.

`src.agents.models` is additionally a **persisted checkpoint identifier**, owned
by the agent maintainers. LangGraph accepts both the legacy and canonical names
with an explicit class allowlist. Canonical imports expose the same model classes,
but their stored type identifiers remain `src.agents.models`, so an older image
can read newly written checkpoints during rollback. A frozen SQLite checkpoint
from base `09ac457` is resumed in regression tests and in the isolated agent wheel
(no source `src` package); rewritten model payloads match the old bytes exactly.
This persistence alias is **not** removable with ordinary source-shim cleanup in
#115. Retire it only through an explicit persisted-format transition after old
checkpoints/backups have expired or migrated and older rollback images are retired.

Remove shims/source entrypoints only after the owning moves migrate known
callers, the #118 external-consumer assessment permits removal, repository
searches show no remaining operational callers, and installed-wheel plus image
startup gates pass. Record any external consumer and its agreed compatibility
window before removal. Do not remove aliases merely because the package builds.

## Validation and rollback

The unchanged base suite passed **856 tests**, with **96 expected skips** and
**137 subtests**. No assertions were relaxed: application imports/patch targets
were migrated to canonical names, and the MCP client subprocess test now runs
its installed entrypoint from a temporary directory. The package boundary tests
add two checks; a Roommate test covers root-relative private state and public-path
rejection from an unrelated working directory. Final head and image results are recorded in the PR.

Validation before the main sync (`d358786`): **863 passed, 96 skipped, 137 subtests**; all 13 exact
wheel manifests/imports/dependency checks passed in independent environments; all six Python images
(backend, web, Flight, Payment, Intake, Orchestrator) built and passed installed
imports from `/tmp` plus default-CMD `/health` checks. Containers had no external
network or persistent mounts and used only dummy startup credentials. CI-scope
Ruff and `git diff --check` passed. The web image also rebuilt the browser bundle.
Live-provider checks and staging rollout remain explicit separate gates.

After merging main `da112b8`, the complete Python/gateway/demo suite passed
**910 tests, 97 skipped, 136 subtests**, including the new PostgreSQL Roommate
checks against a disposable database. The merge carries new Roommate modules into
their canonical package, declares the PostgreSQL driver, and preserves root tooling
for the relocated TypeScript workspaces and explicit local environment files.
A regression verifies relative private backup paths from an unrelated working
directory. Clean Node 24 installation, TypeScript builds and tests also passed.
All six Python images rebuilt and passed installed imports from `/tmp` and
default-CMD health checks after the merge.

Rollback is a code revert and redeployment of the previous published image
digest through the existing release process. Keep databases, keys, media,
volumes and service identities in place. Reinstall the reverted requirements in
a local venv; do not reset or migrate user state. Staging data/digest rollback
evidence remains the #116 gate; this change does not deploy or promote anything.
