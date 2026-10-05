# SPEC-004 — AhaMove moving-service integration

## LLM subagent extension (2026-09-29)

`src/agents/subagents/services/moving_llm.py` adds a graph-contract-compatible,
read-only LLM tool loop. It is distinct from the TypeScript MCP/API and is not yet
registered in graph wiring. See [ADR-018](../adr/ADR-018-llm-first-agent-components.md)
and [handoff](../integration/llm-agents-handoff.md).

- `SPEC-004/AC-22`: LLM chooses observed read tools within per-task call/deadline
  limits; unknown service IDs, generated code and provider writes are unavailable.
- `SPEC-004/AC-23`: Quote amounts, distance, duration and fee breakdown come from
  actual MCP results; missing capacity/loading information stays unknown.
- `SPEC-004/AC-24`: Parse actual nested Partner estimate envelopes as well as flat
  responses; reject errored options/missing price/ID rather than fabricate values.
- `SPEC-004/AC-25`: Test the real LLM -> MCP -> AhaMove staging -> PostgreSQL path
  using an operator-approved route/contact, without creating an order or mocking data.

- Owner: Moving/Relocation service owner
- Reviewers: Agent planning, contracts, backend/security, Map service
- Status: Draft
- Parent issue: To be created
- Related ADRs: ADR-001, ADR-002, ADR-003, ADR-004, ADR-005
- Canonical schemas: `Maps VN/LifeFlow/packages/contracts/src/moving.ts`

## Problem

LifeFlow needs factual moving-service discovery, quotes, booking and lifecycle
tracking. The agent must be able to collect pickup and destination details,
compare available vehicles, present complete costs, obtain an explicit user
decision, create no more than one external order, and recover when provider
responses or callbacks are delayed.

## Scope

- AhaMove API v3 staging integration.
- City, service, vehicle and special-request discovery.
- Immediate and scheduled orders.
- One pickup and one or more delivery points.
- Contacts, coordinates, address details, items, package dimensions, weight,
  declared value, COD, insurance-related fields and proof requirements.
- Multi-service fee estimation with complete provider fee breakdown.
- Create, read, batch read, lookup by tracking number, tracking link, callback
  history, allowed order updates, cancellation and driver rating.
- Webhook ingestion, deduplication and normalized order persistence.
- MCP tools over stdio and authenticated HTTP, with one independent Moving MCP server.
- Independent MCP/API images, one-off migrations and container readiness.

## Non-goals

- Letting the LLM register accounts, request tokens, inspect credentials or call
  arbitrary provider URLs.
- Automatic provider recommendation or invented availability.
- Payment-gateway implementation.
- Enabling production before AhaMove UAT and an explicit configuration change.
- Refactoring the existing Housing/Map MCP server in this capability.

## User flow

1. Resolve pickup and destination coordinates through the Map service.
2. Query current AhaMove services and special requests.
3. Submit one factual estimate request for all eligible service candidates.
4. Validate completeness and freshness of the quote.
5. Present distance, fees, constraints and alternatives to the user.
6. Store an approval bound to the chosen quote, service, cost and action.
7. Create the external order using an idempotency record.
8. Observe progress using webhooks and factual reads.
9. Require a separate approval for material updates or cancellation.

## Interfaces

The Moving MCP tool catalog and schemas are documented in
[`../api/ahamove-v3-integration.md`](../api/ahamove-v3-integration.md). AhaMove
provider payloads are mapped inside `packages/moving-service`; callers use the
provider-independent models in `@lifeflow/contracts`.

## Failure and recovery

- Read operations may be retried only for transient failures and with bounded
  backoff at the caller boundary.
- Create is never blindly retried. An ambiguous result is reconciled through a
  unique partner tracking number before any further attempt.
- Duplicate or replayed callbacks are ignored by event hash.
- The raw provider status is retained. Unknown new statuses do not become a
  fabricated known state.
- `ACCEPTED` may return to `ASSIGNING` during AhaMove rebroadcast.
- Order-level completion and each delivery-point result remain distinct.

## Security and operational limits

- Staging is the default and production requires
  `AHAMOVE_PRODUCTION_ENABLED=true`.
- Write tools require `AHAMOVE_WRITE_ENABLED=true` plus a stored, unexpired,
  payload-bound approval.
- Rating additionally requires `AHAMOVE_RATING_ENABLED=true`.
- API keys, tokens and webhook credentials are never tool inputs or outputs.
- Audit records contain input key names, outcome, duration and error code only.
- Provider hosts are allowlisted by environment.
- Webhook credentials are compared in constant time.

## Acceptance criteria

- `SPEC-004/AC-01`: Service discovery is obtained from AhaMove at request time
  using city or pickup coordinates; vehicle/service IDs are not hardcoded.
- `SPEC-004/AC-02`: A quote contains pickup, ordered destinations, provider
  service, distance, currency, distance fee, stop fee, special-request fee, COD
  commission, discount, subtotal, total price and total payable when supplied by
  the provider; absent values remain unknown rather than becoming zero.
- `SPEC-004/AC-03`: Items, quantity, declared value, COD, package weight and
  dimensions, scheduled time, special requests and route optimization can be
  represented without an untyped arbitrary request.
- `SPEC-004/AC-04`: `create_move_order` rejects a missing, expired, consumed or
  payload-mismatched approval before calling AhaMove.
- `SPEC-004/AC-05`: Repeating the same workflow/action does not create a second
  AhaMove order.
