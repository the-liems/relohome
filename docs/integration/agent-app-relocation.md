# Python application relocation (#114)

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Base: `9bc9dfc` (main, merged #112/#113). This slice changes source ownership and
installed entrypoints; it does not change topology or deploy services.

## Apps and entrypoints

All five projects now use `pyproject.toml` with `src/<namespace>/` discovery.
Shared libraries remain under `packages/python`. No application imports another
application. The backend's only `relohome_flight` imports are checkout passenger
schemas and booking age rules; Flight/Payment adapters remain HTTP clients.

| Project | Distribution / import | Entrypoint |
| --- | --- | --- |
| `apps/agent-api` | `relohome-agent` / `relohome_agent` | `python -m uvicorn relohome_agent.main:app --host 0.0.0.0 --port 8000 --workers 1` |
| `apps/flights-mcp` | `relohome-flights-mcp` / `relohome_flights_mcp` | `python -m relohome_flights_mcp --transport streamable-http` |
| `apps/payments-mcp` | `relohome-payments-mcp` / `relohome_payments_mcp` | `python -m relohome_payments_mcp --transport streamable-http` |
| `apps/intake-api` | `relohome-intake-api` / `relohome_intake` | `python -m uvicorn relohome_intake.app:app --host 0.0.0.0 --port 8011` |
| `apps/orchestrator-api` | `relohome-orchestrator-api` / `relohome_orchestrator` | `python -m uvicorn relohome_orchestrator.app:app --host 0.0.0.0 --port 8012` |

Standalone images still expose 8000 (Compose maps 8011/8012). MCP images still
expose 8765/8766. The Makefile, MCP smoke/cleanup loops, image catalog, workflow
filters and Docker COPY/CMD instructions follow the new projects. Python MCP
build discovery uses `apps/*-mcp/pyproject.toml`, excluding Node MCP projects.
`scripts/local-integration.py` already uses canonical modules, root cwd and an
explicit runtime root at this base; those commands were verified and retained.

## Updating an existing checkout

Run `npm run setup:python` from the repository root after pulling. Keep the
existing virtual environment and data. Old setuptools editable finders map the
canonical namespaces to `src/` or its old app subdirectories; reinstalling
updates these mappings. All five retained old package initializers reject stale
canonical loading with an explicit reinstall message.

Root `npm run dev:agent`, `dev:flights-mcp`, `dev:payments-mcp`, `dev:intake` and
`dev:orchestrator` use the installed distributions. Direct installed launches
must keep the documented working directory/environment, with
`RELOHOME_RUNTIME_ROOT` set to the absolute existing checkout/deployment root.
Docker images set the root to `/app`. Keep existing provider and service tokens;
no live credentials are bundled in wheels or images.

Agent runtime/checkpoint/PII files resolve under this explicit root, preserving
`data/agent-runtime/{runtime.sqlite3,checkpoints.sqlite3,pii.key}` and the key's
0600 mode. Roommate's existing runtime-root resolver and private directory/key
permissions remain intact. Orchestrator retains
`data/orchestrator.sqlite3` and `config/agent-services/registry.json` under the
root, including configured overrides and `:memory:` handling. Flight/Payment
settings and their existing DB paths/volumes are unchanged (direct launches
keep the deployment cwd or explicit `FLIGHT_DB_PATH`/`PAYMENT_DB_PATH`).

`python -m relohome_agent.agents.contracts.export_schema` writes
`docs/api/agent-contract` under the runtime root, including when run from an
installed wheel outside the checkout. Relative `--output-dir` values use that
root; absolute destinations remain explicit. Subagent fixtures are declared
wheel resources; Flight catalogs remain resources in `relohome-flight`.

## Compatibility and complete src accounting

The [file-by-file accounting](agent-app-relocation/src-accounting.tsv) covers
all **221** files tracked under `src/` at the base:

- 123 moved with no file remaining at their original path;
- 16 moved with a legacy forwarding module or namespace initializer retained;
- 71 existing shared-library forwarding shims retained;
- 2 legacy namespace shells retained;
- 9 supported Streamlit demo files retained for #115's explicit example move.

Thus 139 original files moved; 98 original paths still contain only compatibility
modules/namespaces or the nine retained demos. The new source has one owner per
module; forwarding files do not copy models or service implementations.

`packages/python/compatibility.json` enumerates module aliases and is tested for
module/type identity. Identified compatibility users are the shared-domain
regression tests, historical/local source launches (`src.main`,
`src.mcp_servers.{flights,payments}`, `src.agent_services.{intake,orchestrator}.app`),
and pre-relocation editable installations. App tests and operational launchers
now use the canonical app namespaces; intake models use
`relohome_agent_services.intake_models`.

Owner: #114, with inherited #112 shims. **Removal deadline/gate: #115**, after
remaining consumers migrate, external-consumer assessment permits removal, and
installed-wheel/image startup gates pass. Any unknown external consumer must
receive an owned follow-up under #116 rather than an indefinite shim.
`src.ui` stays runnable until #115 moves it to `examples/streamlit`.

Exception: `src.agents.models` is a persisted checkpoint identifier. Its alias
and explicit serializer allowlist survive ordinary shim cleanup; removal needs
a separate persisted-format transition and retirement of old rollback images.
The frozen pre-ReloHome SQLite checkpoint regression remains unchanged.

## Naming, constraints and overlapping work

FastAPI display titles and new prompt templates use ReloHome. M26 synthetic
Moving contacts use ReloHome. Preserve the M07 provider cancellation text
`Khách huỷ qua LifeFlow`, M08 wire value `LifeFlow agent graph`, all M15 image
repositories/tags/labels, M17 health/MCP identities, and M18 provenance, workflow,
UUID/idempotency inputs. No ports, workers, environment keys, HTTP/MCP contracts,
tool IDs, registry contents, data volumes or key permissions are renamed.

ADR-025 on `origin/main` at `9bc9dfc` is **Proposed**, not Accepted. ADR-013's
status is therefore unchanged. The target map and naming inventory remain
historical/normative evidence rather than being rewritten as current source.

Open PR #107 (`feat/observability-106`) overlaps HTTP/telemetry in the moved agent,
MCP and standalone files. It was not merged. Rebase its application changes onto
these paths; shared HTTP already lives in `relohome_mcp_http` and standalone HTTP
in `relohome_agent_services.common`. Source changes are limited to packaging,
paths, display/prompt naming and forwarding guards. Explicit Ruff classification
avoids unrelated import reordering in the relocated application code.

## Observed validation

Python 3.11.16; dependencies installed offline from a copied local uv cache.
The ordinary pip/network install failed; no network-dependent pass is claimed.

| Check | Observed result |
| --- | --- |
| Main full pytest (`9bc9dfc`, separate checkout/environment) | 5 failed, 915 passed, 103 skipped, 136 subtests passed |
| Relocated full pytest | 5 failed, 923 passed, 103 skipped, 136 subtests passed |
| New pytest regressions | **0**; the same five socket-binding `PermissionError` failures on main and head |
| Focused relocation/layout/boundary/image-selection/checkpoint tests | 39 passed, 29 subtests passed |
| Main Ruff scope | 0 diagnostics |
| Updated `npm run lint:python` (explicit local Python override) | All checks passed |
| Build all 13 Python wheels; verify source-module manifests | Passed; [module counts](agent-app-relocation/wheel-module-counts.json) |
| Wheel install in a separate venv, isolated imports from `/private/tmp` | All six app entrypoints and fixture/catalog resources passed |
| Installed Flight/Payment `python -I -m ... --help` | Both passed |
| Installed Agent/Intake/Orchestrator ASGI lifespan and `/health` | All three returned 200; backend used a dummy key for initialization only, no provider request |
| Installed historical checkpoint resume outside checkout | Passed, including byte-identical legacy type identifiers |
| Installed schema export outside checkout | Passed; three JSON schemas equal main-generated exports (checked-in schema snapshots are already stale on main) |
| Docker builds: backend, intake, orchestrator, Flight, Payment | All blocked: permission denied on Docker daemon socket |
| Container startup, `/health`, non-root UID and wheel imports inside images | **Not run**: Docker daemon inaccessible; local wheel/ASGI checks are not image validation |
| Git diff whitespace | `git diff --check` passed |

[Main failures](agent-app-relocation/pytest-base-failures.txt) and
[head failures](agent-app-relocation/pytest-head-failures.txt) record exact test IDs.
CI now verifies installed module origins and wheel resources from `/tmp`, plus
non-root UID in image checks. These CI checks are implemented, not claimed run
inside containers in this session.

`gh issue view 114 --comments`, `gh issue view 108`, and `gh pr view 138` failed
connecting to GitHub. Work follows the supplied acceptance criteria and local
specs; remote comments/PR text remain unverified. No push, PR or deployment was
performed.

## Rollback

Revert the relocation changes and redeploy the prior image digests using the
existing release process. Reinstall the reverted Python requirements in local
checkouts to restore editable mappings. Keep databases, checkpoints, paired
contact/PII keys, media, registry configuration and volumes in place. There is
no data migration to reverse, and checkpoint type identifiers remain compatible
with the previous image.
