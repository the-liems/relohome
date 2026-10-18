# Delivery roadmap — THE LIEMS (P-044)

Source: [recorded announcements](references/gate-announcements.md). The Build Phase
notice supplied by the team on 18 October 2026 is the current submission instruction;
Gate 1 and G2 remain historical milestones. All deadlines below use **UTC+7**.
Submission and passing require separate evidence. GitHub Issues and Milestones
track implementation tasks and owners.

## Build Phase — current submission

**One checkpoint, due 23:00 on Sunday, 18 October 2026.** The judges select top
projects from the submitted materials. Demo Day is **22 October 2026**, alongside
VinUni Tech Career Day; the notice replaces individual team pitching with judging
of submissions for this selection.

One representative submits at [Phoenix](https://phoenix.note.transformerlabs.ai/demo-day).
Required fields are project name/description, a live MVP URL, a demo video of at
most 3 minutes, a pitch deck covering the problem, solution, feasibility and future
development, and one thumbnail image link. The repository must also contain source,
README, architecture, specifications/design, testing documents, weekly logs, live
URL, demo and deck links, with all AI Logs uploaded. Every member must meet the
required AI Log threshold for valid submission access.

Use the [submission checklist](../presentation/README.md) and
[README submission fields](../README.md#build-phase-submission) for current readiness.
The older 23:59 G2 deadline below does not apply to this Build checkpoint.

## Historical gates

| Gate | Deadline | Required outcome | Reward when passed |
|---|---|---|---|
| Gate 1 — Chốt đề tài | Sunday, 20 September 2026, 23:59 UTC+7 | Finalize the problem and design | +100 XP per member |
| G2 — MVP | Sunday, 4 October 2026, 23:59 UTC+7 | Demonstrate the MVP and submit the required evidence | +100 XP per member |

## Gate 1 — Problem and design

| Required deliverable | Repository preparation |
|---|---|
| One-page brief | Prepare a one-page summary of the selected problem, users, and intended solution. The [product brief](product.md) supplies the working content. |
| PRD | Use the [product requirements](product.md), including the confirmed MVP scope and the draft [acceptance criteria still being developed](product.md#acceptance-criteria-to-develop). |
| Wireframe / UI flow | Provide the user-facing screens or interaction flow. A component architecture diagram alone does not cover this deliverable. |
| GitHub repo and AI log setup | Follow the [README setup and AI usage logging instructions](../README.md). Verify contributor logging works. |

The deadline has passed. This roadmap does not establish whether Gate 1 was submitted or passed; add the submission and assessment evidence when available.

## G2 — MVP

| Required deliverable | Completion evidence |
|---|---|
| MVP demo | A **3-minute video** showing the user flow end to end. Prepare it using the [demo notes](../presentation/README.md). |
| Architecture diagram | Components and data flow for the demonstrated implementation. Update the [architecture diagrams](architecture_diagram.md) to match what actually runs. |
| At least 10 merged PRs | Link at least 10 merged pull requests in this repository; verify their merged state at submission. Open PRs do not count. |
| README.md | Reproducible setup instructions, environment variables, sample queries, and other instructions needed to run the MVP. Update the [README](../README.md) for the demonstrated version. |
| Evaluation evidence | At least **5 manual test cases with actual outputs**. The [testing summary](../eval/results/report.md#representative-recorded-inputs-and-actual-outputs) indexes later recorded observations and explains their limits; it does not certify historical G2 completion. |

The demonstrated flow should follow the [confirmed MVP scope](product.md#mvp-scope), including travel booking. Record which providers or actions are simulated so the video, README, diagrams, and test outputs describe the same implementation.

These gate deliverables replace the earlier proposed M1–M5 sequence. Additional product metrics and internal implementation steps may help development, but their sequencing needs team agreement. Do not infer gate completion from a planning document or an automated test count.
