# Thiết kế khung LangGraph cho Stateful Multi-Agent Orchestration

Status: proposed — tài liệu thiết kế, **chưa implement**. Code hiện tại trong
`src/agents/` vẫn là template (`analyze → respond`).
Date: 2026-09-27. Cập nhật 2026-09-28: thêm tầng `intake` và ranh giới "Routing
Orchestrator" theo góp ý mentor (§3.2); chốt quy tắc hỏi ngay / hỏi sau và tự điền
từ dữ liệu đã lưu (§6.1); thêm kiểm soát chi phí (§7.5); chốt chính sách bộ nhớ người
dùng (§6.0, §6.1, Q14); chuẩn contract cho subagent của từng service (§6.3, D13).

**Người viết subagent cho service** đọc §6.3 (contract, quy tắc R1–R12), §6.3.8
(input/output tối thiểu theo lĩnh vực) và §6.9 (commit endpoint, nếu service có thao
tác ghi).

Tài liệu này chuyển sơ đồ kiến trúc v4 thành một **khung LangGraph** có thể code
ngay: topology graph, state schema, contract của từng node/subagent và điểm ráp
(API thật, subagent thật, Intake, Orchestrator). Mục tiêu là dựng được graph chạy
end-to-end bằng **stub + fake adapter**, để sau này khi có API hoặc thiết kế
Intake/Orchestrator thì chỉ cần thay implementation sau interface, không phải sửa graph.

![Stateful Multi-Agent Orchestration Architecture — v4](images/architecture-v4.png)

Bản chi tiết (baseline) dùng để đối chiếu thành phần:
[architecture-baseline.png](images/architecture-baseline.png).

---

## 1. Phạm vi

**Trong phạm vi tài liệu này**

- Topology cố định của graph LangGraph (node, edge, conditional edge).
- `WorkflowState` và các kiểu dữ liệu con (IntakeResult, Task, Plan, TaskResult, …) cùng reducer.
- Contract (interface) cho các phần sẽ ráp sau: Intake, Planner (Orchestrator),
  **subagent của từng service** (manifest, request/result, quy tắc R1–R12), commit
  endpoint, Port của graph (Transaction, Approval, Session).
- Cơ chế runtime: checkpoint, retry/timeout, data quality, change impact,
  human-in-the-loop, approval.
- Cách API FastAPI gọi graph (mô tả, chưa code).
- Layout thư mục code và thứ tự implement.

**Ngoài phạm vi (làm sau)**

- Logic bên trong Intake và Planner — **để trống**, chỉ có contract và stub.
- Bên trong subagent của từng service (housing/location, moving, flight, hợp đồng /
  chính sách dùng RAG, payment): do chủ service viết theo §6.3, gồm cả adapter tới
  provider thật.
- Prompt LLM, lựa chọn model, đánh giá chất lượng.
- UI, deployment (xem `docs/architecture/infrastructure.md` trên branch
  `docs/coolify-migration-plan`).

**Quy ước:** văn bản tiếng Việt; tên node, field, class, enum giữ tiếng Anh để
dùng thẳng trong code. Các đoạn code trong tài liệu là **đặc tả**, không phải code
đã tồn tại.

---

## 2. Quyết định nền tảng

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Theo sơ đồ **v4**: 5 domain agent trong Phase 2; Transaction/Payment tách riêng ở Phase 5; Booking/Reservation của baseline gộp vào Transaction. | Tách rõ "thu thập thông tin" (không side-effect) với "commit" (có side-effect, cần xác nhận). |
| D2 | Mô hình **Intake + Plan-and-Execute + Validator + Human-in-the-loop**, không phải một ReAct agent duy nhất. | Đúng với 5 phase trong sơ đồ; dễ kiểm soát, dễ test. |
| D3 | **Graph LangGraph cố định; kế hoạch (Dependency DAG) là dữ liệu trong state.** | Orchestrator sinh DAG động mỗi request; graph không đổi. Xem §3.1. |
| D4 | Subagent và API ngoài đi qua **Protocol + dependency injection** (`GraphDeps`). | Chạy được với fake ngay; ráp API thật không đổi graph. |
| D5 | Validator, Cost Summary, Change Impact, Executor là **deterministic** (không LLM). | Đúng yêu cầu "deterministic totals"; test được; không bịa số. |
| D6 | Lỗi của subagent là **dữ liệu** (`TaskResult.status = FAILED`), không làm crash graph. | Validator quyết định retry/replan/hỏi user dựa trên dữ liệu đó. |
| D7 | State top-level là `TypedDict` (theo [guide state.md](../guide/langgraph/state.md)); kiểu con dùng Pydantic v2. | TypedDict hợp với reducer của LangGraph; Pydantic validate output của Intake, Planner và adapter. Checkpointer của LangGraph serialize được Pydantic. |
| D8 | **Ba ranh giới: hiểu (`intake`) → lập kế hoạch (`orchestrator`) → thực thi (`executor`).** `orchestrator` + `executor` + `change_impact` gọi chung là **Routing Orchestrator**. Mọi tin nhắn tự nhiên của người dùng, kể cả đổi ý, đi qua `intake`. | Kết hợp hai phương án đã cân nhắc. Xem §3.2. |
| D9 | **Domain agent chỉ đọc.** Mọi thao tác ghi (đặt cọc, đặt xe, đặt vé, thanh toán) chỉ nằm ở `transaction`, sau khi có **approval do backend lưu**, không phải do model tạo. | Không có side-effect trong fan-out song song; approval không thể bị model giả mạo. |
| D10 | **Chỉ hỏi ngay khi không task nào trong yêu cầu chạy được** (hoặc có mâu thuẫn); còn lại chạy phần làm được rồi hỏi sau. Được **tự điền** thông tin thiếu từ dữ liệu người dùng đã cung cấp trước đó, nhưng **phải thông báo** để người dùng sửa. | Ít lượt hỏi, người dùng thấy kết quả sớm; không tự đoán vì dữ liệu tự điền đến từ chính người dùng. §6.1 |
| D11 | **Chi phí có trần theo lượt và theo thread.** LLM của graph chỉ dùng ở `intake` và `orchestrator`; LLM bên trong subagent (D13) báo qua `usage` và vẫn tính vào trần; `respond` dùng template ở giai đoạn khung; các node còn lại là code. | Chi phí dự đoán được, đo được theo request. §7.5 |
| D12 | **Bộ nhớ người dùng tách khỏi dữ liệu gốc** và chỉ chứa điều người dùng nói ra hoặc xác nhận, chia ba mức (tự điền / chỉ gợi ý / không dùng), có hạn theo thời gian và theo sự kiện. | Tự điền không thành tự đoán; không dùng lại dữ liệu phòng/giá đã hết hạn. §6.0, §6.1 |
| D13 | **Mỗi service có subagent riêng do chủ service viết**; graph chỉ nối vào qua contract chung (manifest + `run_task`, §6.3). DAG của Planner ở mức **giữa các lĩnh vực**; việc bên trong lĩnh vực là của subagent. Subagent chỉ đọc, không hỏi người dùng trực tiếp, không gọi chéo lĩnh vực; thao tác ghi đi qua commit endpoint tất định. | Các đội làm song song, đổi bên trong subagent không phải sửa graph; giữ được kiểm soát chi phí, phụ thuộc và an toàn ghi ở graph. |

---

## 3. Ánh xạ sơ đồ v4 → LangGraph

| Sơ đồ v4 | Thành phần LangGraph | Ghi chú |
|---|---|---|
| User (chat / web / mobile) | FastAPI `/chat` → `graph.ainvoke` | Ngoài graph. §9 |
| Context & Session | node `load_context` | Đọc long-term memory qua `SessionPort`. |
| Lead Orchestrator — phần intent + constraints | node `intake` gọi `deps.intake` | **Stub.** Hỏi lại nếu thiếu thông tin chặn. §6.1 |
| Lead Orchestrator — phần decompose → task DAG | node `orchestrator` gọi `deps.planner` | **Stub.** §6.2 |
| Intent + constraints / Task decomposition / Dependency DAG | `IntakeResult.intent`, `.constraints`; `Plan.tasks[].depends_on` | Dữ liệu, không phải node. |
| Executor / Dynamic Router (READY tasks, dispatch) | node `executor` + conditional edge `route_from_executor` trả về `list[Send]` | Fan-out song song. §6.4 |
| 5 domain agent | node `property_agent`, `relocation_agent`, `flight_agent`, `map_agent`, `contract_agent` | Mỗi node nối tới **subagent của service** (do chủ service viết) qua `DomainAgent`; chỉ đọc. §6.3 |
| Collect Results | reducer `merge_dict` trên `task_results`, `task_status` | Fan-in: các agent chạy song song đều quay về `executor`, executor chạy **một lần** ở superstep kế tiếp. |
| Result Validator (PASS / NEED MORE) | node `validator` + conditional edge `route_from_validator` | §6.5 |
| Cost & Plan Summary | node `cost_summary` | §6.6 |
| User Confirmation | node `confirm` dùng `interrupt()`; resume bằng `Command(resume=...)` | §6.7 |
| CONFIRM | edge `confirm → transaction` (kèm approval hợp lệ) | |
| CHANGE / REJECT | `confirm` → `intake` → `change_impact` → `orchestrator` | §6.8 |
| Transaction / Payment Agent | node `transaction` | Idempotent, kiểm approval. §6.9 |
| Response | node `respond` | §6.10 |
| Workflow State / Checkpoint | `WorkflowState` + checkpointer, key theo `thread_id` | §7.1 |
| Retry / Timeout / Fallback | wrapper `run_with_policy` quanh mỗi subagent (timeout, budget); retry provider bên trong subagent; `FallbackAgent` | §6.3.6, §7.2 |
| Data Quality / Unknown Fields | `TaskResult.missing_fields`; validator V2 | Không bao giờ tự điền field thiếu. |
| Change Impact / Compensation | `change_impact` đánh dấu `STALE` theo `depends_on`; `TransactionPort.compensate` | §6.8, §6.9 |

Thành phần của baseline **không** nằm trong graph: Chat/Web/Mobile UI, API Gateway,
Property DB, Vector DB, Crawled Property Documents (do `crawler/` + `preprocess/`
tạo ra), Payment Gateway, Maps/Flight/Moving APIs, Approval Store, và **bên trong
các subagent**. Graph chỉ chạm tới chúng qua subagent (contract §6.3) hoặc Port.

### 3.1. Graph LangGraph ≠ Dependency DAG

Có **hai** "graph" khác nhau, rất dễ nhầm:

| | Graph LangGraph | Dependency DAG (plan) |
|---|---|---|
| Là gì | Luồng điều khiển của hệ thống | Kế hoạch công việc cho **một** yêu cầu |
| Ai tạo | Dev, lúc build (`build_graph`) | Orchestrator, lúc runtime |
| Thay đổi | Không bao giờ trong runtime | Mỗi request / mỗi lần replan có version mới |
| Lưu ở đâu | Code | `state["plan"]` (được checkpoint) |
| Node | `intake`, `orchestrator`, `executor`, `*_agent`, … | `Task` (ví dụ `t1: property search`) |

`executor` đọc DAG trong state, tìm task đã đủ điều kiện (READY) và `Send` sang
node agent tương ứng. Vòng `executor → agents → executor` lặp cho tới khi hết task
chạy được.

### 3.2. Ranh giới trách nhiệm: kết hợp phương án A và B

Có ba việc: **hiểu** yêu cầu (U), **lập kế hoạch** (P) và **thực thi** (E). Hai
phương án đã cân nhắc cắt ở hai chỗ khác nhau:

- **A (sơ đồ gốc):** `[U + P] | [E]`, tức Planner → Router/Executor.
- **B (góp ý mentor):** `[U] | [P + E]`, tức Intake → Routing Orchestrator.

Khung này **cắt cả hai chỗ**:

```mermaid
flowchart LR
    msg(["Tin nhắn người dùng<br/>kể cả đổi ý"]) --> U
    U["intake<br/>(hiểu: intent, constraints,<br/>thiếu / mâu thuẫn)"]
    U -->|"thiếu thông tin chặn"| ask([Hỏi lại])
    U -->|IntakeResult| P
    subgraph RO["Routing Orchestrator — một chủ sở hữu vòng đời plan"]
        P["orchestrator<br/>(Planner: lập / replan DAG)"]
        E["executor<br/>(code thuần: lên lịch DAG)"]
        CI["change_impact<br/>(code thuần)"]
        P -->|"Plan vN"| E
        CI --> P
    end
    U -->|"CHANGE"| CI
    E -->|task_results| V["validator<br/>(code thuần)"]
    V -->|"REPLAN: có hay không"| P
    V -->|"RETRY_TASKS"| E
```

| Lấy từ | Điểm giữ lại |
|---|---|
| **A** | Lập kế hoạch (LLM hoặc rule) tách khỏi thực thi (code thuần). Scheduler test được bằng hàm thuần, idempotent. `Plan.version` là contract giữa hai phần. |
| **B** | `intake` riêng: hỏi lại **trước** khi tốn công lập plan, và test intent độc lập. Chỉ Routing Orchestrator được tạo hoặc sửa plan. Contract giữa hai tầng là `IntakeResult` (nghiệp vụ), không phải tool/endpoint. Approval do backend lưu, gắn với hash payload. Service phải có trong registry (allowlist). Ghi rõ nguồn sandbox/demo. |
| Bổ sung | **Validator quyết định *có* replan hay không; Planner quyết định replan *thế nào*.** Đây là điểm cả A và B còn bỏ ngỏ. Đổi ý bằng lời phải đi qua `intake` trước, vì Router không phải nơi hiểu ngôn ngữ tự nhiên. Payment không nằm trong fan-out đọc (D9). |

