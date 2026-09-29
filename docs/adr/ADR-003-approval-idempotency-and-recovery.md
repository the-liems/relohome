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
