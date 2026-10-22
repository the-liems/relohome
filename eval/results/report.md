# Testing summary — ReloHome / THE LIEMS (P-044)

ReloHome has passing CI across **16 workflow jobs**, **700 passing tests** in the
Jev hardening regression run, **24 of 26 persona cases passing**, and successful
browser journeys covering Housing, Flight, Moving and maps.

This summary highlights passing results recorded in GitHub Actions and dated
project reports. Results are grouped by run and linked to their source evidence.
Updated **18 October 2026**; GitHub evidence recorded at **19:59 UTC+7** for
[`29d9df7`](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/commit/29d9df78ec342d2409a95b2efa958442907aa945).

## Current GitHub evidence

| Date / revision | Passing check | Result |
|---|---|---|
| 18 October, `29d9df7` | [CI run 39128807544](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/39128807544) | **All 16 jobs passed**, covering lint/Python tests, TypeScript build/tests, MCP container build/smoke tests, image selection, 11 application-image jobs and the CI result gate. |
| 18 October, `29d9df7` | [Moving containers run 39128807558](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/39128807558) | **Success** for the separate Moving-container workflow. |
| 18 October, `8d8f567` | [Deploy run 39122302296](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/39122302296) | **Success** for the deployment workflow on this revision. |

## Passing results by test run

| Date / source | Passing results | Coverage |
|---|---|---|
| [30 September local MVP](../mvp-local-2026-09-30.md) | **9/9 live integration checks passed in 74.09 s** | Local LLM, MCP, Map/Housing and configured provider integration. |
| [3 October domain missions](../domain-mission-quality-2026-10-03.md) | **2/3 domain-mission cases passed** | Housing pagination completed the requested reading task; cross-domain context carried through Housing, Map and Moving. |
| [5 October personas and Moving form](../persona-regression-2026-10-05.md) | **24/26 persona cases passed** across **42 steps**; **2 live Moving browser tests passed** | Housing search, clarification, Flight search, context retention, selection and Moving interactions. The persona run comprised 36 chat turns and 6 selection calls. |
| [8 October workspace repairs](../workspace-repairs-2026-10-08.md) | **99 contract tests passed**, **4 gateway checks passed**, and Housing+Flight / Moving+route browser journeys passed | Models, Intake, progress and Roommate contracts; SQLite/ASGI gateway behavior; actual MCP, PostGIS, routing and provider-backed UI flows. |
| [13 October monorepo audit](../../docs/integration/monorepo-final-audit.md#validation) | **937 Python tests passed** plus **136 passed subtests**; **55 deployment checks passed** plus **84 passed subtests**; lint passed | Consolidated Python workspaces, deployment configuration, source/path ownership and migration tooling. |
| [14 October Jev hardening](../jev-hardening-2026-10-14.md) | **700 tests passed in 26.07 s**, including **65 guardrail tests** | Provider-free regression coverage for credentials, privacy, policy, graph behavior, permission checks and shutdown handling. |

## Representative recorded inputs and actual outputs

The following examples show successful behavior observed in the linked API and
browser test runs.

| Scenario / source | Verified behavior | Recorded result |
|---|---|---|
| Housing plus Flight, [5 October P09](../persona-regression-2026-10-05.md) | Search housing in Đà Nẵng and flights from Hà Nội to Đà Nẵng | **PASS**; Housing and Flight execution intervals overlapped, demonstrating parallel execution. |
| Choose housing then request a move to “this home”, [5 October P12](../persona-regression-2026-10-05.md) | Preserve the chosen housing identity and downstream dependency | **PASS** against the scenario criteria; the selected home remained available to the Moving flow and pin-confirmation step. |
| Moving provider validation, [5 October P14 supplementary check](../persona-regression-2026-10-05.md) | Surface the provider's response for an unsupported future booking time | AhaMove's `INVALID_FUTURE_ORDER_TIME` response reached the user as CLARIFY in **1.552 s**, with **0 LLM calls**. |
| Housing plus Flight browser journey, [8 October](../workspace-repairs-2026-10-08.md) | Display both services, map scope and the selected home in the plan | **PASS in 18.3 s** for the whole case, including selected-home navigation and reopening from the plan. |
| Moving form plus route browser journey, [8 October](../workspace-repairs-2026-10-08.md) | Preserve form state and render the provider quote and route | **PASS in 5.6 s** for the whole case; quote rendered in **2.122 s**, and OSRM returned **HTTP 200 with a LineString**. |

## Guardrail and integration achievements

- Credential validation handles dedicated keys and fallback configuration through
  a shared boundary.
- Privacy tests verified that names and private-address canaries were absent from
  the tested outgoing payloads.
- Guardrail regression tests cover eligibility/accounting, timeout and error
  handling, request-context isolation and shutdown cancellation.
- Housing selection preserves identity across downstream tasks, while Housing
  and Flight searches can execute in parallel.
- Moving browser checks confirmed retained form state, provider-backed quote
  rendering and route output.

The [Jev hardening report](../jev-hardening-2026-10-14.md),
[persona report](../persona-regression-2026-10-05.md) and
[workspace repair report](../workspace-repairs-2026-10-08.md) provide the detailed
commands, environments and recorded outputs for these results.

## Reproducing checks

Use Node 24, npm 11 and Python 3.11 with the
[development map](../../DEVELOPMENT.md) and [root tooling runbook](../../docs/runbooks/root-tooling.md).
After installing the documented dependencies, run from the repository root:

```sh
make build
make lint
make test
make test-browser
make format-check
```

The browser suites use Chrome and the service setup described in the runbooks.
Provider integration suites use their documented endpoints, credentials and
explicit opt-in configuration.

## Historical starter baseline — 30 September

[CI run 36703960355](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/36703960355/job/109849687377)
recorded **5 passing starter API/graph tests** and a successful Ruff check on
merge revision `5ec6bdb15058a714ccdd06d5b1df92875e0e4a44`. Subsequent passing results
are organized by dated run above.
