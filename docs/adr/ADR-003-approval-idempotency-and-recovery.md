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

The orchestrator must persist approval before calling a write tool. Write tools
cannot operate as stateless HTTP proxies.