| Thành phần | Sở hữu | Không sở hữu |
|---|---|---|
| `load_context` | Tải sở thích, lựa chọn đã xác nhận, lịch sử | Suy đoán yêu cầu mới |
| `intake` | Phân loại yêu cầu (`RequestKind`), trích intent/constraints, phát hiện thiếu hoặc mâu thuẫn, gộp dữ kiện qua các lượt, xác định task người dùng muốn đổi | Chọn agent/tool, tạo DAG, phê duyệt |
| `orchestrator` | Lập và replan DAG từ `IntakeResult` + feedback, validate plan với registry | Gọi provider, tự quyết định retry |
| `executor` | Tính task READY, dispatch song song/tuần tự, đếm lượt | Quyết định nghiệp vụ, sửa plan |
| `validator` | Kiểm kết quả; chọn PASS / RETRY / REPLAN / ASK_USER / GIVE_UP | Tạo task mới |
| `change_impact` | Đánh dấu STALE theo `depends_on`, xác định phần tái dùng | Hiểu câu đổi ý bằng lời |
| Subagent của service (chủ service viết) | Thực hiện một task trong lĩnh vực của mình: gọi tool, lọc, xếp hạng, retry provider | Lập plan giữa các lĩnh vực, hỏi người dùng trực tiếp, gọi chéo lĩnh vực, ghi |
| `transaction` | Kiểm approval, commit idempotent qua commit endpoint tất định, compensate | Tự tạo approval, gọi subagent LLM để ghi |
| Backend (ngoài graph) | Xác thực người dùng, lưu `Approval` gắn hash payload | Quyết định plan |

---

## 4. Topology graph

```mermaid
flowchart TD
    start([START]) --> load_context
    load_context --> intake

    intake -->|"NEW_GOAL / REFINE, đủ thông tin"| orchestrator
    intake -->|"CHANGE, đã có plan"| change_impact
    intake -->|"thiếu thông tin chặn / mâu thuẫn → CLARIFY"| respond
    intake -->|"UNSUPPORTED / vượt trần chi phí"| respond

    subgraph RO["Routing Orchestrator"]
        orchestrator
        executor
        change_impact
    end

    orchestrator -->|plan hợp lệ| executor
    orchestrator -->|"plan rỗng / không hợp lệ / hết max_replans"| respond
    change_impact --> orchestrator

    subgraph DA["Node nối tới subagent của từng service — chỉ đọc"]
        property_agent
        relocation_agent
        flight_agent
        map_agent
        contract_agent
    end

    executor -. "Send(task)" .-> property_agent
    executor -. "Send(task)" .-> relocation_agent
    executor -. "Send(task)" .-> flight_agent
    executor -. "Send(task)" .-> map_agent
    executor -. "Send(task)" .-> contract_agent

    property_agent --> executor
    relocation_agent --> executor
    flight_agent --> executor
    map_agent --> executor
    contract_agent --> executor

    executor -->|không còn task chạy được| validator

    validator -->|PASS| cost_summary
    validator -->|"NEED_MORE: RETRY_TASKS"| executor
    validator -->|"NEED_MORE: REPLAN"| orchestrator
    validator -->|"NEED_MORE: ASK_USER / GIVE_UP"| respond

    cost_summary -->|plan có commit action| confirm
    cost_summary -->|chỉ hỏi thông tin| respond

    confirm -->|"CONFIRM + approval hợp lệ"| transaction
    confirm -->|"CHANGE / REJECT"| intake
    confirm -->|CANCEL| respond

    transaction --> respond
    respond --> finish([END])
```

### 4.1. Bảng edge và điều kiện

| Từ | Hàm routing | Điều kiện | Tới |
|---|---|---|---|
| `START` | — | luôn | `load_context` |
| `load_context` | — | luôn | `intake` |
| `intake` | `route_from_intake` | `kind == UNSUPPORTED`, hoặc vượt trần chi phí (§7.5) | `respond` |
| | | `needs_clarification` (có `blocking_missing` hoặc `conflicts`) | `respond` |
| | | `kind == CHANGE` và `plan` đã có | `change_impact` |
| | | ngược lại (`NEW_GOAL`, `REFINE`, hoặc `CHANGE` khi chưa có plan) | `orchestrator` |
| `orchestrator` | `route_from_orchestrator` | `plan` có ≥ 1 task và không có lỗi validate plan | `executor` |
| | | ngược lại (stub trả plan rỗng, plan lỗi, vượt `max_replans` hoặc trần LLM) | `respond` |
| `executor` | `route_from_executor` | `state["dispatch"]` không rỗng | `[Send(f"{task.agent}_agent", AgentInput) for task in dispatch]` |
| | | không còn task `READY` hay `RUNNING` | `validator` |
| `*_agent` | — | luôn | `executor` |
| `validator` | `route_from_validator` | `verdict == PASS` | `cost_summary` |
| | | `action == RETRY_TASKS` | `executor` |
| | | `action == REPLAN` | `orchestrator` |
| | | `action in (ASK_USER, GIVE_UP)` | `respond` |
| `cost_summary` | `route_from_cost_summary` | `plan.commit_actions` không rỗng | `confirm` |
| | | ngược lại | `respond` |
| `confirm` | `route_from_confirm` | `CONFIRM` (approval đã được kiểm trong node) | `transaction` |
| | | `CHANGE`, `REJECT` | `intake` |
| | | `CANCEL` | `respond` |
| `change_impact` | — | luôn | `orchestrator` |
| `transaction` | — | luôn | `respond` |
| `respond` | — | luôn | `END` |

`CANCEL` là bổ sung so với sơ đồ v4 (người dùng bỏ hẳn, không muốn phương án khác).
Hàm routing là hàm thuần (chỉ đọc state, không ghi), đặt chung trong `routing.py`
để test riêng.

Một lượt chat mới trên cùng `thread_id` (graph đã tới `END`) cũng đi
`START → load_context → intake`. Nếu đã có plan, `intake` quyết định đây là
`REFINE`, `CHANGE` hay `NEW_GOAL`. Nhờ vậy đổi ý bằng nút bấm hay bằng tin nhắn
đều đi cùng một đường.

### 4.2. Chống lặp vô hạn

Có bốn vòng lặp: `executor ↔ agents`, `validator → executor`,
`validator → orchestrator`, `confirm → intake → change_impact → orchestrator`. Chặn bằng:

- `max_task_attempts` — mỗi task được dispatch tối đa N lần (đếm trong `task_attempts`).
- `max_replans` — `replan_count` vượt ngưỡng thì `orchestrator` route sang `respond`.
  Replan do CHANGE cũng tính vào `replan_count`.
- `recursion_limit` của LangGraph (mặc định 25 superstep) phải nâng lên, ví dụ 100,
  vì mỗi vòng executor/agent tốn 2 superstep. Truyền qua `config={"recursion_limit": ...}`.

Hỏi lại (`CLARIFY`) luôn kết thúc lượt ở `END`, nên không tạo vòng lặp trong một lượt.

---

## 5. State schema

### 5.1. `WorkflowState`

```python
class WorkflowState(TypedDict, total=False):
    # --- Input & hội thoại ---
    messages: Annotated[list[AnyMessage], add_messages]
    user_id: str
    session: SessionContext            # load_context ghi

    # --- Phase 1: Understand & Plan ---
    intake: IntakeResult | None        # intake ghi (gộp dần qua các lượt)
    plan: Plan | None                  # orchestrator ghi (version tăng dần)
    replan_count: int                  # orchestrator ghi
    change_context: ChangeContext | None  # change_impact ghi, orchestrator đọc

    # --- Phase 2: Execute ---
    task_status: Annotated[dict[str, TaskStatus], merge_dict]
    task_attempts: Annotated[dict[str, int], merge_dict]
    task_results: Annotated[dict[str, TaskResult], merge_dict]
    dispatch: list[str]                # executor ghi; id task gửi đi ở vòng này

    # --- Phase 3: Validate ---
    validation: ValidationReport | None

    # --- Phase 4: Decide ---
    cost_summary: CostSummary | None
    user_decision: UserDecision | None

    # --- Phase 5: Commit & Respond ---
    transaction: TransactionResult | None
    response: AgentResponse | None

    # --- Chẩn đoán ---
    errors: Annotated[list[ErrorRecord], operator.add]
```

**Reducer**

```python
def merge_dict(left: dict | None, right: dict | None) -> dict:
    """Gộp theo key; right thắng. Cho phép nhiều agent song song cùng ghi."""
    return {**(left or {}), **(right or {})}
```

- Các field **không** có reducer bị ghi đè (last write wins). Chỉ đúng một node
  được ghi các field này; ghi chú "ai ghi" ở bảng dưới là ràng buộc bắt buộc.
- `merge_dict` không xóa key. Muốn "vô hiệu" thì đổi status (`STALE`), không xóa.
- Intent và constraints chỉ nằm trong `intake`, không nhân đôi ra field top-level.

### 5.2. Bảng đọc/ghi

| Field | Ghi bởi | Đọc bởi |
|---|---|---|
| `messages` | API (input), `confirm` (câu đổi ý khi resume), `respond` (AI message) | `intake`, `respond` |
| `session` | `load_context` | `intake`, `orchestrator`, `cost_summary`, `respond` |
| `intake` | `intake` | `route_from_intake`, `orchestrator`, `executor` (constraints vào AgentInput), `validator`, `cost_summary`, `change_impact`, `respond` |
| `plan`, `replan_count` | `orchestrator` | `intake` (tóm tắt plan để hiểu câu đổi ý), `executor`, `validator`, `cost_summary`, `change_impact`, `transaction` |
| `change_context` | `change_impact` (orchestrator reset về `None`) | `orchestrator` |
| `task_status` | `orchestrator` (khởi tạo), `executor`, `*_agent`, `validator` (đưa về PENDING để retry), `change_impact` (STALE) | `executor`, `validator` |
| `task_attempts` | `executor` | `executor`, `validator` |
| `task_results` | `*_agent` | `executor` (upstream), `validator`, `cost_summary`, `change_impact`, `respond` |
| `dispatch` | `executor` | `route_from_executor` |
| `validation` | `validator` | `route_from_validator`, `orchestrator` (feedback), `respond` |
| `cost_summary` | `cost_summary` | `confirm`, `transaction`, `respond` |
| `user_decision` | `confirm` | `route_from_confirm`, `intake`, `transaction` |
| `transaction` | `transaction` | `respond` |
| `response` | `respond` | API |
| `errors` | mọi node | `respond`, logging |

### 5.3. Kiểu dữ liệu con (Pydantic v2)

```python
class AgentName(StrEnum):
    PROPERTY = "property"        # Property Search & Knowledge
    RELOCATION = "relocation"    # Room Relocation (moving)
    FLIGHT = "flight"            # Flight / Travel
    MAP = "map"                  # Map & Nearby Utility
    CONTRACT = "contract"        # Contract & Policy

class RequestKind(StrEnum):
    NEW_GOAL = "new_goal"        # mục tiêu mới
    REFINE = "refine"            # bổ sung thông tin / trả lời câu hỏi lại
    CHANGE = "change"            # đổi lựa chọn hoặc ràng buộc của plan đã có
    UNSUPPORTED = "unsupported"  # ngoài phạm vi hệ thống

class Intent(BaseModel):
    name: str                        # ví dụ "relocate_and_rent"
    domains: list[AgentName]         # lĩnh vực liên quan, chỉ là gợi ý cho Planner
    summary: str

class Constraints(BaseModel):
    # Để mở; chốt khi thiết kế Intake. Ví dụ các key: budget_vnd,
    # city, move_date, near (địa điểm), room_type, must_have (["wifi", ...]).
    values: dict[str, Any] = {}
    missing: list[str] = []          # thiếu nhưng không chặn lập plan; validator hỏi sau

class ConfirmedFact(BaseModel):
    value: Any
    evidence: str                    # trích nguyên văn lời người dùng; code kiểm là chuỗi con của tin nhắn
    stated_at: datetime

class PrefilledValue(BaseModel):
    value: Any
    source: Literal["preference", "trait"]  # lấy từ bộ nhớ người dùng (§6.0, §6.1)
    last_confirmed_at: datetime             # để respond nói "như lần trước" và để đo tuổi dữ liệu

class IntakeResult(BaseModel):
    kind: RequestKind
    normalized_goal: str
    intent: Intent | None
    constraints: Constraints         # đã gồm giá trị tự điền
    prefilled: dict[str, PrefilledValue] = {}  # field nào được tự điền; respond phải thông báo
    blocking_missing: list[str] = [] # không task nào chạy được nếu thiếu → CLARIFY ngay
    conflicts: list[str] = []        # ví dụ "ngân sách 3 triệu nhưng yêu cầu căn hộ 2 phòng ở Q1"
    user_confirmed_facts: dict[str, ConfirmedFact] = {}  # gộp dần qua các lượt; chỉ điều người dùng nói
    change_request: str | None = None          # khi kind == CHANGE
    target_task_ids: list[str] = []            # task người dùng muốn đổi (nếu xác định được)

    @property
    def needs_clarification(self) -> bool:
        return bool(self.blocking_missing or self.conflicts)

class TaskStatus(StrEnum):
    PENDING = "pending"    # chờ dependency
    READY = "ready"        # dependency đã DONE, chờ dispatch
    RUNNING = "running"    # đã Send, chờ kết quả
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"    # dependency FAILED/SKIPPED, không chạy được
    STALE = "stale"        # kết quả bị vô hiệu do change hoặc quá TTL
    NEEDS_INPUT = "needs_input"  # subagent cần người dùng trả lời questions (§6.3, R4)

class Task(BaseModel, frozen=True):
    id: str                          # ổn định qua các version nếu task không đổi
    agent: AgentName
    inputs: dict[str, Any]           # theo input schema của agent (§6.3)
    depends_on: list[str] = []
    required: bool = True            # False: thiếu cũng PASS được, chỉ ghi chú

class CommitActionKind(StrEnum):
    DEPOSIT = "deposit"                  # đặt cọc phòng
    MOVING_BOOKING = "moving_booking"    # đặt dịch vụ chuyển đồ
    FLIGHT_BOOKING = "flight_booking"    # đặt vé

class CommitAction(BaseModel, frozen=True):
    id: str
    kind: CommitActionKind
    source_task_id: str              # task cung cấp lựa chọn (ví dụ listing, quote)

class Plan(BaseModel, frozen=True):
    version: int
    tasks: list[Task]
    commit_actions: list[CommitAction] = []

class Quote(BaseModel):
    option_id: str                   # id lựa chọn trong data (listing, offer, quote)
    label: str
    amount_vnd: int
    recurrence: Literal["one_time", "monthly"]

SourceKind = Literal["live", "sandbox", "demo", "fake"]

class TaskResult(BaseModel):
    """Bản trong state của AgentTaskResult (§6.3.3), thêm agent và retryable."""
    task_id: str
    agent: AgentName
    plan_version: int
    status: Literal["done", "failed", "needs_input"]
    data: dict[str, Any] = {}        # theo output_schema trong manifest (§6.3)
    quotes: list[Quote] = []         # dùng cho cost_summary
    missing_fields: list[str] = []   # field agent không có dữ liệu — KHÔNG tự bịa
    questions: list[Question] = []   # khi status == "needs_input"; validator chuyển thành ASK_USER
    source: str = ""                 # provider / nguồn thực sự trả dữ liệu
    source_kind: SourceKind = "fake" # respond phải nói rõ khi không phải "live"
    source_refs: list[str] = []
    fetched_at: datetime
    summary: str | None = None       # chỉ để hiển thị; không đưa vào prompt của Planner
    usage: AgentUsage = AgentUsage()
    error: str | None = None         # AgentError.code + message
    retryable: bool = False          # từ AgentError.retryable

class ValidationIssue(BaseModel):
    code: Literal["V1", "V2", "V3", "V4", "V5"]
    task_id: str | None
    message: str

class ValidationReport(BaseModel):
    verdict: Literal["PASS", "NEED_MORE"]
    action: Literal["NONE", "RETRY_TASKS", "REPLAN", "ASK_USER", "GIVE_UP"]
    issues: list[ValidationIssue] = []
    retry_task_ids: list[str] = []
    ask_user_fields: list[str] = []
    questions: list[Question] = []   # câu hỏi gốc từ subagent, để respond hỏi đúng ý

class CostLine(BaseModel):
    task_id: str
    option_id: str
    label: str
    amount_vnd: int
    recurrence: Literal["one_time", "monthly"]

class CostSummary(BaseModel):
    plan_version: int
    selected: dict[str, str]         # task_id -> option_id đang được chọn
    lines: list[CostLine]
    total_one_time_vnd: int
    total_monthly_vnd: int
    commit_actions: list[CommitAction]
    payload_hash: str                # sha256 của (plan_version, selected, lines, commit_actions)
    quotes_expire_at: datetime       # min(fetched_at + stale_ttl) của các task có commit action

class UserDecision(BaseModel):
    kind: Literal["CONFIRM", "CHANGE", "REJECT", "CANCEL"]
    plan_version: int                # phải khớp plan hiện tại, chống xác nhận nhầm bản cũ
    approval_id: str | None = None   # bắt buộc khi CONFIRM; do backend tạo (§9), không phải model
    change_request: str | None = None
    target_task_ids: list[str] = []  # phần user muốn đổi (ví dụ bấm "đổi phòng" trên UI)

class Approval(BaseModel, frozen=True):
    approval_id: str
    user_id: str
    thread_id: str
    plan_version: int
    payload_hash: str                # phải bằng CostSummary.payload_hash
    expires_at: datetime             # không muộn hơn CostSummary.quotes_expire_at

class ChangeContext(BaseModel):
    request: str | None
    invalidated_task_ids: list[str]
    reusable_task_ids: list[str]

class TransactionResult(BaseModel):
    status: Literal["committed", "failed", "compensated", "pending_verification"]
    receipts: list[Receipt] = []
    error: str | None = None

class AgentResponse(BaseModel):
    kind: Literal["ANSWER", "PARTIAL", "CLARIFY", "COMMITTED", "CANCELLED", "UNSUPPORTED", "ERROR"]
    text: str
    data: dict[str, Any] = {}

class ErrorRecord(BaseModel):
    node: str
    task_id: str | None = None
    message: str
    at: datetime
```

