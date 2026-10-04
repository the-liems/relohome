# Architecture diagrams

> Baseline snapshot: 2026-09-30, before the local MVP integration. See the [current architecture](../ARCHITECTURE.md) and [agent graph](architecture/agent-graph.md) for the integrated runtime.

These diagrams distinguish the code that exists from the proposed product. Component details and security limits are in [ARCHITECTURE.md](../ARCHITECTURE.md).

## Current implementation

```mermaid
flowchart LR
    User[HTTP client] --> FastAPI[FastAPI]
    FastAPI --> Health[GET /health]
    FastAPI --> Status[GET /api/v1/status]
    FastAPI --> Chat[POST /api/v1/chat]
    Chat --> Validation[ChatRequest validation]
    Validation --> Analyze[LangGraph: analyze]
    Analyze --> Respond[LangGraph: respond]
    Respond --> ChatResponse[ChatResponse]
```

The two graph nodes return example text. The calculator, knowledge-search stub, and configured LLM factory are outside this execution path. The application has no connected database, vector store, frontend, or external service.

## Proposed product flow

```mermaid
flowchart LR
    Request[User goal] --> Plan[Break goal into dependent steps]
    Plan --> State[LangGraph state and checkpoints]
    State --> Approve[Approve each paid step]
    Approve --> Scope[Check user-scoped token]
    Scope --> Execute[Run sequential or parallel service calls]
    Execute --> Result[Final result]
    Execute --> Progress[Realtime progress]
    Execute --> Recovery[Saga compensation after failure]
    Recovery --> Result
```

This flow reflects the team's stated target and has not yet been implemented. The exact service APIs and first demo scenario remain to be selected.

## Relocation task dependencies (illustrative)

```mermaid
flowchart LR
    Goal[Move goal and constraints] --> Housing[Search housing]
    Goal --> Travel[Search travel]
    Housing --> Choice[Customer selects a home]
    Choice --> Moving[Request moving quote for its address]
    Travel --> Review[Review combined plan]
    Moving --> Review
    Review --> MoveApproval[Approve moving action]
    Review --> TravelApproval[Approve travel action]
    MoveApproval --> MoveAction[Moving vendor action]
    TravelApproval --> TravelAction[Travel vendor action]
    MoveAction --> Progress[Progress and final status]
    TravelAction --> Progress
```

Travel search can proceed while housing options are being found if its route and date are known. A moving quote depends on the chosen destination address. Each paid vendor action has its own approval. If a later action fails, the orchestrator must report and reconcile the earlier actions according to their service contracts. This diagram shows intended dependencies, not an implemented workflow or a commitment to a specific vendor sequence.

## Change after plan finalization (proposed)

```mermaid
flowchart LR
    Change[Customer changes the plan] --> Impact[Find affected tasks]
    Impact --> Record[Record the change and pause affected actions]
    Record --> Refresh[Refresh stale quotes and inputs]
    Record --> Reconcile[Check completed or uncertain vendor actions]
    Refresh --> Preview[Show revised plan and costs]
    Reconcile --> Preview
    Preview --> Approval[Request fresh approval for affected actions]
```

Unrelated results can be reused only while valid. A completed booking remains visible and may require cancellation, refund, or manual follow-up. The customer must approve any new paid action and any consequential change that incurs a fee. The [product brief](product.md#changing-a-finalized-plan) defines the intended behavior; this flow is not implemented in the current checkout.
