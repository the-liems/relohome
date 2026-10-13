# Project organization: specifications, decisions, and delivery

Status: proposed working convention.

The file layout below is a proposal. The current documentation index is
[docs/README.md](README.md); entries for specs, ADRs, contracts, and runbooks
describe future files and do not imply those files already exist.

This document describes the organization of project specifications, architecture
decisions, contracts, work tracking, and delivery milestones. Requirements and
decisions live in version-controlled files; implementation tasks and delivery
progress live in GitHub Issues, Milestones, and one Project.

## Foundation in the technical guide

Follow the repository's technical guide for shared conventions:

- [Chapter 2: project setup](guide/chapter-02.md) defines `docs/architecture/`,
  `docs/api/`, and `docs/adr/`, and recommends preserving the application layout,
  Git workflow, testing setup, and CI unless a change is justified.
- [Chapter 3: architecture](guide/chapter-03.md) provides the ADR template,
  numbering, statuses, and rules for recording and superseding decisions.
- [Chapter 10: planning](guide/chapter-10.md) describes product requirements,
  architecture, implementation, and delivery planning. BMAD is optional.

The project-specific conventions below define capability specs, acceptance IDs,
issue ownership, board fields, and milestone outcomes. Use `apps/`, `packages/` and `examples/` as described in the
[development map](../DEVELOPMENT.md) and [ADR-025](adr/ADR-025-monorepo-layout.md).
Document further application-layout changes in an ADR before migrating.

## Where each kind of information belongs

| Artifact | Question it answers | Source of truth |
|---|---|---|
| Product brief / PRD | What are we building, for whom, and what is outside the MVP? | `docs/product.md` |
| Spec | What must a capability do, including failures? | `docs/specs/` |
| ADR | Why did we choose this technical approach? | `docs/adr/` |
| Architecture | How does the current system fit together? | `ARCHITECTURE.md` overview; detailed designs and diagrams in `docs/architecture/` |
| Infrastructure and delivery plan | How will local development, CI/CD, and hosted environments operate? | `docs/architecture/infrastructure.md`; Coolify scaling/cutover gates in `docs/architecture/migration-options.md` |
| API contracts | How do services exchange data? | `docs/api/` for supplementary documentation, service specifications, and examples |
| Issue | What concrete work needs doing, and who owns it? | GitHub Issues |
| Milestone | What must work end to end at this checkpoint? | GitHub Milestones |
| Roadmap | In what order will capabilities arrive? | `docs/roadmap.md`, linking to milestones |
| Project board | What is ready, active, blocked, or awaiting review? | One GitHub Project |
| Journal and worklog | What did we learn and contribute? | `JOURNAL.md` and `WORKLOG.md` |

Avoid copying task status into specs, roadmap tables, and worklogs. Link to the
issue that owns that status. The roadmap explains sequencing; GitHub tracks actual
delivery progress and dates.

## Proposed file layout

The layout below defines document locations and naming conventions. Add documents
as their capabilities and decisions are developed.

```text
README.md                         # Setup and navigation
ARCHITECTURE.md                    # Current architecture and labeled future design
CONTRIBUTING.md                    # Development and review workflow
JOURNAL.md                         # Weekly learning and decisions
WORKLOG.md                         # Contributions linked to issues and PRs
apps/                             # Runnable applications
packages/                         # Shared libraries
examples/                         # Supported demos and static references

docs/
  README.md                       # Documentation index
  project-organization.md         # Structure and working conventions
  product.md                      # Product brief / PRD: users, MVP, non-goals
  roadmap.md                      # Outcomes and links to milestones
  architecture/                   # Detailed designs and diagrams
    infrastructure.md             # Coolify-first delivery and release contract
    migration-options.md          # Alternative scaling and migration paths
  api/                            # Supplementary API documentation
    openapi/                      # Mock/external service specifications
    examples/                     # Representative requests and responses
  specs/
    README.md                     # Spec index and lifecycle
    _template.md
    SPEC-001-goal-understanding.md
    SPEC-002-knowledge-retrieval.md
    SPEC-003-planning-and-execution.md
    SPEC-006-workflow-progress.md
    SPEC-008-service-tools.md      # Shared service, approval, and recovery contracts
  adr/
    README.md                     # Decision index
    _template.md                  # Based on the Chapter 3 ADR template
    ADR-001-workflow-state-and-persistence.md
    ADR-002-service-adapter-boundary.md
    ADR-003-approval-and-idempotency.md
  runbooks/
    local-development.md
    demo.md
  references/                     # Supporting sources when committed
  guide/                          # Course guide

tests/
  golden_scenarios/                # Executable acceptance scenarios

.github/
  ISSUE_TEMPLATE/
    feature.yml
    bug.yml
    task.yml
  PULL_REQUEST_TEMPLATE.md
  CODEOWNERS
```

