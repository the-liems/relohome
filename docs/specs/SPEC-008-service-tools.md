# SPEC-008: Domain MCP tool catalogue

Status: Draft proposal. The team intends to expose each service through MCP and is open to changing existing contracts. Tool names and boundaries below are proposed, not implemented-product claims.

Owner: unassigned. Reviewers: AI system, housing, recommendation, packing, transport, map utilities, and application security contributors. Implementation issue: not yet assigned.

Related: [housing search](SPEC-016-housing-search.md), [product brief](../product.md), [architecture](../../ARCHITECTURE.md), and [branch work](../work-in-progress.md).

## Goal and scope

Expose typed domain operations for housing discovery, relocation planning, service comparison, approved execution, and recovery. Each tool has explicit inputs, outputs, and effects. AhaMove is the team's selected provider for packing and relocation. Map implementation, other providers, models, transport bindings, schemas, and result limits remain open.

The AI system is confirmed as the component that orchestrates workflows and calls domain tools. The [MVP scope](../product.md#mvp-scope) includes travel booking. The team originally named separate packing and transport services; their service boundaries remain open. This draft proposes clearer domain names: **Moving** for packing and belongings relocation through AhaMove, and **Travel** for the person's journey. This grouping is a proposal, not an agreed rename or implemented service merger. Existing branch tools can implement these semantics without immediate renaming.

## Housing

| Tool | Inputs | Outputs and behavior |
|---|---|---|
| `search_housing` | Visible bounds or explicit location constraint; structured filters; custom requirements; ordering; continuation | Candidate listings with IDs, coordinates, prices and billing units, descriptions or detail references, source facts, continuation, and coverage diagnostics |
| `get_housing` | Listing ID | Full description, images, structured facts, location, provenance, and availability information where known |

Search applies supported geographic and structured constraints. Description search may help discover candidates for custom requirements. Report requirements not supported in retrieval; retrieval relevance does not establish that a requirement is satisfied. Recommendation performs evidence-based assessment.

The current Location [housing schemas](../../packages/contracts/src/housing.ts) and [housing query spec](SPEC-010-tim-nha-o.md) define supported retrieval filters. Unsupported custom criteria remain explicit and pending/unknown for assessment; they must not become false matches or false zero-result claims. A failure to evaluate a supported hard constraint is an unavailable/failed search, not permission to retry without the constraint. Shared assessment and selection-provenance semantics are proposed in [Interactive housing search](SPEC-016-housing-search.md).

Query the current area and requirements rather than only filtering an earlier candidate set. No fixed candidate count or cheapest-first policy is assumed. Report partial coverage. Descriptions can be included in search results or retrieved through details; bulk details are an optional optimization.

These tools do not sign leases or book housing. Explicit housing selection belongs to application/relocation-plan state.

## Recommendation

| Tool | Inputs | Outputs and behavior |
|---|---|---|
| `recommend_housing` | Candidate records or authorized references; requirements with IDs and mandatory/preferred priority; relevant map evidence if available | Ordered listing IDs, per-requirement assessments, evidence, explanations, unresolved conflicts, and assessment coverage |

Return `matches`, `does_not_match`, or `unknown` per evaluated listing and requirement. Description evidence reflects the listing's claim, not independent verification. Preserve missing evidence and contradictions. Ordering must refer to supplied listing IDs without inventing or duplicating candidates.

Assessment and ranking can initially share one tool because the UI consumes them together. Split them if independent callers or policies require it. This tool evaluates the supplied candidates; further retrieval is coordinated by the application. Its result does not imply catalogue-wide coverage.

## Map utilities

| Tool | Inputs | Outputs and behavior |
|---|---|---|
| `resolve_location` | Place/address/area text and optional geographic context | Possible matches with labels, identifiers, coordinates or area bounds, and ambiguity information |
| `search_places` | Geographic bounds or center/radius; text or categories; continuation | Matching places with IDs, locations, provenance, and continuation |
| `find_nearby_places` | Origin; categories or requirements; distance constraints | Nearby places, measured distances, and missing-data diagnostics |
| `calculate_route` | Origin, destination, travel mode, optional departure time when supported | Route geometry where available, distance, estimated duration, source, and unavailable/unsupported conditions |

Use geographic inputs/outputs independent of provider objects. Declare supported modes and whether departure time or traffic is accounted for. Optional extensions include `get_place`, dedicated `search_areas`, and batch route evaluation.

Rendering, panning, zooming, viewport capture, and marker highlighting are frontend behavior. Housing search consumes visible bounds; ordinary map movement does not require a map-utility call.

## Moving / packing — AhaMove confirmed, grouping proposed

The team uses AhaMove for packing and relocation. Proposed boundary: one Moving MCP service owns AhaMove service discovery, quotes, orders, and recovery, including supported packing/handling options. This avoids two services owning the same provider order lifecycle. If separate packing and transport orders are required, their relationship and ownership must be specified first.

| Tool | Inputs | Outputs and behavior |
|---|---|---|
| `list_moving_services` | Pickup location/city and desired service type | Available AhaMove services with identifiers and known capabilities |
| `get_moving_service` | Service ID | Current service details, supported special requests, limits, and packing/handling inclusion where known |
| `estimate_move` | Pickup/destination, timing, contacts/access details, supplied inventory/packages, selected services and supported special requests | Stored quote ID, service options, fee breakdown, assumptions, observation/expiry times, and unsupported needs |
| `create_move_order` | Current quote, selected service, approval reference, and stable action/idempotency identity | Provider order ID and confirmed, pending, or uncertain outcome |
| `get_move_order` | Authorized order ID | Current provider state, fees, and tracking information where available |
| `find_move_orders_by_tracking_number` | Client tracking reference and optional time range | Provider orders needed to reconcile an uncertain create outcome |
| `cancel_move_order` | Order ID or tracking reference, reason, required approval, and stable request identity | Cancellation result, fees, refund state where applicable, and follow-up |

These names align with the reviewed WIP moving branch. Optional extensions include `list_service_areas`, `update_move_order`, dedicated stored-quote retrieval, tracking events, and batch order lookup. A `plan_packing` tool may be added for checklist/materials advice if that is useful to the customer; it is not assumed to be an AhaMove API capability.

AhaMove's [public moving-service description](https://ahamove.com/ahamove-ra-mat-dich-vu-chuyen-nha-tai-viet-nam) distinguishes basic moving from packages that include packing and disassembly. That public offering does not establish which service IDs or options the team's partner API account can book. Confirm those through provider service discovery, details, and integration verification. Preserve unsupported needs explicitly rather than claiming that handling, packing, and disassembly are interchangeable.

Quotes are not orders. Expired quotes require revalidation; changed material inputs or selected options require renewed approval. If packing is included in one move order, approval covers that quoted order and its included work; do not create another packing order implicitly.

## Travel — booking in MVP scope, service boundary proposed

Travel booking is required by the [MVP scope](../product.md#mvp-scope). Proposed boundary: a Travel MCP service handles that journey separately from AhaMove belongings relocation. Whether the originally named transport service adopts this role remains open.

| Tool | Inputs | Outputs and behavior |
|---|---|---|
| `search_travel_options` | Origin, destination, dates, passengers, baggage/preferences, and supported modes | Travel options with IDs, schedules, indicative prices, and conditions |
| `quote_travel` | Selected option and complete passenger/trip needs | Current offer/quote ID, price breakdown, validity, baggage, and cancellation/change terms |
| `book_travel` | Current quote, required passenger details, approval reference, and idempotency identity | Booking identity and confirmed, pending, or uncertain outcome |
| `get_travel_booking` | Authorized booking ID or supported client-request reference | Provider booking/ticket state and known costs |
| `cancel_travel_booking` | Booking ID, reason, required approval, and stable request identity | Cancellation result, fees, refund state where applicable, and follow-up |

Final names and schemas should reflect the selected mode/provider, such as flight-specific operations for a flight-only demo. Revalidate expired offers before booking. The existing flight branch remains WIP; its simulated booking does not establish a live ticket-purchase capability. AhaMove is not assumed to provide passenger tickets in this design.

## AI system — orchestration

The AI system owns the main orchestrator and calls domain tools. Its application API maintains conversation, search context, housing selection, plans, approval decisions, and workflow progress. The proposed integration is an MCP host/client connecting to domain MCP servers. An MCP interface for the AI system is optional only if another host needs to consume the orchestrator.

The AI system interprets the move goal, asks for missing inputs, decomposes dependencies, coordinates independent/dependent calls, and handles plan changes and recovery. Deterministic application handlers may issue tool calls for map/filter changes without asking the LLM to choose the same operation repeatedly.

Creating or revising a plan does not authorize booking. Execution consumes separately recorded approvals, while the executing domain service enforces each action's approval and user scope.

## Shared contract semantics

- Validate inputs and return structured outputs suitable for UI and orchestration. Keep canonical schemas in the service contract sources.
- Preserve consistent money/currency/billing-period and geographic values. Identify sources, observation times, quote validity, and incomplete results.
- Return stable domain errors with safe messages and retry guidance. Distinguish invalid inputs, no matches, missing user information, unavailable providers, expired quotes, denied approval, and uncertain external outcomes.
- Derive identity and authorization from trusted application/authentication context. An arbitrary user identifier in arguments must not grant access.
- Document actual effects. Internal draft creation or quote persistence can change state without committing a vendor action. MCP annotations must reflect implementation behavior.
- Each money-spending vendor action requires approval bound to the user, operation, current price, and material inputs, verified by the executing service. A model-supplied `approved: true` is not approval evidence.
- Side effects need idempotency and reconciliation. Repeating the same key/request must not duplicate an action; conflicting reuse is rejected. After a timeout with an uncertain outcome, inspect provider state before retrying. Booking lookup must support reconciliation even when the initial response did not return a booking ID.
- Cancellation is service-specific compensation, not guaranteed rollback or refund. Report irreversible effects and manual follow-up.
- Bound calls with timeouts. Slow operations need an operation reference and explicit status/result/progress behavior when they outlive normal request waiting. Declare whether cancellation stops work or only stops waiting.

MCP provides tool schemas, structured results, and annotations; these workflow and authorization policies are application requirements. Annotations are hints, not enforcement. See the [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

## First implementation sequence (proposed)

1. Housing search/details, recommendation, and location resolution establish [SPEC-016 — Interactive housing search](SPEC-016-housing-search.md). Add route/nearby evaluation for requirements that need them.
2. Add AhaMove moving discovery/quotes, including supported packing needs. Confirm the proposed packing/moving grouping and select travel modes/providers for the required travel-booking flow.
3. Complete one approved booking lifecycle, including status lookup and compensation/reconciliation. Discovery and quotes alone do not meet the full orchestrator execution goal.
4. Complete both moving and travel-booking lifecycles for the MVP, including per-action approval, status lookup, and recovery. Add further vendor extensions as needed.

The reviewed WIP housing/map and moving branches expose some equivalent operations. Moving has discovery, estimation, order creation, status, updates, and cancellation. This catalogue proposes provider-neutral semantics; it does not establish those branches as integrated or production-ready.

## Acceptance criteria

| ID | Expected behavior |
|---|---|
| SPEC-008/AC-01 | Each tool has validated inputs, structured outputs, a domain owner, and documented effects/errors. |
| SPEC-008/AC-02 | Housing retrieval accepts bounds/requirements and reports incomplete coverage or unsupported retrieval criteria. |
| SPEC-008/AC-03 | Recommendation identifies supplied candidates and requirements and provides evidence or unknown assessments. |
| SPEC-008/AC-04 | Map utilities use provider-neutral geography and disclose routing limits. |
| SPEC-008/AC-05 | Quotes are distinguishable from bookings and include validity and material conditions. |
| SPEC-008/AC-06 | Missing, expired, mismatched, or unauthorized approval prevents a paid action. |
| SPEC-008/AC-07 | Duplicate requests cannot duplicate bookings; uncertain outcomes have a reconciliation path. |
| SPEC-008/AC-08 | Cancellation reports actual outcomes, fees, and irreversible effects. |
| SPEC-008/AC-09 | Service access and booking lookup enforce authorized user scope. |
| SPEC-008/AC-10 | Slow operations expose bounded waiting and continuation/progress behavior when needed. |

## Open decisions

- Whether packing and belongings relocation share one AhaMove order or need separate orders/services.
- Whether the originally named transport service is the proposed Travel service; supported passenger modes and providers.
- Payment owned by booking providers or a separate service; separate payment requires its own lifecycle and saga rules.
- Schemas/names reconciled with WIP branches, owners, and implementation issues.
- AhaMove partner-account coverage of moving/packing options, other providers/mocks, quote/approval validity, timeouts, and result limits.