**Bộ nhớ người dùng** (long-term memory, đọc/ghi qua `SessionPort`, §6.0):

```python
class MemoryValue(BaseModel):
    value: Any
    stated_at: datetime              # lần đầu người dùng nói
    last_confirmed_at: datetime      # lần gần nhất người dùng dùng lại mà không sửa và làm tiếp
    source_thread: str
    stop_prefill: bool = False       # ví dụ khu vực tìm phòng sau khi đã đặt cọc

class SessionContext(BaseModel):
    preferences: dict[str, MemoryValue] = {}  # mức 1: khu vực, ngân sách, loại phòng, tiện ích
    traits: dict[str, MemoryValue] = {}       # mức 1: số người ở, thú cưng, xe máy
    hints: dict[str, MemoryValue] = {}        # mức 2, chỉ gợi ý: origin_city, current_address,
                                              # khối lượng đồ, hãng bay / bên chuyển đồ quen

class MemoryUpdate(BaseModel):
    group: Literal["preferences", "traits", "hints"]
    key: str
    value: Any | None                # None = xoá
    stop_prefill: bool | None = None
    evidence: str | None = None      # lời người dùng làm căn cứ; bắt buộc khi value khác None
```

`Receipt` định nghĩa chi tiết khi có `TransactionPort` thật; giai đoạn khung chỉ cần
`receipt_id`, `action_id`, `provider`, `amount_vnd`, `source_kind`.

### 5.4. Payload gửi cho agent (`Send`)

Node agent **không** nhận toàn bộ `WorkflowState`, mà nhận payload thu gọn. Từ payload
này, `run_with_policy` dựng `AgentTaskRequest` gửi cho subagent (§6.3.6):

```python
class AgentInput(TypedDict):
    task: Task
    plan_version: int
    attempt: int
    request_id: str
    thread_id: str
    constraints: Constraints          # từ state["intake"].constraints; lọc theo manifest khi gửi
    hints: dict[str, Any]             # từ session.hints / preferences; lọc theo manifest khi gửi
    upstream: dict[str, TaskResult]   # kết quả của các task trong task.depends_on
    budget_left: AgentBudget          # phần còn lại của trần lượt (§7.5)
```

Subagent không nhận nguyên `SessionContext`; chỉ nhận các key khai báo trong
`constraint_keys` / `hint_keys` của manifest.

Node agent đăng ký với `input_schema=AgentInput`, và trả về update cho state chung:

```python
{"task_results": {task.id: result}, "task_status": {task.id: DONE | FAILED | NEEDS_INPUT}}
```

Subagent tự quyết định dùng `upstream` thế nào (ví dụ subagent map lấy toạ độ từ các
listing của task property). `Task.inputs` chỉ chứa giá trị tĩnh; không có ngôn ngữ
tham chiếu kiểu `$ref`.

---

## 6. Node và contract

Mọi node: `async def node(state) -> dict`, chỉ trả field thay đổi, có docstring,
bắt exception và ghi `errors` thay vì làm crash graph (theo
[guide nodes-and-edges.md](../guide/langgraph/nodes-and-edges.md)). Node lấy
dependency qua closure do `build_graph(deps)` tạo, không import adapter trực tiếp.

### 6.0. `load_context` và bộ nhớ người dùng

- Đọc `SessionPort.load(user_id)`, trả về `SessionContext` (`preferences`, `traits`,
  `hints`; long-term memory của baseline).
- Không có dữ liệu thì trả `SessionContext` rỗng; không coi là lỗi.
- Fake: `InMemorySessionPort`.

```python
class SessionPort(Protocol):
    async def load(self, user_id: str) -> SessionContext: ...
    async def save(self, user_id: str, thread_id: str, updates: list[MemoryUpdate]) -> None: ...  # upsert
    async def forget(self, user_id: str) -> None: ...           # người dùng yêu cầu xoá (làm sau)
```

**Ba loại dữ liệu, không được trộn:**

| | Bộ nhớ người dùng | Dữ liệu gốc | Kết quả trong một lần xử lý |
|---|---|---|---|
| Nói về | Người dùng: khu vực muốn ở, ngân sách, có xe máy… | Thế giới: phòng trọ, giá, địa chỉ, chính sách cọc | Bản chụp dữ liệu gốc cho một yêu cầu |
| Nguồn | Lời người dùng trong chat | `crawler/` + `preprocess/`, API provider | Domain agent gọi Port |
| Phạm vi | Riêng từng người | Dùng chung | Riêng một thread |
| Nằm ở | `SessionPort` (Q8) | Property DB, Vector DB, provider | `task_results` trong checkpoint |
| Hạn dùng | Theo §6.1 (thời gian + sự kiện) | Theo lịch crawl / provider | `stale_ttl` (§6.3) |

Bộ nhớ người dùng **không** lưu thông tin phòng, báo giá hay giá vé. Dữ liệu gốc
**không** lưu gì về người dùng.

**Ghi bộ nhớ.** `respond` gọi `SessionPort.save` ở cuối lượt với danh sách
`MemoryUpdate` do hàm thuần `memory_updates(state)` tính:

- Chỉ lưu giá trị có trong `intake.user_confirmed_facts` (có `evidence` là lời người
  dùng), **và** lượt đó đã dùng giá trị để làm tiếp (có task `DONE` dùng nó, hoặc
  người dùng chọn một phương án). Điều model tự suy ra không bao giờ được lưu.
- Giá trị tự điền mà người dùng dùng tiếp không sửa: cập nhật `last_confirmed_at`.
  Chỉ im lặng rồi bỏ đi thì không tính là xác nhận.
- Người dùng sửa giá trị tự điền: ghi đè ngay.
- Sự kiện làm hết hạn (§6.1): ví dụ `transaction` commit đặt cọc thành công thì đặt
  `stop_prefill` cho khu vực tìm phòng và lưu `hints.current_address` = địa chỉ phòng.
- Chỉ giá trị thuộc mức 1 hoặc mức 2 (§6.1) mới được lưu.
- `save` là upsert theo `(user_id, group, key)`, nên chạy lại không sai. Lỗi khi lưu
  chỉ ghi `errors`, không làm hỏng câu trả lời.

Dữ kiện trong một thread (`user_confirmed_facts`) chỉ thuộc thread đó. Người dùng
thử nhiều phương án ở nhiều thread thì bộ nhớ chỉ đổi khi có giá trị thoả điều kiện
trên, không ghi đè chỉ vì đang thử.

**Đo chất lượng tự điền.** Mỗi lần người dùng sửa giá trị tự điền, ghi log sự kiện
`prefill_corrected` (field, tuổi của giá trị) theo `request_id`/`thread_id`. Tỉ lệ bị
sửa theo từng field dùng để chỉnh `prefill_ttl` (§7.4): field hay bị sửa thì rút ngắn
hạn hoặc ngừng tự điền.

### 6.1. `intake` — Intake / Goal Understanding (**để trống**)

Node này chỉ là vỏ: gọi `deps.intake`, rồi kiểm tra kết quả bằng code.
**Logic hiểu yêu cầu nằm trong Intake và chưa được thiết kế.**

```python
class IntakeInput(BaseModel):
    messages: list[AnyMessage]
    session: SessionContext
    previous: IntakeResult | None            # để gộp dần, không mất dữ kiện cũ
    plan_outline: list[TaskOutline] | None   # id, agent, lựa chọn đang chọn; để hiểu câu đổi ý
    decision: UserDecision | None            # khi đến từ confirm (CHANGE / REJECT)
    pending_questions: list[Question]        # câu hỏi lượt trước (intake hoặc subagent) để hiểu câu trả lời
    supported_domains: list[AgentName]       # từ AgentRegistry

class Intake(Protocol):
    async def understand(self, inp: IntakeInput) -> IntakeResult: ...
```

**Việc của node `intake` (phần có thể code ngay):**

1. Gọi `deps.intake.understand(...)`. Output phải qua Pydantic validate.
2. Gộp `user_confirmed_facts` của lần trước. Dữ kiện người dùng đã xác nhận chỉ
   bị ghi đè khi có `CHANGE` rõ ràng. Fact mới phải có `evidence` là chuỗi con của
   một tin nhắn người dùng; không có thì bỏ (đó là điều model tự suy ra).
3. **Tính lại phần thiếu bằng code** (hàm thuần `resolve_missing`, xem bên dưới),
   không tin vào LLM. Hàm này ghi `constraints` (kể cả giá trị tự điền), `prefilled`,
   `blocking_missing` và `constraints.missing`.
4. `REJECT` không kèm lời: `kind = CHANGE`, `target_task_ids` = task trong
   `decision.target_task_ids`, hoặc mọi task có `quotes` nếu người dùng không chỉ rõ.
5. `intake` **không** chọn agent/tool, không tạo DAG, không tạo approval.
   `Intent.domains` chỉ là gợi ý cho Planner.

**Quy tắc hỏi ngay / hỏi sau (D10).** Bảng `REQUIRED_INPUTS` ghi input bắt buộc để
task của từng domain chạy được, và input nào suy ra được từ task khác:

| Domain | Bắt buộc để task chạy | Suy ra từ task khác | `cost_tier` (tạm) |
|---|---|---|---|
| property (tìm phòng) | khu vực: `city` hoặc `near` | — | cheap |
| relocation (báo giá chuyển đồ) | `from_address`, `to_address`, `move_date` | `to_address` ← phòng đã chọn (property) | paid |
| flight (tìm vé) | `origin`, `destination`, `date` | `destination` ← thành phố của phòng (property) | paid |
| map (tiện ích xung quanh) | toạ độ | toạ độ ← phòng (property) | cheap |
| contract (hợp đồng / chính sách) | listing | listing ← phòng (property) | cheap |

Ngân sách, loại phòng, tiện ích bắt buộc (`must_have`) là **bộ lọc**, không nằm
trong bảng và **không bao giờ chặn**.

`resolve_missing(intake, session, previous, registry)` làm theo thứ tự:

1. Lấy giá trị từ tin nhắn hiện tại và `user_confirmed_facts` của thread.
2. **Tự điền từ bộ nhớ người dùng** cho input còn thiếu, theo chính sách bộ nhớ bên
   dưới (chỉ mức 1, còn hạn, không `stop_prefill`, thoả quy tắc đi kèm), ghi vào
   `prefilled` kèm nguồn. Chỉ tự điền input dùng cho task `cheap`. Task `paid` phải
   dùng giá trị người dùng nói trong thread, để không gọi API tính tiền bằng dữ liệu cũ.
3. Bỏ các input suy ra được từ task khác có trong cùng yêu cầu (ví dụ có tìm phòng
   thì `to_address` của chuyển đồ không tính là thiếu).
4. Với mỗi domain, input bắt buộc còn thiếu là phần thiếu của task đó.
5. Nếu **không task nào chạy được**, `blocking_missing` = phần thiếu của các task
   **gốc** (không phụ thuộc task khác). Ví dụ "tìm phòng và vé bay vào đó" chỉ hỏi
   khu vực, vì điểm đến của vé suy ra từ phòng, còn ngày bay để hỏi sau.
