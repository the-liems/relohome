# ADR-001 — Polyglot LifeFlow workspace

- Date: 2026-09-25
- Status: Accepted
- Related specs: SPEC-004

## Context

The repository began as a Python FastAPI/LangGraph template. The implemented
Map, PostGIS, Housing Query and MCP components form a TypeScript workspace under
`Maps VN/LifeFlow`. Moving must reuse those contracts and operational services
without rewriting them in Python.

## Alternatives

1. Reimplement Moving in Python and duplicate TypeScript contracts.
2. Move the whole LifeFlow workspace under `src/` immediately.
3. Keep the bounded TypeScript workspace and document the exception.

## Decision

Keep `Maps VN/LifeFlow` as a versioned polyglot application workspace. New
TypeScript integration services remain inside it. Root Python application code
continues under `src/`. Both runtimes are built and tested by root CI.

## Rationale

This preserves working Map/Housing code, avoids duplicate schemas and makes the
layout exception explicit before adding another service.

## Consequences

CI, setup and architecture documentation must cover both runtimes. A future move
of the workspace requires a new ADR and migration plan.
