# Agent token efficiency — 17/10/2026

Tracking: [issue #202](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/202).

Follow-up extension: [issue #216 implementation and verification](housing-filter-followups-2026-10-17.md)
adds conservative filter edits/refreshes to the initial NEW_GOAL-only shortcut
described below. Historical measurements here remain the initial baseline.

Base: main `713266f` (includes PR #201). No model/provider change, database migration,
business-provider search/quote, booking, payment or cloud configuration change.
Four bounded Intake-only model requests used the existing configured provider;
the first two were discarded because PowerShell damaged input Unicode. The two
corrected requests and their limitations are recorded below. No key was logged.

## Why the two example traces repeated the planner

Both traces contain `property*.housing_mode: not grounded in user constraints`.
An explicit `search` and an omitted housing operation are equivalent, but the
planner grounding checker previously rejected `search` unless Intake emitted it.
The checker now permits only this property-specific default. It still rejects
invented city/budget/amenity filters and unrequested `compare`/`search_compare`.
Genuine validation failures retain the bounded repair path, including feedback.

## Implementation

- Intake instructions are a compact core plus modules for registered services.
  No new classifier, keyword router or summary generation was added. Vietnamese
  evidence/output requirements and per-service input semantics are retained.
- When Roommate is not registered, Intake uses `ScalarIntakeDraft`, excluding its
  nested criteria schema. When Roommate is registered, the full typed criteria
  schema remains available: no JSON-string escape hatch or weakened validation.
- Planner sees complete input schemas for requested and carried domains only.
  The server retains the full capability registry for contract/grounding checks.
- Intake may classify a **new, single-service, filter-only housing list** as
  `retrieval_only`. This is an additive internal hint, default false for old
  checkpoints/requests; it is not consent, transaction authorization or a filter.
- The planner can construct that one task from existing validated filters and
  runs the same contract/grounding validation as for model-authored plans. UUID
  task IDs avoid overwriting history. Refinements, comparisons, replanning,
  previous results, missing inputs, commits and memory-prefilled filters do not
  take this shortcut.
- Property reuses `search_housing_and_return` without generating a tool choice.
  The normal adapter still resolves real locations, asks about ambiguity, enforces
  filters/budgets, reads bounded pages and preserves provider provenance. No
  ranking or model assessment is invented. Usage reports zero property LLM calls
  and counts actual provider calls. The trace identifies
  `implementation=validated-filter-retrieval`.
- Mixed Housing+Moving stays on the full planner/domain path, including when
  Moving lacks required inputs. Missing Moving questions are retained; no home
  is automatically chosen as a destination.

## Offline measurements, not provider-token/latency claims

| Surface | Before | After |
| --- | ---: | ---: |
| Intake instructions, the five services shown in the traces | 14,299 characters | 6,969 characters |
| Intake instructions, property-only runtime | 14,299 characters | 4,466 characters |
| Intake Pydantic schema, no Roommate | 11,457 characters | 3,722 characters |

Character counts are **not token counts**. The SDK's wire schema may add strict
formatting. Registered Roommate still requires the larger schema. Actual input,
output, cache tokens and latency must be measured on the target provider.

The provider-free graph test executes the real Intake/planner/executor/validator
nodes with simulated model/provider responses. It asserts one Intake call, zero
planner/property generations and no commits for the Ocean Park 2 filter search.
The mixed-service graph test asserts that the full planner still executes and
asks for missing Moving data. This proves control flow/accounting, **not** that
the changed prompt has identical natural-language accuracy on a live model.

## Rollback and acceptance checks

`AGENT_FILTER_FAST_PATH_ENABLED=false` keeps full model planning/tool choice for
new searches. The compact prompt/schema and the default-search grounding fix
remain; the flag only disables the read-only execution shortcut. `.env.example`
documents it; existing local secrets/config files were not edited.

Before staging rollout, compare fresh conversations using these cases:

1. `Tìm nhà ở khu Ocean Park 2 dưới 5 triệu`: inspect `retrieval_only`, exact
   filters, real location choices, planner/property call counts and token usage.
2. `Tìm nhà ở Hà Nội dưới 5 triệu`: no invented district or air conditioning.
3. `Tìm nhà và báo giá chuyển đồ tới đó`: both intents retained; ask for missing
   Moving input, do not book or pick a destination automatically.
4. Compare previously viewed homes, new-area `search_compare`, custom travel-time
   requirements and preference ranking: full reasoning path, not facts-only.
5. Change budget/location, select/unselect a home, and continue an existing goal:
   preserve task/history/selection semantics and grounding checks.
6. Roommate natural-language criteria when the service is registered: full typed
   schema, eligibility/contact protections unchanged.

Measure p50/p95 end-to-end **and** LLM/tool durations separately, along with
repair reasons, real generation counts, input/output/cached tokens and result
quality. Do not assume OpenAI caching discounts when routing via OpenRouter.

## Verification in this workspace

- Agent, checkout, Roommate and browser-gateway regression suite: **850 passed,
  7 skipped**. Six packaging failures in the initial run were caused by the test
  virtual environment's editable gateway install pointing at an older worktree;
  reinstalling only that test environment's package resolved them. The user's
  application environment/database was not changed.
- **38 focused tests** cover the actual grounding error, default/mode safety,
  invented filters, selective schema loading, mixed domains, full graph call
  counts, disabled fast path, provider budgets, and provider ambiguity.
- Ruff and `git diff --check` pass.
- Two **real Intake-only** samples with intact Unicode, configured `gpt-6-luna`,
  five registered domains, empty history and at most one call per sample:

| Sample | Input/output tokens | Calls | Intake wall time | Parsed result |
| --- | --- | ---: | ---: | --- |
| Ocean Park 2, below 5 million | 3,212 / 160 | 1 | 3.43 s | Exact near + max price, retrieval_only=true, no conflicts |
| Same search + Moving quote to that home | 3,226 / 220 | 1 | 2.92 s | Both domains, original housing filters, quote mode and selected-home reference, retrieval_only=false, no conflicts |

These timings are **not** end-to-end search/quote latencies or an A/B benchmark.
The earlier trace's rounded 8k tokens is not a matched baseline measurement.
Live samples cover two parses only; they do not establish broad natural-language
accuracy, multi-turn behavior or staging deployment success. Trace export was
disabled during this bounded local check.

Rationale: fewer serial requests and classical code for deterministic steps,
consistent with [OpenAI latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization).
Safety checks remain in code; shortening instructions is not a substitute for them.
