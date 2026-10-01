# Development journal — THE LIEMS (P-044)

This journal records verified project learning and decisions. Individual reflections and team meeting notes can be added with their authors and dates. Git commit metadata alone does not establish a person's role or time spent.

## 2026-09-29 — Documentation baseline

### Observed

- The repository still runs the AI20K example FastAPI and two-node LangGraph flow.
- The proposed multi-service relocation workflow describes substantially more than the current code implements.
- The team identified people relocating as the target users and housing, moving, and travel as the core vendor categories. The exact demonstration request, member roles, and deployment choices need confirmation. The team roster is recorded in [README.md](README.md#team).

### Documentation decision

Describe current behavior and proposed behavior separately in [ARCHITECTURE.md](ARCHITECTURE.md), and leave unmeasured evaluation results unreported in the [evaluation report](eval/results/report.md).

### Next decisions

Choose a concrete relocation request, define the MVP service boundary, and agree on who owns its requirements. Record the decisions in [docs/product.md](docs/product.md) before presenting a proposed flow as implemented work.

## Earlier activity visible in Git

| Date | Evidence | What it establishes |
|---|---|---|
| 2026-09-24 | `e2c14ec` | Project organization convention was added. |
| 2026-09-30 | `93a7eff` / [PR #14](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/14) | Team-44 self-hosted CI configuration merged into `main`; earlier September 28–29 commits were branch work. |

These entries are a repository history summary, not a substitute for weekly team reflections.

## 2026-09-30 — GitHub planning review

Open issues and PRs identify four service domains: Location/Housing, Moving, Flight, and Payment. The current graph-demo issue targets a chat flow across them, with same-city moving and mock payment. Several issues report branch-level tests or staging checks, while approval, authentication, persistent state, real housing data, and end-to-end integration remain open. The [work-in-progress map](docs/work-in-progress.md) links the source issues and PRs. These reports do not change the implemented status of the current checkout. The team clarified that a name appearing in branch work was randomly generated and is not the product name.
