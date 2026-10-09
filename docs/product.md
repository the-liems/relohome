# Product brief — THE LIEMS Multi-Service AI System

Status: customer problem and system constraints confirmed by the team. The first demo city, sample request, vendor actions, and measured customer outcomes are still open. Feature issues and open PRs are work in progress.

## Problem

A person relocating to another place needs one comprehensive moving plan. They must find and select housing, arrange a relocation service, buy travel tickets when needed, and coordinate other tasks. Each task involves a different vendor. The user has to carry details such as destination, housing address, dates, and budget between vendors while keeping the bookings consistent. The team has not yet supplied user research or quantified the time or cost of this pain point.

## Customer and desired outcome

The initial customer is a person planning to relocate. The customer may need a place to live, a way to move belongings, and travel to the destination. The team has not narrowed this to a particular age group, household type, city pair, or income segment.

The customer's job is to make one coherent move without repeating the same requirements at every vendor, losing track of dependencies, or paying for an action they did not choose. The intended result is a plan the customer can inspect and revise: housing options and selection, moving and travel options, known prices and their sources, steps still awaiting a choice or approval, and the status of each vendor action. A quote is an estimate until the provider confirms it; the plan must not present an uncertain price as a final charge.

**User story:** “I am relocating to another place around a date I choose. Help me compare housing, plan how my belongings and I will get there, show the likely costs and order of steps, and ask me before you spend money or make a booking.” This is an illustrative request, not a confirmed demo script.

## MVP scope

Housing search and selection, packing and relocation services, and **travel booking for the person relocating are in MVP scope**. Travel includes comparing options, obtaining a current quote, approving a booking, and tracking its outcome. AhaMove is selected for packing and relocation.

The [tool catalogue](specs/SPEC-008-service-tools.md) proposes grouping packing and belongings relocation as Moving and passenger journeys as Travel. Service grouping, supported travel modes and providers, payment integration, and which demo actions use mocks remain open. Those implementation choices do not make travel booking optional in the MVP. The current flight branch uses simulated booking; live ticket purchase is not implemented in this checkout.

## Platform role

ReloHome is an intermediary platform. It helps users find, compare and confirm
services and pay electronically in the app. In the demo, it only collects
and holds payments through the ZaloPay sandbox and does not pay providers: flight
tickets are simulated and a paid Moving option is recorded as approved without an
AhaMove order ([payment design](review/payment-design.md)). Contracts, agreements
and legal responsibility for housing, moving and travel are between the user and
the provider; ReloHome does not sign leases or collect housing money.
Paying providers and holding real funds require merchant and provider agreements,
legal review and a separate decision.

## Agreed system goal

Build an AI system that breaks a natural-language goal into steps, calls multiple service APIs sequentially or in parallel, passes outputs between steps, respects dependencies, and rolls back or compensates when a step fails. Long-running workflows are acceptable if the user can see realtime progress.

