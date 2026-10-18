# Build Phase submission checklist — ReloHome (P-044)

**Deadline: 23:00 on Sunday, 18 October 2026 (Vietnam time, UTC+7).**
Demo Day: **22 October 2026**, alongside VinUni Tech Career Day.
One representative submits or updates the team entry at
[Phoenix](https://phoenix.note.transformerlabs.ai/demo-day).
See the [recorded Build announcement](../docs/references/gate-announcements.md#build-phase--18-october-2026-update).

Prepared from repository history through GitHub `main`
[`29d9df7`](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/commit/29d9df78ec342d2409a95b2efa958442907aa945),
with a **19:59 UTC+7, 18 October** evidence cutoff. Checked boxes mean the named
repository artifact is present, not that judges have accepted the submission.
Phoenix submission/receipt and AI Log eligibility have not been verified here.

## Submission form

The [README submission fields](../README.md#build-phase-submission) are the
canonical place for the video, pitch deck and thumbnail URLs supplied by the team.
The URLs are recorded; duration, slide contents and judge access have not been
verified in this update.

- [x] Project name and description: **ReloHome — AI-assisted relocation planning**,
  with a reusable description in the README.
- [ ] Final live MVP URL and judge access verified. The README links staging,
  which redirected to Cloudflare Access sign-in during the 18 October check.
- [x] Demo video URL supplied and linked in the README.
- [x] Pitch deck URL supplied and linked in the README.
- [x] One project thumbnail image URL supplied and linked in the README.
- [ ] Verify the recording is **at most 3 minutes**.
- [ ] Verify the final slides cover **problem, solution, feasibility and future
  development**.
- [ ] Verify judges can open the video, deck and thumbnail links.

## Required GitHub artifacts

| # | Required item | Evidence / readiness |
|---|---|---|
| 1 | Full project source | Committed application/service/library source in `apps/`, `packages/`, `examples/`, with deployment configuration. Confirm the final intended code is merged; local-only changes are not part of the reviewed GitHub snapshot. |
| 2 | README.md | [Project overview, setup navigation and submission fields](../README.md) present, including all three supplied media URLs. |
| 3 | Architecture diagram | [Component and data flow overview](../ARCHITECTURE.md#implemented-system) present; check against the selected deployed revision. Historical/proposed diagrams remain labeled separately. |
| 4 | Specifications and design | [Product brief](../docs/product.md), [specifications](../docs/specs/README.md), [design documents](../docs/design/) and [ADRs](../docs/adr/README.md) present. |
| 5 | Testing documents | [Testing summary](../eval/results/report.md) links current CI, dated reports, actual outputs, failures and limits. Final deployed acceptance remains pending. |
| 6 | Weekly logs | [Weekly worklog](../WORKLOG.md) and [development journal](../JOURNAL.md) reconstructed through 18 October; personal roles/hours are not invented. |
| 7 | Live URL | [Staging](https://staging.c4-app-044.io.vn) linked in README; judge access and final deployed SHA pending. |
| 8 | Demo video | URL supplied in the README; duration and judge access remain unverified. |
| 9 | Pitch deck | URL supplied in the README; content coverage and judge access remain unverified. |
| 10 | AI Log fully uploaded to the system | **Unverified in Phoenix** — hooks are documented, but upload success and all-member thresholds require dashboard verification. |

## Final repository and deployment checks

- [ ] Confirm all source intended for the checkpoint is committed and merged;
  record the final submission SHA below.
- [ ] Confirm the final revision's required GitHub checks pass. The
  [reviewed CI at `29d9df7`](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/39128807544)
  passed, but that does not cover later revisions or these local documentation edits.
- [ ] Confirm the [deployment run](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/39129395438)
  finishes successfully and identify the revision actually served. It was still
  in progress at the cutoff; two earlier attempts on `25b3eb4` failed.
- [ ] Verify the demo journey from a judge's access context and record its result
  in the [testing summary](../eval/results/report.md#representative-recorded-inputs-and-actual-outputs).
- [ ] Verify judge access to the private GitHub repository and all submitted links.
- [ ] Ensure the README, deck, video and architecture describe the same tested
  capabilities and clearly identify provider/staging/sandbox transaction limits.

## All-member AI Log eligibility

The notice supplies no numeric threshold. Check the applicable requirement in
Phoenix and verify both completed uploads and eligibility for every member.
No AI Log status is inferred from Git commits or local hook configuration.

| Team member | All AI Logs uploaded | Required threshold met |
|---|---|---|
| Đặng Đỉnh Đoàn | Unverified | Unverified |
| Ngô Anh Khoa | Unverified | Unverified |
| Mai Quang Dũng | Unverified | Unverified |
| Nguyễn Dũng | Unverified | Unverified |

- [ ] All four members' uploads and thresholds verified in Phoenix.
- [ ] Phoenix opens valid submission access for the team representative.

## Submission record

- [ ] One representative submitted/updated the team entry before the deadline.
- [ ] Open every saved link from the submitted entry and check it is correct.
- [ ] Save confirmation or a receipt and record the actual submission time.

| Field | Value |
|---|---|
| Final submission commit | TODO: full SHA |
| Verified deployed commit | TODO: full SHA and verification time |
| Team representative | TODO: name |
| Actual submission time | TODO: date and time in UTC+7 |
| Submission confirmation / receipt | TODO: confirmation reference or shareable receipt |

## Demo and deck preparation

Select a scenario that works on the final deployment. A suitable narrative is:
state the relocation goal, compare housing, select a home, request a grounded
moving quote or flight search, and review the plan and any required confirmation.
Only show supported actions as completed; do not imply a real flight booking or
successful payment from a search result, quote or sandbox form.

Suggested recording budget: **0:00–0:20** problem and user; **0:20–2:30** tested
product flow; **2:30–3:00** result, implementation limits and next steps.

Suggested deck coverage:

1. Target user and coordination problem, with sourced evidence where available.
2. ReloHome solution and the tested customer journey.
3. Demonstrated product capabilities and architecture.
4. Feasibility: actual implementation, data/providers and the linked testing
   evidence, including known failures and operational limits.
5. Future development and next milestones.
6. Team and contribution evidence from the weekly worklog.

The original September preparation notes were planning material, not a finished
video or deck. Historical Gate 1/G2 requirements remain in the
[roadmap](../docs/roadmap.md#historical-gates); the current Build deadline is 23:00
on 18 October, and its demo limit is **3 minutes**, not the general course guide's
older 5-minute maximum.
