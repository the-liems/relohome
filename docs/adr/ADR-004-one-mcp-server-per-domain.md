# ADR-004 — One MCP server per domain service

- Date: 2026-09-25
- Status: Accepted
- Related specs: SPEC-004

## Context

Housing, maps, moving, travel and other services have different credentials,
failure modes, permissions and release cycles.

## Decision

Each domain has an independently startable MCP server and tool registry. Servers
share versioned contracts and `@lifeflow/mcp-core` behavior for result envelopes,
error classification, redacted audit and annotations. They do not import one
another's provider clients.

## Update 2026-09-29

`@lifeflow/mcp-core` applies to the TypeScript servers in `Maps VN/LifeFlow`. The Python servers
(Flight, Payment; ADR-013, ADR-014) use FastMCP and do not share it. The agent graph normalises both
result and error formats in its MCP client (`src/services/adapters/mcp.py`) and keeps separate read and
write tool allowlists per server.

## Consequences

Failure and credential scope are isolated. The orchestrator connects to several
MCP servers, while schema primitives and operational conventions remain common.