6. Ngược lại, phần thiếu của các task chưa chạy được vào `constraints.missing`.
   Planner **không** tạo task còn thiếu input; validator hỏi sau khi đã có kết quả
   một phần (§6.5). Khi người dùng bổ sung (`REFINE`), Planner thêm task đó vào plan
   version mới và giữ các task đã `DONE`.
7. `conflicts` không rỗng thì cũng hỏi ngay, giống `blocking_missing`.

Người dùng sửa giá trị tự điền ("không, lần này ở Thủ Đức") thì `intake` trả
`kind = CHANGE`, đi luồng `change_impact` như mọi thay đổi khác.

**Chính sách bộ nhớ (chốt Q14).** Nguyên tắc nguồn: bộ nhớ chỉ chứa điều người dùng
**nói ra hoặc xác nhận** (§6.0). Dữ liệu chia ba mức:

| Mức | Loại dữ liệu | Ví dụ | Cách dùng | Lý do |
|---|---|---|---|---|
| 1 — tự điền, có thông báo | Sở thích tìm phòng (`preferences`) | khu vực, ngân sách, loại phòng, tiện ích | `resolve_missing` tự điền cho task `cheap`; `respond` thông báo | Sai thì chỉ tốn một lần tìm rẻ, người dùng sửa được ngay |
| | Đặc điểm ít thay đổi (`traits`) | số người ở, thú cưng, xe máy | như trên | Gần như không đổi giữa các lần tìm |
| 2 — chỉ gợi ý | Input của task `paid` (`hints`) | thành phố xuất phát, `current_address`, khối lượng đồ | Không tự điền; `respond` hỏi kèm gợi ý ("Bay từ Hà Nội như lần trước?"), chờ người dùng xác nhận | Không gọi API tính tiền bằng dữ liệu cũ |
| | Nhà cung cấp quen (`hints`) | hãng bay, bên chuyển đồ từng chọn | Agent chỉ dùng để **xếp hạng**, không làm bộ lọc | Không loại bớt lựa chọn của người dùng |
| 3 — không bao giờ dùng | Lựa chọn giao dịch cũ | phòng đã chọn, báo giá, giá vé | Không lưu | Hết hạn, phòng có thể đã có người thuê |
| | Ngày tháng | ngày chuyển, ngày bay | Không lưu | Gắn với một lần cụ thể |
| | Dữ liệu nhạy cảm | thanh toán, giấy tờ | Không lưu vào bộ nhớ, không đưa vào LLM; chỉ backend xử lý | Bảo mật |
| | Điều model tự suy ra | "có vẻ là sinh viên" | Không lưu | Dùng lại là tự đoán |

Phạm vi ban đầu nhỏ: mức 1 chỉ gồm 4 sở thích (`city`/`near`, `max_price_vnd`,
`room_type`, `must_have`) và 3 đặc điểm (`household_size`, `has_pet`, `has_motorbike`).
Mở rộng sau khi chạy ổn.

**Hết hạn theo thời gian.** Tính từ `last_confirmed_at`, mỗi field một hạn, cấu hình
ở `GraphSettings.prefill_ttl` (§7.4):

| Field | Hạn mặc định | Lý do |
|---|---|---|
| khu vực (`city`, `near`) | 90 ngày | Gắn với trường, chỗ làm; đổi theo học kỳ, hợp đồng |
| ngân sách (`max_price_vnd`) | 60 ngày | Giá thị trường và thu nhập đổi nhanh hơn |
| loại phòng, tiện ích | 180 ngày | Tương đối ổn định |
| số người, thú cưng, xe | 365 ngày | Rất ít thay đổi |

**Hết hạn theo sự kiện** (ưu tiên hơn hạn thời gian):

| Sự kiện | Xử lý |
|---|---|
| Người dùng sửa giá trị tự điền | Ghi đè ngay, `last_confirmed_at = now` |
| Người dùng nói hoàn cảnh mới ("mình chuyển việc sang Thủ Đức") | Bỏ khu vực cũ |
| Đặt cọc thành công | Khu vực tìm phòng `stop_prefill = True`; lưu `hints.current_address` = địa chỉ phòng mới, làm gợi ý cho lần chuyển đồ sau |
| Người dùng yêu cầu "quên thông tin của mình" | `SessionPort.forget` (làm sau, xem Q14) |

**Quy tắc đi kèm.** Một số giá trị chỉ đúng trong bối cảnh của giá trị khác. Bảng
`PREFILL_ANCHORS` ghi các cặp này; field chỉ được tự điền khi mọi anchor của nó cũng
lấy từ bộ nhớ, không bị người dùng đổi trong lượt này:

| Field | Anchor | Ví dụ |
|---|---|---|
| `max_price_vnd` | `city`, `near` | Ngân sách 5 triệu đặt cho Quận 10; người dùng nói "tìm ở Thủ Đức" thì không điền ngân sách cũ |

Đặc điểm (`traits`) không có anchor nên vẫn được tự điền khi đổi khu vực. Khi
anchor trong bộ nhớ đổi giá trị, `memory_updates` đặt `stop_prefill` cho các field
phụ thuộc, trừ khi người dùng cũng nói giá trị mới cho field đó. Nhờ vậy lần sau
không tự điền ngân sách cũ cho khu vực mới.

**Tin nhắn luôn thắng bộ nhớ.** Field người dùng nói trong lượt hiện tại không bao
giờ bị tự điền đè lên.

**Bộ lọc tự điền làm ra 0 kết quả.** Planner đưa các bộ lọc có trong `prefilled` vào
`Task.inputs.soft_filters`. Agent tìm với đủ bộ lọc; nếu không có kết quả thì tìm lại
không có `soft_filters` và ghi `data.relaxed_filters`. `respond` nói rõ, ví dụ "Không
có phòng dưới 5 triệu như lần trước; đây là các phòng đến 6 triệu." Bộ lọc người
dùng tự nói trong lượt này không bao giờ bị nới.

**Implementation giai đoạn khung**

| Class | Dùng khi | Hành vi |
|---|---|---|
| `PassThroughIntake` | mặc định trong app | `kind = NEW_GOAL`, không thiếu gì; để `NotImplementedPlanner` trả `UNSUPPORTED`. |
| `FixedIntake(result)` | test, demo | Trả `IntakeResult` dựng sẵn. |
| `ScriptedIntake([r1, r2, …])` | test hỏi lại / đổi ý | Mỗi lần gọi trả kết quả kế tiếp. |

### 6.2. `orchestrator` — Planner của Routing Orchestrator (**để trống**)

Node này chỉ là vỏ: gọi `deps.planner`, validate kết quả, khởi tạo trạng thái task.
**Logic lập kế hoạch nằm trong Planner và chưa được thiết kế.** Planner nhận
`IntakeResult` đã được kiểm tra, không đọc `messages` thô.

```python
class PlannerInput(BaseModel):
    intake: IntakeResult
    session: SessionContext
    previous_plan: Plan | None
    previous_results: dict[str, TaskResult]
    validation: ValidationReport | None      # feedback khi REPLAN
    change_context: ChangeContext | None     # feedback khi CHANGE/REJECT
    available_agents: list[AgentName]        # từ AgentRegistry

class PlannerOutput(BaseModel):
    plan: Plan                               # tasks có thể rỗng

class Planner(Protocol):
    async def plan(self, inp: PlannerInput) -> PlannerOutput: ...
```

**Việc của node `orchestrator` (phần có thể code ngay):**

1. Nếu `replan_count >= max_replans` thì ghi `errors` và route sang `respond`.
2. Gọi `deps.planner.plan(...)`.
3. Validate plan (hàm thuần `validate_plan`):
   - `task.id` duy nhất;
   - `depends_on` chỉ trỏ tới id có trong plan;
   - DAG không có chu trình (topological sort);
   - `task.agent` có trong `AgentRegistry` (đây là allowlist, xem §6.3);
   - `task.inputs` hợp lệ với `input_schema` trong manifest của subagent;
   - `commit_actions[].source_task_id` tồn tại, và `kind` nằm trong `commit_kinds`
     của service tương ứng.
4. Ghi `plan` với `version = (plan cũ).version + 1`.
5. Khởi tạo `task_status` cho mọi task của plan mới:
   - `DONE` nếu id nằm trong `change_context.reusable_task_ids` và đã có kết quả DONE
     không stale, hoặc task giữ nguyên từ plan cũ và kết quả còn hợp lệ;
   - còn lại là `PENDING`, kể cả task `NEEDS_INPUT` của lượt trước (người dùng đã trả
     lời, Planner đưa câu trả lời vào `task.inputs`).
6. Reset `validation`, `user_decision`, `cost_summary`, `change_context` về `None`;
   tăng `replan_count` nếu đây không phải lần plan đầu.

Hỏi lại người dùng **không** còn là việc của Planner: thiếu thông tin chặn đã được
`intake` xử lý. Planner vẫn có thể trả plan rỗng nếu không có cách đáp ứng yêu cầu;
khi đó `respond` trả `UNSUPPORTED` hoặc `PARTIAL`.

**Implementation giai đoạn khung**

| Class | Dùng khi | Hành vi |
|---|---|---|
| `NotImplementedPlanner` | mặc định trong app | Trả `plan.tasks = []`; `respond` trả `UNSUPPORTED` ("chức năng lập kế hoạch chưa sẵn sàng"). |
| `FixedPlanner(plan)` | test, demo | Trả plan dựng sẵn, bỏ qua input. |
| `ScriptedPlanner([plan_v1, plan_v2, …])` | test replan / change | Mỗi lần gọi trả plan kế tiếp. |
| `TemplatePlanner(templates, fallback)` | sau này, giảm chi phí (§7.5) | Yêu cầu một domain, không dependency: dựng plan từ mẫu, không gọi LLM; còn lại chuyển cho `fallback` (LLM Planner). |

Các câu hỏi mở của Intake và Orchestrator được liệt kê ở §12.

### 6.3. Subagent của service — chuẩn contract

Mỗi service (housing/location, moving, flight, hợp đồng/chính sách, …) có **subagent
riêng do chủ service viết**, có thể dùng LLM bên trong. Graph không biết và không
quản lý bên trong subagent; graph chỉ **nối vào** qua contract ở mục này. Người viết
subagent làm theo mục này; subagent qua được bộ test tuân thủ (§11) thì đăng ký vào
registry mà **không cần sửa graph** (D13).

Pydantic trong repo là nguồn schema chính; khi code sẽ export JSON Schema vào
`docs/api/agent-contract/` cho các service viết bằng ngôn ngữ khác (TypeScript).

#### 6.3.1. Phân vai

| Việc | Graph (kiến trúc) | Subagent (chủ service) |
|---|---|---|
| Chọn lĩnh vực nào, thứ tự, phụ thuộc **giữa** các lĩnh vực | Planner (DAG) | — |
| Chia nhỏ và thực hiện **trong** lĩnh vực: gọi tool nào, mấy lần, lọc, xếp hạng | — | Subagent |
| Hỏi người dùng | `respond` | Trả `questions` (R4) |
| Retry với provider | — | Subagent, trong `budget` (R7) |
| Timeout tổng, ngân sách, đếm chi phí | `run_with_policy`, `UsageMeter` | Tôn trọng `budget`, báo `usage` (R6, R11) |
| Kiểm schema, độ mới, xung đột | `validator` | Cung cấp đủ nguồn gốc dữ liệu (R2) |
| Thao tác ghi (đặt cọc, đặt xe, đặt vé, thanh toán) | `transaction` gọi commit endpoint | Cung cấp commit endpoint tất định; subagent **không** ghi (R3) |
| Bộ nhớ người dùng | Graph (§6.0) | Không lưu dữ liệu người dùng (R8) |

