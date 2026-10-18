# Testing summary — ReloHome / THE LIEMS (P-044)

Updated **18 October 2026** from GitHub Actions and existing dated reports.
Evidence cutoff: **19:59 UTC+7**. Reviewed GitHub `main`:
[`29d9df78ec342d2409a95b2efa958442907aa945`](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/commit/29d9df78ec342d2409a95b2efa958442907aa945).
This documentation update did not rerun application, browser or provider suites.
The local documentation checkout is older than that GitHub revision; the remote
results below belong to their linked SHA, not uncommitted local changes.

## Current GitHub evidence

| Revision / date | Check | Recorded result | What it establishes |
|---|---|---|---|
| `29d9df7`, 18 October | [CI run 39128807544](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/39128807544) | **Success**; all 16 listed jobs succeeded | Lint/Python tests, TypeScript build/tests, MCP container build/smoke tests, image selection, 11 application-image jobs and the CI result gate passed on this revision. No aggregate test count is inferred from job status. |
| `29d9df7`, 18 October | [Moving containers run 39128807558](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/39128807558) | **Success** | The separate Moving-container workflow completed successfully. |
| `29d9df7`, 18 October | [Deploy run 39129395438](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/39129395438) | **In progress at cutoff** | Deployment completion was not yet established. PR #262 adjusted readiness handling for running deployments without a Collector healthcheck. |
| `25b3eb4`, 18 October | [Deploy run 39124457654](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/39124457654) and [retry 39125721716](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/39125721716) | **Failure** on both attempts | Passing CI on this earlier revision did not imply successful deployment. |
| `8d8f567`, 18 October | [Deploy run 39122302296](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/39122302296) | **Success** | A prior deployment workflow succeeded; this does not identify the currently served revision or prove every user journey. |

