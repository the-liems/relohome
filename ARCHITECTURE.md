# Architecture

Status: local MVP integration, reconciled with `main` on 2026-10-04. The [product brief](docs/product.md) defines intended behavior; the [agent graph design](docs/architecture/agent-graph.md), [integration index](docs/integration/README.md), and [frontend audit](apps/web/SERVICE_AUDIT.md) describe implementation details and limits.

## Implemented system

The React frontend sends authenticated requests through a Python browser gateway. The gateway owns browser sessions and conversation history, and forwards requests to the FastAPI agent API with a server token and user identity. LangGraph coordinates intake, planning, domain reads, validation, confirmation, and transactions. Provider connections are configured separately.

```mermaid
flowchart LR
    Browser[React frontend] --> Gateway[Python browser gateway]
    Gateway --> API[FastAPI agent API]
    Gateway --> Platform[Location Platform API]
    API --> Graph[LangGraph workflow]
    Graph --> Read[Domain agents and read tools]
    Read --> Location[Location MCP]
    Read --> Moving[Moving MCP]
    Read --> Flight[Flight MCP]
    Read --> Payment[Payment MCP]
    Graph --> Confirm[Human confirmation]
    Confirm --> Transaction[Transaction adapter]
    Transaction --> Moving
    Graph --> SQLite[Local checkpoints and runtime stores]
    Location --> PostGIS[PostGIS]
    Platform --> PostGIS
    Location --> OSRM[OSRM routing]
    Platform --> OSRM
```

| Component | Source | Responsibility |
|---|---|---|
| Browser application | `apps/web/src/` | Chat, housing/map workspaces, plan progress, and confirmation forms |
| Browser gateway | `apps/browser-gateway/src/relohome_gateway/server.py`, `apps/browser-gateway/src/relohome_gateway/store.py` | HttpOnly sessions, thread ownership, history, and upstream requests |
| Agent API | `apps/agent-api/src/relohome_agent/main.py`, `apps/agent-api/src/relohome_agent/api/` | Chat, state, decisions, UI actions, and opt-in sandbox payment endpoints |
| Agent workflow | `apps/agent-api/src/relohome_agent/agents/` | LLM intake/planning, domain execution, validation, cost summary, approval, and response |
| Service adapters | `apps/agent-api/src/relohome_agent/services/adapters/` | MCP boundaries, moving approvals, transactions, and local persistence |
| Location platform | `apps/platform-api/`, `apps/location-mcp/`, `examples/map-app/`, `deploy/database/` | Housing/POI queries, geographic data, routes, REST API, and MCP tools |
| Moving service | `packages/moving-service/` | AhaMove adapter, quotes, approval records, order actions, and webhooks |
| Flight and Payment | `apps/flights-mcp/` and `apps/payments-mcp/` | Flight search and payment tools with provider-specific configuration |
| Streamlit examples | `examples/streamlit/src/relohome_demos/` | Flight, Payment and agent-chat HTTP demos; shared library dependencies only |
| Static references | `examples/design-reference/` | HTML/image design evidence, outside runtime images |
| Standalone agent services | `apps/intake-api/` and `apps/orchestrator-api/` | Separate Intake and Routing APIs; execution gateway disconnected by default |

The integrated entrypoint is `AgentService.open()`. It requires live-mode configuration and an LLM API key. It persists graph checkpoints and runtime records in SQLite and wraps configured domains with LLM agents. The standalone services have a separate lifecycle and runbook.

## Approvals and service limits

Domain agents use read tools. The transaction adapter handles configured writes after confirmation and checks the approval against the user, thread, plan version, payload hash, and expiry. The moving service has separate read, write, and approval credentials. Changes to a plan can invalidate dependent results and require a new confirmation.

Moving transactions in the integrated MVP are restricted to AhaMove staging and use CASH. Flight search is supported, but the integrated runtime removes flight booking capabilities. ZaloPay sandbox payment creation is a separate opt-in form/API flow. These implementation limits do not establish production booking or payment support.

Runtime state, approval records, and encrypted PII are stored locally. Deployment currently assumes one application worker for the agent runtime. A provider timeout can require reconciliation; the code includes write-intent records, but recovery and ownership gaps identified during review remain unresolved.

## Product target and historical diagrams

The [confirmed MVP scope](docs/product.md#mvp-scope) includes housing selection, moving services, and travel booking. The [shared tool catalogue](docs/specs/SPEC-008-service-tools.md) describes proposed contracts and vendor lifecycles. The [roadmap](docs/roadmap.md) owns delivery milestones.

The [interactive housing search spec](docs/specs/SPEC-016-housing-search.md) preserves the desktop list/map and automatic viewport-search baseline and distinguishes it from the current MapLibre workspace, Location contracts, and provider-backed home-selection path. Its remaining proposals cover shared requirements, evidence assessment, location precision, and selection provenance. Browsing or focusing a card does not choose a home; an explicit home choice can invalidate dependent plan results.

The [product flow and dependency diagrams](docs/architecture_diagram.md) and [issue/PR map](docs/work-in-progress.md) capture the baseline and proposals from 2026-09-30. The integrated graph is described in [agent-graph.md](docs/architecture/agent-graph.md). Architectural decisions are indexed under [docs/adr/](docs/adr/README.md).

## Planned hosted delivery

The [infrastructure plan](docs/architecture/infrastructure.md) defines integrated application
delivery through GitHub Actions, ARM64 images in GHCR, and Coolify Docker Compose
Empty Services in one project with staging and production environments. Resources,
data, credentials, and release configuration are environment-specific; server
placement is a deployment input and can expand independently of the CD contract.
Successful eligible `main` revisions reach staging; a published
versioned release selects staging-verified image digests for an operator-dispatched
production promotion from current `main`, without rebuilding. The plan records the existing Coolify/runner setup separately from
deployment automation and production readiness that still require verification.

The [Coolify scaling and migration plan](docs/architecture/migration-options.md)
covers host resizing/relocation and qualified multi-server deployment, preserving
the same release contract and data cutover/recovery gates.

## Running and verifying

Follow the [local MVP runbook](docs/runbooks/local-mvp.md), [frontend guide](apps/web/README.md), [Location guide](docs/location/README.md), and [Moving container runbook](docs/runbooks/moving-containers.md). The root Compose file starts the backend and Flight/Payment MCP containers; other services have separate setup.

Review evidence is under [docs/review/](docs/review/) and [eval/](eval/). Dated reports describe the configurations they tested. Existing Python test failures and runtime review findings remain open; this documentation cleanup does not certify production readiness.

Python source entrypoints use installed `relohome_*` namespaces. The only retained
legacy module identifier is `src.agents.models`, registered in memory for stored
LangGraph checkpoints and rollback readers. `Frontend/` has no source modules;
its ignored `data/housing-media` path remains the local media default. See the
[example/shim accounting](docs/integration/python-examples-and-shims.md).
