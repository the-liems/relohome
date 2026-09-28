# ADR-002 — Service adapter boundary

- Date: 2026-09-25
- Status: Accepted
- Related specs: SPEC-004

## Context

AhaMove-specific identifiers and payloads change independently from LifeFlow's
agent workflow and may later be joined by another moving provider.

## Decision

MCP tools expose provider-independent Moving contracts. `MovingService` owns
business policy; `AhaMoveClient` owns HTTP/authentication; mapper functions are
the only boundary that understands both representations.

## Consequences

Provider extensions remain available as factual metadata, but callers cannot
send arbitrary upstream payloads or URLs.
