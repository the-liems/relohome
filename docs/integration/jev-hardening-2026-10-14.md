# Jev shadow hardening — issue #155

Follow-up to merged #145, based on `main` at `8566aeb`.

## Credential boundary

The dedicated `OPENROUTER_API_KEY`, compatibility `OPENAI_API_KEY` and direct `JevClient`
constructor all require `sk-or-v1-[A-Za-z0-9_-]+` before creating an HTTP client.
An invalid dedicated override does not fall back to another credential. Runtime emits
only `invalid_credential` and leaves the observer unconfigured; normal agent workflows
remain available. The synthetic evaluation CLI uses the same resolver. The format check
is not proof that a credential was issued or remains valid; the provider checks that.

## Runtime privacy and the deliberate coverage trade-off

Runtime has no switch that allows narrative text egress to Jev. It omits raw chat,
fact evidence, names/addresses embedded in narrative and provider assessment prose.
Other arbitrary strings (including location values nested in constraints) become opaque,
projection-local symbols. Their dictionary never leaves the process. Typed domains,
bounded numeric constraints, booleans, valid ISO dates/times and exact allowlisted schema
values remain available. Dates, budgets and constraints can still be sensitive or
identifying in combination: this is data minimization, not a claim of complete anonymity.

Plan observation checks consistency with the structured Intake output. It does **not**
independently prove that Intake accurately interpreted the original user message.
Equal opaque symbols support value comparison; different symbols do not prove different
places. No geocoding or semantic routing is replaced by this privacy projection.

The current Housing/Flight `agent_assessment` contract exposes `reason`/`next_step` prose,
not typed factual claims. Its Jev observation is therefore skipped with
`privacy_insufficient_evidence`. This reduces assessment coverage to zero for that
contract rather than send private prose or return a misleading `grounded`/`clean` verdict.
It does not disable Housing/Flight agents, Roommate, or existing deterministic gates.

The old synthetic harness explicitly uses `synthetic_text=True` for its invented cases.
This keyword is not an API/runtime setting and must never be used on real threads.
Historical v1 semantic smoke accuracy is not calibration for this v2 structured policy.
Restoring narrative grounding/injection observation needs a separately reviewed privacy
design; enforcement before tool consumption remains out of scope here.

## Operational metrics without an additional request/network dependency

The observer emits `jev_metrics {JSON}` to the existing logger/stderr every 60 seconds
after the first observation and once on shutdown. There is no public metrics route, new
dependency, LLM call, retry, or deployment/config activation. The timer runs in fresh
contextvars and is canceled/joined with the observer. Skip-only traffic is exported too.
Originally these were stderr-only snapshots. Issue #160 adds direct fixed-label
OTEL instruments and provisioned Grafana panels through the existing Collector;
see [observability runbook](../runbooks/observability.md#jev-shadow-metrics).
Snapshots remain for local diagnostics; do not ship arbitrary log messages to Loki
or weaken log sanitation to recover them. No public Prometheus scrape route is added.

Each fixed point (`plan`, `assessment`) has cumulative process-local counters:

- `seen`: invocations, including deterministic/unsupported and duplicate exclusions.
- `eligible`: eligible observation attempts except duplicates of already-submitted points.
- `submitted`, `completed`, `timeout`, `provider_error`, `connection_error`,
  `invalid_response`, `response_limit`, `unavailable`, `internal_error`, `cancelled`.
- `skip_reasons`: fixed reasons including `deterministic`, `unsupported_domain`,
  `no_assessment`, `closed`, `missing_scope`, `turn_limit`, `ledger_full`, `overload`,
  `not_applicable`, `privacy_insufficient_evidence`, `projection_skipped`.
- `in_flight` and `coverage_ratio = completed / eligible` (null without eligible traffic).

This ratio is **attempt coverage, not the percentage of all user chats or unique turns**.
Overload/privacy/projection failures are in its denominator; already-submitted duplicates
and non-LLM/unsupported exclusions are not. A skipped attempt can be offered again, so do
not sum this as a unique-turn counter. Completed means a valid Jev response, not a safe
task or a blocked attack. No scope/user/thread/request identifiers are metrics labels.

Counters reset on process restart. Aggregate counters across workers before computing a
rate; do not average each worker's ratio. For a time window use counter deltas and handle
restarts. During live traffic, pending tasks can lower coverage temporarily. Shutdown
cancellation (including before the network coroutine starts) is accounted for separately.
Provider timeout billing remains unknown without provider-side reconciliation.

## Behavior unchanged

Default `AGENT_GUARDRAIL_MODE=off`; still only `off|shadow`. No automatic local/staging
activation or enforcement. Existing owner/approval/revision/hash/TTL/idempotency and
moderation checks remain authoritative. Typed UI paths still add zero Jev requests.
No API/DB schema, backend transaction semantics, or CI/deployment settings are changed.

## Verification

See [offline verification](../../eval/jev-hardening-2026-10-14.md).
