# Moving auto-suggestion: large catalogs (#226)

Historical #227 behavior below. The follow-up [whole-request budget fix (#242)](moving-selection-request-budget.md)
replaces the catalog/context/request character gates with one serialized UTF-8
request byte budget; lossless factoring and the no-first-N policy remain intact.

## Cause

The form previously stopped before LLM selection whenever its decision catalog
had more than 50 services or 20,000 JSON characters. Repeated descriptions,
district lists and operational restrictions could hit that limit with just a
few services. This was an application guard, not an AhaMove rejection.

## Change

- Keep every observed service ID and every fact in the existing redacted decision
  projection. No first-N shortlist, capacity inference from IDs or city allowlist.
- `catalog_defaults` contains only fields present and identical on **all** services.
  Missing restrictions remain unknown. Merge each service's constraint overrides.
- Explicit per-service `fact_refs` / `constraint_refs` point to `catalog_facts`
  for long repeated values within subsets. Nested provider objects stay opaque;
  a provider key that looks like a reference is not interpreted by code.
- The short selection prompt explains this representation and continues treating
  all catalog/user content as untrusted data. Round-trip tests reconstruct the
  exact projected facts, including false/zero/null, required options and remarks.
- Remove the 50-service cutoff. Keep the 20,000-character compact catalog and
  24,000-character context limits; additionally bound the serialized model request
  (including tools/ID enum/instructions) to 32,000 characters. These are character
  budgets, not token counts. An irreducible over-limit request asks for an explicit
  service before consuming a model call; it never silently drops alternatives.
- Retain one generation and one provider-authoritative estimate of selected IDs.
  Explicit user selection still uses zero generations. The exact route/schedule,
  user notes, price provenance, usage ledger and exception/cancellation behavior
  are unchanged. No order/payment action or new runtime variable is introduced.
- The UI footer no longer hard-codes `staging`. Its neutral wording does not
  assert which provider environment is actually configured or enable real orders.

## Offline verification

Synthetic repeated-rule catalogs previously refused by main now select an
observed service at the end of the catalog with one generation:

| Services | Projected JSON before factoring | Compact catalog |
| --- | --- | --- |
| 2 | about 23.4k characters | about 11.9k characters |
| 60 | about 443k characters | about 14.8k characters |

These are synthetic fixture sizes, not a capture of the affected production
catalog and not a measurement of model token usage/latency. Tests fake both
model and provider; no live AhaMove quote, order, payment or LLM request is made.

Coverage includes >50 small services, large shared restrictions, subset references,
missing/conflicting facts, type-preserving reconstruction, irreducible catalogs,
oversized tool enums, redacted liftgate/closed-body notes, selecting the final
observed ID, explicit selection, real HTTP-form -> LangGraph execution, both
memory/SQLite ledgers, crash accounting, concurrency, invalid IDs and cancellation.
Browser tests cover the neutral footer in VI/EN on desktop/mobile and existing
picker/auto-suggestion form behavior. The entire agent suite is also run.

Local results: 577 agent tests passed / 1 existing skip, 49 web contracts passed,
6 targeted browser cases passed, web production build passed, and Ruff checks
passed for the changed Python files. No live provider/model test was enabled.

## Deployment / diagnosis

Normal backend/web deployment after CI/review; no env change or DB migration.
The code does not modify `AHAMOVE_ENV`, credentials, endpoints or payment modes.

In Langfuse: `moving_quote_agent` -> output `task_results` -> task -> `data` ->
`agent_trace.catalog_selection`. Only safe counters/status are recorded:
`service_count`, `projected_chars`, `catalog_chars`, `shared_fact_count`,
`context_chars` and `request_chars` when reached. Status is `prepared`,
`catalog_limit`, `context_limit`, `request_limit` or `ready`. `ready` means the
selection payload passed size validation, not that the provider accepted a quote.
No raw restrictions, contact details or service IDs are added to these diagnostics.

If the real catalog remains irreducibly oversized, retain its safe diagnostics
and use explicit selection; do not remove restrictions or raise limits blindly.
Live model quality and the actual affected catalog still need a post-deploy smoke
test by an authorized tester. Rollback is code-only.
