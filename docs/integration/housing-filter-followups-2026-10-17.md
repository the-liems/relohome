# Housing filter follow-ups — 17/10/2026

Tracking: [issue #216](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/216).
Base: main `4a14c23` (includes PR #212). Independent of the Moving/prompt PR #215.
No model/provider switch, migration, cloud configuration or transaction change.

## Cause and change

The supplied staging traces `cd7edbf3e929f5530e8753fb3a0d116b` and
`afa7fa4baa8f29040afd6a0f8b2a6a62` use `6dadf31`. They have one Intake, one
Planner and one Property generation, not the earlier invalid `housing_mode`
repair. The initial optimization accepted NEW_GOAL only. Follow-up edits still
paid for two extra decisions despite being representable as ordinary filters.

Intake still interprets language with the same configured model. It may mark an
unranked Housing filter edit/refresh as `retrieval_only`. New numeric/place
values retain exact-message facts; amenities and clearing optional filters use
a small `housing_filter_patch` with explicit add/remove/clear operations and
current-message evidence. No classifier, keyword route or second summary call.

Trusted code validates and merges the patch, retains untouched conditions, and
removes cleared filters from both carried values and facts. An amenity edit is
not a replacement of the entire old amenity list. An explicit empty `must_have`
remains valid, including when the last amenity is removed. Patch data is consumed
within that turn; it cannot be replayed on a subsequent checkpoint.

The planner can reuse the sole search task's identity with the new validated
inputs. Normal capability/grounding validation still runs, as do change-impact,
executor, validator, budgets, result formatting and shadow guardrail hooks.
Only the code-generated plan issues a turn-local task hint to Property; the
model's Intake flag alone cannot authorize direct retrieval. Ordinary model
plans clear that hint. Load-context resets it each turn.

An explicit refresh also invalidates the otherwise reusable fresh result, so
"Tìm căn khác" performs another provider read. It does not promise novel listings
or exclude old homes without an explicit exclusion contract. Unknown location
and real provider failures/empty results remain ordinary provider outcomes.

Changing city invalidates the old district/near pin, place ID and bounding box;
unchanged price/amenities survive. Clearing a near filter also clears its
verified sidebar pin, so it cannot be silently reapplied.

## Safety boundaries

No shortcut for comparison/search_compare, ranking/custom suitability checks,
shortlist filtering rather than a fresh search, home selection, mixed-service
plans, dependencies, committed actions, validation-driven replans, ambiguous
targets or memory-prefilled constraints. Previous non-filter goals, viewing
selections and pending payment also retain the full path. Old checkpoints with
`retrieval_only=false` remain conservative; start a fresh filter search to test.

A zero-generation plan is allowed even when Intake consumed the turn's single
LLM slot. Falling back to a model still fails BEFORE a generation if that slot
is exhausted. Provider/subagent invocation budgets are not increased or bypassed.
Read-only retrieval remains subject to the existing provider and retry guards.

This follows the [OpenAI latency guide](https://developers.openai.com/api/docs/guides/latency-optimization):
remove unnecessary model round trips and use deterministic code for determined
operations. It does not remove semantic Intake or contract/grounding gates.

## Verification

Offline regressions exercise a seven-turn real graph with simulated model/domain
responses: initial search, lower price, add AC, remove AC (keep Internet), change
city, refresh and remove the price cap. Each eligible turn has one Intake call,
zero Planner/Property generations and a fresh provider read. Additional tests
cover last-amenity clearing, old coordinates/place/viewport cleanup, malformed
patches, feature-off fallback, independent threads, full-path safety boundaries
and a one-generation budget. These are control-flow/data-flow tests, not natural
language quality or production-provider benchmarks.

Initial related regression: **928 passed, 16 skipped**, two existing library
warnings, across agent, checkout, Roommate, browser-gateway, standalone service
and this opt-in test file (skipped in the regular run). The new offline file has
44 cases; the existing efficiency file has 38. Ruff check/format and
`git diff --check` pass. Six initial gateway packaging failures came from a reused
venv's editable install pointing to another checkout; a separate worktree venv
with editable packages resolved them without changing those tests or the user's
application venv.

### Review correction: memory must not restore explicitly cleared filters

At the original PR head `14b7e3a`, removing the last location (a near-only search
for Ocean Park 2) removed its facts but allowed `resolve_missing` to prefill the
same landmark from account memory. The graph regression failed with both the
in-memory session store and real SQLite session storage before this correction.

The intake node now persists code-owned `housing_prefill_exclusions` for the
active goal and passes them to the prefill step before missing-field validation.
Cleared filters remain excluded on later turns; only a newly grounded fact or
API-verified location choice can reopen a field. A genuine new goal resets the
exclusions. This does not delete or disable the shared account preference.

Clearing the last location also excludes remembered city/district as a fallback:
ask the user for a new area instead of substituting an unrelated remembered area.
The existing price and other confirmed constraints remain. No planner or provider
call occurs while the location is missing; the one semantic Intake call remains.
No prompt or `IntakeDraft` schema changes, no new model/provider calls or migration.

Twelve additional regression cases cover real graph/memory and SQLite stores,
persistence across later turns and checkpoint model roundtrip, clearing price
then the final scope, explicit reintroduction of the same/different location,
other conversations' remembered city/district, new-goal reset and unchanged
account preferences. No paid model or real domain-provider calls were made for
this correction.

After the correction, the same related regression suite passes **940 tests,
16 skipped**, with the same two existing library warnings. Ruff check/format and
`git diff --check` pass.

### Bounded real-model check

`tests/test_llm_agents/test_housing_filter_followups_live.py` is skipped by default.
Explicit `RUN_HOUSING_FILTER_LIVE=1` uses credentials/model from `--env-test` and
the existing model default when no override is configured. At most nine model
generations per complete run. All domain sources remain fixtures: no real
Housing search, Moving quote, booking, payment or database mutation.

Configured `gpt-6-luna`, five registered domains matching the original traces:

| Turn | Input / output tokens | Graph + fixture wall time | Generations |
| --- | ---: | ---: | ---: |
| New Hanoi search, <5M, Internet | 3,504 / 185 | 3.53 s | 1 |
| Lower price to <4M | 3,664 / 170 | 2.63 s | 1 |
| Add air conditioning | 3,705 / 157 | 2.61 s | 1 |
| Remove AC, keep Internet | 3,751 / 138 | 2.65 s | 1 |
| Switch to Da Nang, keep price | 3,798 / 170 | 2.75 s | 1 |
| Search again | 3,812 / 113 | 2.15 s | 1 |
| Remove price cap, keep Internet | 3,812 / 164 | 3.54 s | 1 |

All seven preserved the exact expected filters and made zero Planner/Property
generations. Two separate real-Intake negatives (Housing + Moving, and a custom
comparison) kept the shortcut off. An earlier harness attempt stopped after its
first graph turn because it read a ContextVar from the parent caller; the test
now measures in the model invocation context and cross-checks the usage ledger.
That initial attempt made three calls including the two negatives, followed by
the seven-turn run above (ten paid generations total during development).

These are not matched before/after measurements or staging latency promises.
Real location resolution/search adds time; larger catalogs/history, registered
Roommate schema, model repairs, retries or hints can increase tokens/calls.

## Rollout and replay

Use existing `AGENT_FILTER_FAST_PATH_ENABLED` (default true). No new server env
variable is required. False disables shortcuts for fresh searches AND filter
follow-ups; typed filter-edit correctness and normal validation remain active.
Local `.env`/`.env.local` were not edited. No automatic merge/deploy.

After review/CI/deploy, verify the running service commit before replaying the
seven steps in a fresh conversation. Intake should have one generation per
eligible turn. Orchestrator and Property nodes still exist but have no child LLM
generation; Property trace shows `implementation=validated-filter-retrieval`.
Check filters on the map, real provider calls/results, exact removed amenities,
unchanged budget, and absence of old geographic pins after a city change. Replay
comparison, selection and mixed-service negatives and confirm their full path.
