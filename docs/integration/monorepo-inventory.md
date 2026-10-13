# Monorepo migration inventory — issue #109

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Inventory date: 2026-10-12. Historical executed baseline revision:
`9b2b2dbddee8e55d7219be7de3348e815b1e50f4` (main merge of #88).
This is a planning-only change under [#108](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/108).
No application code, configuration, database or user artifact moves here.

**Publication update:** this PR is based on newer main `263c4a9`. Read the
[current-base reconciliation](monorepo-baseline/current-base.md) first: it maps
47 additional files (1,062 total). Active runtime/CI sections below describe
publication base `263c4a9`; historical entrypoint/test appendices remain pinned.
Executed results below still belong only to the original revision.

- [ADR-025: decisions, Python boundaries, root command contract and rollback](../adr/ADR-025-monorepo-layout.md)
- [File map: all 1,015 tracked baseline paths](monorepo-baseline/path-map.tsv)
- [Entrypoint declarations and cross-root Python imports](monorepo-baseline/entrypoints.md)
- [LifeFlow naming inventory and #118 handoff](monorepo-baseline/naming-inventory.md)
- [Exact validation commands/results and triage](monorepo-baseline/validation.md)

## Coverage and exclusions

The map starts from `git ls-files` at the source revision. Each file has exactly
one row, including retained roots and historical evidence; mappings are proposed
subject to ADR review. #118 fixes source names in the naming contract; existing
runtime identities are preserved. No filesystem-wide glob is authorized for automated moves.
Verify coverage against the pinned commit, not the current working tree:

```python
import csv, subprocess
with open("docs/integration/monorepo-baseline/path-map.tsv") as source:
    rows = list(csv.DictReader(source, delimiter="\t"))
tracked = subprocess.check_output([
    "git", "ls-tree", "-r", "--name-only",
    "9b2b2dbddee8e55d7219be7de3348e815b1e50f4",
], text=True).splitlines()
assert len(rows) == len(tracked) == 1015
assert sorted(row["old_path"] for row in rows) == sorted(tracked)
```

Excluded: untracked `design-comparison/`, extracted `project-data-2026-10-05/`,
ignored `.env`, `.venv`, node_modules, dist, caches, browser output, local SQLite,
uploaded media, keys, OSM/PBF/OSRM files and DVC cache. The tracked snapshot ZIP
is an LFS artifact and is retained, not unpacked or treated as application source.

Tracked root families not relocated are `.agents`, `.ai-log`, `.claude`, `.codex`,
`.cursor`, `.gemini`, `.github`, `.dvc`, `config`, `data`, `deploy/coolify`, `docs`,
`eval`, `presentation`, `scripts`, `tasks`, integration `tests`, root governance,
README/architecture/worklog/journal documents and operational entry files.
`.ai-log` and logging hooks are managed by existing automation, not this migration.

## Supported runnable applications and examples

| Runtime | Current invocation (from root unless stated) | Identity / target |
| --- | --- | --- |
| React + gateway | `cd Frontend && npm run build`; `python -m uvicorn Frontend.server:app --port 8503 --workers 1` | `web`; `apps/web` + `apps/browser-gateway` |
| Integrated agent | `uvicorn src.main:app --port 8000 --workers 1`; `make run` adds reload | `backend`; `apps/agent-api` |
| Platform API | LifeFlow: `npm run dev:api` / `node platform-api/dist/server.js` | `platform`, 4100; `apps/platform-api` |
| Location MCP | LifeFlow: `npm run dev:mcp` (stdio), `npm run dev:mcp:http` (HTTP) | local `location-mcp`, Coolify `location`, 4300; `apps/location-mcp` |
| Moving API / MCP | LifeFlow: `npm run dev:moving-api`, `dev:moving-mcp`, `dev:moving-mcp:http` | `moving-api` 4200 / `moving-mcp` 4400 |
| Flight MCP | `python -m src.mcp_servers.flights --transport stdio` or `streamable-http` | `flights-mcp`, 8765 |
| Payment MCP | `python -m src.mcp_servers.payments --transport stdio` or `streamable-http` | `payments-mcp`, 8766; Coolify backend uses authenticated HTTP |
| Standalone Intake | `uvicorn src.agent_services.intake.app:app` | Compose `intake`, host 8011 → 8000; compatibility harness |
| Standalone Orchestrator | `uvicorn src.agent_services.orchestrator.app:app` | Compose `orchestrator`, host 8012 → 8000; compatibility harness |
| Streamlit Flight / Payment | `make ui`, `make ui-payment` | retained demo entrypoints, default 8501 / explicit 8502 |
| Streamlit integrated chat | `streamlit run src/ui/agent_chat.py` | retained example, backend HTTP client |
| Location agent / tool lab | LifeFlow: `streamlit run demo/streamlit_app.py`, `streamlit run demo/tool_lab_app.py` | retained examples, own requirements |
| Map app | LifeFlow: `npm run dev:map`; map-app: `npm run build`, `npm run test:e2e` | retained supported example, dev 5173 |
| Static design HTML | `Frontend MVP planning questions/*.html` | references; no supported service/API |

The appendix includes every npm script, Python `__main__`, Streamlit file,
PowerShell/shell launcher and tracked script helper. Also preserve schema export
(`python -m src.agents.contracts.export_schema`), Roommate maintenance routines,
Flight/Payment server launches in local-integration.py and Docker CMDs (backend clients are HTTP-only), TS migration/import/report commands,
and test-only gateway launchers. Launchers are not all safe to run against an
existing database; this issue inventories them without invoking writes.

## Docker, Compose and release identities

| Image suffix / local tag | Current Dockerfile | Context / target | Runtime health |
| --- | --- | --- | --- |
| `web` | `Frontend/Dockerfile` | root / final | 8503 `/health`; runtime imports `Frontend.server` |
| `backend` | `Dockerfile` | root / final | 8000 `/health` |
| `platform` | `Maps VN/LifeFlow/platform-api/Dockerfile` | LifeFlow / `platform` | 4100 `/health` |
| `location-migrate` | same platform Dockerfile | LifeFlow / `location-migrate` | one-shot migration |
| `location` | `Maps VN/LifeFlow/mcp-server/Dockerfile` | LifeFlow / final | 4300 `/readyz` |
| `moving-api` | `Maps VN/LifeFlow/Dockerfile.moving` | LifeFlow / `moving-api` | 4200 `/ready` |
| `moving-mcp` | same Moving Dockerfile | LifeFlow / `moving-mcp` | 4400 `/ready` |
| `moving-migrate` | same Moving Dockerfile | LifeFlow / `moving-migrate` | one-shot migration |
| `flights-mcp` | `src/mcp_servers/flights/Dockerfile` | root / final | 8765 `/health` |
| `payments-mcp` | `src/mcp_servers/payments/Dockerfile` | root / final | 8766 `/health` |
| local `lifeflow-intake` / `lifeflow-orchestrator` | `Dockerfile.agents` | root / `intake`, `orchestrator` | 8000 `/health` |
| `postgis` | pinned upstream docker-postgis repository | remote upstream context | `pg_isready` |

Published application prefix is `ghcr.io/ai20k-build-phase-cohort-4/p-044`, with
`${sha}-${run_id}` release tags. Directory names do not rename these images.
The publication-base CI catalog `config/ci/application-images.json` has **ten**
images, including Payment. Selection uses `scripts/select-ci-images.py` and
`.github/workflows/build-application-images.yml`. Preserve the separate MCP
checks as well; PR #107 may modify these existing contracts.

Retain root `docker-compose.yml`, `compose.agents.yaml`, `compose.coolify.yaml` as
stable operational interfaces. The standalone Compose project is
`lifeflow-agents`; Moving is `lifeflow-moving`; legacy location infra is
`lifeflow`, with fixed containers `lifeflow-postgis`, `lifeflow-location-mcp`
and explicitly named volume `lifeflow-postgis-data`. That older infra publishes
`${MCP_PORT:-3000}:3000` and checks `/healthz`, unlike the integrated local and
Coolify Location service on 4300 with `/readyz`. Preserve both configurations.
Moving local image names remain `lifeflow/moving-api`, `lifeflow/moving-mcp`,
`lifeflow/moving-migrate`; location local image is `lifeflow-location-mcp`.
Location `infra/compose.yaml`, Moving `compose.moving.yaml`,
`compose.moving.ci.yaml`, `compose.moving.staging-write.yaml` relocate as in the
map; their relative build/bind paths must change while resolved paths and
project names stay fixed. Move Docker-specific `.dockerignore` files with their
Dockerfiles and revise root context filtering. Future TS images build from root
so root lock/workspaces and shared packages are available. Keep target names.

Coolify storage: `web-data:/app/data`, `agent-data:/app/data`,
`roommate-private:/app/private-roommate`, `flights-data:/app/data`,
`payments-data:/app/data`, `location-data:/var/lib/postgresql/data`, `moving-data:/var/lib/postgresql/data`,
`routing-data:/data:ro`. Local MCP also uses `payments-data`; standalone uses
`orchestrator-state`. Preserve actual project-qualified/external volume names,
not merely these YAML keys. OSRM keeps hcm/hanoi/danang ×
driving/walking/motorcycle service identities and `/data/<city>/<mode>/<city>.osrm`.
PostGIS and OSRM are infrastructure, not npm apps.

Deployment selector/rendering stays in `scripts/deploy-coolify.py` and
`.github/workflows/deploy-staging.yml`. It selects successful main CI releases,
loads `compose.coolify.yaml` from the selected revision, and preserves digest
promotion. Do not change the checkout revision/selected release distinction.

## CI, tests and path-sensitive tooling

| Reference | Required coordinated edits when its source moves |
| --- | --- |
| `.github/workflows/ci.yml` | Python tests include gateway; npm cwd/cache lock; ten-image catalog paths/contexts/targets and reusable build workflow; web import smoke; MCP glob |
| `agent-services.yml` | `src/agent_services`, config, tests, requirements, Dockerfile, scripts, contracts and Moving create-server path filters; npm cwd |
| `moving-containers.yml` | Shell `case` path filters (not just YAML `paths`), ignored test/docs patterns, Docker context, SQL `008_*`, workspace locks and CI Compose |
| `map-data.yml` | Cities/catalog filters and validators; Cities stays fixed |
| `postgis-image.yml` | Pinned upstream SHA/context and ARM64 tag remain unchanged |
| `mvp.yml` | Python/SQLite suite, npm working directory and lock; currently Node 22 versus CI Node 24 |
| `deploy-staging.yml` | Release Compose path and validation; no production activation |
| `Makefile` | MCP Dockerfile discovery, Python test scope, non-mutating check, Streamlit paths |
| `Frontend/playwright*.config.ts` | All 11 configs, testDir/server commands/output dirs, opt-in live flags; default Chrome channel |
| Frontend and map-app asset preparation | Resolve hoisted MapLibre worker/shared assets; avoid hard-coded local node_modules |
| Python tests under root and gateway | Installed imports, test image/source layout assertions, generated schema/registry and subprocess launch paths |
| LifeFlow packages/service tests | Keep Vitest tests attached to workspaces; `test:ci` excludes housing-query/platform/location DB suites |
| `scripts/local-integration.py`, `_pyrun.*`, `start-local-mvp.ps1` | Stable root selectors, root env precedence, local port/readiness checks, one worker and no implicit migrations |
| LifeFlow Start/Stop/Setup-Routing/Extract-Poi PowerShell | New source paths but same runtime logs/PIDs, database containers, routing/extraction locations |
| `init-local-integration.py`, restore/import snapshot tools | Preserve stored paths/artifact checksums; never run automatically during source migration |
| `export-agent-registry.mjs`, map/geocode/normalization/repair tools | Resolve moved source/SQL and preserve explicit write opt-ins |

`eval/` is historical Markdown/results evidence, not an installable package.
Current live evaluation entrypoints are in `tests/test_llm_agents`, browser
`*.live.spec.ts`, `scripts/measure-read-latency.py`, map dialogue tools and Moving
live scripts. Preserve their explicit provider gating. Keep historical paths in
reports clearly historical; update current runbooks and launch instructions.

Additional file-derived paths to update atomically (also see the
[publication-base path traps](monorepo-baseline/current-base.md#additional-relocation-sensitive-paths)
for provider/performance imports, auth fixtures, gateway static assets and schema exports):
`platform-api/src/{migrate,report-poi-coverage,clean-pois}.ts` resolve the old
LifeFlow root from `import.meta.url`; `packages/moving-service/src/migrate.ts`
loads `../../../database/`. The housing-query POI integration test launches
`../../../platform-api/dist/import-pois-v2.js`. Both housing-query and
moving-service config search CWD, parent and grandparent `.env`; preserve
`LIFEFLOW_ENV_FILE` precedence and ensure hoisting does not load another app's
secrets. Standalone `clean-pois.ts` is also an operational CLI even though it is
not exposed as an npm script. Source relayout must preserve its explicit write
behavior and SQL resources.

Geodata/ingestion inventory: Cities catalog and three GeoJSON boundaries;
LifeFlow SQL migrations and Moving audit SQL; POI tag filter; OSRM motorcycle
profile; `requirements-map-data.txt`; root map catalog validators; PowerShell
routing/extraction/import scripts; platform import places/POIs/housing/admin
areas, deduplication and coverage-report CLIs. `.dvc/config` is tracked and empty
at baseline; no tracked `.dvc` artifact pointer exists. The LFS ZIP and checksum,
Roommate demo JSON and local ignored extracts remain in place. The map demo's
`prepare:data` has a developer-specific `D:/Demo AI thực chiến/...` source;
#115 must accept a configured input path without copying local data into source.

## Follow-on scope register

These are concrete additions to the linked issues, recorded here for review;
the linked GitHub issue bodies also carry the concrete #118 naming handoff.

| Work item | Findings added to its required scope / gate |
| --- | --- |
| [#118](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/118) | Record the final [rename/preserve naming matrix](monorepo-baseline/naming-inventory.md), external-consumer assessment, Python/npm names and alias ownership/removal criteria before implementation |
| [#110](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/110) | Root `relohome`; keep child names until owning moves; preserve `lifeflow-typescript` CI key. After #118 merges, reconcile three npm locks including map-app; fix both worker-copy scripts for hoisting; root tests include gateway/demo contracts; separate format from check; choose/document Node 24 versus legacy MVP 22; provision browser prerequisites and track [B2/B3/B5 baseline failures](monorepo-baseline/validation.md#failure-and-coverage-register) |
| [#111](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/111) | Apply `@relohome/*`, with `location-mcp` and `moving-mcp` suffixes; rename internal M05 symbols with all consumers; add shims only for identified external consumers and record removal evidence; preserve deployed identities; TS Docker root contexts; Moving shell filters and SQL dependencies; registry export; retain migration targets and image suffixes; coordinate telemetry package if #107 lands |
| [#112](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/112) | Use final `relohome-*` distributions / `relohome_*` imports when extracting privacy, contracts, Roommate, Flight, Payment and standalone shared modules from ADR; include function-local imports, catalog package data, Settings/runtime separation; verify wheels outside repo and persistent-path compatibility |
| [#113](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/113) | Apply approved ReloHome display names; same combined web image, same-origin/static serving; preserve housing media default and traveler key; update every browser config, gateway test helper and source-inspection test; coordinate #76 before web renames; re-establish the current-base browser baseline and reconcile the 36 historical supplemental failures before comparing move PRs |
| [#114](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/114) | Apply final `relohome_*` imports / ReloHome display titles; preserve M08 response value and M07 provider comment; retain both standalone harnesses, images, registry path and volume; install distributions in MCP/backend images; remove cross-app imports, update local-integration/Docker launchers and preserve layout-test health/non-root/transport checks; coordinate #107 HTTP/telemetry changes |
| [#115](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/115) | Use `@relohome/map-app`, `relohome_location_demo`, `scripts/relohome/`, renamed launchers and `dev:relohome`; retain M20 hooks and M21 safety prefixes; retain historical/compatibility exceptions and all demos/static references; move SQL/config/scripts with explicit persistent bind resolution; map prepare:data configuration; keep DVC/LFS/Cities/runtime data fixed; audit all old paths and retire owned shims |
| [#116](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/116) | Audit all M01–M26 decisions and every retained alias against #118; require an owned follow-up for any alias without satisfied removal gates; repeat exact suites without coverage loss; full deterministic browser baseline; isolated DB/HTTP checks distinct from portable skips; existing-data staging smoke and prior digest rollback; no production promotion |

## Open PR coordination

[#107](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/107) is open/draft
at inspection. Its changed-file list overlaps root requirements/Compose, CI,
all runtime Docker contexts, gateway/backend/graph and Node services. Its prospective additions include
`src/observability`, `Maps VN/LifeFlow/packages/telemetry`,
`deploy/observability` and rendering/validation scripts. Shared
`src/mcp_servers/http_service.py` and `config/ci/application-images.json` already
exist at the publication base; #107 modifies those contracts. Proposed destinations:
Python telemetry → `packages/python/observability/src/relohome_observability/`;
shared MCP HTTP → `packages/python/mcp-http/src/relohome_mcp_http/`;
TS telemetry → `packages/telemetry/` (`@relohome/telemetry`); deployment/config/scripts retain their roots.
Telemetry additions are conditional; shared MCP HTTP is already mapped in the
publication-base additions and the image catalog retains its existing path. The Python
namespace spellings and source-directory labels above follow #118;
telemetry service identities stay unchanged. Preserve OTEL service
names, disabled-by-default behavior and its matrix source of truth. Prefer merging
#107 before shared package/Docker moves; otherwise rebase it through the reviewed
mapping and rerun its export/privacy tests. Do not manufacture a new telemetry
abstraction independently in #112.

[#76](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/76) is open/draft
and changes web App/HousingComparison/PlanPeek/serviceJourney, Playwright scope
contracts/config, agent housing intake/planning/progress/selection, API web
select actions and integration tests. Prefer landing/rebasing its behavior change
before #113. Keep rename commits separate so its author can translate paths;
rerun housing comparison identity and scope tests on the actual new base.
Its old report of 30 baseline failures is not evidence for this revision: the
historical `9b2b2db` Python baseline has 758 passes. PR #107's 842-pass report is likewise
not this baseline. Actual maintainer agreement remains a pre-move review gate;
this document records conflicts and merge strategy, not claimed conversations.

#61 owns runner isolation; #66 owns gateway storage transition; #77 routing data;
#87 container reachability; #55 payment reconciliation. Structural follow-ons
must link and preserve these contracts rather than absorb their behavior work.
