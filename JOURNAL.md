# Development journal — THE LIEMS / ReloHome (P-044)

Updated **18 October 2026**, reconstructed from the evidence linked in the
[weekly worklog](WORKLOG.md), through GitHub `main` `29d9df7` at **19:59 UTC+7**.
These are technical observations derived from repository records, not invented
personal reflections or meeting notes. Member roles and time spent are unconfirmed.

## Weekly learning and decisions

| Week (Vietnam time) | Repository evidence and learning | Follow-up / limit |
|---|---|---|
| 7–13 September | Initial repository history begins on 10 September (`3384a58`). | A starting template is not evidence of delivered relocation features. |
| 14–20 September | The 20 September commit is titled “Thử” (`ba9c317`). | Its title does not establish a feature, team decision or Gate 1 submission. |
| 21–27 September | PR #4 introduced locations for product requirements, specs, ADRs and delivery evidence. | Proposed structure must be distinguished from files and behavior that actually exist. |
| 28 September–4 October | PRs #14/#23/#25/#22 delivered CI configuration, product/architecture documentation, prompt-hook repair and the integrated MVP. The 3 October domain evaluation found 2 passing cases and 1 failure. | Link claims to the tested revision; better task completion in one case does not establish lower latency or overall quality. |
| 5–11 October | Service specifications, fixture reconciliation and Coolify delivery configuration merged. The 26-case persona run had 24 PASS and 2 FAIL under original criteria; issue #70 recorded provider/browser checks and suite failures. | Keep harness/criteria changes explicit. A configured promotion pipeline is separate from successful deployment and public access. |
| 12–18 October | Root workspaces and installed Python packages replaced legacy source layouts; checkpoint compatibility remained explicit. Housing/Roommate flows, shadow guardrails, telemetry and deployment previews evolved in linked PRs. | Retain compatibility until the documented migration gate is met. Provider-free guardrail tests do not establish live semantic accuracy. CI passed at `29d9df7`, while deployment remained in progress at the cutoff. |

All commit/PR references in this table are linked in the [weekly worklog](WORKLOG.md).
The [testing summary](eval/results/report.md) separates historical provider runs,
current CI and deployment outcomes.

## Build submission decisions — 18 October

- Use the supplied Build announcement: **23:00 on 18 October 2026 (UTC+7)**,
  at most 3 minutes of demo video, and Demo Day on 22 October. Preserve the older
  Gate 1/G2 dates as historical records in the [roadmap](docs/roadmap.md).
- Maintain one set of media links in the
  [README submission fields](README.md#build-phase-submission), referenced by the
  [submission checklist](presentation/README.md).
- The observed staging endpoint requires Cloudflare Access sign-in. Judge access,
  the final deployed revision and an end-to-end demonstration need verification.
- Verify each member's AI Log uploads and threshold in Phoenix. Repository hooks
  alone cannot establish eligibility; retain the final submission receipt separately.

## Historical notes — retained from the September baseline

The observations below describe their original dates, before later integration,
monorepo migration and CI repairs. Statements about missing implementation are
historical; use the current README and testing summary for the later snapshot.

### 2026-09-29 — Documentation baseline

#### Observed

- The repository still runs the AI20K example FastAPI and two-node LangGraph flow.
- The proposed multi-service relocation workflow describes substantially more than the current code implements.
- The team identified people relocating as the target users and housing, moving, and travel as the core vendor categories. The exact demonstration request, member roles, and deployment choices need confirmation. The team roster is recorded in [README.md](README.md#team).

#### Documentation decision

Describe current behavior and proposed behavior separately in [ARCHITECTURE.md](ARCHITECTURE.md), and leave unmeasured evaluation results unreported in the [evaluation report](eval/results/report.md).

#### Next decisions

Choose a concrete relocation request, define the MVP service boundary, and agree on who owns its requirements. Record the decisions in [docs/product.md](docs/product.md) before presenting a proposed flow as implemented work.

### Earlier activity visible in Git

| Date | Evidence | What it establishes |
|---|---|---|
| 2026-09-24 | `e2c14ec` | Project organization convention was added. |
| 2026-09-30 | `93a7eff` / [PR #14](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/14) | Team-44 self-hosted CI configuration merged into `main`; earlier September 28–29 commits were branch work. |

These entries are a repository history summary, not a substitute for weekly team reflections.

### 2026-09-30 — GitHub planning review

Open issues and PRs identify four service domains: Location/Housing, Moving, Flight, and Payment. The current graph-demo issue targets a chat flow across them, with same-city moving and mock payment. Several issues report branch-level tests or staging checks, while approval, authentication, persistent state, real housing data, and end-to-end integration remain open. The [work-in-progress map](docs/work-in-progress.md) links the source issues and PRs. These reports do not change the implemented status of the current checkout. The team clarified that a name appearing in branch work was randomly generated and is not the product name.
