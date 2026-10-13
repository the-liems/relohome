# SPEC-017 — Travel and flight booking

- Status: Draft
- Update 2026-10-09: an in-app checkout demo (simulated hold and ticket, ZaloPay
  sandbox payment) is implemented behind `APP_PAYMENT_DEMO_ENABLED` per
  [payment design](../review/payment-design.md); see *Simulated booking path* below.
  Search stays live through SerpApi. Real ticketing remains unavailable.
- Owner: unassigned; ownership to be agreed in #32
- Reviewers: Flight/Travel, AI system, frontend/UX, Payment, Moving, security
- Requirements review: [#32](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/32)
- Implementation: [Flight #10](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/10), [service access #17](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/17), [Payment #11](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/11)
- Related review: [Transport #8](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/8), [payment ownership #33](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/33), [shared interaction #28](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/28)

## Problem and scope

A person relocating needs to compare a suitable passenger journey, understand its
timing and full known cost, choose an itinerary, and approve a booking with a
clear outcome. A search result, selected option, temporary hold, payment receipt,
and issued ticket represent different states and must be presented separately.

The [product brief](../product.md#mvp-scope) requires travel booking in the MVP.
This specification defines customer behavior for that capability using the
existing domestic Vietnam flight contract as its initial integration boundary.
It includes search/refinement, comparison, offer inspection, passenger collection,
approval, booking status, and supported cancellation/recovery. Requirements here
do not establish that booking is enabled or that a provider can issue real tickets.

This capability concerns the person's journey. AhaMove belongings relocation
belongs to [SPEC-004](SPEC-004-ahamove-moving-service.md). A Travel service rename
or merger with Transport #8 requires a recorded decision; this spec preserves
the existing Flight service and tool names.

### Implementation boundary used for this review

Reviewed against merged `main` at `1a4ca11` on 2026-10-05. Delivery progress
belongs in the linked issues; these references explain the boundaries on which
the draft requirements are based.

| Surface | Existing behavior and limit |
|---|---|
| Integrated application | [FlightWorkspace](../../apps/web/src/components/ServiceWorkspaces.tsx) compares, sorts, inspects, and selects flight offers; selection is labeled as not booked. The [Flight adapter](../../apps/agent-api/src/relohome_agent/agents/subagents/services/flight.py) requires SerpApi search results and leaves baggage unknown. It requests up to five price-sorted offers without passing the service contract's `nonstop_only` or `cabin_class` filters. Workspace sorting/filtering operates on this returned subset; it does not establish the earliest or fastest option across all provider results. |
| Domain agent | [SPEC-014](SPEC-014-domain-llm-agents.md) and [domain tools](../../apps/agent-api/src/relohome_agent/agents/subagents/services/domain_tools.py) define grounded search and offer inspection. Static fare rules are not verified provider facts. [Application wiring](../../apps/agent-api/src/relohome_agent/agents/wiring.py) removes flight commit capabilities and rejects simulated transactions. |
| Standalone Flight MCP | The [service documentation](../../apps/flights-mcp/README.md) defines domestic one-way search, passenger validation, and a simulated hold → ticket → cancellation lifecycle. [Server registration](../../apps/flights-mcp/src/relohome_flights_mcp/server.py) exposes booking/status/cancellation tools only when `FLIGHT_SIMULATION_ENABLED` is explicitly enabled; it defaults to false. It cannot issue real tickets; catalog baggage/change/cancellation terms are sample data. |
| Transaction adapter | [McpTransaction](../../apps/agent-api/src/relohome_agent/services/adapters/commit.py) contains hold → payment → issuance and cancellation logic. Its `_holds` and `_receipts` caches are process-local dictionaries; the adapter alone does not preserve their hold/payment linkage across restart. Paid-but-failed issuance raises an uncertain outcome requiring manual refund follow-up. Its existence does not establish an enabled application booking flow, durable recovery, or a completed provider payment/ticket lifecycle. |

### Simulated booking path (update 2026-10-09)

The table above was reviewed against `main` at `1a4ca11`. Since then the
[payment design](../review/payment-design.md) has been implemented on the
integration branch (PR #69, #80). With `APP_PAYMENT_DEMO_ENABLED` and
`FLIGHT_SIMULATION_ENABLED`:

- Each service is its own transaction. The customer opens a payment summary from
  the UI (not from a chat approval), confirms it, and pays a ZaloPay **sandbox**
  order. The summary shows the reference price and the time it was captured;
  prices are not re-verified with an airline.
- Flight checkout re-reads the stored offer, places a simulated 15-minute hold,
  creates the sandbox order (15-minute expiry) and, once paid, a durable
  fulfilment job issues a simulated ticket at most once. Hold, payment and ticket
  are shown as separate states and labeled simulated (AC-18).
- **Round trip** uses SerpApi's round-trip mode as one flight task
  (`trip_type=round_trip`, `return_date`). Outbound prices are the cheapest round
  trip that includes that outbound flight (`price_scope=round_trip_from`) and
  cannot be paid. Choosing an outbound flight is a typed UI action that loads the
  return flights for it (`search_return_flights`, no LLM call); each return option
  is an itinerary whose price is the provider's total (`price_scope=round_trip`).
  The application never sums or splits leg prices.
- Domestic only: no ID card or passport, checked baggage or seat selection. The
  booker comes from an encrypted account profile; companions are entered in the
  payment form.

Without the flag the application keeps the unavailable-booking behavior of AC-08.

Domestic flights, passenger schemas, simulated holds, and cancellation preview
already have service contracts. Review must decide their use in the application
and any extensions, rather than treating those contracts as absent.

SerpApi is a search-only source and cannot hold or issue a ticket. The current
[`get_offer`](../../apps/flights-mcp/src/relohome_flights_mcp/tools.py) reads cached offer data and
sample catalog terms; it does not re-price or verify bookable inventory with an
airline. No booking-capable provider is connected for the live flow required below.

## User flow and required behavior

1. Capture origin, destination, explicit flight date, passenger mix, and relevant
   preferences. Resolve airports through the service catalog; clarify ambiguity.
   Keep flight and moving dates distinct. Retain baggage or timing requests even
   when the current provider cannot verify or filter them.
2. Search using confirmed requirements. Present itinerary, airport-local dates
   and times, connections, supplied duration, total/currency, source, and expiry.
   Missing baggage, seat availability, or fare conditions remain unknown. Explain
   partial matches and no results without silently relaxing requirements. Disclose
   the applied ranking, result limit, and that returned offers may be a subset.
3. Refine through chat or available controls. Preserve confirmed facts and
   unrelated work when switching workspaces. A request for a later departure,
   fewer connections, or baggage must either affect the supported search or be
   explicitly reported as an unmet or unverified preference. Pass supported
   service filters through the application, or disclose the integration limitation
   before presenting results as satisfying them. Local sorting must identify its
   comparison set; answering an earliest/fastest search request requires a new
   provider search with the supported ordering, or an explicit limitation. Reordering
   five cheapest offers cannot establish the earliest flight in the full result set.
4. Select an itinerary and inspect its current offer. Selection and plan acceptance
   do not authorize holding, charging, or issuing a ticket. A cached offer is not
   proof of bookable inventory. A search-only offer is not committable for live
   booking until a booking-capable provider maps the exact selected itinerary,
   confirms availability, and re-prices it before commitment. If it is unavailable,
   return to comparison without a hold or charge and without silently substituting
   another flight. Changed price or material terms require renewed approval.
5. When booking is available, collect required passenger/contact information in
   a protected form and validate it against the canonical passenger contract.
   Show the journey, passenger summary, current total, known conditions, and
   simulation/provider boundary before requesting action-specific approval.
6. Execute only the approved action. If the agreed flow uses a hold, show its
   reference and deadline separately from ticket issuance. If separate payment
   is used, keep payment and ticket outcomes linked but distinct; do not collect
   again when the booking provider already owns payment.
7. Display pending, confirmed, expired, failed, cancelled, and uncertain outcomes
   as supported by the integration. A payment marked paid is not a ticket.
   Show a booking reference or ticket identity only when returned by the service,
   and mark simulated identities explicitly.
8. For change/cancellation requests, retain the original booking, explain actual
   supported options and known fees/refund limits, and obtain the applicable
   approval. Without a change-ticket capability, offer manual follow-up rather
   than silently buying a replacement.

If booking is unavailable, explain that the application can search and select
offers but cannot book them. Do not open a payment flow, fabricate a hold or
confirmation, or block independent valid search work.

### Dependencies and interaction

Search may run independently of housing when the route and date are known. A
selected home's verified city may supply the destination, but its street address
does not automatically change the airport. A changed flight date, route, passenger
mix, or selected itinerary invalidates affected offers and approvals. Reuse
independent results only while their own inputs and validity still hold.

Compare arrival feasibility with the move or viewing schedule only when the
necessary facts are available. Missing airport-transfer time remains unknown;
the agent must not invent it or choose timing priorities for the customer.

Comparisons, offer details, passenger forms, and status views must preserve task
context, keyboard access, and readability on narrow layouts. Shared composer
placement and workspace alternatives remain under #28; this spec does not decide
a new shell or replace the existing workspace design.

## Interfaces and canonical data

| Contract or interface | Canonical source |
|---|---|
| Flight search, offers, passengers, holds, bookings, cancellation results | [Flight schemas](../../packages/python/flight/src/relohome_flight/schemas.py); [tools](../../apps/flights-mcp/src/relohome_flights_mcp/tools.py); [request/response examples](../api/examples/flights/README.md) |
| Domain task input/output and grounded tools | [Flight capability](../../apps/agent-api/src/relohome_agent/agents/subagents/capabilities.py); [Flight adapter](../../apps/agent-api/src/relohome_agent/agents/subagents/services/flight.py); [domain tools](../../apps/agent-api/src/relohome_agent/agents/subagents/services/domain_tools.py); [SPEC-014](SPEC-014-domain-llm-agents.md) |
| Offer detail and result selection | [UI action API](../../apps/agent-api/src/relohome_agent/api/web_actions.py); [web gateway](../../apps/browser-gateway/src/relohome_gateway/server.py); [FlightWorkspace](../../apps/web/src/components/ServiceWorkspaces.tsx) |
| Approval, private forms, transaction orchestration | [Agent models](../../apps/agent-api/src/relohome_agent/agents/models.py); [transaction adapter](../../apps/agent-api/src/relohome_agent/services/adapters/commit.py); [SPEC-003](SPEC-003-planning-and-execution.md) |
| Shared approval, authorization, idempotency, and recovery semantics | [SPEC-008 — Domain MCP tool catalogue](SPEC-008-service-tools.md#shared-contract-semantics) |

Use existing `search_airports`, `search_flights`, `get_offer`, `hold_booking`,
`confirm_booking`, `get_booking`, and `cancel_booking` names. Schema limits belong
in the canonical sources; this spec does not add unsupported arguments or rename
tools. The last four are simulation-gated in the standalone server and unavailable
in the integrated application. Any future provider or passenger mode must supply
an explicit contract.

## Failures, security, and limits

Apply the shared SPEC-008 rules to the exact travel action, user, material inputs,
and current amount. A matching price alone does not preserve approval if the
itinerary or passengers changed. Neither an LLM assertion nor a tool boolean
constitutes approval evidence. Enforce authorization at execution and status
lookup; possession of a PNR or booking ID must not grant another user's access.

Keep passenger/contact information in the protected form path rather than model
context or public logs. Cancellation approval must describe the affected booking,
known fee, and refund terms; an unknown fee is not zero. Static demo fare rules
must never be used as verified terms for a real booking.

Duplicate submissions must not create another charge or booking. Preserve stable
action identities and payment/booking references across resume or restart. After
a timeout with an uncertain outcome, reconcile service state before retrying.
If payment succeeded but ticket issuance failed or is uncertain, preserve the
paid state and show reconciliation, refund, or manual follow-up. Do not claim a
refund succeeded from a cancellation result or a calculated refundable amount.

Provider errors must produce an actionable explanation, without mock fallback
presented as live results. Holds and offers have separate expiry deadlines. A
hold expiring during payment must not trigger automatic replacement or a second
charge; check both states and apply the agreed recovery path.

### Outside the initial integration boundary

Rail, bus, international/multi-city search, airport-transfer booking, seat
selection, ancillary purchases, and ticket modification require explicit review.
A round trip is not an atomic booking contract merely because two one-way
searches are possible; the demo books it only as one provider itinerary offer
(see *Simulated booking path*). Production ticket issuance and payment require provider
capability evidence and approved integration decisions. This spec does not enable
simulated transactions in the current application.

If review chooses a separate simulation path, define its own availability and
expiry checks and label any hold against a SerpApi offer as simulated. A successful
simulated hold does not establish airline availability or live revalidation.

## Acceptance criteria and review scenarios

These stable IDs define required behavior for review; they are not completion
claims. Booking criteria apply when a reviewed booking flow is enabled. AC-08
defines the current unavailable-booking behavior.

| ID | Verifiable behavior |
|---|---|
| SPEC-017/AC-01 | Ambiguous origin/destination or missing flight date prompts for the necessary field; the system does not invent an airport or conflate flight and moving dates. |
| SPEC-017/AC-02 | Search and follow-up refinement preserve confirmed requirements except changes the user explicitly requests. Contract-supported filters such as `nonstop_only` and `cabin_class` reach the provider, or the application explicitly reports the integration limitation. No-result/unsupported responses do not silently relax requirements or fabricate alternatives. |
| SPEC-017/AC-03 | Comparison shows available itinerary, local dates/times, connections, duration, total/currency, source, expiry, applied search ranking, and result-limit/subset disclosure. Local sorting identifies its comparison set; earliest/fastest claims require a provider re-search with the supported ordering or an explicit limitation. A departure near midnight retains the provider's local calendar date regardless of browser timezone. |
| SPEC-017/AC-04 | A cheaper offer with unknown baggage is not described as satisfying a requested allowance. Static catalog fare rules remain explicitly unverified even after offer inspection. |
| SPEC-017/AC-05 | Search, selection, plan acceptance, hold, payment, and ticket issuance are distinct. Selecting an offer creates no charge, hold, or ticket. |
| SPEC-017/AC-06 | Housing and flight searches can run independently when route/date are known. Changing housing within the same destination city preserves valid independent flight work; changing the flight date invalidates affected work. |
| SPEC-017/AC-07 | Moving between workspaces preserves the active journey and choices. Comparison, detail, and enabled passenger/status views work with keyboard input and readable narrow layouts. |
| SPEC-017/AC-08 | Without the checkout demo flag, a booking request explains that ticket booking is unavailable, creates no payment/hold/ticket, and allows valid independent read tasks to continue. With the flag, the agent points to the in-app payment summary, which runs the labeled simulated path: simulated hold, ZaloPay sandbox order, then a simulated ticket. No real ticket is created. |
| SPEC-017/AC-09 | Before live booking, a booking-capable provider confirms and re-prices the exact selected itinerary; reading a cached SerpApi offer is insufficient. An unavailable offer returns to comparison without hold/charge or silent substitution; changed price/terms trigger AC-10. The form validates passenger/contact data against the Flight schema before commitment. An explicitly agreed simulation path labels its own checks as simulated and makes no live availability claim. |
| SPEC-017/AC-10 | An enabled booking requires valid action-specific approval. Changing itinerary, date, passenger mix, material terms, or amount requires review and renewed approval, even when the total is unchanged. |
| SPEC-017/AC-11 | A hold displays its reference and expiry as a hold. An expired hold cannot be represented as ticketed or silently replaced while a related payment is pending or paid. |
| SPEC-017/AC-12 | With separate payment, ticket issuance waits for the verified paid state and references that payment. Provider-owned payment does not also trigger separate collection. In test environments only, an authorized tester may mark an unexpired sandbox attempt as paid: it is recorded as `paid_simulated` (not `paid_verified`), labeled "marked by tester", requires a server-side flag, a tester allow-list and ownership, and is refused when `APP_ENV=production` ([ADR-015](../adr/ADR-015-zalopay-payment-and-data-privacy.md)). Fulfilment runs at most once per transaction, whichever confirmation arrives first. |
| SPEC-017/AC-13 | Pending/failed payment does not become a ticket confirmation. Paid-but-unfulfilled or uncertain issuance preserves both outcomes and exposes an explicit recovery/manual-follow-up path. |
| SPEC-017/AC-14 | Duplicate approval/submission or resumed execution does not duplicate a charge or booking. A restart preserves the action and references needed to reconcile an uncertain outcome before retrying. |
| SPEC-017/AC-15 | User B cannot read or mutate user A's booking/payment by supplying its reference. Passenger/contact data is excluded from model context and public logs. |
| SPEC-017/AC-16 | Enabled cancellation reviews actual supported terms and obtains the applicable approval. Cancellation status, refundable amount, and confirmed refund remain distinct; unavailable refund support is disclosed. |
| SPEC-017/AC-17 | Changing a plan with an existing booking keeps that booking visible. Unsupported ticket modification gives a follow-up path and does not automatically cancel or buy a replacement. |
| SPEC-017/AC-18 | Live search plus simulated issuance is explicitly labeled per action. A simulated PNR/ticket is never described as a real provider booking. |
| SPEC-017/AC-19 | Provider timeout/error is distinguished from no matching flights. Uncertain external writes are reconciled before retry; search failure does not fall back to fabricated live offers. |
| SPEC-017/AC-20 | Arrival conflicts show the facts and missing evidence. Without an airport-transfer duration, the system does not claim arrival at the selected home by a requested time. |
| SPEC-017/AC-21 | "Round trip" and equivalent phrasing produce one flight task with `trip_type=round_trip`; a missing return date is asked for before the round-trip search. |
| SPEC-017/AC-22 | Outbound offers are labeled as "from" round-trip prices and cannot be selected for payment. The payment summary appears only for an itinerary offer and shows both legs, the itinerary reference price and its capture time. A failed hold creates no payment order. |
| SPEC-017/AC-23 | A return date before the departure date is rejected with a question. A same-day return lists only flights departing after the outbound arrival plus a configured minimum gap (`FLIGHT_ROUND_TRIP_MIN_GAP_MINUTES`, default 120). Changing the outbound flight clears the selected return flight and its selection. |
| SPEC-017/AC-24 | An expired attempt or a payment-creation timeout moves to reconciliation; the gateway is queried at least once after the deadline (with a grace period), and a new attempt is allowed only when the previous one is confirmed unpaid. A payment verified after the hold expired is kept and shown as paid but not fulfilled. |
| SPEC-017/AC-25 | Passenger and contact data stay in the encrypted personal-data store (30-minute retention); transactions, simulated bookings, hashes and logs hold only a reference. Passenger ages are checked against the ticket type at the flight date before any hold. |

### Review scenarios

These scenarios define expected behavior, not executed test results. Transaction
scenarios apply only to a reviewed, enabled booking path; TRV-01 covers the
current application's unavailable-booking behavior.

| ID | Trigger | Expected result | Acceptance criteria |
|---|---|---|---|
| TRV-01 | After choosing an offer, the customer asks to book it. | Without the demo flag: explain that booking is unavailable and create no hold, payment, or ticket. With it: point to the in-app payment summary and run the labeled simulated path. Either way, preserve the selection and permit independent read tasks. | AC-05, AC-08, AC-18 |
| TRV-02 | A search returns five price-sorted offers; the customer requests nonstop economy travel or the earliest departure. | Apply supported filters and provider ordering on a new search, or disclose unsupported propagation. If sorting existing cards only, identify that subset and do not claim it includes every flight or the global earliest departure. | AC-02, AC-03 |
| TRV-03 | A booking-capable provider reports the selected itinerary unavailable, or quotes changed terms. | Unavailability returns to comparison without a hold, charge, or substituted itinerary. Changed terms require a new decision. A search-only or simulated result cannot pass live revalidation. | AC-09, AC-10, AC-18 |
| TRV-04 | A hold expires while payment remains pending. | Keep hold and payment states separate; reconcile both and apply the agreed recovery path. Do not issue against the expired hold, silently replace it, or collect twice. | AC-11, AC-12, AC-14 |
| TRV-05 | Payment is verified PAID, but `confirm_booking` fails or times out. | Preserve the paid state and booking reference; show failed/uncertain issuance and reconciliation/refund/manual follow-up. Do not claim a ticket or refund, or retry an uncertain write blindly. | AC-13, AC-14, AC-19 |
| TRV-06 | The process restarts after creating a hold and payment, before issuance. | Recover the durable action, approval, hold, and payment linkage; inspect actual states before resuming. If recovery evidence is missing, expose an unresolved outcome rather than create another booking or charge. | AC-10, AC-13, AC-14 |

## Evidence and decisions to review

Existing [Flight service tests](../../tests/test_mcp_flights/test_booking_engine.py)
exercise the simulated lifecycle, idempotent confirmation, passenger validation,
expiry, and cancellation fees. [Application action tests](../../tests/browser_gateway/test_actions.py)
and [domain-agent tests](../../tests/test_llm_agents/test_live_components.py) provide
integration evidence. Their exact coverage and results must be checked before
marking any criterion implemented; service tests do not establish a live ticket
or a verified payment/refund lifecycle.

Relevant decisions: [ADR-012 — flight data source](../adr/ADR-012-flight-data-source.md),
[ADR-015 — payment and privacy](../adr/ADR-015-zalopay-payment-and-data-privacy.md),
[ADR-019 — integrated local MVP](../adr/ADR-019-local-integrated-mvp.md), and
[ADR-021 — domain tools](../adr/ADR-021-mission-driven-domain-tools.md).

Review in #32 must record accepted, deferred, and unresolved requirements:

- Confirm domestic flights as the initial supported passenger mode/geography.
  Round trip is decided for the demo (SerpApi round-trip mode, one itinerary
  payment; AC-21–AC-23); broader modes remain separate decisions.
- Agree how the existing `nonstop_only`, `cabin_class`, `sort_by`, and `max_results`
  contract reaches the application. Record the current dropped-filter and
  five-cheapest-subset gaps, required coverage disclosure, and when ordering changes
  trigger a new provider search. Distinguish baggage/preferences that can be
  enforced from retained, unverified requests.
- Select the booking-capable provider that maps/re-prices search offers, or
  explicitly define a separate simulated path and its checks. Neither cached
  `get_offer` nor a simulated hold supplies live revalidation evidence. Confirm
  the unavailable-offer return-to-comparison behavior in AC-09.
- Decide the enabled booking/demo path. The current application excludes
  simulated transactions; changing that policy requires an explicit decision
  consistent with ADR-019 and SPEC-014, not an implied consequence of this draft.
- Agree passenger-form UX, hold timing, booking/status access, supported
  cancellation, and the boundary for ticket changes. Reuse the existing service
  contracts where applicable.
- With #33/#11, assign payment ownership and recovery for paid-but-unfulfilled,
  expired-hold, refund, and uncertain outcomes, including durable hold/payment
  linkage across restart in place of reliance on the adapter's process-local caches.
- Reconcile Transport #8 with Flight #10 and assign ownership. No rename, new
  provider, deadline, or delivery commitment is assumed here.