An unauthenticated HTTP check of the
[staging application](https://staging.c4-app-044.io.vn) on 18 October followed a
redirect to a **Cloudflare Access sign-in page**, not the React application.
HTTP 200 on that login page is not product acceptance. Judge access, final deployed
revision and the recorded demo journey remain checks in the
[submission checklist](../../presentation/README.md).

## Dated testing reports

Results below are historical measurements on the environments described by each
report. Counts are not added together: suites overlap and revisions differ.

| Date / source | Recorded result | Scope and limits |
|---|---|---|
| [30 September local MVP](../mvp-local-2026-09-30.md) | Final update reports **9/9 live integration checks passed in 74.09 s** | Configured local LLM, MCP, Map/Housing and provider checks. ZaloPay was sandbox-only; no successful real payment or issued flight ticket is established. See the source's earlier failed attempts and transaction caveats. |
| [3 October domain missions](../domain-mission-quality-2026-10-03.md) | **2 cases PASS, 1 FAIL** | Small real-provider/domain-loop evaluation. It found better pagination completion and a response-scope regression; no general accuracy, speed or cost improvement follows. |
| [5 October personas and Moving form](../persona-regression-2026-10-05.md) | **26 cases / 42 steps: 24 PASS, 2 FAIL** under original criteria; **2 live browser Moving tests PASS** | Local `62f83b7` plus PR #53 `6c89a60` and other local latency changes; 36 chat turns and 6 selection calls, not 26 browser runs. Real providers, AhaMove staging; writes/payment creation disabled. P14/P18 failures and the P21 quality warning remain in the report. |
| [8 October workspace repairs](../workspace-repairs-2026-10-08.md) | Scoped contracts **99 passed**; gateway checks **4 passed**; real Housing+Flight and Moving+route browser checks passed | Local Windows/PostGIS/provider environment. Full local suite also had **31 failed, 541 passed, 83 skipped** against a failing baseline; publication suite differed. These historical failures must not be described as current-main failures without a rerun. |
| [13 October monorepo audit](../../docs/integration/monorepo-final-audit.md#validation) | **937 passed, 103 skipped, 5 failed**, plus 136 passed subtests; deployment checks **55 passed**, 84 passed subtests; lint passed | All five Python failures were sandbox socket-bind permissions. The report separately cites a supplied unsandboxed baseline of 942 passed/103 skipped. Node 26 was used for that audit while Node 24 is supported; this is not a fresh Node 24 run. |
| [14 October Jev hardening](../jev-hardening-2026-10-14.md) | **700 passed, 8 skipped** in 26.07 s, including 65 guardrail tests | Scoped provider-free regression suite on `fix/155-jev-hardening`, based on `8566aeb`. Mocked payload/privacy/policy checks do not calibrate live Jev accuracy. Unconfigured PostgreSQL/live integrations were skipped. |

## Representative recorded inputs and actual outputs

These are selected observations from the linked reports, not newly executed manual
tests or acceptance of the final deployment. Original reports retain the full
criteria, environments, raw-artifact availability and failed attempts.

| Scenario / source | Expected behavior | Recorded actual output / outcome |
|---|---|---|
| Housing plus Flight, [5 October P09](../persona-regression-2026-10-05.md) | Find housing in Đà Nẵng and flights from Hà Nội to Đà Nẵng | PASS under source criteria; Housing/Flight execution intervals overlapped, rather than only displaying parallel progress. |
| Choose housing then request a move to “this home”, [5 October P12](../persona-regression-2026-10-05.md) | Preserve chosen housing identity and downstream dependency | PASS under source criteria; clarification for confirmed pins was allowed. This does not prove a completed moving quote or order. |
| Future Moving time after confirmed inputs, [5 October P14 supplementary check](../persona-regression-2026-10-05.md) | Expose provider refusal without inventing a quote/order | AhaMove returned `INVALID_FUTURE_ORDER_TIME`; response was CLARIFY in **1.552 s**, **0 LLM calls**, with no quote/order/transaction invented. Original P14 still failed its earlier field-specific expectation. |
| Housing plus Flight browser journey, [8 October](../workspace-repairs-2026-10-08.md) | Display both services, map scope and selected home in the plan | PASS in **18.3 s** for the whole case; selected-home navigation and reopening from the plan were observed. |
| Moving form plus route browser journey, [8 October](../workspace-repairs-2026-10-08.md) | Preserve form state and show real route/quote output | PASS in **5.6 s** for the whole case; quote rendered in **2.122 s**, OSRM returned HTTP 200 with a LineString. No transaction was executed. |

The historical G2 notice asked for at least five manual cases with actual outputs.
This index improves discoverability of recorded evidence; it does not reclassify
API/automated runs as manual testing or establish that G2 was submitted/passed.
The [18 October Build notice](../../docs/references/gate-announcements.md#build-phase--18-october-2026-update)
requires testing documents without specifying a new case count.

## Reproducing checks on the selected submission revision

Use Node 24, npm 11 and Python 3.11 with the
[development map](../../DEVELOPMENT.md) and [root tooling runbook](../../docs/runbooks/root-tooling.md).
From the repository root, after installing the documented dependencies:

```sh
make build
make lint
make test
make test-browser
make format-check
```

These commands describe how to verify a selected revision; this update did not
run them. Browser suites require Chrome and their documented service setup.
Live/provider checks additionally require explicit opt-ins and configured
credentials/endpoints; use the runbooks and identify staging/sandbox versus live
operations in each result. Skipped checks are not passing integration evidence.

## Remaining acceptance evidence

- Verify the final deployed commit, judge access and one end-to-end demo journey;
  record date, inputs, expected/actual outputs and pass/fail against that deployment.
- Recheck any failed historical scenario before claiming it is fixed. Current CI
  success alone does not rerun the dated real-provider persona/browser evaluations.
- No general production success rate, coverage percentage, user-study outcome or
  successful real flight booking/payment is claimed by this summary. Local timing
  samples are not a production latency SLA.
- The [video/deck/thumbnail fields](../../README.md#build-phase-submission), all-member
  AI Log eligibility and Phoenix receipt remain submission evidence to complete.

## Historical starter baseline — 30 September

[CI run 36703960355](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/36703960355/job/109849687377)
reported **5 passed** and Ruff success for the starter API/graph, testing merge
`5ec6bdb15058a714ccdd06d5b1df92875e0e4a44` for PR head
`68243647d8fe85fbdf4c722fa4693065d41ef526` against `93a7eff`.
This older result is retained for provenance; it is not the current MVP test total.
The former September table's “not implemented” statements and unmeasured targets
are superseded here by dated evidence and explicit remaining acceptance checks.