The technical direction is an LLM with LangGraph for the multi-step state machine and checkpointing, plus custom saga orchestration for recovery. The AI system is confirmed as the component that orchestrates workflows and calls domain tools; domain services expose MCP interfaces. The [MVP scope](#mvp-scope) defines the required service capabilities and open integration choices. Service contracts and demo providers still need reconciliation with the MCP implementations under development. The [service issues](work-in-progress.md) describe a mix of mock, staging, and live read-only providers. These are project requirements and work-in-progress designs, **not features of the current checkout**. Its implemented baseline is described in [ARCHITECTURE.md](../ARCHITECTURE.md).

## Required controls

1. A user must approve **each** money-spending step before that step executes. Approval for one step must not authorize another.
2. Service tokens must be protected and limited to the appropriate user's scope. The orchestrator must not use one user's authorization for another user's service call.
3. If a workflow fails after earlier steps succeeded, the system must preserve a consistent state through a defined saga/compensation path. The exact reversibility of each service action belongs in its contract.
4. The workflow must expose realtime progress and resume from checkpoints as designed. A long end-to-end latency is acceptable; the team still needs to define operational timeouts and progress expectations.

## Customer-facing behavior

| Stage | What the customer should see or control | Dependency |
|---|---|---|
| Describe the move | Enter destination, timing, housing needs, budget, and travel needs; answer only the missing questions needed to proceed. | Starts the workflow. |
| Choose housing | Compare sourced housing options and select one, or ask for different options. | A selected address can become the moving destination. |
| Compare logistics | See moving quotes and travel options, with provider, price, validity, and material conditions where available. | Moving quote needs pickup and destination details; travel search may proceed independently once route and date are known. |
| Review the plan | See the sequence, estimated costs, unresolved choices, and actions that will have an external effect. | Depends on current vendor responses. |
| Approve actions | Approve or reject each paid action separately with the exact action and current price visible. | No paid call can run before its own approval. |
| Track and recover | See progress, confirmations, failures, and any cancellation, refund, or manual follow-up required. | Uses checkpoints and service-specific recovery rules. |

Housing search and selection are distinct from signing a lease. The integrated housing service has read-only query tools and an ingestion pipeline; the [Location data report](integration/location-data-status.md) records dated import evidence, not a guarantee of current listing availability. The integrated runtime supports flight search but disables flight booking; see the [architecture](../ARCHITECTURE.md#approvals-and-service-limits) for current transaction limits.

## Interactive housing search

The team has confirmed a desktop layout with housing listings on the left and a map on the right, with automatic visible-area search after dragging or zooming. The current MapLibre workspace retrieves viewport results and exposes filters and chat. Broad searches show area/cluster guidance before listing individual homes. Shared custom requirements and evidence assessment remain part of the target behavior.

The [housing search spec](specs/SPEC-016-housing-search.md) records that baseline, current implementation evidence, and remaining proposals for shared requirements, description-based assessment, synchronized cards and markers, refresh failures, and explicit home choice. Its acceptance criteria are not a claim that every behavior is implemented. Shared interaction and prompt placement remain under review in [#28](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/28).

## Changing a finalized plan

Finalizing a plan means the customer has accepted the proposed steps; it must not make later changes impossible. A change pauses affected future actions while the system works out the impact. The customer should see what can be kept, what must be quoted again, and what has already happened. The system needs a durable record of changed inputs, approvals, and completed vendor actions; it does not necessarily need a stored copy of every plan revision.

| State when the customer changes the plan | Intended behavior |
|---|---|
| No vendor action has run | Recompute the changed task and its dependent tasks. Reuse independent results only if still valid. Refresh affected quotes and present the revised plan. |
| An affected action is awaiting approval | Invalidate its old approval. Show the revised action and price, then request a new approval. |
| A vendor action is in progress or has an uncertain outcome | Pause conflicting steps. Check the provider's actual state using the request or idempotency key before retrying or changing it. |
| A booking or payment has completed | Keep it recorded as a real action. Show the available change, cancellation, or refund path and any fee; ask before taking a new paid or consequential action. If the provider cannot reverse it, show the required manual follow-up. |

For example, if the customer changes the selected home after accepting the plan, a moving quote tied to the old address becomes stale. A flight search may remain usable if its route and date have not changed. If a moving order was already placed, the agent must check its cancellation or modification terms before proposing a replacement. It must not silently reuse the old quote or charge twice.

The open [routing orchestrator issue](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/13) proposes plan versioning alongside change-impact analysis and preservation of unaffected work. Versioning is an implementation option in that issue, not a customer requirement. The user-facing behavior above is the requirement; neither that issue nor this checkout establishes a completed implementation.

## Acceptance criteria to develop

- A plan records step inputs, outputs, dependencies, and which independent steps may run in parallel.
- A dependent step receives the required output from its predecessor; it never runs before its dependencies complete.
- A paid mock action cannot execute without approval tied to that specific action.
- A service call cannot obtain a token outside the current user's authorized scope.
- A simulated failure after a successful step produces the documented compensation or reconciliation outcome.
- A user can inspect progress during a long workflow, including paused, failed, and completed states.
- The customer can tell which housing, moving, and travel facts came from which provider and when quotes expire.
- Changing a selected home or move date updates affected downstream steps without silently preserving stale quotes or approvals.
- A change after plan finalization identifies affected and unaffected steps, records the change, and pauses affected future vendor actions.
- Completed external actions remain visible; any new paid action, cancellation fee, or replacement booking requires a fresh customer decision.
- An uncertain vendor outcome is reconciled before retrying so the change does not create a duplicate booking or charge.
- The final summary distinguishes confirmed actions, estimates, failed actions, and actions requiring manual follow-up.

These criteria need concrete examples, schemas, and tests after the first demo request and vendor actions are selected.

## Relocation workflow to demonstrate

The [confirmed MVP scope](#mvp-scope) is illustrated by this draft end-to-end flow:

1. Collect destination, move date, housing constraints, travel needs, and budget; clarify missing details.
2. Search housing options and let the user select one. Capture its address and availability for downstream steps.
3. Use the selected destination and move details to request relocation quotes and travel options. Independent searches may run in parallel; booking steps must respect their dependencies.
4. Show a consolidated plan, quotes, and the approval required for **each** paid action, including moving service and ticket purchase.
5. Execute approved actions through the relevant vendor adapters, show realtime progress, and compensate or reconcile according to each service's contract if a later step fails.

This is a draft workflow derived from the team's problem statement. The [agent demo issue](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/21) records the earlier demo proposal for Location, Moving, Flight, and Payment, with a same-city moving leg and mock payment. This is historical demo scope, not a current provider-coverage restriction: [SPEC-004/AC-20–21](specs/SPEC-004-ahamove-moving-service.md#integration-requirements-2026-09-29) and the [Moving integration response](integration/moving-service-response.md) require provider discovery and a route-specific estimate, with fresh confirmation for changed prices and no implicit 5% / 20,000 VND allowance. Neither all same-city nor all intercity routes are guaranteed; the [moving specification](specs/SPEC-004-ahamove-moving-service.md#customer-facing-moving-and-packing-requirements) separates the review example from the unconfirmed live demo route. The city, actual data, vendor actions, and integration remain work in progress. The team still needs to choose a concrete request and specify what each simulated service can reverse. See the [issue and PR map](work-in-progress.md) for branch-level progress and gaps.

## Product requirements to confirm

1. What concrete origin, destination, date, budget, and housing criteria will the first demo request use?
2. Which concrete housing, moving, and travel-booking actions will demonstrate the confirmed MVP scope, and which use mocks?
3. Which mock actions spend money or change external state, and what information is shown for approval?
4. What are the compensation, retry, timeout, duplicate request, and cancellation rules for each service?
5. What are the acceptable progress-update delay and recovery time for a long workflow?
6. What evidence will show that the plan reduces coordination effort and is correct and safe enough for a demo? No time-saved or customer-satisfaction claim has been measured yet.

## Initial boundaries

Until the team agrees otherwise, documentation treats real bookings, real-money payment, and production credentials as outside the executable baseline; the sandbox checkout demo is described under [Platform role](#platform-role). Housing lease signing is not part of the current stated workflow. The current API has no user authentication or paid-action gate. The next scope decision should be recorded here and linked to focused specs and ADRs as described in [project organization](project-organization.md).
