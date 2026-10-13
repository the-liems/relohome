# Python package boundaries (#112)

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


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
| `relohome-observability` / `relohome_observability` | `packages/python/observability` | Observability #106: SDK initialization, trace propagation, sanitization and HTTP/SQLite instrumentation |
| `relohome-mcp-http` / `relohome_mcp_http` | `packages/python/mcp-http` | MCP transport: shared bearer authentication and HTTP service behavior |
| `relohome-agent` / `relohome_agent` | `apps/agent-api/pyproject.toml` | Integrated agent API, graph, checkout and runtime composition |
| `relohome-browser-gateway` / `relohome_gateway` | `apps/browser-gateway/pyproject.toml` | Browser gateway; calls backend business operations over HTTP |
| `relohome-flights-mcp` / `relohome_flights_mcp` | `apps/flights-mcp/pyproject.toml` | Flight MCP transport and tools |
| `relohome-payments-mcp` / `relohome_payments_mcp` | `apps/payments-mcp/pyproject.toml` | Payment MCP transport and tools |
| `relohome-intake-api` / `relohome_intake` | `apps/intake-api/pyproject.toml` | Standalone intake compatibility harness |
| `relohome-demos` / `relohome_demos` | `examples/streamlit/pyproject.toml` | Supported Flight, Payment and local agent-chat examples |
| `relohome-location-demo` / `relohome_location_demo` | `examples/location-streamlit/pyproject.toml` | Location Streamlit example |
| `relohome-orchestrator-api` / `relohome_orchestrator` | `apps/orchestrator-api/pyproject.toml` | Standalone orchestrator compatibility harness |

All shared and application projects now use their final `src/relohome_*` layouts.
After updating an existing checkout, run `npm run setup:python` again to replace
old editable mappings. See [app relocation](agent-app-relocation.md) for #114's
entrypoints, compatibility inventory, validation and rollback. The supported demos
are installed from `examples/streamlit`; see
[example/shim migration](python-examples-and-shims.md). PR #107 adds the conditional
telemetry implementation as `relohome-observability`, shared by the gateway,
agent API and both Python MCP applications. These applications and the shared
MCP HTTP package declare it explicitly; images install it as a wheel.
Initialization and middleware live in the canonical application packages.

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

Each Docker build installs its own application and shared dependencies as wheels,
alongside `requirements-runtime.txt` (or the existing standalone pins in
`requirements-agents.txt`). Images launch canonical installed modules; source
launchers and forwarding shims have been retired by #115. Image/service names,
ports, worker counts, health routes, volume identities and same-origin web
serving remain unchanged.

`tests/test_python_package_boundaries.py` discovers all 16 projects from their
`pyproject.toml` metadata. It checks every declared package's current Python
sources, including function-local imports, for declared internal dependencies
and forbidden application-to-application edges. It also checks the single retained persisted-checkpoint alias and the absence
of legacy source shells. Root `pytest.ini` keeps fixture scopes stable as
application pyprojects are added.

CI imports the canonical installed entrypoint from `/tmp` in the six Python
images it already builds. `.github/workflows/build-application-images.yml`
covers gateway, agent, Flight MCP and Payment MCP; `scripts/smoke-agent-containers.py`
covers Intake and Orchestrator alongside their HTTP/auth/readiness checks.
These imports use no repository-root `sys.path` or `PYTHONPATH` injection and
require no additional dependency installation on the runner. Package data remains
declared in each owning `pyproject.toml`; the Orchestrator registry is explicit
external configuration, not bundled package data.

