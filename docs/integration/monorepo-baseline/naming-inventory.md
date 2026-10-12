# LifeFlow → ReloHome naming inventory for #118

Scope: the updated [#109](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/109)
inventory, not a naming decision or rename implementation.
[#118](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/118) finalizes the
contract before #110–#116 implement it. The epic's intended direction is display
**ReloHome**, machine-facing source names **relohome**, and proposed npm scope
**@relohome/**. Exact suffixes, Python namespaces, aliases and exceptions need
that decision. No source, data, runtime identity or generated file is changed here.

## Evidence and limits

Pinned source: `263c4a9e5f986758dbc78a237d61c3a7b8d8ff58`, the publication base.
[naming-occurrences.tsv](naming-occurrences.tsv) records every case-insensitive
`lifeflow` matching text line from `git grep` and every matching tracked path:

- 1,017 matching content lines in 254 files, with 1,144 literal matches:
  `LifeFlow` 599, `lifeflow` 468, `LIFEFLOW` 77.
- 224 matching tracked paths; 1,241 evidence rows total. Path rows use line 0.
- `review_lane` routes review; it is **not** a rename authorization. Lines can
  mix source names with persisted values. The matrix below controls disposition;
  unresolved or mixed occurrences require review under #118.

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
This PR's own historical/provisional `lifeflow` mentions are explanatory evidence
outside that pinned source scan. Re-scan the chosen implementation base.

## Mechanical category coverage

Every evidence row has `matrix_category`: semicolon-separated IDs from the matrix
below, or explicit `unresolved`. IDs identify review categories, not approval to
rename. Exact token families and tracked workspace paths are routed conservatively;
uncategorized and mixed multi-match lines retain `unresolved`. There are
**711 unresolved rows** out of 1,241; these are an explicit #118 review queue,
not approved exceptions. A category can also contain unresolved consumer decisions.
#118 must inspect each recorded source line/path, assign every occurrence its
applicable categories and record its disposition before #116 can claim a complete
exception audit. Never infer preserve/rename from `review_lane` or file extension.
All `__LIFEFLOW_MAP__` occurrences route to M20, health service literals to M17,
and the default MCP host allowlist to M14. No broad documentation exemption is used.

## Rename-candidate / preserve matrix

“Candidate” means suitable for coordinated source/display renaming after #118,
not a commitment to the sample spelling. “Preserve” follows the epic's current
compatibility constraints; changing it requires a separately scoped transition.

| ID | Category and exact observed names | Evidence at the pinned base | Disposition / reason | Implementation after #118 |
| --- | --- | --- | --- | --- |
| M01 | npm `@lifeflow/{contracts,housing-query,mcp-core,moving-service,platform-api,mcp-server,moving-api,moving-mcp-server}` | Eight workspace manifests, TS imports, Docker npm workspace commands | Candidate `@relohome/*`; decide whether MCP suffixes track canonical app names. Update dependency keys, imports, exports consumers and Docker commands together | #110/#111 |
| M02 | Root manifest `lifeflow-platform`; example `lifeflow-map-app` | LifeFlow and map-app `package.json` | Candidate source/package names; root manifest ownership and example suffix decided in #118 | #110/#115 |
| M03 | `Maps VN/LifeFlow/`; `Start-LifeFlow.ps1`, `Stop-LifeFlow.ps1`; npm `dev:lifeflow`, `predev:lifeflow`; `tests/lifeflow.spec.ts` | Launchers, map manifest, workflow cwd/path filters, tests | Candidate tracked-source/command names. Resolve each path through the layout map; do not rename the old directory recursively because ignored storage remains there | #110/#111/#115 |
| M04 | Python `LifeFlowMcpClient`, `lifeflow_root`, `self.lifeflow_root`, `LIFEFLOW_ROOT` | Location demo client/agent/UI modules | Candidate internal symbols (e.g. ReloHomeMcpClient); update import consumers. Local variable `LIFEFLOW_ROOT` is distinct from environment-variable contracts below | #115 |
| M05 | TS `LifeFlowMcpDependencies`, `createLifeFlowMcpServer`, `createLifeFlowMcpRuntime` | Location create-server/runtime/types and consumers; dependencies type re-export | Candidate source/export names, but external consumers and temporary re-exports must be assessed first | #111 |
| M06 | Browser `LifeFlow Map`, visible `LifeFlow`; Streamlit `LifeFlow MCP Tool Lab`, `LifeFlow — local integration`; FastAPI `LifeFlow Intake`, `LifeFlow Routing Orchestrator`; OCI title `LifeFlow Moving` | map-app index/App, demo/tool_lab, src/ui/agent_chat, standalone app factories, Dockerfile.moving | Display candidates → ReloHome with descriptive suffix. OCI title is display metadata, unlike image repository or label selector. Keep routes and health identifiers unchanged | #111/#113/#114/#115 |
| M07 | Prompt text `Intake ... LifeFlow`, `Routing Orchestrator ... LifeFlow`, `subagent ... LifeFlow`; cancellation comment `Khách huỷ qua LifeFlow` | src/agents and standalone prompts; adapters/commit | Candidate brand text with domain review; prompts/provider-facing comments can affect behavior or audit history. Do not combine with prompt/copy redesign or rewrite prior messages | #114/#115 |
| M08 | API response `agent: "LifeFlow agent graph"` | src/api/routes.py | Review whether display-only or consumed machine value; preserve until that distinction is established | #114 |
| M09 | npm lock root/package names, `node_modules/@lifeflow/*` links; registry `source` string | Three package-lock.json files; config/agent-services/registry.json and export-agent-registry.mjs | Regenerate from approved manifests/exporter. Registry source provenance can change; do not rewrite registry protocol/tool identities. Never hand-edit generated lock metadata globally | #110/#111/#115 |
| M10 | SQL verification enum `lifeflow_verified`; provider value `lifeflow` | migrations/002_core_tables.sql, 009_mobility_readiness.sql, contracts/common.ts, queries/imports/geocode scripts | **Preserve** persisted/wire values and validation/protection predicates; display relabeling cannot change stored enums | #111/#115 exception; #116 checks |
| M11 | `public.lifeflow_schema_migrations`; advisory lock `lifeflow-moving-migrations` | platform migration runner/rollback, moving-service migrate.ts, test-migration-image.py | **Preserve** migration history and lock identity; renaming risks rerunning SQL or simultaneous migrations | #111/#115 exception |
| M12 | Database/role defaults `lifeflow`, `lifeflow_admin`, `lifeflow_app`, `lifeflow_ingest`; integration DB `lifeflow_verified` | LifeFlow .env.example, database config/migrate, init-local-integration.py | **Preserve** existing databases, users and credentials; `lifeflow_verified` here is also a DB name, distinct from the enum above | #111/#115 exception |
| M13 | `lifeflow-clean-poi` format/version; `database/lifeflow.dump`; historical dump/backup filenames | platform-api/src/poi-dataset.ts, scripts/restore-local-snapshot.py, snapshot runbooks | **Preserve** serialized artifact format and existing restore/checksum paths; never regenerate or rename stored artifacts for branding | #111/#115 exception |
| M14 | Compose projects `lifeflow`, `lifeflow-moving`, `lifeflow-agents`, `lifeflow-integration`, `lifeflow-routing-local`; default `MCP_ALLOWED_HOSTS=lifeflow-location-mcp` host allowlist; container/volume `lifeflow-postgis`, `lifeflow-postgis-data`; OSRM `lifeflow-osrm-<city>-<mode>` | Compose files, Setup/Start/Stop scripts and container discovery | **Preserve** resource/DNS/volume identities, including host validation, discovery regexes and qualified volumes; avoid orphaned data or duplicate services | #111/#114/#115 exception |
| M15 | Images `lifeflow-intake`, `lifeflow-orchestrator`, `lifeflow-location-mcp`, `lifeflow/moving-{api,mcp,migrate}`; cleanup labels `lifeflow.ci.{agents,mcp,moving}` | Compose, CI, smoke scripts | **Preserve** repositories/tags and ownership labels; producer/filter must continue to agree. Changing a label prefix is not merely changing log text | #110/#111/#114 exception |
| M16 | Env keys `LIFEFLOW_API_BASE_URL`, `LIFEFLOW_ENV_FILE`, `LIFEFLOW_MAP_TEST_URL`, `LIFEFLOW_LIVE_LLM` | Gateway, UI, config loaders, Playwright, live tests and docs | **Preserve** external configuration/opt-in interfaces. Never accidentally enable live checks or change credential/env precedence | #110–#115 exception |
| M17 | MCP names `lifeflow-location`, `lifeflow-moving`; health services `lifeflow-intake`, `lifeflow-orchestrator`, `lifeflow-moving-api`, `lifeflow-location-mcp`, `lifeflow-moving-mcp`; clientInfo `lifeflow-streamlit` | MCP factories, standalone install_http, Moving app, mcp-server/src/http-server.ts:51, moving-mcp-server/src/http-app.ts:78, demo/mcp_client.py | **Preserve** protocol/operational identities; changing a page title does not authorize changing server/client metadata | #111/#114/#115 exception |
| M18 | Source/provider IDs `lifeflow-flights`, `lifeflow-location`, dynamic `lifeflow-` + domain; `lifeflow:` workflow and UUID-v5 inputs | src/agents/subagents/services and src/services/adapters/{commit,moving_approval}.py | **Preserve** provenance, persisted approvals and idempotency. Changing the UUID input produces a different operation identity | #112/#114 exception |
| M19 | Documented URIs `lifeflow://schemas/{place,housing}`, `lifeflow://catalog/categories`, `lifeflow://providers/capabilities`, `lifeflow://workflows/moving` | LifeFlow docs/LIFEFLOW-MCP-POSTGIS-PLAN.md only | Preserve design evidence pending #118 contract assessment. No executable occurrences were found at this base; do not claim these are deployed resources | #115 review |
| M20 | `__LIFEFLOW_MAP__`; map source IDs `lifeflow-{pois,housing,housing-interaction,route,selected-poi}` | map-app MapView/config and browser tests | Coupled runtime/test hooks: candidate only after confirming no external consumers. Update producers, selectors, event handlers and tests atomically; preserve by default meanwhile | #115 |
| M21 | CI job key `lifeflow-typescript`; temporary prefixes `lifeflow-*-test-*`, `lifeflow_poi_test_`, `lifeflow-restore-*`; test MCP client names | Workflow needs/results expressions, DB tests, smoke/restore scripts | Review operational consumers and cleanup guards before renaming. CI checks may be branch-protected; test DB prefix guards are safety conditions, not arbitrary text | #110/#115 |
| M22 | README/runbooks/current architecture/source comments | Root docs and app docs, referenced in evidence TSV | Candidate current product/source references; preserve literal env/API/SQL/image examples and historical quotations. Mixed documents require section-level review | #115 (with each move's operational docs) |
| M23 | Dated eval/results/reports, journal/worklog, old ADR rationale, historical handoff/snapshot names, external repository/proper-name links | eval/, reports/, dated integration records, ADR-001, presentation and historical references | Preserve evidence and original names/URLs; add “historical” context where unclear. An ADR or runbook can also contain current instructions: do not blanket-exempt every Markdown file | #115/#116 exception audit |

## Existing Python imports versus proposed namespaces

At this base the import roots are `src.*`, `Frontend.*` and demo `demo.*`;
there are no implemented `lifeflow_*` top-level Python packages or corresponding
installable distributions to rename. The `lifeflow_*`/`lifeflow-*` names in
ADR-025 and the target-map columns are **earlier provisional proposals**, not
compatibility-sensitive existing identifiers. #118 should decide their ReloHome
replacements before any package is introduced, avoiding a second source rename.

Candidates for #118 (not approved final names):

| Proposed distribution(s) in ADR-025 | Proposed import(s) | Candidate direction for decision |
| --- | --- | --- |
| lifeflow-agent; lifeflow-browser-gateway | lifeflow_agent; lifeflow_gateway | relohome-agent / relohome_agent; relohome-browser-gateway / relohome_gateway |
| lifeflow-flights-mcp; lifeflow-payments-mcp | lifeflow_flights_mcp; lifeflow_payments_mcp | relohome-flights-mcp / relohome_flights_mcp; relohome-payments-mcp / relohome_payments_mcp |
| lifeflow-intake-api; lifeflow-orchestrator-api | lifeflow_intake; lifeflow_orchestrator | relohome-intake-api / relohome_intake; relohome-orchestrator-api / relohome_orchestrator |
| lifeflow-contracts; lifeflow-privacy; lifeflow-roommate | lifeflow_contracts; lifeflow_privacy; lifeflow_roommate | relohome-contracts / relohome_contracts; relohome-privacy / relohome_privacy; relohome-roommate / relohome_roommate |
| lifeflow-flight; lifeflow-payment; lifeflow-agent-services | lifeflow_flight; lifeflow_payment; lifeflow_agent_services | relohome-flight / relohome_flight; relohome-payment / relohome_payment; relohome-agent-services / relohome_agent_services |
| lifeflow-mcp-http | lifeflow_mcp_http | relohome-mcp-http / relohome_mcp_http |
| lifeflow-demos; lifeflow-location-demo | lifeflow_demos; demo | relohome-demos / relohome_demos; decide a collision-free location-demo import instead of assuming `demo` is final |
| conditional PR #107 observability package | lifeflow_observability | decide relohome-observability / relohome_observability with telemetry owner; preserve exported service identities |

Likewise `scripts/lifeflow/` and LifeFlow-containing destination filenames in the
layout map are provisional source names. #118 must reconcile the target columns;
old-path evidence and preserved runtime paths are never mechanically replaced.

## External consumers and identifiers without this spelling

All 11 tracked npm manifests are `private: true`, including the eight scoped
packages, LifeFlow root, map-app and `siu-ai-web`. No `npm publish` or
`twine upload` command was found under tracked `.github/` and `scripts/` at this
base. This supports an internal-workspace assessment only; it does **not** prove
that no package was ever published, copied or imported by another repository.
#118 must assess registry/consumer history and ownership before finalizing aliases.
Preserve public export behavior while updating names; the exported TS factory
and dependencies type require explicit consumer review.

Browser identities are not necessarily spelled LifeFlow. Preserve
`siu_session`, `siu-ui-preferences`, `siu-plan-strip-open`, the `siu-draft-` key
prefix, `relohome.mode` and `relohome-analytics-id`; they are not branding text.
The existing `siu-ai-web` package name and ReloHome browser display are context
for #118, not authority to perform a broader SIU rename. Keep API routes,
provider/tool identifiers, keys and telemetry identities even when they do not
match the search term. No external-service/registry or deployed-state audit was
performed here. PR #107 telemetry remains an additional re-inventory gate.

## Handoff and sequencing

`#109 → #118 → #110 → #111`; Python starts after `#109 + #118 + #110`, then
`#112 → #113 → #114`; final consolidation/validation remain #115/#116.

#118 owns the final matrix, externally published-consumer assessment and any
alias decision. Proposed review owners: npm/domain maintainers for scoped
packages/exports; Python/domain owners from ADR-025 for import shims; gateway
owner for browser/config compatibility; deployment maintainers for external
identities. These are functional responsibilities, not invented assignees.
Every approved alias needs an owner, list of consumers, deprecation policy and
removal criterion. Neither elapsed time nor completion of a folder move alone
justifies dropping an external alias. Temporary internal source shims can be
removed in #115 only after verified consumers are migrated and #118 agrees.

#110/#111 implement agreed npm/source names; #112/#114 Python names;
#111/#113/#114 app/API display titles; #115 demos/scripts/current docs;
#116 verifies all remaining occurrences against compatibility/historical
exceptions. No global replacement, infrastructure rename, visual redesign,
repository/domain rename or data migration is authorized by this inventory.
