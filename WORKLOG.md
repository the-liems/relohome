# Weekly worklog — THE LIEMS / ReloHome (P-044)

Reconstructed on **18 October 2026** from merged `main` history and dated project
reports. Evidence cutoff: **19:59 UTC+7**, GitHub `main`
[`29d9df7`](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/commit/29d9df78ec342d2409a95b2efa958442907aa945).
Weeks run Monday–Sunday in Vietnam time. These are retrospective records, not
contemporaneous meeting minutes. Merge dates establish delivery to `main`, not
when every underlying task was performed. No member roles, hours or work outside
Git are inferred from author strings. See the [journal](JOURNAL.md) for technical
learning and the [testing summary](eval/results/report.md) for measured results.

## 7–13 September — repository baseline

- **10 September:** the [initial commit](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/commit/3384a58)
  establishes the starting code history. It does not establish delivery of a
  relocation product or completion of upstream template work by this team.

## 14–20 September — early activity

- **20 September:** [commit `ba9c317`](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/commit/ba9c317)
  is titled “Thử”; that message alone does not establish a completed feature.
- No dated meeting notes or Gate 1 submission receipt were identified in the
  reviewed worklog/journal. The [gate record](docs/references/gate-announcements.md)
  records requirements, not proof of submission.

## 21–27 September — project organization

- **24 September:** [PR #4](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/4)
  added project organization conventions and README navigation, defining locations
  for specifications, architectural decisions and delivery records.

## 28 September–4 October — relocation MVP integration

- **30 September:** [PR #14](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/14)
  moved CI to the team-44 self-hosted runner.
- **1 October:** [PR #23](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/23)
  merged relocation product/architecture documentation prepared during the
  September review. [PR #25](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/25)
  repaired Codex prompt hooks and transcript-home-path redaction.
- **4 October:** [PR #22](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/22)
  merged the MVP branch. The [30 September MVP report](eval/mvp-local-2026-09-30.md)
  records local provider checks and transaction limits. The
  [3 October domain evaluation](eval/domain-mission-quality-2026-10-03.md)
  records **2 passing cases and 1 failure**.
- Remaining evidence at that stage: public deployment acceptance, submission
  media and production flight/payment completion were not established by these reports.

## 5–11 October — service contracts and delivery automation

| Merged work | Repository evidence |
|---|---|
| 5 October: Moving, Housing, Maps and Travel specifications; isolated CI jobs | [#37](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/37), [#24](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/24), [#36](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/36), [#38](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/38), [#51](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/51) |
| 6 October: payment/API/Flight/Map/Moving fixture reconciliation and Coolify delivery planning | [#54](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/54), [#56](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/56), [#57](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/57), [#58](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/58), [#59](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/59), [#60](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/60), [#5](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/5) |
| 7–11 October: ARM64 PostGIS publishing, staging automation, separated deployment, migration tests and production promotion configuration | [#62](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/62), [#63](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/63), [#64](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/64), [#78](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/78), [#97](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/97), [#85](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/85) |
| 10–11 October: landing UX, housing context, device routing and confirmed Moving-form feedback | [#98](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/98), [#100](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/100), [#104](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/104), [#103](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/103) |

Testing performed during the week is separate from merge dates. The
[5 October persona report](eval/persona-regression-2026-10-05.md) records **24 PASS,
2 FAIL against the original criteria** across 26 cases. The
[8 October issue #70 report](eval/workspace-repairs-2026-10-08.md) records real
browser/provider journeys and baseline suite failures. These results do not
establish acceptance of every workflow or production deployment.

## 12–18 October — workspace consolidation and product hardening

| Merged work | Repository evidence |
|---|---|
| 12–13 October: ReloHome naming, root tooling, source/package relocation and final migration audit | [#121](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/121), [#124](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/124), [#128](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/128), [#129](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/129), [#138](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/138), [#139](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/139), [#141](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/141), [#142](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/142), [#144](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/144) |
| 13–16 October: Housing cloud management and tenant/landlord workspaces | [#135](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/135), [#170](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/170), [#193](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/193) |
| 14–15 October: Jev shadow guardrails/hardening, observability and Git-based deployment | [#145](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/145), [#156](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/156), [#107](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/107), [#168](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/168), [#180](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/180), [#184](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/184), [#185](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/185) |
| 16–18 October: Moving quote forms through LangGraph, private Roommate chat, tenant UX, Housing query improvements and map follow-ups | [#192](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/192), [#212](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/212), [#219](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/219), [#223](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/223), [#254](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/254), [#256](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/256), [#257](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/257) |
| 18 October: embedded collectors/PR previews, followed by readiness handling for deployments without a Collector healthcheck | [#209](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/209), [#262](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/262) |

The [monorepo audit](docs/integration/monorepo-final-audit.md) retains environment
limits and checkpoint compatibility details. The [14 October guardrail report](eval/jev-hardening-2026-10-14.md)
records **700 passed, 8 skipped** in its scoped provider-free suite, not a live
accuracy calibration. At the evidence cutoff, `29d9df7` had passing CI and
Moving-container workflows; its deployment was still running after two failed
attempts on `25b3eb4`. See the [testing summary](eval/results/report.md#current-github-evidence).

Submission follow-up: publish the three media links, verify judge access, confirm
all members' Phoenix AI Logs, and retain a submission receipt in the
[checklist](presentation/README.md). Merged PRs do not establish these outcomes.

## Preserved earlier Location/Map note — recorded 29 September

The earlier worklog recorded housing accuracy/method/deposit contracts, entity
routing, a nine-tool MCP registry, timeout/cancellation and two-endpoint region
validation, with **93 tests passed / 9 skipped** and nine OSRM graph checks.
See [integration status](docs/integration/README.md),
[data/backup status](docs/integration/location-data-status.md), and
[Location handoff](docs/integration/location-service-implementation-status.md).
This preserves a dated report, not a fresh test run or cloud/end-to-end acceptance.

## Team contributions requiring confirmation

The [team roster](README.md#team) is recorded in the repository. Per-member roles,
hours, work outside Git and personal reflections require team confirmation.
PR/commit links above provide evidence without guessing which aliases correspond
to roster members. The earlier duplicated 8 October workspace note is consolidated
into the linked weekly entry; the September documentation preparation is distinguished
from its 1 October merge.
