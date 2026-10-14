# Observability hardening — issue #160

Base: `main` at `331f03d`. Isolated branch: `fix/160-observability-hardening`.

## Changes

- Python/Node and application Compose now default to metadata-only telemetry.
  If APP_ENV or OTEL_DEPLOYMENT_ENVIRONMENT is production, content is omitted even
  for legacy redacted/raw configuration. Traces, usage, durations and business
  responses remain. Compose propagates APP_ENV consistently across services;
  the production Collector additionally drops input/output attributes under its
  authoritative environment (defense for legacy SDK exports, not retroactive erasure).
  Non-production diagnostic modes remain explicit opt-ins;
  patterns cannot reliably anonymize names/addresses. Old stored traces are not erased.
- Jev emits fixed-enumeration event/skip counters and an in-flight up/down sum
  directly via existing OTEL. No request ID, user/session ID, text, key, coordinate,
  model rationale or exception message is a metric label. SDK failure is fail-open.
  Scope/coverage semantics and privacy assessment skips are unchanged.
- Collector allowlists point/event/reason metric labels. Native Grafana panels
  show coverage for active process lifetimes, skips, outcomes and pending work.
- The local Node service launcher preloads the existing registration module before
  importing HTTP/Fastify/pg. Missing-build validation checks the entrypoint, not
  the new --import flag. Schema check and migrate commands are unchanged.

## Review correction

The prior Uvicorn-only probe ran before `build_guardrail()`. That function already
sets the Jev logger to INFO when the observer is enabled. The claim that default
Uvicorn permanently prevents Jev logs was incorrect. The actual integration gap
was that MetadataLogHandler intentionally discards arbitrary message bodies,
including snapshots; direct metric instruments solve it without exporting log text.

## Boundaries and handoff

No API/MCP contract, database, agent orchestration, LLM decision, enforcement,
transaction, `.env.local`, credential, deployment or observability activation change.
No new dependency, destination or foreground await. Update/redeploy application
images for SDK changes; update the separately deployed Collector and Grafana stack
for label allowlisting/panels. Existing deployed resources do not update merely by
merging this PR. Keep export disabled until the existing stack is ready.

Collector rules use the standard [OTTL delete_key editor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/ottlfuncs/README.md#delete_key),
without weakening existing log sanitation or adding arbitrary labels.

Validation evidence is recorded in the PR. Windows tooling/CRLF/cache findings
from the broader main review are separate and not hidden as a green full suite.

## Verification (2026-10-14)

- 817 Python regression tests passed; 8 live/PostgreSQL integration skips, one
  existing Starlette/AnyIO deprecation warning. Includes Agent, Checkout, Roommate,
  API, Gateway, package boundaries, local launcher and telemetry suites.
- 11 Node telemetry tests passed, including real OTLP subprocess fixtures for
  default metadata and production legacy redacted/raw modes. TypeScript workspace
  build, Ruff and diff whitespace checks passed.
- Actual Python OTLP wire tests confirm fixed-label Jev counters and balanced
  in-flight values, no synthetic private canaries in exported signals, and preserved
  LLM token usage. They use a fake model/Jev and a loopback receiver, not providers.
- Collector 0.162.0 (the pinned image) validated the production config offline with
  network disabled, read-only filesystem, 256 MiB memory limit and fake credentials.
  No full Langfuse/Cortex/Grafana/S3 deployment or dashboard-query smoke was run.
- Synthetic admission microbenchmark: 500 completed fake observations per mode.
  Metrics disabled: p50 0.0219 ms, p95 0.0354 ms; in-memory OTEL metrics enabled:
  p50 0.0465 ms, p95 0.0648 ms. This times `_observe` with an empty fake projection,
  not full projection cost, actual HTTP/model latency, user-visible response time,
  correctness calibration or production load. No extra model calls/foreground awaits.

Test environment is an ignored venv in this worktree with editable packages pointing
here and plain dependency paths to the root venv. The root runtime/editable installs,
dirty user files, `.env.local` and DB are not changed. No real user data, paid
providers, orders, payment, staging deployment or observability activation was used.
