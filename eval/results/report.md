# Evaluation report — THE LIEMS (P-044)

Status: baseline inventory from 2026-09-29, with customer evaluation criteria updated 2026-09-30. Product quality metrics have not yet been measured. Targets and results should be agreed for the selected MVP workflow and linked to reproducible evidence.

The [work-in-progress issue map](../../docs/work-in-progress.md) includes tests and staging checks reported for separate service branches. Those reports are useful progress evidence, but they are not a passing end-to-end result for this checkout and are not counted in the table below.

## Existing automated checks

| Check | What the test asserts | CI result on 2026-09-30 |
|---|---|---|
| `tests/test_api/test_routes.py::test_health` | Health endpoint returns HTTP 200 and `status: ok`. | Passed in the linked CI run below. |
| `tests/test_api/test_routes.py::test_chat_empty_message` | Empty chat message returns HTTP 422. | Passed in the linked CI run below. |
| `tests/test_api/test_routes.py::test_agent_status` | Agent status endpoint returns HTTP 200. | Passed in the linked CI run below. |
| `tests/test_agents/test_graph.py` | Graph returns a response and preserves the query in state. | Passed in the linked CI run below. |

[CI run 36703960355](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/36703960355/job/109849687377) passed on 2026-09-30 for PR head `68243647d8fe85fbdf4c722fa4693065d41ef526`. Actions tested merge commit `5ec6bdb15058a714ccdd06d5b1df92875e0e4a44` against main `93a7eff`. On Linux ARM64 with Python 3.11.16, `ruff check src/ tests/` passed and `pytest tests/ -v --tb=short` reported **5 passed**. These checks cover the starter API and graph; they do not establish relocation workflow quality or test coverage. Later revisions need their own CI result.

## G2 manual evaluation evidence

G2 requires at least **5 manual test cases with actual outputs**, due at 23:59 UTC+7 on Sunday, 4 October 2026. See the [delivery roadmap](../../docs/roadmap.md#g2--mvp). The five automated tests above are separate evidence and do not satisfy this manual-test deliverable.

No completed manual test cases with actual outputs are recorded in this report yet. For each case, record the tested commit or deployment, run date, inputs and steps, expected result, actual output (text, screenshot, or linked artifact), and pass/fail outcome. Identify each provider and whether each tested operation uses a mock, sandbox/staging, or live service, including whether a booking or payment has a real external effect. Record failures as observed; planned scenarios alone are not completed evidence.

## Product metrics

| Metric | Target | Actual | Evidence |
|---|---|---|---|
| Goal interpretation accuracy | To define for selected workflow | Not measured | No evaluation set yet |
| Relocation plan completeness | Housing, moving, and travel needs are represented or explicitly marked unresolved | Not measured | No end-to-end scenario yet |
| Quote traceability | Each displayed price has a provider, timestamp, and validity/uncertainty label where available | Not measured | No integrated quote view yet |
| Customer coordination effort | Define a baseline and measure repeated inputs or time across vendors | Not measured | No user study or baseline yet |
| Workflow completion rate | To define | Not measured | No multi-service workflow yet |
| Approval enforcement | All paid actions require valid approval | Not measured | Approval flow not implemented |
| Dependency and data passing | Downstream steps run with the correct predecessor output | Not measured | Orchestrator not implemented |
| Scoped service access | Calls use only the current user's authorized scope | Not measured | Service authorization not implemented |
| Compensation consistency | Failed workflows reach the documented compensated or reconciled state | Not measured | Saga not implemented |
| Progress visibility | Updates are available throughout long workflows | Not measured | Realtime progress not implemented |
| Change after finalization | Affected steps and approvals are refreshed; unrelated valid work is preserved; no duplicate paid action occurs | Not measured | Change-impact handling and reconciliation not implemented |
| Response or workflow latency | To define | Not measured | No timed scenario results yet |
| User feedback | To define | Not collected in repository | No feedback records yet |
| Test coverage | To define | Not measured | Coverage tooling/results absent |

## Next evidence to collect

1. Keep CI evidence linked to the tested revision as implementation changes; attach dated commands and output for any additional local measurements.
2. Define representative customer scenarios: missing destination or date, housing selection feeding a moving quote, travel search in parallel, a change after finalization but before booking, a change after one booking, an uncertain vendor response, rejected paid action, and failure after one successful action.
3. Record dataset size, evaluation method, raw results, and limitations for each reported metric.
4. Record consented user feedback with date, scenario, and summary. Do not invent users or ratings.

No demo date, participant count, production URL, or user feedback is confirmed in this repository.
