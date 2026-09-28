# ADR-005: Moving containers and HTTP MCP boundary

- Date: 2026-09-26
- Status: Accepted
- Scope: Moving/AhaMove; Housing/Map deployment is owned separately.

## Context

The AI Service and Moving MCP must run in separate containers. The existing stdio
entrypoint cannot serve clients over the container network. The infrastructure
proposal in PR #5 expects portable images, readiness, independent migration and
release identities. The user explicitly requires real staging tests without mocks.

## Decision

Use one multi-stage `Maps VN/LifeFlow/Dockerfile.moving` with three independently
tagged targets: `moving-mcp`, `moving-api`, `moving-migrate`. A Dockerfile is a
build recipe; multiple targets produce distinct images and containers. Domain
libraries and contracts are bundled dependencies, not additional network services.

Expose `/mcp` using the installed MCP SDK v2 `createMcpHandler` and Node adapter.
Serving is stateless with legacy stateless compatibility; workflow state, approvals
and idempotency remain in PostgreSQL. Keep the stdio executable for local clients.

The initial HTTP consumer is the team's trusted backend. Require a service-specific
bearer token, exact Origin allowlist and Host validation. This is a private service
authentication contract, not an OAuth discovery implementation. A public/general
MCP offering would need separate OAuth/resource authorization and user isolation.

Provide process liveness at `/health` and schema/permission readiness at `/ready`.
Do not call AhaMove in probes. Use a distinct database runtime role and run the
administrator-only migration target once per release. The local Compose database
is isolated; hosted deployments can use the team's existing PostgreSQL instance.

## Alternatives and consequences

- Spawning stdio through `docker exec` couples the AI container to Docker control;
  HTTP provides a regular network boundary.
- A separate Dockerfile per image duplicates the dependency build. Multi-stage
  targets retain independent release images while reusing build layers.
- HTTP has no sticky-session requirement. Provider HTTP calls and PostgreSQL must
  still be reachable, and each replica must share the same database and credentials.
- Image publication is not deployment approval. Infra owns Coolify resources,
  exact digest deployment, HTTPS, backup, domain configuration and production gates.
- Write-tool UAT and the orchestrator's human-approval integration remain required
  before enabling writes. Containerization does not satisfy those criteria.