Mức chia task: mỗi `Task` trong DAG là **một mục tiêu cho một lĩnh vực** (ví dụ "tìm
phòng theo các điều kiện này"), không phải một lần gọi tool.

#### 6.3.2. Manifest

Mỗi subagent công bố manifest. Registry đọc manifest khi khởi động; subagent khác
**major** `contract_version` thì không được đăng ký, và `validate_plan` từ chối task
dùng lĩnh vực đó.

```python
class AgentBudget(BaseModel):
    max_llm_calls: int
    max_provider_calls: int
    deadline_at: datetime | None = None   # trong manifest: None; trong request: luôn có

class AgentCapability(BaseModel):
    agent: AgentName                   # một subagent có thể phục vụ nhiều AgentName
    input_schema: dict                 # JSON Schema của task.inputs
    output_schema: dict                # JSON Schema của data (validator V4)
    required_fields: list[str]         # validator V2
    stale_ttl_s: int                   # validator V3
    cost_tier: Literal["cheap", "paid"]  # §7.5
    uses_llm: bool
    default_budget: AgentBudget
    constraint_keys: list[str]         # constraint nào của người dùng subagent cần nhận
    hint_keys: list[str] = []          # gợi ý xếp hạng nào subagent cần nhận
    commit_kinds: list[CommitActionKind] = []  # thao tác ghi service hỗ trợ qua commit endpoint (§6.9)

class AgentManifest(BaseModel):
    name: str                          # id subagent, ví dụ "lifeflow-location"
    owner: str                         # người / đội chịu trách nhiệm
    contract_version: str              # ví dụ "1.0"
    capabilities: list[AgentCapability]
```

#### 6.3.3. Request và result

```python
class UpstreamResult(BaseModel):
    task_id: str
    agent: AgentName
    data: dict[str, Any]
    source_refs: list[str]

class AgentTaskRequest(BaseModel):
    contract_version: str
    request_id: str
    thread_id: str                     # chỉ để log / trace; subagent không giữ state theo thread
    task_id: str
    plan_version: int
    attempt: int
    agent: AgentName
    inputs: dict[str, Any]             # đúng input_schema
    constraints: dict[str, Any]        # chỉ các key trong constraint_keys
    hints: dict[str, Any] = {}         # chỉ các key trong hint_keys; để xếp hạng, không làm bộ lọc
    upstream: dict[str, UpstreamResult]  # kết quả của task trong depends_on
    budget: AgentBudget                # deadline_at luôn có
    locale: str = "vi-VN"

class Question(BaseModel):
    field: str                         # input còn thiếu, ví dụ "has_bulky_items"
    text: str                          # câu hỏi gợi ý; respond có thể viết lại
    options: list[str] = []
    blocking: bool                     # True: thiếu thì task không xong được

class AgentUsage(BaseModel):
    llm_calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    provider_calls: int = 0
    cached_calls: int = 0

class AgentError(BaseModel):
    code: Literal["invalid_input", "unsupported_contract", "provider_unavailable",
                  "provider_rejected", "timeout", "budget_exceeded", "internal"]
    message: str
    retryable: bool

class AgentTaskResult(BaseModel):
    contract_version: str
    task_id: str
    plan_version: int
    status: Literal["done", "failed", "needs_input"]
    data: dict[str, Any] = {}          # đúng output_schema
    quotes: list[Quote] = []           # dùng cho cost_summary
    missing_fields: list[str] = []     # field không có dữ liệu — KHÔNG tự bịa
    questions: list[Question] = []     # bắt buộc khi status == "needs_input"
    source: str                        # provider / nguồn thực sự trả dữ liệu
    source_kind: SourceKind
    source_refs: list[str] = []        # id bản ghi gốc (listing, offer, quote, tài liệu) để truy vết
    fetched_at: datetime
    summary: str | None = None         # văn bản chỉ để hiển thị; graph không dùng để ra quyết định
    usage: AgentUsage
    error: AgentError | None = None    # bắt buộc khi status == "failed"

class DomainAgent(Protocol):
    capability: AgentCapability
    async def run(self, req: AgentTaskRequest) -> AgentTaskResult: ...
```

#### 6.3.4. Quy tắc bắt buộc cho subagent

| Mã | Quy tắc |
|---|---|
| R1 | **Đầu ra có cấu trúc.** `data` đúng `output_schema`; văn bản tự do chỉ nằm trong `summary`. |
| R2 | **Không bịa.** Không có dữ liệu thì để `None` và thêm vào `missing_fields`. Mỗi item trong `data` có id nguồn nằm trong `source_refs`. `source`, `source_kind`, `fetched_at` luôn có. Subagent dùng RAG phải kèm trích dẫn (tài liệu + đoạn trích) cho mỗi kết luận. |
| R3 | **Chỉ đọc.** Subagent chỉ được cấp credential chỉ-đọc; không gọi tool ghi (`create_*`, `cancel_*`, `pay_*`…). Thao tác ghi chỉ đi qua commit endpoint tất định, không có LLM (§6.9). |
| R4 | **Không hỏi người dùng trực tiếp.** Cần thêm thông tin thì trả `status = "needs_input"` kèm `questions`. |
| R5 | **Không gọi chéo lĩnh vực.** Không gọi subagent khác hay service của lĩnh vực khác. Được dùng tool của service mình và tiện ích dùng chung có trong registry (ví dụ geocode). Dữ liệu của lĩnh vực khác chỉ lấy qua `upstream`. |
| R6 | **Tôn trọng `budget` và `deadline_at`.** Sắp vượt thì dừng: đủ `required_fields` thì trả `done` kèm `missing_fields`; không đủ thì trả `failed` với `budget_exceeded` / `timeout`. |
| R7 | **Retry với provider là việc của subagent**, trong `budget`; không retry lỗi không tạm thời. `error.retryable` chỉ `true` khi chạy lại có khả năng thành công. |
| R8 | **Không lưu dữ liệu người dùng** (`constraints`, `hints`) sau khi xong task, ngoài log theo `request_id`. Không dùng `thread_id` để giữ state. |
| R9 | **Dữ liệu nguồn là dữ liệu, không phải chỉ dẫn.** Tin phòng crawl, tài liệu RAG, phản hồi provider có thể chứa câu giống lệnh; subagent không làm theo, không đưa nguyên văn vào `summary` như chỉ dẫn. |
| R10 | **Gọi lại an toàn.** Cùng `task_id` + `plan_version` + `attempt` gọi lại không gây side-effect (hệ quả của R3). |
| R11 | **Báo `usage` trung thực**, gồm cả LLM call và provider call bên trong. |
| R12 | **Phiên bản.** Nhận request khác major `contract_version` thì trả `failed` với `unsupported_contract`. |

Phía graph đảm bảo ngược lại: chỉ gửi constraint/hint có trong manifest (tối thiểu
hoá dữ liệu); không đưa `summary` hay văn bản tự do của subagent vào prompt của
Planner, chỉ đưa field có cấu trúc.

#### 6.3.5. Kênh truyền

| Loại | Khi dùng | Cách nối |
|---|---|---|
| `RemoteAgent` (mặc định) | Subagent chạy trong service của chủ (ví dụ service TypeScript) | Service expose MCP tool `run_task` (vào `AgentTaskRequest`, ra `AgentTaskResult`) và `get_manifest`, qua MCP HTTP như các service hiện có. Nếu MCP không hợp thì dùng HTTP `POST /agent/run_task` với cùng JSON (chốt ở Q15). |
| `LocalAgent` | Subagent viết bằng Python, chạy trong process (có thể là subgraph LangGraph) | Implement `DomainAgent` trực tiếp. |
| `FakeAgent` | Giai đoạn khung, test | Đọc fixture JSON theo `AgentName`, trả `AgentTaskResult` hợp lệ. |

Registry giữ hai loại entry cho mỗi service: **read** (`run_task`, `get_manifest`;
credential chỉ-đọc, dùng bởi node `*_agent`) và **write** (commit endpoint; credential
ghi, chỉ `transaction` dùng). Model không bao giờ tự tạo URL, tên tool hay nhìn thấy
credential.

#### 6.3.6. Wrapper `run_with_policy`

Mỗi node `*_agent` gọi subagent qua wrapper:

```python
async def run_with_policy(agent: DomainAgent, inp: AgentInput, policy: AgentPolicy) -> dict:
    """Dựng AgentTaskRequest, gọi subagent, kiểm result, trả update cho state.

    Không bao giờ raise: lỗi của subagent là dữ liệu cho validator (D6).
    """
```

1. Dựng `AgentTaskRequest` từ `AgentInput`: lọc `constraints`/`hints` theo manifest,
   `budget` = `min(default_budget, phần còn lại của trần lượt)`, `deadline_at` =
   bây giờ + `policy.timeout_s`.
2. Gọi `agent.run`, timeout tổng = `deadline_at` + một khoảng dư nhỏ.
3. **Chỉ retry 1 lần cho lỗi đường truyền** (không kết nối được, service trả 502/503
   trước khi nhận task). Không chạy lại cả subagent khi nó đã nhận việc, vì đắt và
   cho kết quả khác; lặp lại ở mức task là việc của validator (`RETRY_TASKS`).
4. Kiểm result: parse được, `task_id` / `plan_version` / major `contract_version`
   khớp. Sai thì thành `failed` với `internal`.
5. Ghi `usage` vào `UsageMeter`.
6. Chuyển thành `TaskResult` và trả
   `{"task_results": {task.id: result}, "task_status": {task.id: DONE | FAILED | NEEDS_INPUT}}`.

LangGraph 1.2 có sẵn `retry_policy=`, `timeout=` và `error_handler=` ở `add_node`.
Khung **không** dùng chúng cho agent, vì exception cuối cùng sẽ làm crash run; tự
bọc giúp validator thấy lỗi dưới dạng dữ liệu. Các tuỳ chọn này có thể dùng cho node
hạ tầng như `load_context`.

#### 6.3.7. Subagent và port theo từng service

Provider, cache và fallback giữa các provider là việc **bên trong** subagent. Graph
chỉ giữ port cho những gì graph tự làm.

| Node | Nối tới | Chủ / nguồn thật (sau này) | Fake giai đoạn khung |
|---|---|---|---|
| `property_agent` | Subagent housing | Service housing/location (nhánh `QuangDung`); dữ liệu phòng từ Property DB + Vector DB (từ `crawler/`/`preprocess/`) | `FakeAgent(property)` |
| `map_agent` | Subagent location (có thể cùng subagent với housing) | Service location (nhánh `QuangDung`) | `FakeAgent(map)` |
| `relocation_agent` | Subagent moving | Service Moving / AhaMove (nhánh `khoa`) | `FakeAgent(relocation)` |
| `flight_agent` | Subagent flight | Service Flight (nhánh `Doan/api`) | `FakeAgent(flight)` |
| `contract_agent` | Subagent hợp đồng / chính sách, dùng RAG | Service chính sách riêng (chủ khác); nội dung RAG ngoài phạm vi tài liệu này | `FakeAgent(contract)` |
| `transaction` | `TransactionPort` → commit endpoint của từng service + Payment | Commit endpoint của các service trên + Payment ZaloPay **sandbox** (nhánh `Doan/api`) | `FakeTransaction` (ghi nhận, idempotent) |
| `transaction`, `confirm` | `ApprovalPort.get(approval_id)` | Approval Store của backend | `InMemoryApprovalStore` |
| `load_context` (đọc), `respond` (ghi) | `SessionPort` (§6.0) | Long-term user memory (DB / LangGraph Store, Q8) | `InMemorySessionPort` |

`source_kind` của mỗi service ghi trong registry (ví dụ Flight booking giả lập là
`demo`, ZaloPay là `sandbox`); graph đối chiếu với `source_kind` subagent trả về.

Có thể có nhiều subagent cho cùng một `AgentName` (ví dụ hai nguồn tìm phòng):
`FallbackAgent([a, b])` thử lần lượt và ghi `source` là subagent đã trả kết quả.

#### 6.3.8. Input/output tối thiểu theo lĩnh vực

Manifest của từng lĩnh vực phải **ít nhất** bao được bảng dưới (được thêm field, không
được bớt); chốt lại với chủ service:

| Agent | `inputs` (tối thiểu) | `data` (output) | `required_fields` | `quotes` | `stale_ttl` (tạm) |
|---|---|---|---|---|---|
| property | `city`, `max_price_vnd?`, `near?`, `room_type?`, `must_have?`, `soft_filters?` (bộ lọc tự điền, được nới khi 0 kết quả) | `candidates: [Listing{id, title, price_vnd, deposit_vnd?, area_m2?, address, lat?, lng?, wifi?}]`, `relaxed_filters?` | `candidates`, `candidates[].price_vnd`, `candidates[].address` | tiền thuê (monthly), cọc (one_time) nếu biết | 6h |
| relocation | `from_address`, `move_date`, `volume?` (`to_address` lấy từ upstream property) | `quotes: [MovingQuote{id, provider, price_vnd, vehicle, movers, date}]` | `quotes`, `quotes[].price_vnd` | giá chuyển (one_time) | 24h |
| flight | `origin`, `destination`, `date`, `passengers` | `offers: [FlightOffer{id, carrier, fare_vnd, baggage_kg?, depart_at, arrive_at, seats_left?}]` | `offers`, `offers[].fare_vnd`, `offers[].depart_at` | giá vé (one_time) | 15m |
| map | `categories` (hospital, school, market, pharmacy, gym…), `radius_m`; toạ độ lấy từ upstream | `nearby: {listing_id: [Poi{name, category, distance_m}]}` | `nearby` | — | 7d |
| contract | `topics` (deposit, cancellation, lease_term); listing lấy từ upstream | `policies: {listing_id: Policy{deposit_rule?, cancellation?, lease_term_months?, citations: [Citation{doc_id, snippet}]}}` | `policies`, `policies[].citations` | — | 30d |

`?` là field có thể thiếu. Thiếu thì để `None` **và** thêm tên vào
`missing_fields`; không suy đoán (ví dụ không mặc định "có Wi-Fi", không tự tính cọc
= 1 tháng tiền nhà).

`cost_tier` tạm theo bảng ở §6.1: property, map, contract là `cheap` (DB nội bộ /
PostGIS / RAG nội bộ); relocation, flight là `paid` (provider bên ngoài). Giá trị chính
thức do manifest khai báo (Q13). Nếu subagent dùng LLM (`uses_llm`), chi phí LLM của nó
vẫn tính vào trần qua `usage`, dù `cost_tier` là `cheap`.

### 6.4. `executor` — Executor của Routing Orchestrator

Hàm thuần `compute_ready(plan, task_status, task_attempts, max_attempts)` quyết định:

| Trạng thái hiện tại | Điều kiện | Trạng thái mới |
|---|---|---|
| `PENDING` | mọi `depends_on` đều `DONE` | `READY` |
| `PENDING` | có dependency `FAILED` hoặc `SKIPPED` | `SKIPPED` |
| `READY` | `attempts < max_task_attempts` | `RUNNING`, đưa vào `dispatch`, `attempts + 1` |
| `READY` | `attempts >= max_task_attempts` | `FAILED` |
| `STALE` | (chỉ xảy ra sau validator V3 / change) | xử lý như `PENDING` |
| `PENDING` | có dependency `NEEDS_INPUT` | giữ `PENDING` (chờ người dùng trả lời; không dispatch) |
| `NEEDS_INPUT` | — | giữ nguyên; không dispatch lại trong lượt này |

Node ghi `task_status`, `task_attempts`, `dispatch`. Sau đó
`route_from_executor` gửi `Send(f"{task.agent}_agent", AgentInput(...))` cho mỗi id
trong `dispatch`; `upstream` lấy từ `task_results` của các task trong `depends_on`.

- Các agent trong cùng một `dispatch` chạy **song song** trong một superstep; mọi
  agent đều có edge về `executor`, nên executor chạy lại **một lần** khi tất cả xong
  (fan-in). Đây là chỗ "Collect Results" của sơ đồ.
- Task không phụ thuộc nhau chạy song song; task phụ thuộc chạy tuần tự theo DAG.
  Đây là "parallel / sequence / conditional" của sơ đồ.
- Nhánh "conditional" (ví dụ chỉ đặt vé nếu user bay) do Planner thể hiện bằng việc
  có hay không có task trong plan; executor không đánh giá điều kiện nghiệp vụ.
- Executor **không bao giờ sửa plan**. Mọi thay đổi plan đều quay về `orchestrator`.
- Trước khi đưa task `paid` vào `dispatch`, executor kiểm `max_paid_calls_per_turn` /
  `max_paid_calls_per_thread` qua `deps.usage`. Vượt trần thì đánh dấu task `FAILED`
  (`retryable=False`, lỗi `budget_exceeded`) để validator trả `GIVE_UP` → `PARTIAL` (§7.5).

### 6.5. `validator` — Result Validator

Kiểm tra theo thứ tự; mỗi lỗi sinh một `ValidationIssue`:

| Mã | Kiểm tra | Ví dụ |
|---|---|---|
| V1 | Task completeness: mọi task `required` đều `DONE` (task `NEEDS_INPUT` chuyển sang hỏi người dùng) | task flight `FAILED` |
| V2 | Required information: `data` có đủ `required_fields` (theo manifest); `missing_fields` không chứa field bắt buộc; item có id trong `source_refs` (R2) | listing không có giá |
| V3 | Dependency / stale-result: `fetched_at + stale_ttl < now` (`stale_ttl_s` của manifest); kết quả thuộc `plan_version` cũ; upstream đã đổi sau khi task chạy | giá vé lấy từ 1 giờ trước |
| V4 | Schema: `data` validate được bằng `output_schema` trong manifest; `source_kind` khớp registry | subagent trả sai kiểu |
| V5 | Conflicts giữa các kết quả (luật pluggable) | ngày chuyển đồ trước ngày có phòng; tổng chi phí vượt `budget_vnd` |

**Bảng quyết định** (áp dụng theo thứ tự, dừng ở dòng đầu tiên khớp). Validator
quyết định **có** replan hay không; Planner quyết định replan **thế nào**.

| Điều kiện | verdict / action | Ghi vào state |
|---|---|---|
| Không có issue và `intake.constraints.missing` rỗng | `PASS` / `NONE` | — |
| Có task `FAILED` do `budget_exceeded` (§7.5) | `NEED_MORE` / `GIVE_UP` | không retry, không replan |
| Thiếu thông tin chỉ user mới cung cấp được (`intake.constraints.missing`, task `NEEDS_INPUT` có `questions`, hoặc V5 cần user chọn) | `NEED_MORE` / `ASK_USER` | `ask_user_fields` (gộp cả `questions` của subagent, bỏ trùng); `respond` trả kết quả đã có kèm câu hỏi |
| Có issue V1/V2/V3 trên task `retryable` hoặc stale, còn lượt `max_task_attempts` | `NEED_MORE` / `RETRY_TASKS` | `retry_task_ids`; `task_status[id] = PENDING` |
| Có issue cần kế hoạch khác (không có kết quả phù hợp, V5 xung đột, lỗi không retry được) và còn `max_replans` | `NEED_MORE` / `REPLAN` | feedback cho Planner qua `validation` |
| Còn lại | `NEED_MORE` / `GIVE_UP` | `respond` trả `PARTIAL`, nêu rõ phần thiếu |

Task `required=False` bị lỗi chỉ tạo ghi chú, không chặn `PASS`.

### 6.6. `cost_summary` — Cost & Plan Summary

Deterministic, không LLM:

1. Với mỗi task có `quotes`, chọn option: ưu tiên option user đã chọn **trong thread
   này** (`intake.user_confirmed_facts`), nếu không thì lấy option đầu tiên (agent trả
   về đã xếp hạng). Lựa chọn giao dịch của lần trước không được dùng (mức 3, §6.1).
2. Tạo `CostLine`, tính `total_one_time_vnd` và `total_monthly_vnd` bằng số nguyên
   VND (không float).
3. Gắn `commit_actions` từ plan; `route_from_cost_summary` quyết định có cần xác nhận
   hay không. Đây là nút "Critical action?" của baseline.
4. Tính `payload_hash` (hàm thuần `confirmation_hash`, JSON canonical) và
   `quotes_expire_at`.

### 6.7. `confirm` — User Confirmation (human-in-the-loop)

```python
async def confirm_node(state: WorkflowState) -> dict:
    """Dừng graph chờ user xác nhận trước khi commit / thanh toán."""
    summary = state["cost_summary"]
    payload = {
        "type": "confirmation_required",
        "plan_version": state["plan"].version,
        "cost_summary": summary.model_dump(),
        "payload_hash": summary.payload_hash,
        "expires_at": summary.quotes_expire_at,
    }
    decision = UserDecision.model_validate(interrupt(payload))  # graph dừng, state được checkpoint
    update = {"user_decision": decision}
    if decision.kind == "CONFIRM":
        await check_approval(deps.approvals, decision, summary, state)  # lỗi → ghi errors, interrupt lại
    if decision.change_request:
        update["messages"] = [HumanMessage(decision.change_request)]    # để intake đọc như mọi tin nhắn
    return update
```

- Cần checkpointer bền vững; resume bằng `graph.ainvoke(Command(resume=decision_dict), config)`
  với cùng `thread_id`.
- Khi resume, LangGraph **chạy lại node từ đầu**, nên mọi thứ trước `interrupt()`
  phải không có side-effect.
- `decision.plan_version` khác plan hiện tại thì coi là không hợp lệ: ghi `errors`
  và interrupt lại.
- `check_approval` với `CONFIRM`: `approval_id` tồn tại trong `ApprovalPort`, cùng
  `user_id` và `thread_id`, `payload_hash` khớp `cost_summary.payload_hash`, chưa hết
  hạn. Sai bất kỳ điều kiện nào thì không đi tiếp sang `transaction`.
- `CHANGE`/`REJECT` đi về `intake`, không đi thẳng `change_impact`, vì câu đổi ý là
  ngôn ngữ tự nhiên cần được hiểu trước.

### 6.8. `change_impact` — Change Impact / Compensation

Khi `intake` trả `kind = CHANGE` và đã có plan (ví dụ "phòng này đắt quá, chọn phòng khác"):

1. Lấy `intake.target_task_ids` (hoặc toàn bộ task có `quotes` nếu intake không xác
   định được).
2. Tính **downstream closure** theo `depends_on` (ví dụ đổi phòng thì map, contract,
   relocation phụ thuộc phòng cũng bị ảnh hưởng; flight thì không).
3. Ghi `task_status[id] = STALE` cho target + downstream.
4. Ghi `change_context` với `invalidated_task_ids`, `reusable_task_ids` (các task còn
   lại DONE), và `request` (= `intake.change_request`).
5. Báo giá và approval gắn với plan cũ tự hết hiệu lực vì `plan_version` và
   `payload_hash` sẽ đổi.
6. Compensation: giai đoạn này chưa có side-effect nào trước `confirm`, nên không cần
   release gì. Nếu sau này có "giữ chỗ tạm" (hold) ở Phase 2 thì gọi
   `TransactionPort.release_hold` tại đây.

### 6.9. `transaction` — Transaction / Payment Agent

```python
class TransactionPort(Protocol):
    async def commit(self, action: CommitAction, option_id: str, amount_vnd: int,
                     idempotency_key: str) -> Receipt: ...
    async def lookup(self, idempotency_key: str) -> Receipt | None: ...
    async def compensate(self, receipt: Receipt) -> None: ...
    async def status(self, receipt_id: str) -> Receipt: ...
```

- Chỉ chạy khi `user_decision.kind == "CONFIRM"`, `plan_version` khớp và approval
  còn hợp lệ. Kiểm lại approval ngay trước khi commit (phòng trường hợp hết hạn
  giữa `confirm` và `transaction`).
- `idempotency_key = sha256(thread_id, plan.version, action.id, option_id)`.
- Trước mỗi `commit`, gọi `lookup(idempotency_key)`. Đã có receipt thì dùng lại,
  không commit lần hai (xử lý trường hợp node chạy lại khi resume/retry).
- **Timeout hoặc kết quả không rõ sau `commit`**: gọi `lookup` trước. Chỉ gọi
  `commit` lại khi provider hỗ trợ idempotency key; nếu không, trả
  `TransactionResult(status="pending_verification")` và báo người dùng, không tự
  gọi lại. Xem ADR-003 trên nhánh `khoa`.
- Commit tuần tự theo `commit_actions`. Nếu một action lỗi thì `compensate` các
  receipt đã thành công theo thứ tự ngược lại, và trả
  `TransactionResult(status="compensated")`.
- Theo v4, Booking/Reservation được gộp ở đây: adapter thật dispatch theo
  `CommitActionKind` (đặt cọc phòng, đặt chuyển đồ, đặt vé) và Payment Gateway.
- **Commit endpoint của service là tất định, không qua subagent LLM** (R3). Mỗi
  service hỗ trợ ghi công bố commit endpoint cho các `commit_kinds` trong manifest,
  với contract tối thiểu:
  - vào: `action_kind`, `option_id` (id trong `source_refs` của kết quả đã được xác
    nhận), `amount_vnd`, `idempotency_key`, `approval_id`;
  - ra: `Receipt` hoặc lỗi có cấu trúc;
  - thêm `lookup(idempotency_key)` và, nếu hỗ trợ huỷ, `compensate(receipt_id)`.
  Endpoint từ chối nếu `amount_vnd` khác giá hiện tại của provider, thay vì tự đổi
  giá. Chỉ `transaction` có credential ghi.
- Receipt từ adapter `sandbox`/`demo` phải mang `source_kind` đó; `respond` không
  được trình bày như đặt/thanh toán thật.
- Đặt cọc thành công là sự kiện hết hạn của bộ nhớ (§6.1). `transaction` không tự
  ghi bộ nhớ; `respond` ghi qua `memory_updates` (§6.0).

### 6.10. `respond` — Response

Soạn `AgentResponse` và thêm AI message vào `messages`. Giai đoạn khung dùng template
(không LLM); sau này có thể thay bằng LLM composer.

| Tình huống | `kind` |
|---|---|
| Plan rỗng do `NotImplementedPlanner` / intake `UNSUPPORTED` | `UNSUPPORTED` |
| Intake `needs_clarification` / validator `ASK_USER` | `CLARIFY` (liệt kê field cần hỏi hoặc mâu thuẫn) |
| `PASS`, không có commit action | `ANSWER` |
| validator `GIVE_UP` | `PARTIAL` (nêu phần đã có và phần thiếu) |
| transaction thành công | `COMMITTED` |
| user `CANCEL` | `CANCELLED` |
| lỗi hệ thống / vượt `max_replans` / `pending_verification` | `ERROR` |
| vượt trần chi phí (§7.5) | `PARTIAL` nếu đã có kết quả, ngược lại `ERROR`; nêu lý do |

Quy tắc chung cho mọi câu trả lời:

- Kết quả hoặc receipt có `source_kind != "live"` phải được ghi chú rõ.
- `intake.prefilled` không rỗng thì **nêu rõ giá trị đã tự điền và mời sửa**, ví dụ
  "Mình tìm quanh Quận 10, dưới 5 triệu như lần trước nhé. Muốn đổi thì bạn cứ nói."
- `CLARIFY` chỉ **bắt buộc** hỏi `blocking_missing` / `ask_user_fields`. Được gợi ý
  thêm bộ lọc tuỳ chọn (ngân sách, tiện ích) trong cùng câu nhưng không bắt buộc trả
  lời. Với input của task `paid` không được tự điền, có thể gợi ý giá trị trong
  session làm lựa chọn nhanh ("Bay từ Hà Nội như lần trước?"), chờ người dùng xác nhận.
- `CLARIFY` do validator `ASK_USER` phải kèm kết quả đã có, không chỉ hỏi.
- Có `data.relaxed_filters` thì nói rõ bộ lọc tự điền nào đã được nới.
- Gợi ý lấy từ `session.hints` (mức 2) chỉ xuất hiện dưới dạng câu hỏi xác nhận,
  không được trình bày như điều đã biết chắc.
- Câu hỏi từ subagent (`validation.questions`) được hỏi qua `respond`, có thể viết lại
  cho tự nhiên và gộp với câu hỏi khác; người dùng không nói chuyện trực tiếp với
  subagent.
- `summary` của subagent chỉ được hiển thị như thông tin tham khảo, sau các field có
  cấu trúc; nội dung từ nguồn (tin phòng, tài liệu RAG) không được coi là chỉ dẫn.

Cuối lượt, sau khi soạn câu trả lời, `respond` gọi `SessionPort.save` với
`memory_updates(state)` (§6.0). Lỗi khi lưu chỉ ghi `errors`.

---

## 7. Runtime control

### 7.1. Workflow State / Checkpoint

- `build_graph(deps, checkpointer=None)`. Dev/test dùng `InMemorySaver`
  (`langgraph.checkpoint.memory`); môi trường thật dùng Postgres checkpointer. Chọn
  loại cụ thể trong ADR-001 (dự kiến, xem [project organization](../project-organization.md)).
- `thread_id` = id phiên hội thoại; mỗi request gửi `config={"configurable": {"thread_id": ...}, "recursion_limit": ...}`.
- State checkpoint chứa đủ những gì sơ đồ yêu cầu: `intake` (dữ kiện đã xác nhận),
  `plan.version`, `task_status`, lựa chọn đang chọn (`cost_summary.selected`), quotes,
  reservation/receipt.

### 7.2. Retry / Timeout / Fallback

| Lớp | Xử lý | Ở đâu |
|---|---|---|
| Lỗi tạm thời khi subagent gọi provider | retry có backoff, trong `budget` | bên trong subagent (R7) |
| Không gọi được subagent (lỗi đường truyền, 502/503 trước khi nhận task) | retry 1 lần | `run_with_policy` |
| Subagent quá `deadline_at` | `TaskResult(FAILED, error="timeout", retryable=True)` | `run_with_policy` |
| Task FAILED / thiếu field / stale | dispatch lại (giới hạn `max_task_attempts`) | `validator` → `executor` |
| Không có kết quả phù hợp | lập kế hoạch lại (giới hạn `max_replans`) | `validator` → `orchestrator` |
| Provider chính lỗi | provider dự phòng | bên trong subagent |
| Subagent chính lỗi | subagent dự phòng cho cùng `AgentName` (nếu có) | `FallbackAgent` |
| Timeout sau thao tác ghi | `lookup(idempotency_key)` trước khi cân nhắc gọi lại | `transaction` |

### 7.3. Data Quality / Unknown Fields

- Subagent không có dữ liệu thì ghi `None` và thêm vào `missing_fields` (R2).
- Validator V2 chặn nếu field thiếu là bắt buộc; nếu không bắt buộc thì `respond`
  ghi rõ "chưa có thông tin".
- Cấm suy diễn mặc định (Wi-Fi, tiền cọc, phí dịch vụ…).
- Không trình bày dữ liệu `sandbox`/`demo` như dữ liệu thật.

### 7.4. Cấu hình

```python
class GraphSettings(BaseModel):
    max_task_attempts: int = 2
    max_replans: int = 2
    recursion_limit: int = 100
    agent_timeout_s: dict[AgentName, float]      # mặc định 20s; subagent dùng LLM có thể cần lâu hơn
    agent_transport_retries: int = 1             # chỉ lỗi đường truyền trước khi subagent nhận task (§6.3.6)
    # stale_ttl lấy từ manifest (stale_ttl_s); có thể ghi đè ở đây nếu cần chặt hơn
    stale_ttl_override: dict[AgentName, timedelta] = {}
    approval_ttl: timedelta = timedelta(minutes=10)  # trần; không vượt quotes_expire_at

    # --- Kiểm soát chi phí (§7.5) ---
    llm_models: dict[str, str]                   # node -> model id; intake: model nhỏ, orchestrator: model mạnh
    max_llm_calls_per_turn: int = 4              # LLM của graph (intake, orchestrator)
    max_subagent_llm_calls_per_turn: int = 20    # tổng LLM call báo qua usage của các subagent
    max_paid_calls_per_turn: int = 6             # tổng call tới agent cost_tier="paid"
    max_paid_calls_per_thread: int = 30

    # --- Bộ nhớ người dùng (§6.0, §6.1) ---
    prefill_ttl: dict[str, timedelta] = {        # tính từ last_confirmed_at
        "city": timedelta(days=90), "near": timedelta(days=90),
        "max_price_vnd": timedelta(days=60),
        "room_type": timedelta(days=180), "must_have": timedelta(days=180),
        "household_size": timedelta(days=365), "has_pet": timedelta(days=365),
        "has_motorbike": timedelta(days=365),
    }                                            # field không có trong bảng thì không tự điền
```

Giá trị mặc định là tạm thời. Sau này đọc từ `src/config.py` (`Settings`) qua biến
môi trường.

### 7.5. Kiểm soát chi phí

**Chi phí đến từ đâu**

| Nguồn | Mức | Ở node |
|---|---|---|
| LLM call lớn (lập DAG) | đắt | `orchestrator` |
| LLM call nhỏ (trích xuất, phân loại) | rẻ, dùng model nhỏ | `intake` |
| LLM bên trong subagent (`uses_llm`) | tuỳ subagent; nhân theo số task | subagent, báo qua `usage` |
| API bên ngoài tính tiền hoặc giới hạn lượt (báo giá chuyển đồ, tìm vé) | đắt / giới hạn | agent `paid` |
| DB nội bộ (Property DB, Vector DB, PostGIS, RAG nội bộ) | gần như miễn phí | agent `cheap` |
| Số lượt chat | mỗi lượt ≥ 1 LLM call | toàn graph |

**Nguyên tắc**

1. **Phân tầng model.** `intake` dùng model nhỏ; `orchestrator` dùng model mạnh;
   `respond` dùng template (sau có thể dùng model nhỏ). Node khác không gọi LLM (D11).
   Cấu hình qua `GraphSettings.llm_models`, không ghi cứng trong node.
2. **Bỏ qua LLM Planner khi không cần** (đề xuất). Yêu cầu chỉ có một domain và không
   có dependency (ví dụ `find_room → [property]`) dùng `TemplatePlanner` với plan mẫu.
   LLM Planner chỉ dùng cho yêu cầu nhiều domain. Cả hai implement cùng `Planner`,
   graph không đổi.
3. **Không gọi lại thứ đã có.** Khi `REFINE`/`CHANGE`, task không bị ảnh hưởng giữ
   `DONE` (§6.2, §6.8). Subagent nên cache kết quả provider theo hash input, hạn bằng
   `stale_ttl` (khuyến nghị cho chủ service, báo `cached_calls` trong `usage`).
4. **Không gọi API tính tiền bằng dữ liệu đoán.** Tự điền từ session chỉ áp dụng cho
   task `cheap` (§6.1). Task `paid` chỉ chạy khi input do người dùng nói trong thread
   hoặc suy ra từ kết quả đã có.
5. **Chỉ làm mới cái sắp commit.** Trước `confirm`, chỉ làm mới kết quả hết hạn của
   task có commit action (V3), không làm mới toàn bộ plan.
6. **Có trần.** `max_task_attempts`, `max_replans` và các trần ở §7.4. Node kiểm trần
   trước khi gọi LLM / dispatch task `paid`; vượt trần thì không gọi, ghi `errors` và
   route sang `respond` (`PARTIAL` hoặc `ERROR`, nêu lý do). Replan do `CHANGE` cũng
   tính vào trần.
7. **Hỏi sau giúp giảm lượt.** Gộp câu hỏi còn thiếu vào lượt trả kết quả một phần
   (D10) thường bớt được một lượt chat, tức bớt LLM call.
8. **Ngân sách cho subagent.** Mỗi request tới subagent mang `budget` = `min(default_budget`
   trong manifest, phần còn lại của trần lượt`)`. Subagent phải dừng trong ngân sách
   (R6) và báo `usage` (R11); `run_with_policy` ghi vào `UsageMeter`. Không chạy lại cả
   subagent khi lỗi tạm thời (§6.3.6), vì mỗi lần chạy lại là cả một vòng LLM.

**Đo chi phí.** `GraphDeps.usage: UsageMeter` ghi mỗi LLM call (node, model, token
vào/ra) và mỗi call provider (agent, `cost_tier`, thời gian, cache hit) theo
`request_id`, `thread_id`, `plan_version`. Bộ đếm theo lượt/thread để kiểm trần cũng
lấy từ đây. Dữ liệu đo **không** nằm trong `WorkflowState` để checkpoint không phình.
Test dùng `InMemoryUsageMeter`.

```python
class UsageMeter(Protocol):
    async def record_llm(self, node: str, model: str, tokens_in: int, tokens_out: int) -> None: ...
    async def record_provider(self, agent: AgentName, cost_tier: str, cached: bool, elapsed_ms: int) -> None: ...
    async def record_subagent(self, agent: AgentName, usage: AgentUsage, elapsed_ms: int) -> None: ...
    async def counts(self, thread_id: str, request_id: str | None = None) -> UsageCounts: ...
```

**Ước lượng theo ví dụ** (số call, chưa quy ra tiền):

| Tình huống | LLM lớn | LLM nhỏ | Call `paid` | Lượt |
|---|---|---|---|---|
| "Tìm phòng giúp mình" — người dùng mới: hỏi khu vực rồi tìm | 1 (0 nếu `TemplatePlanner`) | 2 | 0 | 2 |
| "Tìm phòng giúp mình" — người dùng cũ: tự điền khu vực, tìm luôn | 1 (0 nếu `TemplatePlanner`) | 1 | 0 | 1 |
| Phòng + chuyển đồ, **hỏi ngay** địa chỉ | 2 | 3 | 1 | 3 |
| Phòng + chuyển đồ, **hỏi sau** (theo D10) | 2 | 2 | 1 | 2 |

Ở ví dụ phòng + chuyển đồ, người dùng đằng nào cũng phải chọn phòng trước khi báo giá,
nên hỏi sau gộp câu hỏi vào lượt đó và bớt một lượt.

---

## 8. Dependency injection và build graph

```python
@dataclass(frozen=True)
class GraphDeps:
    intake: Intake
    planner: Planner
    agents: AgentRegistry            # AgentName -> DomainAgent (Remote/Local/Fake), dựng từ manifest
    session: SessionPort
    transaction: TransactionPort
    approvals: ApprovalPort
    settings: GraphSettings
    usage: UsageMeter                # đo token / call provider, kiểm trần chi phí (§7.5)
    clock: Callable[[], datetime]    # inject để test V3 (stale), hạn approval, tuổi sở thích

def build_graph(deps: GraphDeps, checkpointer: BaseCheckpointSaver | None = None):
    """Dựng StateGraph theo §4. Node agent được tạo động từ deps.agents."""
```

- Một node `*_agent` được đăng ký cho mỗi agent có trong registry. Agent chưa có thì
  không có node, và `validate_plan` sẽ từ chối task dùng agent đó.
- `default_deps()` dùng `PassThroughIntake` + `NotImplementedPlanner` + `InMemoryUsageMeter`
  + `FakeAgent` cho mọi lĩnh vực + các fake port.
  Đây là thứ API dùng cho tới khi có implementation thật.
- `test_deps(intake=FixedIntake(...), planner=FixedPlanner(...), overrides=...)` cho test.

**Ráp phần thật sau này:**

| Phần | Việc cần làm | Graph có phải sửa không |
|---|---|---|
| Subagent thật của một service | Chủ service làm theo §6.3 (manifest + `run_task`), chạy bộ test tuân thủ; đăng ký endpoint + credential chỉ-đọc vào registry | Không |
| Commit endpoint của một service | Chủ service làm theo §6.9; đăng ký credential ghi cho `transaction` | Không |
| Lĩnh vực mới | Thêm `AgentName`, manifest mới, đăng ký registry | Không (node sinh từ registry) |
| Intake | Viết class implement `Intake` (LLM structured output), thay `PassThroughIntake` | Không |
| Orchestrator | Viết class implement `Planner`, thay `NotImplementedPlanner` | Không |
| LLM cho respond | Thay template trong `respond` | Không |

---

## 9. Ráp vào API (làm sau, chỉ mô tả)

Endpoint hiện tại ([routes.py](../../src/api/routes.py)) gọi
`agent.ainvoke({"query": ...})` với graph mẫu. Khi chuyển sang graph mới:

| Endpoint | Hành vi |
|---|---|
| `POST /chat` `{thread_id?, message}` | Tạo `thread_id` nếu chưa có. Nếu thread đang chờ xác nhận (`aget_state` có `interrupts`), coi tin nhắn là đổi ý: `Command(resume={"kind": "CHANGE", "plan_version": <hiện tại>, "change_request": message})`. Ngược lại `graph.ainvoke({"messages": [HumanMessage(message)], "user_id": ...}, config)`. |
| | Nếu kết quả có `__interrupt__` thì trả `{status: "pending_confirmation", thread_id, confirmation: <payload>}`. |
| | Ngược lại trả `{status: "done", thread_id, response: AgentResponse}`. |
| `POST /chat/{thread_id}/decision` `{kind, plan_version, payload_hash?, change_request?, target_task_ids?}` | Với `CONFIRM`: backend xác thực user, so `payload_hash` client gửi với payload đang chờ (lấy từ `aget_state`), tạo `Approval` trong Approval Store, rồi resume với `approval_id`. Client **không** tự gửi `approval_id`. Các kind khác resume trực tiếp. |
| `GET /chat/{thread_id}/state` | `graph.aget_state(config)`: intake, plan, task_status, cost_summary, đang chờ gì (`next`, `interrupts`). |
| (sau) `GET /chat/{thread_id}/stream` | `graph.astream(..., stream_mode="updates")` để hiển thị tiến độ từng task. |

Cần cập nhật `ChatRequest`/`ChatResponse` trong
[schemas.py](../../src/models/schemas.py). App tạo graph một lần khi khởi động bằng
`build_graph(default_deps(), checkpointer)`. Mỗi request ghi log `request_id`,
`thread_id`, `plan_version`, tool đã gọi và thời gian.

---

## 10. Ví dụ chạy qua một yêu cầu

> "Tháng 11 mình chuyển từ Hà Nội vào TP.HCM, cần phòng dưới 6 triệu gần bệnh viện
> Chợ Rẫy, có Wi-Fi; đặt giúp chuyển đồ và vé máy bay."

**Lượt 1 — `intake`** (giai đoạn khung là `FixedIntake`) trả `kind = NEW_GOAL`,
`intent = relocate_and_rent` (domains: property, relocation, flight, map, contract),
`constraints.values = {city: HCM, max_price_vnd: 6_000_000, near: "BV Chợ Rẫy",
must_have: [wifi], origin_city: HN, move_month: 2026-11}`.

Áp quy tắc §6.1:

| Domain | Còn thiếu | Chạy được? |
|---|---|---|
| property | — | có |
| map, contract | — (lấy từ phòng) | có, sau property |
| flight | `date` (mới có tháng) | chưa |
| relocation | `from_address` (mới có thành phố), `move_date`; `to_address` lấy từ phòng | chưa |

Có task chạy được nên **không hỏi ngay**: `blocking_missing = []`,
`constraints.missing = [flight.date, relocation.from_address, relocation.move_date]`.
Flight và relocation là `paid`, nên dù session có địa chỉ cũ cũng không tự điền.

Plan v1 (do Planner sinh ra; ở giai đoạn khung là `FixedPlanner`) chỉ gồm task chạy được:

| Task | Agent | depends_on | inputs (rút gọn) |
|---|---|---|---|
| `t1` | property | — | `city=HCM, max_price_vnd=6_000_000, near="BV Chợ Rẫy", must_have=["wifi"]` |
| `t3` | map | `t1` | `categories=[hospital, market, pharmacy], radius_m=1500` |
| `t4` | contract | `t1` | `topics=[deposit, cancellation, lease_term]` |

Validator không thấy lỗi nhưng `constraints.missing` còn, nên `ASK_USER`. Câu trả lời
lượt 1 gồm danh sách phòng kèm tiện ích, chính sách cọc và câu hỏi: *"Bạn chọn phòng
nào? Bay ngày nào? Chuyển đồ ngày nào, từ địa chỉ nào ở Hà Nội?"*

**Lượt 2** — người dùng: *"Phòng số 2. Bay 15/11, chuyển đồ 14/11 từ 12 Láng Hạ."*
`intake` trả `REFINE`, ghi `selected_listing_id` vào `user_confirmed_facts`, không
còn thiếu gì. Plan v2 giữ `t1`, `t3`, `t4` ở `DONE` và thêm:

| Task | Agent | depends_on | inputs (rút gọn) |
|---|---|---|---|
| `t2` | flight | — | `origin=HAN, destination=SGN, date=2026-11-15` |
| `t5` | relocation | `t1` | `from_address="12 Láng Hạ", move_date=2026-11-14`; `to_address` từ phòng đã chọn trong `t1` |

`commit_actions`: `deposit(t1)`, `flight_booking(t2)`, `moving_booking(t5)`.

```mermaid
sequenceDiagram
    participant API
    participant I as intake
    participant O as orchestrator
    participant E as executor
    participant A as agents
    participant V as validator
    participant C as cost_summary / confirm
    participant X as change_impact
    participant T as transaction
    Note over API,T: Lượt 1
    API->>I: messages
    I->>O: IntakeResult (NEW_GOAL, missing: date, from_address, move_date)
    O->>E: plan v1 (t1, t3, t4)
    E->>A: Send t1 (property)
    A-->>E: task_results t1
    E->>A: Send t3 (map), t4 (contract) — song song
    A-->>E: task_results t3, t4
    E->>V: không còn task
    V-->>API: ASK_USER → respond CLARIFY (kèm danh sách phòng)
    Note over API,T: Lượt 2
    API->>I: "Phòng số 2, bay 15/11, chuyển 14/11 từ 12 Láng Hạ"
    I->>O: IntakeResult (REFINE, đủ thông tin)
    O->>E: plan v2 (t1, t3, t4 DONE; thêm t2, t5)
    E->>A: Send t2 (flight), t5 (relocation) — song song
    A-->>E: task_results t2, t5
    E->>V: không còn task
    V->>C: PASS
    C-->>API: interrupt(confirmation_required v2, payload_hash)
    API->>C: Command(resume=CHANGE "phòng đắt quá", target t1)
    C->>I: câu đổi ý (messages)
    I->>X: IntakeResult (CHANGE, target t1)
    X->>O: t1, t3, t4, t5 STALE; t2 reusable
    O->>E: plan v3 (t1 mới, t2 giữ DONE)
    Note over E,V: lặp lại Phase 2–3 chỉ cho task bị ảnh hưởng
    C-->>API: interrupt(confirmation_required v3, payload_hash mới)
    Note over API: backend xác thực user, lưu Approval(payload_hash v3)
    API->>C: Command(resume=CONFIRM v3 + approval_id)
    C->>T: approval hợp lệ
    T->>T: lookup → commit deposit, flight, moving (idempotent)
    T-->>API: respond COMMITTED (ghi rõ sandbox/demo nếu có)
```

Trường hợp `t1` trả listing có `wifi = None`: `missing_fields=["candidates[0].wifi"]`.
Wi-Fi là `must_have`, nên V2 báo lỗi. Validator chọn `RETRY_TASKS` (nếu adapter có
thể bổ sung) hoặc `ASK_USER` / `PARTIAL`, **không** giả định là có Wi-Fi.

### 10.1. "Tìm phòng giúp mình."

Yêu cầu chỉ có domain property, thiếu khu vực.

**Người dùng mới** (session rỗng): không task nào chạy được, nên
`blocking_missing = [location]`. Luồng `load_context → intake → respond (CLARIFY) → END`,
không gọi Planner, không gọi API.

> Bạn muốn tìm phòng ở khu vực nào? Ví dụ: gần ĐH Bách Khoa, Quận 10 TP.HCM…
> Nếu có ngân sách hay yêu cầu như Wi-Fi, máy lạnh, chỗ để xe thì nói luôn để mình lọc sát hơn.

Lượt sau người dùng trả lời "Quận 10, dưới 5 triệu": `intake` trả `REFINE` → plan
`[t1 property]` → `ANSWER`.

**Người dùng cũ** (`session.preferences` có `near = "Quận 10"` và
`max_price_vnd = 5_000_000`, còn hạn theo `prefill_ttl`, không `stop_prefill`):
property là `cheap` nên được tự điền. `prefilled = {near: preference,
max_price_vnd: preference}`; hai giá trị vào `soft_filters`. Không còn thiếu gì, tìm
luôn trong một lượt:

> Mình tìm quanh Quận 10, dưới 5 triệu như lần trước nhé. Có 6 phòng: …
> Muốn đổi khu vực hay ngân sách thì bạn cứ nói.

Người dùng đáp "không, lần này ở Thủ Đức": `intake` trả `CHANGE` → `change_impact`
đánh dấu `t1` là `STALE` → Planner lập plan mới. Ngân sách 5 triệu có anchor là khu
vực, nên **không** được tự điền cho Thủ Đức. Cuối lượt, `memory_updates` ghi
`near = "Thủ Đức"` (có evidence, đã dùng để tìm) và đặt `stop_prefill` cho ngân sách
cũ; log `prefill_corrected` cho `near`.

Nếu 5 triệu ở Quận 10 cho 0 kết quả: agent tìm lại không có `soft_filters` và trả
`relaxed_filters = [max_price_vnd]`; câu trả lời nói rõ ngân sách như lần trước đã
được nới.

---

## 11. Layout code đề xuất và thứ tự implement

```text
src/agents/
  graph.py              # build_graph(deps, checkpointer)
  state.py              # WorkflowState, merge_dict, AgentInput
  models.py             # IntakeResult, Task, Plan, TaskResult, ValidationReport, CostSummary, Approval, enums…
  routing.py            # route_from_intake/orchestrator/executor/validator/cost_summary/confirm
  deps.py               # GraphDeps, AgentRegistry, GraphSettings, default_deps()
  intake.py             # Intake Protocol, REQUIRED_INPUTS, resolve_missing, PassThroughIntake, FixedIntake, ScriptedIntake
  planning.py           # Planner Protocol, validate_plan, NotImplementedPlanner, FixedPlanner, TemplatePlanner
  approval.py           # confirmation_hash, check_approval (hàm thuần)
  memory.py             # MEMORY_TIERS, PREFILL_ANCHORS, prefill_from_memory, memory_updates (hàm thuần)
  cost.py               # UsageMeter Protocol, UsageCounts, check_budget (hàm thuần)
  nodes/
    load_context.py
    intake.py           # vỏ node; logic nằm trong Intake
    orchestrator.py     # vỏ node; logic nằm trong Planner
    executor.py         # + compute_ready (hàm thuần)
    validator.py        # + các rule V1–V5
    cost_summary.py
    confirm.py
    change_impact.py    # + downstream_closure (hàm thuần)
    transaction.py
    respond.py
  contracts/
    agent_task.py       # AgentManifest, AgentCapability, AgentBudget, AgentTaskRequest,
                        # AgentTaskResult, Question, AgentUsage, AgentError (§6.3) — nguồn schema
    export_schema.py    # xuất JSON Schema ra docs/api/agent-contract/
  subagents/
    base.py             # DomainAgent Protocol, run_with_policy, AgentPolicy
    remote.py           # RemoteAgent: gọi MCP tool run_task / get_manifest qua registry
    local.py            # LocalAgent: bọc subagent Python chạy trong process
    fake.py             # FakeAgent(AgentName) đọc fixture
    fallback.py         # FallbackAgent
src/services/adapters/
  ports.py              # TransactionPort, ApprovalPort, SessionPort (port của graph; port provider nằm trong subagent)
  registry.py           # ServiceRegistry: URL, credential ref (read / write), tool allowlist, source_kind, manifest
  commit.py             # TransactionPort thật: gọi commit endpoint của từng service (§6.9)
  fakes.py              # FakeTransaction, InMemorySessionPort, InMemoryApprovalStore, InMemoryUsageMeter
docs/api/agent-contract/  # JSON Schema xuất từ contracts/agent_task.py, cho chủ service
tests/fixtures/agents/    # JSON fixture cho FakeAgent
tests/contract/agent_conformance/  # bộ test tuân thủ R1–R12, chủ service chạy với subagent của mình
tests/test_agents/
  test_routing.py       # các hàm route_* (thuần)
  test_intake.py        # resolve_missing: chặn chỉ khi không task nào chạy được, chỉ hỏi task gốc,
                        # tự điền cho cheap / không cho paid, prefill quá hạn, REJECT → CHANGE,
                        # fact không có evidence bị bỏ
  test_memory.py        # quá hạn không điền; sửa thì ghi đè; đặt cọc xong ngừng điền khu vực;
                        # đổi khu vực không điền ngân sách; mức 2 chỉ gợi ý; mức 3 và điều
                        # model suy ra không được lưu; save chạy lại không sai; 0 kết quả → nới
  test_executor.py      # compute_ready: song song, tuần tự, SKIPPED, max attempts
  test_validator.py     # V1–V5 và bảng quyết định
  test_change_impact.py # downstream closure, reusable
  test_approval.py      # hash lệch, hết hạn, sai user, sai plan_version
  test_cost_limits.py   # vượt trần paid/LLM → PARTIAL/ERROR, cache hit không tính call, TemplatePlanner,
                        # usage của subagent tính vào trần
  test_run_with_policy.py  # lọc constraint/hint theo manifest, budget, deadline, retry 1 lần chỉ
                        # cho lỗi đường truyền, result sai contract → FAILED, needs_input → NEEDS_INPUT
  test_graph_e2e.py     # FixedIntake + FixedPlanner + fakes: PASS → confirm → CONFIRM → COMMITTED
  test_interrupt.py     # interrupt / resume CHANGE → intake → replan v2; restart không lặp side-effect
```

`example_node.py`, `example_tool.py` và test hiện có trong
[test_graph.py](../../tests/test_agents/test_graph.py) sẽ được thay thế khi code
khung. `requirements.txt` đang ghi `langgraph>=0.2.0`; nên nâng lên `>=1.0` vì thiết
kế dùng `interrupt`, `Command`, `input_schema` (bản đã cài trong `.venv` là 1.2.11).

**Thứ tự implement** (tiến độ theo dõi ở GitHub Issues, không cập nhật ở đây):

| Mốc | Nội dung | Kết quả kiểm chứng |
|---|---|---|
| M0 — Khung | models, state, routing, `build_graph`, `PassThroughIntake`/`FixedIntake`, `NotImplementedPlanner`/`FixedPlanner`, `resolve_missing`, `InMemoryUsageMeter`, contract §6.3 + JSON Schema, `FakeAgent` cho 5 lĩnh vực, `run_with_policy`, `respond` template | `test_graph_e2e` chạy hết hai lượt ở §10 và hai trường hợp ở §10.1 không cần mạng |
| M1 — Kiểm soát | validator V1–V5, cost_summary, change_impact, chính sách bộ nhớ (`memory.py`, `SessionPort.save`) với `InMemorySessionPort` | test bảng quyết định, closure, `test_memory` |
| M2 — Human-in-the-loop | `confirm` + checkpointer, approval với `InMemoryApprovalStore`, transaction với `FakeTransaction`, API `/chat` + `/decision` | test interrupt/resume, approval, idempotency |
| M3 — Subagent thật | bộ test tuân thủ; `RemoteAgent`; từng service đăng ký subagent (manifest + `run_task`) khi các nhánh được ghép, bắt đầu bằng subagent moving chỉ đọc trên staging (dữ liệu mock trước, Q13); commit endpoint cho `transaction`; giữ `FakeAgent` cho test | mỗi subagent qua bộ test tuân thủ; e2e với ít nhất một `RemoteAgent` |
| M4 — Intake + Orchestrator | thiết kế + implement `Intake` và `Planner` (kèm `TemplatePlanner`), model theo `llm_models` | bộ câu tiếng Việt có expected intent; golden scenarios (`tests/golden_scenarios/`); báo cáo token/call theo kịch bản từ `UsageMeter` |

---

## 12. Câu hỏi mở

| # | Câu hỏi | Ảnh hưởng |
|---|---|---|
| Q1 | Orchestrator dùng LLM planner (structured output) hay rule-based, hay kết hợp? | Chỉ ảnh hưởng implementation `Planner`. |
| Q2 | ~~Domain agent là tool-caller deterministic hay ReAct LLM?~~ **Đã chốt 2026-09-28:** mỗi service có subagent riêng do chủ service viết, bên trong tuỳ chủ service (có thể dùng LLM); graph nối qua contract §6.3 (D13). | §6.3. |
| Q3 | Checkpointer thật: Postgres hay SQLite? Dùng chung DB với Property DB không? | ADR-001. |
| Q4 | Giá trị `stale_ttl` cho từng loại dữ liệu (đặc biệt giá vé, báo giá chuyển đồ). | Validator V3, hạn approval. |
| Q5 | Có cần "giữ chỗ tạm" (hold) trước khi user xác nhận không? Nếu có thì ai release khi CHANGE? | `change_impact`, `TransactionPort`. |
| Q6 | `max_task_attempts`, `max_replans`, timeout từng agent. | `GraphSettings`. |
| Q7 | Chọn option mặc định trong `cost_summary`: lấy theo thứ hạng của agent hay theo tiêu chí tổng chi phí thấp nhất? | `cost_summary`. |
| Q8 | Long-term memory: DB riêng hay LangGraph `Store`? | `SessionPort`. |
| Q9 | Luật xung đột V5 cụ thể (ngày chuyển, ngân sách, vị trí). | `validator`. |
| Q10 | ~~Field nào chặn (hỏi ngay), field nào hỏi sau?~~ **Đã chốt 2026-09-28:** chỉ hỏi ngay khi không task nào chạy được; được tự điền từ session kèm thông báo. Xem D10, §6.1. | `intake`, validator `ASK_USER`. |
| Q11 | Intake và Planner dùng chung một model/prompt hay tách? Có gộp thành một LLM call khi yêu cầu đơn giản không? | Chi phí, độ trễ; không ảnh hưởng graph. |
| Q12 | Approval Store đặt ở đâu, ai sở hữu, TTL bao lâu? | `ApprovalPort`, API `/decision`. |
| Q13 | Đơn giá / hạn mức của từng provider (AhaMove, flight, maps) và giá trị trần chi phí; `cost_tier` của từng agent. **Hoãn** đến khi có API thật: giai đoạn đầu test độ ổn định bằng API mock. Khi test mock vẫn giữ `cost_tier` theo bản chất provider thật (không đặt tất cả `cheap`), để hành vi tự điền và trần chi phí giống lúc chạy thật. | §7.4, §7.5. |
| Q14 | ~~Dữ liệu session nào được tự điền, và bao lâu thì hết hiệu lực?~~ **Đã chốt phần logic 2026-09-28:** ba mức dữ liệu, hạn theo field và theo sự kiện, quy tắc đi kèm, chỉ lưu điều người dùng nói (§6.0, §6.1, §7.4). **Hoãn** đến khi có người dùng thật: xin đồng ý lưu, màn hình xem/xoá, `SessionPort.forget` (thống nhất với ADR-007 trên nhánh `Doan/api`); chỉnh `prefill_ttl` theo tỉ lệ `prefill_corrected`. | `SessionPort`, `memory.py`, `resolve_missing`. |
| Q15 | Kênh truyền tới subagent: MCP tool `run_task` (đề xuất, vì các service đều đã là MCP server) hay HTTP `POST /agent/run_task`? Có cần stream tiến độ từ subagent không? | `RemoteAgent`, registry, §6.3.5. |
| Q16 | Danh sách tiện ích dùng chung subagent được phép gọi theo R5 (ví dụ geocode, tính khoảng cách): ai cung cấp, đặt ở service nào? | R5, registry. |
| Q17 | Commit endpoint cụ thể của từng service (đặt cọc, đặt xe, đặt vé, thanh toán): service nào hỗ trợ `lookup` / `compensate`? | §6.9, `commit.py`. |