The [accepted review follow-up](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/128#pullrequestreview-5493564528)
makes these image imports and metadata-driven boundary tests the #112 acceptance
evidence and the #115 installed-package removal gate. Validation follows the
actual consumers: the packages are private and installed together in these images.

The live efficiency comparison must install each revision in its own environment;
`RUN_EFFICIENCY_PYTHON` selects its interpreter and `RUN_EFFICIENCY_APP` can select
a pre-migration source entrypoint. `RUN_EFFICIENCY_SOURCE_ROOT` supplies runtime
configuration, not an import-path override. These checks remain opt-in. Demo
source-runner path compatibility is tracked under #115.

Schema export defaults to `docs/api/agent-contract` under `RELOHOME_RUNTIME_ROOT`;
relative overrides resolve against the same root and absolute overrides stay explicit:

```sh
python -m relohome_agent.agents.contracts.export_schema --output-dir docs/api/agent-contract
```

## Runtime paths and existing state

Set `RELOHOME_RUNTIME_ROOT` to the **absolute existing checkout/deployment root**
when launching installed applications directly. Root npm/Make commands and the
local integration launcher set it; Python images set `/app`. It is configuration,
not a source or import path. Wheels never infer a checkout by walking their
installation directory. The gateway requires this setting after #113; see the [web/gateway relocation](web-gateway-relocation.md).

Gateway paths relative to this root remain:

- `data/siu-web.sqlite3` for the database;
- the database sibling `siu-web-traveler.key` for its encryption key;
- `Frontend/data/housing-media` for local media;
- `apps/web/dist` for browser assets after #113.

Existing `SIU_WEB_DB`, `SIU_TRAVELER_KEY_FILE`, `SIU_TRAVELER_KEY`, and
`SIU_HOUSING_MEDIA_DIR` overrides remain supported. Relative path overrides are
anchored to the configured runtime root. Compose's absolute container media
path remains unchanged. Opening an existing database without its encryption key
fails before opening the store; it never creates a replacement key. Copy the
existing paired key when restoring a database.

All three application resolvers expand `~`, require an absolute configured root,
and resolve it before use (no source-launch fallback remains).
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

The #112/#113/#114 source shims were removed by #115 after migrating repository
callers to installed namespaces. `packages/python/compatibility.json` now lists
only the persisted alias below. No `src/` package or `Frontend/*.py` remains.
`Frontend/data/housing-media` is an ignored runtime location, not Python source.
Shared-domain tests now import their canonical packages; gateway/app regression
tests verify current editable origins from an isolated interpreter outside the
checkout. Demos import `relohome_demos` and shared libraries without modifying
`sys.path`, and communicate with applications over HTTP.

[Complete accounting, caller migration and validation results](python-examples-and-shims.md)
record #115's removal evidence and any unverified gates. Unknown private/copied
checkout consumers require an owned census/migration follow-up under #116:
packaging/application maintainers own this assessment; no speculative source
shim is retained for an unidentified consumer. Installed wheels and all six
Python image build/import/startup checks remain required before acceptance.

`src.agents.models` is additionally a **persisted checkpoint identifier**, owned
by the agent maintainers. LangGraph accepts both the legacy and canonical names
with an explicit class allowlist. Canonical imports expose the same model classes,
but their stored type identifiers remain `src.agents.models`, so an older image
can read newly written checkpoints during rollback. A frozen SQLite checkpoint
from base `09ac457` is resumed by `tests/test_checkpoint_compatibility.py` under
ordinary pytest, without any pip invocation. Rewritten model payloads match the
old bytes exactly.
This persistence alias is **not** removable with ordinary source-shim cleanup in
#115. Retire it only through an explicit persisted-format transition after old
checkpoints/backups have expired or migrated and older rollback images are retired.

Shim-removal acceptance requires that the owning moves migrate known
callers, the #118 external-consumer assessment permits removal, repository
searches show no remaining operational callers, and the canonical image-import,
boundary and image startup checks pass. Record any external consumer and its
agreed compatibility window before removal. Do not remove aliases merely because the package builds.

## Validation and rollback

The original unchanged base suite passed **856 tests**, with **96 expected skips**
and **137 subtests**. Application imports/patch targets were migrated without
relaxing existing behavioral assertions. The MCP client subprocess uses its
installed entrypoint from a temporary directory. Boundary tests cover project
discovery, dependency direction and alias identity; the historical checkpoint
regression remains part of ordinary pytest. Roommate tests cover runtime-root
anchoring and rejection of public paths for private state and backups.

After merging main `da112b8`, the complete Python/gateway/demo suite passed
**910 tests, 97 skipped, 136 subtests**, including PostgreSQL Roommate checks
against a disposable database. Clean Node 24 installation, TypeScript builds and
tests passed. All six Python images rebuilt and passed installed imports from
`/tmp` and default-CMD health checks. The web image rebuilt the browser bundle.
Current-head validation results are recorded in the PR. Provider-dependent checks
and staging rollout remain explicit separate gates.

Rollback is a code revert and redeployment of the previous published image
digest through the existing release process. Keep databases, keys, media,
volumes and service identities in place. Reinstall the reverted requirements in
a local venv; do not reset or migrate user state. Staging data/digest rollback
evidence remains the #116 gate; this change does not deploy or promote anything.
