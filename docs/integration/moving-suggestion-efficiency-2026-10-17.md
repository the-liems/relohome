# Moving suggestions and scoped task prompts — 17/10/2026

Tracking: [issue #214](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/214).
Base: main `6dadf31` (includes PR #204). No model/provider, schema/DB migration,
authorization, booking/payment, deployment or real domain-provider change.

## Trace diagnosis and implementation

Trace `942ef6cb860a8daa74b7f6d7a4c97b7e` shows three Moving generations
(1.48 + 2.36 + 1.59 seconds), about 19k total tokens, 9.82 seconds end-to-end.
The screenshot shows the last generation calling `estimate_move`; it does NOT
establish what the first two called. In code the confirmed form pins already
supply both coordinates: endpoint preparation does not call a model or geocode
them again. Discovery is at pickup; the provider estimates the full A→B route.
Do not replace this with an assumption that all points in three cities work.

Previously auto-suggestion entered a model-driven tool loop and could read two
service details sequentially, carrying results into subsequent generations.
The new structured-form path is:

1. Existing code validates request, route, confirmed pins and future schedule.
2. Existing pickup-specific TRUCK catalog/cache supplies real candidates.
3. One model decision selects up to three observed service IDs (or asks one
   necessary question). Only estimate/ask tools are exposed, not detail reads,
   order operations, changed route, price, contacts or approval arguments.
4. Exact schema, membership, duplicate and count checks run in code before the
   existing batched `estimate_move`/`service_selection`. Provider validates actual
   route/time/serviceability; code returns its real prices/warnings/expiry.
5. Existing facts-only completion finishes, without another model generation.

An explicitly chosen service still bypasses the model, including when no model
key exists. Conversation-mode quote, catalog and order-status retain their tool
loop with the same bounded repair/rejection rules. A form provider refusal asks
for input or fails according to the existing transport/retryable contract; no
hidden second model selection or automatic service retry is introduced.

The model-only catalog projection keeps every candidate's ID/name/description,
delivery type, COD limit and observed operational constraints: vehicle info,
distance/stops/value limits, cross-city/district availability, hours/truck bans,
required service requests/proof fields. Required-request options are included
when indicated. Raw provider payloads, fleet debug and presentation assets are
not selection context. Originals remain untouched for validation/provider calls.
Unknown capacity/coverage stays unknown; there is no load-fit guarantee or
automatic booking. No first-N candidate fallback or service-ID-prefix guessing.

No speculative detail prefetch was added: the selection uses observed catalog
metadata and leaves final feasibility to the quote endpoint. This avoids extra
provider calls just to assemble model context. A future detail-prefetch path
would need separate budget/concurrency and quality evidence.

Catalogs over 50 candidates or 20,000 model-projection characters ask the user
to choose a package rather than silently dropping alternatives/restrictions.
Full selection input over 24,000 characters does the same. These are character
safety bounds, NOT a token guarantee. There is no new server environment flag.

## Prompt audit

Instructions are now in `agents/task_prompts.py` with role core + typed domain/
mode modules. No classifier call, keyword router, prompt-compression model or
runtime summarizer is used. Instructions use concise English with explicit
Vietnamese question/assessment requirements. These are semantic rewrites, not
a proof of exact behavior equivalence; retain code validation and run evals.

| Runtime instruction surface | Before, characters | After, characters |
| --- | ---: | ---: |
| Planner: Property | 8,275 | 2,566 |
| Planner: Property + Moving | 8,275 | 3,230 |
| Planner: all six domains | 8,275 | 4,745 |
| Property read core + domain | 3,380 | 2,166 |
| Flight read core + domain | 3,157 | 1,981 |
| Map read core + domain | 2,843 | 1,841 |
| Payment read core + domain | 2,731 | 1,692 |
| Moving form selection | 1,699 | 872 |
| Moving conversational quote | 1,699 | 1,066 |
| Moving catalog / order lookup | 1,699 | 965 / 966 |

Counts compare literal instruction strings (including the joining newline), not
schemas, tools, user history or tokens. Planner modules are chosen by requested
AND carried previous-plan domains, matching the existing schema filter. Read
agents get only their domain. Moving gets only its actual mode. Repair feedback
and provider facts remain separate data, never system instructions.

Other audited surfaces:

- Active Intake was already scoped/shortened in PR #204; unchanged here, including
  Roommate conditional typed schema and multi-service extraction.
- Roommate execution uses deterministic typed services, not a separate domain
  LLM/system prompt. Its planner module retains read-only/consent restrictions.
- JEV atomic question policies are already short, versioned and shadow-only;
  unchanged. Removing independent safety questions to save tokens is out of scope.
- `apps/intake-api` / `apps/orchestrator-api` have separate service-contract
  prompts, not the graph path in the supplied traces. Audited, not rewritten into
  graph prompts; their distinct evidence/registry contracts remain intact.
- MCP server instructions describe tool contracts; they are not extra model
  generations and were not modified as part of this runtime optimization.

Preserved semantic rules: exact grounded filters/IDs; no synthetic provider
facts/approval; separate search/compare/search_compare IDs and selection roles;
mixed-service retention and ready-domain/dependency handling; verified map
bindings and unchanged pickup/dropoff roles; real airport/round-trip price scope;
unknown utilities/fees/fit remain unknown; straight-line distance vs travel time;
OSRM estimates vs live traffic; backend-owned payment IDs; sandbox not real money;
read-only Roommate criteria with no contact/publish/request or financial action.

## Verification

### Review correction: retain vehicle requirements in remarks

The initial compact form-selection context omitted `moving_options.remarks`.
This could hide requirements such as a lift gate or excluding open-bed trucks
until after vehicle selection, even though the provider draft retained the note.
Restore the complete note as a separate user-data field before selection, using
the existing PII redactor; do not interpolate it into system instructions.
Phone numbers and email addresses are covered by these regressions; the existing
redactor is not a guarantee of removing every personal name or address.

Four regressions fail on the original PR head and pass after the correction:
direct agent requests with/without contact details, and HTTP form through the real
LangGraph path with memory/SQLite usage ledgers. They verify the vehicle request
reaches the model before selection, contacts are redacted, provider notes remain
intact and usage stays at one generation/two provider calls. These fixture tests
verify data flow, not that a real model guarantees vehicle suitability.

Offline tests exercise the real agent/graph with fixture model/provider responses:
one vs zero generations; batched observed IDs; no geocoding for confirmed pins;
no hidden retries; invalid/duplicate/excess/unknown IDs; malformed model responses;
provider refusal, required questions, budget/timeout/cancellation; unchanged
conversation catalog/order paths; projection immutability/privacy; prompt scope
including carried domains; and memory/SQLite crash usage with quota blocking.

Final local regression after the review correction: **924 passed, 18 skipped** across agent, checkout,
Roommate, browser-gateway, standalone agent-service and opt-in prompt-eval tests
(the seven paid cases skip in this run). The two new offline files contain 47
cases; the existing crash-ledger test gains six auto-suggestion cases. Ruff
check/format on all nine changed/new Python files and `git diff --check` pass.
Concurrent form requests also retain independent routes/usage on a shared agent.

Run the regular regression suite with live tests disabled. The optional file
`tests/test_llm_agents/test_compact_prompts_live.py` defaults to skip; explicitly
set `RUN_COMPACT_PROMPT_LIVE=1` to use the configured model with synthetic domain
fixtures. Each planner/form case permits one generation; Property permits two.
It loads no real domain client and performs no actual quote/search/transaction.
Do not enable this flag in the server or ordinary CI.

### Limited real-model check (7 passed)

Configured `gpt-6-luna`, synthetic catalog/provider and grounded Intake facts:

| Case | Model calls | Input / output tokens | Wall time |
| --- | ---: | ---: | ---: |
| Moving base comparison | 1 | 525 / 32 | 2.44 s |
| Oversized load requiring a fit guarantee: asked user, no estimate | 1 | 530 / 55 | 1.78 s |
| Planner Housing + missing Moving | 1 | 2,332 / 69 | 2.57 s |
| Planner compare two known homes | 1 | 1,823 / 61 | 2.00 s |
| Planner independent nearby Map | 1 | 1,583 / 74 | 2.26 s |
| Planner round-trip Flight | 1 | 1,338 / 87 | 2.20 s |
| Property facts-only tool selection | 1 | 950 / 21 | Not separately timed |

This is NOT a matched old/new benchmark, full real-provider test or claim that
staging will take 2.44 seconds. The fixture catalog is much smaller than a real
catalog. Seven cases cannot establish broad Vietnamese, multi-turn, comparison
or domain-quality equivalence. An initial attempt was invalidated by the offline
test suite's dummy key override; the opt-in loader now checks for a real key
before sending. No real key/contact was printed or included in model context.

## Rollout / recovery

- Deploy only after CI/review. Check deployed service version; merging alone does
  not establish successful deployment.
- Replay the original real form without/with explicit service: inspect actual
  `usage.llm_calls`, input/output tokens, `agent_trace.strategy`, tool timings,
  quote options, unknowns and provider warnings. Auto form normal path should be
  `single-decision` with one generation; selected package `explicit-service` zero.
- Try unavailable routes, cross-city points, time restrictions, COD/add-ons,
  ambiguous locations, custom load/fit requests, mixed-service followups,
  comparison identity, Map routes and Flight/Payment uncertainties.
- Measure p50/p95 model and provider times separately along with output quality,
  not just total tokens. Do not assume OpenRouter has OpenAI's cache behavior.
- Recovery is a normal revert of this PR; no database migration or extra server
  environment setup is required. The separate Housing fast-path flag from #204
  controls Housing only, not this Moving change.

Design follows fewer sequential requests and task-relevant input, rather than
assuming prompt length alone determines latency: [OpenAI latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization).
