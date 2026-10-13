# SPEC-004 — AhaMove moving service and customer-facing behavior

- Owner: Moving/Relocation service owner
- Reviewers: Agent planning, contracts, backend/security, Map service, frontend, UX
- Status: Draft
- Parent issue: [Moving integration #9](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/9)
- Customer-facing requirements review: [#31](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/31); shared interaction review: [#28](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/28)
- Related ADRs: ADR-001, ADR-002, ADR-003, ADR-004, ADR-005
- Canonical schemas: `packages/contracts/src/moving.ts`

## Problem

ReloHome needs factual moving-service discovery, quotes, booking and lifecycle
tracking. The agent must be able to collect pickup and destination details,
compare available vehicles, present complete costs, obtain an explicit user
decision, create no more than one external order, and recover when provider
responses or callbacks are delayed. Customers also need an accessible interface
that preserves their moving requirements while they inspect housing, distinguishes
service selection from approval and order confirmation, and explains unsupported
packing or handling needs.

## Scope

- Customer-facing requirement capture, quote comparison, action approval, order
  outcomes, and provider-supported changes/cancellation across the moving flow.
- Preservation of moving details across housing/moving navigation, clear task
  context, keyboard access, and readable narrow layouts. Shared interaction
  alternatives remain under #28; this spec does not select a composer or shell.
- Requested packing/handling needs distinguished from verified provider
  inclusions, with selected material inputs preserved through approved execution.
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
- Payment-gateway implementation. (Proposed 2026-10-07, Draft, not implemented: the application, not this
  Moving service, routes a moving quote through a ZaloPay sandbox payment order and then records the move as
  approved without creating an AhaMove order. See [payment-design.md](../review/payment-design.md) §9.)
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

## Customer-facing moving and packing requirements

These draft requirements extend the moving-service contract with customer-facing
behavior for review in #31. They specify required outcomes, not delivery status
or verified provider coverage. The
[product brief](../product.md) owns MVP boundaries; the
[Domain MCP tool catalogue](SPEC-008-service-tools.md) specifies shared approval,
idempotency, and recovery rules. Moving-specific application is defined in
[Failure and recovery](#failure-and-recovery) and AC-04–06 below. These requirements
apply the shared rules to Moving and must remain consistent with them.

The customer should be able to arrange transport and supported handling of
belongings to the chosen destination, understand the included work and current
cost, and inspect the order outcome.

| Feature | Required customer behavior |
|---|---|
| Describe and refine the move | Capture pickup/destination, explicit date/time, inventory or load, access conditions, and handling needs through natural language and editable controls. Clarify imprecise addresses and missing details instead of inventing them. |
| Distinguish needs from inclusions | Retain fragile-item, stairs, packing, and disassembly requests. Show each as provider-confirmed, unsupported, or unknown. AhaMove selection alone does not establish packing or labor availability. |
| Compare suitable quotes | Show provider/service, supplied capacity, route, schedule, inclusions, exclusions, fees, total/currency, source, validity, and unmet needs. Missing facts remain unknown; a single suitable quote does not require invented alternatives. |
| Select and approve | Keep service selection, plan acceptance, and order approval distinct. Show the current action, material inputs, amount, and terms before approval. CASH is a payable commitment and still requires approval; it is not an online payment receipt. |
| Preserve the approved intent | Carry the selected route, timing, load, service, and handling options into the action reviewed for approval. A matching total alone does not establish that those inputs are unchanged. Apply AC-31 when they change, even if the total stays the same. |
| Track the outcome | Distinguish quotes, awaiting approval, submission, provider confirmation, uncertainty, failure, and cancellation. Show order identity and tracking when supplied; request acceptance does not mean the move is complete. |
| Change or cancel | Explain provider-supported changes, known or unknown fees, and consequences before seeking the applicable approval. Keep existing orders visible; unavailable changes or uncertain outcomes need an explicit follow-up path. |

### Interaction and boundaries

Present a move form, service comparison, quote review, or tracking view when
useful to the current task. Returning to housing should preserve moving
requirements and pending work. A selected home may supply the destination, but
address precision and access still need confirmation. Changing it should identify
affected quotes and approvals while retaining completed orders. Independent
travel results remain reusable only while their own inputs and validity hold.

Shared composer placement, popup shells, and interaction alternatives are
reviewed under #28. This spec does not select one of those designs.

Passenger travel is a separate capability. Packing may be included in a quoted
move only when provider details establish that inclusion; a separate packing
order must not be created implicitly. Packing-material shopping, storage,
insurance sales, and guaranteed labor are outside the customer-facing features
specified here. Existing service fields or tools, including rating and batch
lookup, do not by themselves define additional customer-facing workflows.

Use provider discovery and a route-specific estimate to establish availability
under AC-20. A same-city demo example is not a blanket restriction on customer
origins or a guarantee that a route is supported. Apply AC-21 to changed prices;
there is no implicit 5% / 20,000 VND allowance.

### Review example and scenarios

For design discussion, use a hypothetical Ho Chi Minh City move from a pickup in
District 5 to a selected home in District 10, at 09:00 on a future date explicitly
chosen by the reviewer. The requested inventory is six packed boxes, a desk, and
a fragile monitor, with stairs at pickup and requests for desk disassembly and
monitor packing. These are needs to assess, not confirmed provider inclusions.
The live demo route, exact addresses/pins, contacts, and service remain open.

For the changed-price scenario, 800,000 and 810,000 VND are illustrative amounts,
not provider quotes. Use actual provider amounts and validity for integration
verification. The following scenarios link to their acceptance criteria; they do
not claim passing test results.

| Scenario | Action | Expected customer outcome | Criteria |
|---|---|---|---|
| MOV-01 | Enter moving details, inspect housing, then return to moving. | Destination, inventory, handling needs, time, and quote state remain available; task context is visible and navigation does not book anything. | AC-27, AC-32 |
| MOV-02 | Inspect a service without confirmed packing or disassembly. | The unmet request stays visible with an explanation and next step; transport is not presented as a complete packing package. | AC-26 |
| MOV-03 | Compare and select a quote, then review it without approving. | Selection, approval, payment method, and provider confirmation remain distinct; no order is placed by selection alone. | AC-32 |
| MOV-04 | Let a quote expire or change the amount from 800,000 to 810,000 VND. | Refresh the quote and obtain approval for the current action under AC-04/AC-21 and the shared rules. | AC-04, AC-21 |
| MOV-05 | Creation times out or tracking returns multiple possible orders. | Show uncertainty, pause conflicting actions, and reconcile under AC-05/AC-06. Ambiguity requires follow-up; no blind replacement order is created. | AC-05, AC-06 |
| MOV-06 | Change the selected home after an order is confirmed. | Preserve the existing order, identify affected pending work, and explain supported changes/cancellation and fees before a new decision. | AC-07, AC-08, AC-27 |
| MOV-07 | Navigate, edit, review, and dismiss the flow using only the keyboard. | Logical tab order, visible focus, accessible errors/status, and focus restoration from dialogs; no shortcut silently books or pays. | AC-28 |
| MOV-08 | Repeat MOV-01/MOV-03 at 390 × 844 and review reflow at 320 CSS pixels. | Inputs, terms, errors, pending state, and approval controls remain readable and reachable without overlapping controls or losing drafts. | AC-29 |
| MOV-09 | Change the selected load or packing/handling options while the quoted total stays the same. | The revised inputs are retained, the affected approval is invalidated, and no order uses the old approval. | AC-31 |

Review of these draft requirements is tracked in #31; shared interaction
comparison and accessibility review are tracked in #28. Implementation and
verification progress, including preservation of selected material inputs under
AC-31, are tracked in [#21](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/21)
and the linked issues and PRs, with measured evidence in evaluation reports.

## Interfaces

The Moving MCP tool catalog and schemas are documented in
[`../api/ahamove-v3-integration.md`](../api/ahamove-v3-integration.md). AhaMove
provider payloads are mapped inside `packages/moving-service`; callers use the
provider-independent models in `@relohome/contracts`.

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

All criteria are defined here in ID order. AC-01–18 cover core service behavior;
AC-19–21 cover backend approval registration, route coverage, and price consent;
AC-22–25 cover the LLM subagent; AC-26–29 cover customer-facing handling and
accessibility; AC-30 covers provider quote rejection; AC-31–32 cover preservation
of approved inputs and the selection-to-approval boundary.

ID correction (2026-10-05): the provider-rejection criterion introduced on
2026-10-01 was also labeled AC-22. It is now AC-30; the earlier LLM read-tool
criterion retains AC-22. Historical references to the 2026-10-01 provider-rejection
criterion should be read as AC-30. All other existing IDs are unchanged.

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
- `SPEC-004/AC-22`: LLM chooses observed read tools within per-task call/deadline
  limits; unknown service IDs, generated code and provider writes are unavailable.
- `SPEC-004/AC-23`: Quote amounts, distance, duration and fee breakdown come from
  actual MCP results; missing capacity/loading information stays unknown.
- `SPEC-004/AC-24`: Parse actual nested Partner estimate envelopes as well as flat
  responses; reject errored options/missing price/ID rather than fabricate values.
- `SPEC-004/AC-25`: Test the real LLM -> MCP -> AhaMove staging -> PostgreSQL path
  using an operator-approved route/contact, without creating an order or mocking data.
- `SPEC-004/AC-26`: Requested packing, disassembly, stairs, and fragile-item
  handling are distinguished from provider-confirmed inclusions. Unsupported or
  unknown needs stay visible when comparing and selecting a service.
- `SPEC-004/AC-27`: Switching between housing and moving preserves entered move
  details and pending work without placing an order. A changed selected home
  identifies affected quotes and approvals while keeping completed orders visible.
- `SPEC-004/AC-28`: The moving review flow supports keyboard navigation, visible
  focus, accessible field errors and status updates, and focus restoration when
  dialogs close. Keyboard shortcuts do not silently book or pay.
- `SPEC-004/AC-29`: Moving inputs, quote terms, errors, pending state, and approval
  controls remain readable and reachable at 390 × 844 and at 320 CSS pixels wide,
  without overlapping controls or loss of drafts during reflow.
- `SPEC-004/AC-30` (2026-10-01): When AhaMove prices no requested service, the
  estimate fails with `PROVIDER_REJECTED` carrying the provider's reason and code
  (for example `INVALID_FUTURE_ORDER_TIME`); per-service rejections next to at
  least one priced option become warnings. The Moving agent turns such
  request-level rejections into a question on the relevant field or a retry with
  an untried catalog service, never into a fabricated quote. See
  [map workspace §9](../integration/map-workspace-2026-10-01.md).
- `SPEC-004/AC-31`: Selected route, timing, load, service, and handling options
  are preserved through re-estimation, the stored quote, and the provider order.
  Approval binds the exact material inputs, directly or through the canonical
  quote fingerprint. Changing any of those inputs invalidates the affected
  approval and requires a new user decision even when the total is unchanged;
  an order using the old approval is rejected before provider creation.
- `SPEC-004/AC-32`: Selecting a quote, navigating to review, or accepting the
  plan does not create an order. The customer sees distinct selection, action
  approval, payment-method, and provider-confirmation states. Only explicit
  approval of the current action permits creation; choosing CASH does not
  establish online payment or provider confirmation.

## Open questions

- The trusted backend registers user approval through the internal approval API;
  the integrating graph must authenticate the user before supplying `approved_by`.
- Which webhook authentication mode will AhaMove configure for the partner?
- Which staging pickup/destination set will be used for the team's UAT evidence?
- Which required inventory, packing, disassembly, stairs, and handling needs does
  the partner account support on that route? Which are included in one quote,
  separate services, unsupported, or unknown?
- Which customer-visible modification paths and fee disclosures should the
  first demo include?
- Which shared interaction should carry moving inputs across housing, moving,
  and travel, following the comparison in #28?

## LLM subagent extension (2026-09-29)

AC-22–25 in [Acceptance criteria](#acceptance-criteria) define the
read-only, graph-contract-compatible LLM tool loop, distinct from the TypeScript
MCP/API. See [ADR-018](../adr/ADR-018-llm-first-agent-components.md) and the
[handoff](../integration/llm-agents-handoff.md) for the technical context.

## Integration requirements (2026-09-29)

AC-19–21 in [Acceptance criteria](#acceptance-criteria) define backend approval
registration, provider-determined route coverage, and changed-price consent.
The 2026-10-01 provider-rejection extension is AC-30; see the ID correction above.

See [internal approval API](../api/moving-internal-approvals.md) and
[integration response](../integration/moving-service-response.md).

## Confirmed quote form (2026-10-05; issue #52)

These additions reserve new IDs after main's AC-32. Existing AC-26–32 are
unchanged; the stacked PR must not reuse their identifiers.

- `SPEC-004/AC-33`: A typed quote form with confirmed pickup/destination and time
  does not invoke Intake/Planner LLM. An explicitly selected service is validated
  against the actual catalog and quoted without LLM; SIU-auto selection retains
  the Moving LLM decision over observed provider services. Chat is unchanged.
- `SPEC-004/AC-34`: Form quoting uses the shared task policy, usage ledger,
  result/source/expiry validation and LangGraph checkpoint. A new quote increments
  plan version, clears affected selections and invalidates downstream results,
  without changing unrelated completed tasks or auto-authorizing a write.
- `SPEC-004/AC-35`: Ownership, stale version, invalid pins/date/time, pending
  approvals/payment/reconciliation and active Moving bookings are checked before
  issuing a replacement quote. Verification uses real staging, not mocked prices.
- `SPEC-004/AC-36`: The confirmed form remains mounted during thread creation and
  quote submission. A rejected request retains pins, time and service choice;
  success opens actual quotes directly without a flash back to the chat.
- `SPEC-004/AC-37`: UI and agent may reuse actual catalogs for at most 45 seconds,
  within one provider/client scope and exact pickup/city/delivery-type query.
  Explicit refresh and provider refusal invalidate catalogs. Quotes/prices and
  writes are never served from this cross-request cache. Default and TRUCK
  catalogs are read in parallel for the UI, without invented service IDs.
- `SPEC-004/AC-38`: Service detail model context omits presentation fields and
  duplicate language labels, not request IDs/options/limits. Observed vehicle
  constraints can be projected from redacted provider records; stored detail
  remains unchanged and the agent still chooses its tools.

See [typed API](../api/moving-quote-form.md) and [ADR-022](../adr/ADR-022-confirmed-moving-form-intent.md)
(Proposed; team review required).