## Infrastructure and deployment organization

Follow the [Coolify delivery plan](architecture/infrastructure.md) for actual local
entrypoints, CI, GHCR images, automatic staging delivery, and production promotion.
Its [canonical planned repository structure](architecture/infrastructure.md#planned-repository-structure)
owns deployment paths. These project-specific infrastructure conventions extend
the technical guide; the guide does not mandate this deployment layout.
Use `deploy/` for application runtime configuration and `infra/` for host,
runner, and shared-platform configuration. Keep both on `main` through reviewed
short-lived branches. Provisioning and application releases have separate
authorization and lifecycles; credentials and infrastructure state stay out of Git.

The [Coolify scaling and migration options](architecture/migration-options.md)
cover host resizing/relocation and multi-server qualification with common data
cutover and recovery gates. Create the selected destination's configuration when
implementation begins; planned directories do not establish deployed infrastructure.

## Specifications

Use `docs/product.md` for the product brief and overall requirements: problem,
target users, use cases, MVP scope, and non-goals. Link its capabilities to their
detailed specs.

[SPEC-008](specs/SPEC-008-service-tools.md) owns service integration, approval binding, idempotency, and compensation semantics. It replaces the former SPEC-004/005 placeholders in this layout while preserving its existing acceptance IDs. Orchestration, persistence, and UI specs should reference these shared rules instead of redefining them.

Write one spec per coherent capability, including behavior across module and team
boundaries. For example, approvals and recovery involve planning, backend,
persistence, and the user interface; those components need one shared behavioral
contract.

Each spec should contain:

- Stable ID, title, accountable owner, status, and relevant reviewers.
- Problem, scope, and explicit non-goals.
- User flow and expected behavior.
- Interfaces and links to canonical schemas.
- Failure cases, security requirements, and relevant operational limits.
- Numbered acceptance criteria.
- Open questions and links to ADRs and the implementation parent issue.

Use `Draft`, `Accepted`, and `Superseded` as spec statuses. Acceptance means the
team agrees to the requirements; implementation progress belongs in Issues.
Update an accepted spec through a reviewed PR when its requirements change.

Give acceptance criteria stable references, such as `SPEC-008/AC-06`:
"Missing, expired, mismatched, or unauthorized approval prevents a paid action." Issues and tests
can then identify the exact requirement they implement or verify. Do not renumber
existing criteria when inserting new ones.

Keep internal types authoritative in their Python/Pydantic definitions. FastAPI's
generated OpenAPI describes the backend endpoints; `docs/api/` holds supplementary
explanations and service integration contracts. For mock services, choose either
contract-first OpenAPI under `docs/api/openapi/` or generation from service models,
and document which representation is authoritative. Avoid independently
maintaining the same schema in Python, YAML, and Markdown. Specs explain semantics
and link to the schemas.

## Architecture decision records

Store ADRs in `docs/adr/` and use the template and writing rules in
[Chapter 3](guide/chapter-03.md#template-adr). Name files
`ADR-001-short-title.md`, `ADR-002-short-title.md`, and so on. Each record includes
the date, status, context, alternatives, decision, rationale, and consequences.
Add links to related specs and issues where relevant.

Useful initial subjects for this project are:

- Application package layout and module boundaries.
- Responsibilities of LangGraph versus custom DAG execution code.
- Workflow checkpointing and persistence.
- Boundaries between tool definitions, service adapters, and HTTP clients.
- Approval binding, idempotency, and recovery semantics.

Use the guide's statuses: `Accepted`, `Deprecated`, and `Superseded by ADR-XXX`.
Discuss pending decisions in an issue or draft PR before accepting the record.
When a decision changes, create a new ADR and mark the previous one
`Superseded by ADR-XXX`, following the guide's preservation rule. Keep ADRs short
and focused on consequential choices and their trade-offs.

## Optional BMAD workflow

The [BMAD overview](guide/bmad/overview.md) describes analysis, planning,
solutioning, and implementation, with tool outputs in
`_bmad-output/planning-artifacts/` and `_bmad-output/implementation-artifacts/`.
Those directories apply when the team adopts BMAD tooling; they are not required
for this project's documentation workflow.

When using BMAD, link working outputs to the relevant spec or issue. Publish agreed
requirements and decisions in the canonical locations above, and keep task status
in GitHub. Avoid maintaining two independently edited copies of an accepted spec.

## Issues, ownership, and review

Use a parent issue for a capability and child issues for independently reviewable
implementation work. Each actionable issue should have one accountable assignee,
a concrete result, acceptance criteria or spec references, dependencies, and a
milestone when scheduled. Split work that is too large to review coherently.

The four roles below are illustrative planning roles; the team has not assigned members to them:

| Role | Primary responsibility |
|---|---|
| AI/DS 1 | Goal understanding, RAG, memory, personalization |
| AI/DS 2 | Tool routing, planning, DAG execution logic, replanning |
| AI/DS 3 | Data contracts, normalization, ranking, evaluation |
| Backend/Security | API, persistence, credentials, execution controls, recovery, realtime |

Shared contracts need review from the people who consume them. Joint involvement
does not remove the need for one accountable owner per task.

Keep one Project with statuses `Backlog`, `Ready`, `In progress`, `In review`, and
`Done`. Track blocking relationships using issue dependencies. Start with priority
values `P0`, `P1`, and `P2`, and area labels such as `agent`, `rag`, `contracts`,
`backend`, `infra`, and `evaluation`. Add metadata only when it helps planning.

GitHub supports sub-issues and blocking dependencies; see the official
[GitHub Issues documentation](https://docs.github.com/en/issues/tracking-your-work-with-issues/learning-about-issues/about-issues).

For a typical change:

1. Agree on the relevant requirements and any consequential design decision.
2. Create an issue linking the spec, acceptance criteria, and dependencies.
3. Implement through a PR linked to that issue.
4. Include appropriate verification and update affected specs or architecture.
5. Close the issue when its acceptance criteria are met and the change is merged.

Use `.github/CODEOWNERS` to declare review ownership by path, consistent with team
responsibilities and course review requirements. Describe the contribution and
review process in `CONTRIBUTING.md`.

## Course gates and delivery tracking

The [delivery roadmap](roadmap.md) records the team's supplied Gate 1 and G2 announcements, deadlines, and required deliverables. Use those gates for submission planning. Link implementation issues and evidence to the relevant gate; assign task owners and intermediate dates when the team agrees on them.

The former M1–M5 milestone sequence was a planning proposal and is replaced by the announced gates. Internal milestones may be added by team agreement without changing the gate requirements.

Approval enforcement remains required before paid vendor actions. Mock and real actions must be identified in the demo and evaluation evidence, and real side effects require the appropriate execution controls.

## Documentation maintenance

Use `docs/README.md` as the documentation index. Keep the spec and ADR indexes
updated when records are added or superseded. Keep `ARCHITECTURE.md` aligned with
implemented components and link to detailed designs in `docs/architecture/`.
Clearly label future design. Link supporting diagrams from the overview without
duplicating their content.

Store background proposals and analysis documents in `docs/references/`, with
agreed requirements captured in focused specs. Keep project-specific documentation
separate from the course guide in `docs/guide/`.

Link evaluation evidence in `eval/` to relevant acceptance criteria and milestones.
Use `presentation/` for demo materials, `JOURNAL.md` for learning and reflections,
and `WORKLOG.md` for contributions linked to issues and PRs.
