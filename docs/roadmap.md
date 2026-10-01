# Delivery roadmap — THE LIEMS (P-044)

Source: [official Gate 1 and G2 announcements](references/gate-announcements.md), confirmed by @ai-dnn and applicable until further official notices. The dates below use the current project year, 2026, and the confirmed timezone **UTC+7**. These gates define the submission requirements; passing or submitting a gate requires separate evidence. GitHub Issues and Milestones track implementation tasks and owners.

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
| Evaluation evidence | At least **5 manual test cases with actual outputs**, recorded in the [evaluation report](../eval/results/report.md#g2-manual-evaluation-evidence). |

The demonstrated flow should follow the [confirmed MVP scope](product.md#mvp-scope), including travel booking. Record which providers or actions are simulated so the video, README, diagrams, and test outputs describe the same implementation.

These gate deliverables replace the earlier proposed M1–M5 sequence. Additional product metrics and internal implementation steps may help development, but their sequencing needs team agreement. Do not infer gate completion from a planning document or an automated test count.
