# LifeFlow → ReloHome naming contract (#118)

This is the normative naming appendix of [ADR-025](../../adr/ADR-025-monorepo-layout.md).
Decision date: 2026-10-12; effective on merge of #118's ADR change. Final names
are **ReloHome** for display, **relohome** for source names, and **@relohome/**
for private npm workspaces. Implementation belongs to #110–#115; #116 audits it.
No application, data, runtime identity or generated runtime file changes here.

## Evidence and limits

Pinned source: `263c4a9e5f986758dbc78a237d61c3a7b8d8ff58`, the publication base.
[naming-occurrences.tsv](naming-occurrences.tsv) records every case-insensitive
`lifeflow` matching text line from `git grep` and every matching tracked path:

- 1,017 matching content lines in 254 files, with 1,144 literal matches:
  `LifeFlow` 599, `lifeflow` 468, `LIFEFLOW` 77.
- 224 matching tracked paths; 1,241 evidence rows total. Path rows use line 0.
- `review_lane` routes review; it is **not** a rename authorization. Lines can
  mix source names with persisted values. The matrix below controls disposition;
  mixed occurrences have per-token decisions below; never replace an entire line.

Reproduce from any checkout containing that revision:

```sh
git grep -n -i lifeflow 263c4a9e5f986758dbc78a237d61c3a7b8d8ff58
git ls-tree -r --name-only 263c4a9e5f986758dbc78a237d61c3a7b8d8ff58
```

The second command covers filenames, including `Start-LifeFlow.ps1`,
`Stop-LifeFlow.ps1`, `lifeflow.spec.ts`, `LIFEFLOW-MCP-POSTGIS-PLAN.md` and
`ADR-001-polyglot-lifeflow-workspace.md`. All content lines can be recovered with
`git show <revision>:<path>` at the recorded line. Evidence stores no copied
credentials or full log content. This inventory excludes untracked files,
ignored dist/node_modules/runtime data, binary/LFS payloads and PR-only code;
it does not claim to have inspected deployed databases or private consumers.
The planning documents' historical `lifeflow` mentions are explanatory evidence
outside that pinned source scan. Re-scan the chosen implementation base.

## Complete occurrence decisions

All **1,241 rows** are classified; none remains `unresolved`. The original
`kind`, `path`, `line`, `case_variants`, `match_count` and `review_lane` evidence
is unchanged. `matrix_category` is the union of applicable M01–M26 decisions.
`decision` is `rename`, `preserve`, or `mixed`.
`token_decisions` enumerates matching tokens left-to-right as
`ordinal:category:decision`; tokens use `[\w@./:-]*lifeflow[\w@./:-]*`
(case-insensitive). A token can contain multiple literal matches. This records
mixed lines without copying source/credentials into the evidence file.

Path rows authorize only the tracked file's target in `path-map.tsv` plus
`current-base-additions.tsv`. Original source paths remain evidence. For a
historical document, relocation changes its link location, not its quoted text
or historical basename. Ignored credentials, runtime state and datasets under
an old source directory are M24 and stay in place. M03 references to source
roots resolve through the component map, not to a new `Maps VN/ReloHome` tree.

## Rename / preserve matrix

This is the final decision matrix. `Preserve` is a deliberate compatibility or
historical exception, not unfinished naming work. Any later change to preserved
interfaces needs a separately scoped compatible transition.

| ID | Category and exact observed names | Evidence at the pinned base | Disposition / reason | Implementation after #118 |
| --- | --- | --- | --- | --- |
| M01 | npm `@lifeflow/{contracts,housing-query,mcp-core,moving-service,platform-api,mcp-server,moving-api,moving-mcp-server}` | Eight workspace manifests, TS imports, Docker npm workspace commands | Rename to the exact npm table below. Preserve exported behavior and subpaths; rename internal M05 symbols atomically | #110/#111 |
| M02 | Root manifest `lifeflow-platform`; example `lifeflow-map-app` | LifeFlow and map-app `package.json` | Root → `relohome`; map example → `@relohome/map-app`. Retain `siu-ai-web` | #110/#115 |
| M03 | `Maps VN/LifeFlow/`; `Start-LifeFlow.ps1`, `Stop-LifeFlow.ps1`; npm `dev:lifeflow`, `predev:lifeflow`; `tests/lifeflow.spec.ts` | Launchers, map manifest, workflow cwd/path filters, tests | Relocate tracked source by the target maps; `Start-ReloHome.ps1`, `Stop-ReloHome.ps1`, `dev:relohome`, `predev:relohome`, `tests/relohome.spec.ts`; scripts under `scripts/relohome/`. M24 overrides persisted paths | #110/#111/#115 |
| M04 | Python `LifeFlowMcpClient`, `lifeflow_root`, `self.lifeflow_root`, `LIFEFLOW_ROOT` | Location demo client/agent/UI modules | Rename → `ReloHomeMcpClient`, `relohome_root`, `self.relohome_root`, `RELOHOME_ROOT`; update all local consumers with demo namespace migration | #115 |
| M05 | TS `LifeFlowMcpDependencies`, `createLifeFlowMcpServer`, `createLifeFlowMcpRuntime` | Location create-server/runtime/types and consumers; dependencies type re-export | Rename → `ReloHomeMcpDependencies`, `createReloHomeMcpServer`, `createReloHomeMcpRuntime`; update all internal consumers atomically, without speculative aliases | #111 |
| M06 | Browser `LifeFlow Map`, visible `LifeFlow`; Streamlit `LifeFlow MCP Tool Lab`, `LifeFlow — local integration`; FastAPI `LifeFlow Intake`, `LifeFlow Routing Orchestrator`; OCI title `LifeFlow Moving` | map-app index/App, demo/tool_lab, src/ui/agent_chat, standalone app factories, Dockerfile.moving | Rename only brand substring to ReloHome; keep descriptive suffixes, routes, icons and layout. `LifeFlow Map` → `ReloHome Map`; Intake → `ReloHome Intake`; Routing Orchestrator → `ReloHome Routing Orchestrator` | #111/#113/#114/#115 |
| M07 | Prompt text `Intake ... LifeFlow`, `Routing Orchestrator ... LifeFlow`, `subagent ... LifeFlow`; cancellation comment `Khách huỷ qua LifeFlow` | src/agents and standalone prompts; adapters/commit | New prompt templates: LifeFlow → ReloHome, same instructions and regression coverage. Preserve provider cancellation comment `Khách huỷ qua LifeFlow` and prior messages/audit records; external payload text has no proven display-only contract | #114/#115 |
| M08 | API response `agent: "LifeFlow agent graph"` | src/api/routes.py | **Preserve** `LifeFlow agent graph`; JSON response value is an external wire contract even if human-readable. No new alias field/API redesign in this migration | #114 |
| M09 | npm lock root/package names, `node_modules/@lifeflow/*` links; registry `source` string | Three package-lock.json files; config/agent-services/registry.json and export-agent-registry.mjs | Regenerate lockfiles from renamed manifests; registry `source` → `apps/moving-mcp/src/create-server.ts + packages/contracts/src/moving.ts; offline metadata only`. Preserve registry protocol/tool IDs | #110/#111/#115 |
| M10 | SQL verification enum `lifeflow_verified`; provider value `lifeflow`; provenance enum `lifeflow_admin` | migrations/002_core_tables.sql, 009_mobility_readiness.sql, contracts/common.ts, queries/imports/geocode scripts | **Preserve** persisted/wire values and validation/protection predicates; display relabeling cannot change stored enums | #111/#115 exception; #116 checks |
| M11 | `public.lifeflow_schema_migrations`; advisory lock `lifeflow-moving-migrations` | platform migration runner/rollback, moving-service migrate.ts, test-migration-image.py | **Preserve** migration history and lock identity; renaming risks rerunning SQL or simultaneous migrations | #111/#115 exception |
| M12 | Database/role defaults `lifeflow`, `lifeflow_admin`, `lifeflow_app`, `lifeflow_ingest`; integration DBs `lifeflow_verified`, `lifeflow_quangdung_20261005` | LifeFlow .env.example, database config/migrate, init-local-integration.py | **Preserve** existing databases, users and credentials; `lifeflow_verified` here is also a DB name, distinct from the enum above | #111/#115 exception |
| M13 | `lifeflow-clean-poi` format/version; `database/lifeflow.dump`; historical dump/backup filenames | platform-api/src/poi-dataset.ts, scripts/restore-local-snapshot.py, snapshot runbooks | **Preserve** serialized artifact format and existing restore/checksum paths; never regenerate or rename stored artifacts for branding | #111/#115 exception |
| M14 | Compose projects `lifeflow`, `lifeflow-moving`, `lifeflow-agents`, `lifeflow-integration`, `lifeflow-routing-local`; default `MCP_ALLOWED_HOSTS=lifeflow-location-mcp` host allowlist; container/volume `lifeflow-postgis`, `lifeflow-postgis-data`; OSRM `lifeflow-osrm-<city>-<mode>` | Compose files, Setup/Start/Stop scripts and container discovery | **Preserve** resource/DNS/volume identities, including host validation, discovery regexes and qualified volumes; avoid orphaned data or duplicate services | #111/#114/#115 exception |
| M15 | Images `lifeflow-intake`, `lifeflow-orchestrator`, `lifeflow-location-mcp`, `lifeflow/moving-{api,mcp,migrate}`; cleanup labels `lifeflow.ci.{agents,mcp,moving}` | Compose, CI, smoke scripts | **Preserve** repositories/tags and ownership labels; producer/filter must continue to agree. Changing a label prefix is not merely changing log text | #110/#111/#114 exception |
| M16 | Env keys `LIFEFLOW_API_BASE_URL`, `LIFEFLOW_ENV_FILE`, `LIFEFLOW_MAP_TEST_URL`, `LIFEFLOW_LIVE_LLM` | Gateway, UI, config loaders, Playwright, live tests and docs | **Preserve** external configuration/opt-in interfaces. Never accidentally enable live checks or change credential/env precedence | #110–#115 exception |
| M17 | MCP names `lifeflow-location`, `lifeflow-moving`; health services `lifeflow-intake`, `lifeflow-orchestrator`, `lifeflow-moving-api`, `lifeflow-location-mcp`, `lifeflow-moving-mcp`; clientInfo `lifeflow-streamlit`, documented `lifeflow-ai` | MCP factories, standalone install_http, Moving app, mcp-server/src/http-server.ts:51, moving-mcp-server/src/http-app.ts:78, demo/mcp_client.py | **Preserve** protocol/operational identities; changing a page title does not authorize changing server/client metadata | #111/#114/#115 exception |
| M18 | Source/provider IDs `lifeflow-flights`, `lifeflow-location`, dynamic `lifeflow-` + domain; `lifeflow:` workflow and UUID-v5 inputs | src/agents/subagents/services and src/services/adapters/{commit,moving_approval}.py | **Preserve** provenance, persisted approvals and idempotency. Changing the UUID input produces a different operation identity | #112/#114 exception |
| M19 | Documented URIs `lifeflow://schemas/{place,housing}`, `lifeflow://catalog/categories`, `lifeflow://providers/capabilities`, `lifeflow://workflows/moving` | LifeFlow docs/LIFEFLOW-MCP-POSTGIS-PLAN.md only | **Preserve** documented `lifeflow://` URIs as historical design evidence; no executable implementation found. Do not introduce renamed resources or claim deployment | #115 review |
| M20 | `__LIFEFLOW_MAP__`; map source IDs `lifeflow-{pois,housing,housing-interaction,route,selected-poi}` | map-app MapView/config and browser tests | **Preserve** all existing hooks and map source/layer IDs. External browser automation is not discoverable with confidence; retaining them costs no duplicated implementation | #115 |
| M21 | CI job key `lifeflow-typescript`; temporary prefixes `lifeflow-*-test-*`, `lifeflow_poi_test_`, `lifeflow-restore-*`; test MCP client names | Workflow needs/results expressions, DB tests, smoke/restore scripts | **Preserve** CI job keys, temporary DB/directory/container prefixes, synthetic auth tokens and test MCP client names. Retain cleanup guards, branch-check names and producer/consumer agreement | #110/#115 |
| M22 | README/runbooks/current architecture/source comments | Root docs and app docs, referenced in evidence TSV | Rename current brand text to ReloHome and update source links/commands by the target map. Token-level M10–M21/M24/M25 exceptions take precedence. Historical ADR titles/quotes and immutable migration SQL comments stay exact | #115 (with each move's operational docs) |
| M23 | Dated eval/results/reports, journal/worklog, old ADR rationale, historical handoff/snapshot names, external repository/proper-name links | eval/, reports/, dated integration records, ADR-001, presentation and historical references | **Preserve** historical text, commit-pinned URLs, old ADR basenames/titles, handoff names and third-party proper names. Relocate tracked files per M03; update current instructions or label transcripts historical and point to a current runbook | #115/#116 exception audit |
| M24 | Legacy `.env`, `.runtime/`, external data paths and ignore/loader references under `Maps VN/LifeFlow/` | ADR-025 runtime-path table, init-local-integration and location config | **Preserve** actual state/credential locations and precedence. Tracked `.env.example` relocates; its environment values still refer to existing data | #110–#115; #116 verifies |
| M25 | Human log prefixes `LifeFlow MCP ...`, `LifeFlow Location MCP ...`, `LifeFlow Moving MCP ...` | TS MCP console logs | **Preserve** operational log/telemetry identity; unknown alert parsers may consume text. Display title rename excludes logs | #111/#114; #116 verifies |
| M26 | Test `describe` labels and synthetic `QuoteContact("LifeFlow", ...)` | TS tests and Python moving fixtures | Rename brand text to ReloHome with producer/assertion updates. No stored or real contact change; tokens/client IDs stay M21 | #111/#114 |

## Exact npm package map

All remain private; preserve versions, export paths, signatures and runtime
behavior. Namespace ownership in a public registry is not claimed or required
for private workspaces. No publication is authorized.

| Existing package | Final package | Owner issue |
| --- | --- | --- |
| `@lifeflow/contracts` | `@relohome/contracts` | #111 |
| `@lifeflow/housing-query` | `@relohome/housing-query` | #111 |
| `@lifeflow/mcp-core` | `@relohome/mcp-core` | #111 |
| `@lifeflow/moving-service` | `@relohome/moving-service` | #111 |
| `@lifeflow/platform-api` | `@relohome/platform-api` | #111 |
| `@lifeflow/mcp-server` | `@relohome/location-mcp` | #111 |
| `@lifeflow/moving-api` | `@relohome/moving-api` | #111 |
| `@lifeflow/moving-mcp-server` | `@relohome/moving-mcp` | #111 |
| `lifeflow-platform` (nested root) | `relohome` (repository root) | #110 consolidates root metadata; #111 retires nested root |
| `lifeflow-map-app` | `@relohome/map-app` | #115; #110 initially includes old manifest |
| `siu-ai-web` | `siu-ai-web` (preserve) | #113; #110 initially includes manifest |
| conditional #107 `@lifeflow/telemetry` | `@relohome/telemetry` | #111; preserve `.` and `./register` exports |

#110 adds root tooling with existing child names. #111 renames each TS package
and every import, selector, dependency key and lockfile entry atomically with
its move. #115 does the same for map-app. Do not introduce duplicate workspaces
under old and new names or upgrade dependencies as part of branding.

## Exact Python distribution and import map

At the pinned base import roots are `src.*`, `Frontend.*` and demo `demo.*`;
no `lifeflow_*` top-level packages are implemented. The provisional ADR labels
are superseded by the final columns below. No aliases for those never-shipped
provisional names are needed. Distribution names use lowercase ASCII and
hyphens; valid Python import identifiers use underscores. Each distribution
uses `src/<import>/` and declared wheel package data; no namespace named `src`
or generic `demo` remains in the final installed API.

| Previous ADR distribution / import | Final distribution / import | Implementation |
| --- | --- | --- |
| `lifeflow-agent` / `lifeflow_agent` | `relohome-agent` / `relohome_agent` | #112/#114 |
| `lifeflow-browser-gateway` / `lifeflow_gateway` | `relohome-browser-gateway` / `relohome_gateway` | #112/#113 |
| `lifeflow-flights-mcp` / `lifeflow_flights_mcp` | `relohome-flights-mcp` / `relohome_flights_mcp` | #112/#114 |
| `lifeflow-payments-mcp` / `lifeflow_payments_mcp` | `relohome-payments-mcp` / `relohome_payments_mcp` | #112/#114 |
| `lifeflow-intake-api` / `lifeflow_intake` | `relohome-intake-api` / `relohome_intake` | #112/#114 |
| `lifeflow-orchestrator-api` / `lifeflow_orchestrator` | `relohome-orchestrator-api` / `relohome_orchestrator` | #112/#114 |
| `lifeflow-contracts` / `lifeflow_contracts` | `relohome-contracts` / `relohome_contracts` | #112 |
| `lifeflow-privacy` / `lifeflow_privacy` | `relohome-privacy` / `relohome_privacy` | #112 |
| `lifeflow-roommate` / `lifeflow_roommate` | `relohome-roommate` / `relohome_roommate` | #112 |
| `lifeflow-flight` / `lifeflow_flight` | `relohome-flight` / `relohome_flight` | #112 |
| `lifeflow-payment` / `lifeflow_payment` | `relohome-payment` / `relohome_payment` | #112 |
| `lifeflow-agent-services` / `lifeflow_agent_services` | `relohome-agent-services` / `relohome_agent_services` | #112 |
| `lifeflow-mcp-http` / `lifeflow_mcp_http` | `relohome-mcp-http` / `relohome_mcp_http` | #112/#114 |
| `lifeflow-demos` / `lifeflow_demos` | `relohome-demos` / `relohome_demos` | #115 |
| `lifeflow-location-demo` / `demo` | `relohome-location-demo` / `relohome_location_demo` | #115 |
| conditional #107 / `lifeflow_observability` | `relohome-observability` / `relohome_observability` | #112/#114 with telemetry owner |

Conditional telemetry names were checked against PR #107 head `30215d1` on
2026-10-12; re-inventory its final merge before implementation. Its private npm
manifest exports `.` and `./register`; both must remain.

The exact old module ownership, shared extractions and final target roots are
in ADR-025 and the two path TSVs. Current `src.*`/`Frontend.*`/`demo.*` callers
must change in the same slice or use explicitly owned temporary forwarding
shims. Never copy implementations. `scripts/relohome/` is a source path, not a
new runtime/state root.

## External consumers and identifiers without this spelling

Assessment on 2026-10-12 against `481288a` and pinned source `263c4a9`:

- All 11 tracked npm manifests are `private: true`. Tracked CI/scripts contain
  no `npm publish`, `twine upload` or `publishConfig` publication setup. Git
  history includes the original workspace import (`3ff427a`) and subsequent
  package changes; it is not a registry publication ledger.
- Read-only GETs to `https://registry.npmjs.org/@lifeflow%2f<suffix>` returned
  **404 for all eight scoped names** in the npm map. No public package metadata
  was found. A 404 cannot establish absence of private/unpublished packages.
- GitHub code search for `"@lifeflow/" -repo:AI20K-Build-Phase-Cohort-4/P-044`
  returned two files in `mzi070/mobile_app`: `apps/api/package.json` and
  `packages/shared/package.json`. Its API manifest uses `@lifeflow/api` and
  `@lifeflow/shared`, neither a package in this repository. These are unrelated
  proper names; do not rename them or infer scope ownership.
- All known consumers of the three M05 exports are within Location MCP: runtime,
  stdio/HTTP entrypoints and tool modules. Its private manifest has no `main`
  or `exports` entry. Rename these symbols outright with their consumers;
  symbol aliases alone would not preserve the renamed package route. This
  does not rule out unobserved deep imports or copied checkouts.
  None of the implemented Python roots is a published LifeFlow distribution. No private registry, copied checkout,
  deployment state or downstream repository census is available here.

Decision: use private workspace renames with atomic in-repository updates; no
speculative npm shim packages. #111 must record any newly discovered package
consumers before removing their old package route. If an external consumer is
found, retain its old private package as a forwarding facade with the same
export/subpath surface and version behavior, and track its migration before
removal. Do not publish a facade to a scope we have not verified ownership of.
Compatibility shims are conditional on identified consumers, including any
newly discovered M05 deep importer. Record the actual old import route and
symbols that consumer needs; do not add symbol aliases speculatively. The
source-shim rules below retain explicit ownership and removal gates.

Browser identities are not necessarily spelled LifeFlow. Preserve
`siu_session`, `siu-ui-preferences`, `siu-plan-strip-open`, the `siu-draft-` key
prefix, `relohome.mode` and `relohome-analytics-id`; they are not branding text.
The existing `siu-ai-web` package name and ReloHome browser display are context
for #118, not authority to perform a broader SIU rename. Keep API routes,
provider/tool identifiers, keys and telemetry identities even when they do not
match the search term. Only the read-only public registry/search assessment above was performed;
no deployed-state or private-registry audit is claimed. PR #107 telemetry remains an additional re-inventory gate.

## Handoff and sequencing

`#109 → #118 → #110 → #111`; Python starts after `#109 + #118 + #110`, then
`#112 → #113 → #114`; final consolidation/validation remain #115/#116.

#118 owns this final matrix. Functional owners below are responsibilities,
not invented assignees or changes to CODEOWNERS. Every alias must have a
consumer list and removal evidence in its implementation issue.

| Compatibility item | Accountable owner / issue | Deprecation and removal gate |
| --- | --- | --- |
| `src.*`, `Frontend.*`, `demo.*` source shims | Packaging/move authors #112/#113/#114; demo owner #115 | Add only for an identified intermediate caller, list each caller; #115 removes once all callers/launchers migrate and installed-wheel/image tests pass outside checkout. Unknown external callers require an owned follow-up under #116 |
| Discovered old npm package consumers | TS maintainers, #111 | Keep private forwarding facade only if needed; document consumer versions, exports and migration notice in #111. #116 checks both entry routes until every consumer is verified migrated; separate owned issue required for any remaining facade |
| M08, M10–M21, M24–M25 runtime/persisted exceptions and browser keys | Owning app/domain and deployment maintainers, #111–#115 | No deprecation/removal under #108. Any later transition must independently design dual-read/write or protocol compatibility and rollback as appropriate |
| M23 historical evidence | Documentation owners, #115/#116 | Keep original names/URLs indefinitely; for formerly operational transcripts add a historical notice with a current guide, do not silently turn old commands into current instructions |

Neither elapsed time nor completion of a folder move justifies dropping an
external alias. #116 cannot close with unowned shims or claim historical naming
exceptions prove runtime compatibility. All persisted-state checks remain
implementation/staging work; they were not run as part of this decision.

#110/#111 implement agreed npm/source names; #112/#114 Python names;
#111/#113/#114 app/API display titles; #115 demos/scripts/current docs;
#116 verifies all remaining occurrences against compatibility/historical
exceptions. No global replacement, infrastructure rename, visual redesign,
repository/domain rename or data migration is authorized by this inventory.

## Decision validation

Run from repository root:

```sh
python3 docs/integration/monorepo-baseline/validate-naming.py
git diff --check
```

The validator checks unchanged pinned evidence, complete occurrence decisions,
per-token coverage, all source-map rows and final target naming. It does not
prove downstream deployment compatibility. Recorded result (2026-10-12): validator PASS (1,241 rows, 26 categories,
1,062 source paths); `git diff --check` PASS. No runtime tests or deployments are
needed for this documentation-only decision; #110–#116 retain those gates.
