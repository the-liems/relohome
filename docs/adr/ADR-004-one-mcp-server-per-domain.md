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

## Consequences

Failure and credential scope are isolated. The orchestrator connects to several
MCP servers, while schema primitives and operational conventions remain common.
