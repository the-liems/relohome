# ADR-003 — Approval, idempotency and recovery

- Date: 2026-09-25
- Status: Accepted
- Related specs: SPEC-004

## Context

Creating, changing or cancelling an order has real-world and financial effects.
Network failure can make the result of a create call ambiguous.

## Decision

Approvals are server-stored, expiring and bound to a canonical payload hash.
Create is guarded by a unique workflow/action idempotency key. Ambiguous create
results are reconciled by partner tracking number. Webhooks are deduplicated by
payload hash and provider status remains authoritative.

## Update 2026-09-29 (agent graph, ADR-016)

"Orchestrator" in this ADR is the graph's `transaction` node. After the user confirms and the backend
approval passes `check_approval`, `transaction` registers the approval record in the Moving database
through an internal endpoint (Q22, issue #16), then calls the write tool with that approval id. It uses
`workflow_id = lifeflow:<thread_id>` and a stable `action_id`; an ambiguous result becomes
`pending_verification` and is never retried automatically.

## Consequences

### Moving integration clarification (2026-09-29)

The trusted backend registers approvals through the authenticated internal API,
not an agent-accessible auto-approval tool. Reusing an approval ID may not change
its payload, owner or expiry, or clear consumption. HTTP MCP read and write
credentials have server-enforced scopes; registration uses a third credential.
Unclear multi-match tracking lookup remains unresolved rather than selecting
the first order. See [approval contract](../api/moving-internal-approvals.md).

The orchestrator must persist approval before calling a write tool. Write tools
cannot operate as stateless HTTP proxies.
