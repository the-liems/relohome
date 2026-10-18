# Moving selection: budget the whole request (#242)

## Reproduction and cause

The supplied production trace reports 19 services, 32,556 projected characters,
29,924 compact catalog characters, 7 shared facts and `status=catalog_limit`.
No model generation or estimate occurred. The raw production catalog was not
provided; tests use an explicitly synthetic 19-service catalog adjusted to
29,924 compact characters, not a claimed capture of those provider records.

The earlier #227 fix factored repeated data and removed the 50-service limit,
but independently enforced 20,000 catalog / 24,000 context / 32,000 request
character limits. A valid, complete selection could stop at the first gate,
regardless of the size of the request eventually sent. Removing only that gate
would still leave the later two. JSON escaping, tool schemas and repeated enum
IDs also contribute to the request, not just the catalog.

## Change

- Retain the lossless catalog projection/compaction and ALL candidates,
  descriptions, vehicle limits, operational restrictions and required options.
- Replace the three overlapping character gates with ONE 64,000-byte budget on
  the compact serialized UTF-8 request. This is an explicit application payload
  policy, not a token count or a model context-window guarantee.
- Measure the exact dictionary passed to `responses.create`, including input
  string escaping, instructions, tools, observed-ID enums and output settings.
  Equality is allowed; one byte over the budget stops before a generation or
  estimate. A Vietnamese character may occupy multiple bytes.
- Construct the model client only after the size check. Keep at most one
  generation, `max_output_tokens=500`, no model retry and the existing tool/ID/
  duplicate validation. Unknown/invented IDs never reach the provider estimate.
- Keep the batched estimate authoritative for route, schedule and price. An
  explicitly chosen service still bypasses model selection entirely.
- Preserve redacted notes and input immutability. No credentials, contacts,
  raw catalog text or observed IDs are added to the diagnostic counters.
- Record `request_bytes`, `request_byte_limit`, `request_chars`, `tools_chars`
  and `catalog_section_chars` (services/defaults/shared-facts numeric sizes).
  Retain existing projected/catalog/context counters for comparison. Oversized
  payloads now report `request_limit`, not an ambiguous earlier catalog gate.
- No new dependency, tokenizer asset download, counting API request, model,
  environment variable, database migration, order or payment behavior.

The 64 KB policy accommodates the supplied approximately 30k-character size
witness plus the full envelope, tools and Vietnamese text, while staying finite.
It can admit a larger model input than before; this change restores functionality,
not a claim that every new selection uses fewer tokens. Actual token/cost usage
continues to come from the provider response and existing ledger.

Official OpenAI guidance notes that complete input includes instructions/tools
and that a local text tokenizer is not an exact complete-request token count:
[Counting tokens](https://developers.openai.com/api/docs/guides/token-counting).
No token-count endpoint is added because the app also supports an OpenAI-compatible
router and an additional network call would add latency. The byte policy is
intentionally named and documented as bytes rather than tokens.

## Verification

- First ran the new 19-service regression against the old implementation:
  failed with `needs_input` instead of `done`, reproducing the early stop.
- The same size witness now reaches one selection and one batched estimate,
  can select the LAST observed service, and reconstructs the entire projected
  catalog exactly. It also exceeds the old context AND full-request gates.
- Cover complete-request exact boundary, UTF-8 multibyte overflow, oversized
  tool enum even when catalog/context alone fit, oversized load/notes/catalog,
  redacted liftgate/closed-body requirements, explicit-service zero-generation,
  invalid outputs, budgets, crashes, cancellation and concurrent forms.
- Exercise HTTP form -> LangGraph -> real agent with the new size witness,
  for both in-memory and SQLite usage ledgers. Model/provider responses are
  fixtures; assertions verify one recorded usage entry and no commit actions.

Local results on main `59cb0ef` plus this change: **597 agent tests passed, 1
opt-in test skipped**; the focused three-file Moving group has **74 passed**.
Ruff lint/format and `git diff --check` pass. The synthetic 19-service witness
without remarks measured 29,924 catalog characters, 30,123 context characters,
34,225 request characters and **42,659 UTF-8 request bytes**: it exceeds all
three old gates but fits the new full-request budget. These are fixture size
measurements, not real model token usage, price or end-to-end latency.

The affected live provider account currently fails token authentication in the
available local environment. No paid model call, live quote or production
deployment is claimed. A post-deploy run with the real catalog is still needed
to confirm provider/model acceptance and record real tokens/latency.

## Deploy / follow-up

Deploy the backend image containing this commit; no env change is needed. In a
fresh Langfuse trace, read `agent_trace.catalog_selection`: expect the 64,000-byte
limit and `ready` for a within-budget request. `ready` means size validation passed,
not that the model or AhaMove accepted the eventual quote. A truly oversized
request still asks for an explicit service without a model charge. Do not remove
vehicle restrictions or silently shortlist the first few records to force a fit.
