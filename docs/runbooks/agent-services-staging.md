# Intake and Routing Orchestrator — staging handoff

Two independent images from `Dockerfile.agents`:

| Component | Target | Container port | Persistence |
|---|---|---|---|
| Intake | `intake` | 8000 | none |
| Routing Orchestrator | `orchestrator` | 8000 | `/app/data` local durable volume, UID 10001 |

Use `compose.agents.yaml` as the local reference. No deploy is performed by the
agent-services CI workflow; it validates/builds/smokes only. These standalone
services are not in `compose.coolify.yaml` or its application image catalog. Infra owners control any separate image publication and rollout;
the integrated Application uses the [deployment runbook](../../deploy/README.md).

Supply only OPENAI_API_KEY, component model setting and its own API token. Routing
also receives its independent approval-backend token if that endpoint is enabled.
Do not pass AhaMove or other domain provider secrets. Never put secrets in build
arguments or images. Registry is packaged metadata, not a provider connection.

Keep both APIs internal behind the authenticated backend. End-user identity comes
from that backend; `X-Owner-ID` is not authenticated on its own. Keep OpenAPI/docs
internal. The deployment caller, not an LLM, holds service credentials.

Liveness is `/health`. Intake `/ready` requires LLM key and service token. Routing
`/ready` reports local storage/API readiness plus separate planning and execution
capabilities; in this release execution is intentionally disconnected. Key presence
does not guarantee provider connectivity. Perform the opt-in live check before rollout.

One host/replica for SQLite; do not mount its file across a cluster. Back up the
volume before image/registry changes, preserve it across restarts, and restrict
access because workflows may contain user input. Registry changes invalidate old
workflow execution until a reviewed migration. There are no database migration
steps for domain services in these images.

This handoff does not connect Chat API, Intake to Routing, MCP adapters or approval
records in Moving. Those need the integration milestone and domain-owner review.