- `SPEC-004/AC-06`: A transient error after create is reconciled by partner
  tracking number and is never blindly retried.
- `SPEC-004/AC-07`: Updates are blocked outside `IDLE`, `ASSIGNING` and
  `ACCEPTED`, and require a separately stored approval.
- `SPEC-004/AC-08`: Cancellation is blocked outside AhaMove cancellable states,
  requires a standardized reason and a separately stored approval.
- `SPEC-004/AC-09`: Duplicate webhooks are idempotent, multi-drop callback
  suffixes map to the base order, and raw delivery-point status is preserved.
- `SPEC-004/AC-10`: Secrets do not appear in MCP results, audit input summaries,
  application logs, examples or committed configuration.
- `SPEC-004/AC-11`: Moving runs as a separate MCP process while consuming shared
  contracts and the shared MCP behavior package.
- `SPEC-004/AC-12`: No mock AhaMove data or mocked AhaMove HTTP test is used;
  provider integration evidence comes from opt-in staging tests and UAT.
- `SPEC-004/AC-13`: Production and all write operations are disabled by default.
- `SPEC-004/AC-14`: Every tool publishes accurate read-only, idempotent,
  destructive and open-world annotations.
- `SPEC-004/AC-15`: A network MCP read client lists 9 read tools; a separately
  authenticated write client lists all 13 tools through `/mcp`. Read credentials
  cannot invoke write tools. Missing/incorrect bearer tokens and disallowed
  Host/Origin headers are rejected before tool execution.
- `SPEC-004/AC-16`: Separate MCP/API images run non-root with runtime-only secrets;
  `/health` works without database connectivity, while `/ready` reports HTTP 503
  when the schema, runtime grants or required webhook configuration is unavailable.
- `SPEC-004/AC-17`: A separate migration job initializes Moving and audit without
  requiring Housing/Map, serializes concurrent migration jobs and rejects changed
  migration checksums. Repeating the job preserves existing data.
- `SPEC-004/AC-18`: CI builds affected Moving images; documentation/test-only changes
  do not publish images. Real staging verification is opt-in in a trusted environment.

## Open questions

- The trusted backend registers user approval through the internal approval API;
  the integrating graph must authenticate the user before supplying `approved_by`.
- Which webhook authentication mode will AhaMove configure for the partner?
- Which staging pickup/destination set will be used for the team's UAT evidence?

## Integration requirements (2026-09-29)

- `SPEC-004/AC-19`: `POST /v1/internal/moving/approvals` requires a dedicated
  backend credential, validates the canonical Zod request and binds action,
  payload, owner and expiry (future, at most 30 minutes). Identical registration
  is idempotent; conflicting reuse returns 409 and cannot reset consumption.
- `SPEC-004/AC-20`: No same-city restriction is inferred from administrative
  boundaries. Availability comes from the provider's service discovery and route
  estimate. This does not promise all intercity routes are supported.
- `SPEC-004/AC-21`: No implicit 5%/20,000 VND price-increase permission is added.
  The backend must obtain confirmation for changed prices. Unknown cancellation
  fees remain unknown; compensation is not assumed free.
- `SPEC-004/AC-22` (2026-10-01): When AhaMove prices no requested service, the
  estimate fails with `PROVIDER_REJECTED` carrying the provider's reason and code
  (for example `INVALID_FUTURE_ORDER_TIME`); per-service rejections next to at
  least one priced option become warnings. The Moving agent turns such
  request-level rejections into a question on the relevant field or a retry with
  an untried catalog service, never into a fabricated quote. See
  [map workspace §9](../integration/map-workspace-2026-10-01.md).

See [internal approval API](../api/moving-internal-approvals.md) and
[integration response](../integration/moving-service-response.md).

## Confirmed quote form (2026-10-05; issue #52)

- `SPEC-004/AC-26`: A typed quote form with confirmed pickup/destination and time
  does not invoke Intake/Planner LLM. An explicitly selected service is validated
  against the actual catalog and quoted without LLM; SIU-auto selection retains
  the Moving LLM decision over observed provider services. Chat is unchanged.
- `SPEC-004/AC-27`: Form quoting uses the shared task policy, usage ledger,
  result/source/expiry validation and LangGraph checkpoint. A new quote increments
  plan version, clears affected selections and invalidates downstream results,
  without changing unrelated completed tasks or auto-authorizing a write.
- `SPEC-004/AC-28`: Ownership, stale version, invalid pins/date/time, pending
  approvals/payment/reconciliation and active Moving bookings are checked before
  issuing a replacement quote. Verification uses real staging, not mocked prices.
- `SPEC-004/AC-29`: The confirmed form remains mounted during thread creation and
  quote submission. A rejected request retains pins, time and service choice;
  success opens actual quotes directly without a flash back to the chat.
- `SPEC-004/AC-30`: UI and agent may reuse actual catalogs for at most 45 seconds,
  within one provider/client scope and exact pickup/city/delivery-type query.
  Explicit refresh and provider refusal invalidate catalogs. Quotes/prices and
  writes are never served from this cross-request cache. Default and TRUCK
  catalogs are read in parallel for the UI, without invented service IDs.
- `SPEC-004/AC-31`: Service detail model context omits presentation fields and
  duplicate language labels, not request IDs/options/limits. Observed vehicle
  constraints can be projected from redacted provider records; stored detail
  remains unchanged and the agent still chooses its tools.

See [typed API](../api/moving-quote-form.md) and [ADR-022](../adr/ADR-022-confirmed-moving-form-intent.md)
(Proposed; team review required).
