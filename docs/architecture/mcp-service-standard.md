# ReloHome MCP service standard

Status: implemented initially by Moving; existing services can adopt it without
changing their domain contracts.

## Isolation and sharing

Every domain MCP server is an independent process with its own tool registry,
configuration and provider dependencies. Servers may share:

- `@relohome/contracts` for canonical cross-service value objects;
- `@relohome/mcp-core` for audited handlers, response behavior and error shape;
- infrastructure services such as PostgreSQL, using separate schemas and roles.

They must not share provider credentials or call another service's private
adapter. Cross-domain work is coordinated by the orchestrator through MCP.

## Required server behavior

1. Stable server name and semantic version.
2. Typed input and output schemas for every tool.
3. Both text content and structured content on success.
4. Stable error code, safe message and retryability on failure.
5. Accurate MCP annotations.
6. Input validation before side effects.
7. Timeouts on every external operation.
8. Secrets never accepted as tool arguments.
9. Audit contains only tool name, input key names, result, duration and code.
10. Graceful transport and resource shutdown.
11. Network deployments use authenticated HTTP MCP, Host/Origin validation and bounded bodies.
12. Separate process liveness (`/health`) from database/schema readiness (`/ready`).
13. Container images run non-root, keep secrets out of build layers, and report a release identity.

Moving implements this network profile first; it retains stdio. Its private
service bearer token is not a user identity or a general OAuth integration.

## Tool classes

| Class | `readOnlyHint` | `destructiveHint` | Approval |
|---|---:|---:|---|
| Query | true | false | No |
| Quote | true | false | No; result expires |
| Create | false | false | Required |
| Update | false | depends on effect | Required for material changes |
| Cancel/Delete | false | true | Required |
| Administrative | not exposed by default | varies | Human/operator only |

`idempotentHint` is true only when the implementation, not merely the upstream
documentation, guarantees safe repetition.

## Security boundary

MCP is not a credential broker. Account registration, token refresh, provider
base URLs and webhook secrets belong to the service adapter/configuration layer.
No tool may accept an arbitrary URL, SQL query, header or provider payload.

## Testing rule

ReloHome Moving intentionally has no mocked provider response or mock AhaMove
server. Pure policy/schema checks may run locally; real provider behavior is
verified by opt-in staging integration tests and documented UAT.
