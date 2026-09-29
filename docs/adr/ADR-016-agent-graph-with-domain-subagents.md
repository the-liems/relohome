# ADR-016 — Một LangGraph graph với subagent theo lĩnh vực

- Date: 2026-09-29
- Status: Accepted trên nhánh `integration/langgraph-services` (theo code đã chạy; nhóm review lại khi
  merge vào `main`)
- Supersedes: [ADR-006](ADR-006-standalone-intake-routing.md) — Standalone Intake and Routing Orchestrator
- Related: ADR-003, ADR-004, ADR-005, ADR-013, ADR-014, ADR-015; SPEC-001, SPEC-003;
  [agent graph design](../architecture/agent-graph.md) (D8, D13, D15, D16; hiện trạng §13)
- Code: [`src/agents/`](../../src/agents/), [`src/services/adapters/`](../../src/services/adapters/),
  [`src/api/routes.py`](../../src/api/routes.py)

## Context

ADR-006 dựng Intake và Routing Orchestrator thành hai service HTTP riêng (`:8011`, `:8012`). Routing
lập plan ở mức từng MCP tool, gọi tool qua `ToolGateway`, giữ state trong SQLite. ADR-006 bác phương án
"một graph chung trong Chat API" vì lúc đó yêu cầu là **bàn giao hai thành phần độc lập**.

Sau đó nhóm chốt thêm các yêu cầu mà hai service riêng khó đáp ứng:

- Mỗi lĩnh vực có **subagent riêng** (D13). Planner không nên biết từng tool của từng service: số tool
  tăng theo số service, và thay cách dùng tool không được kéo theo sửa Planner. (Ban đầu định để chủ
  service viết subagent; từ 2026-09-29 nhóm AI viết, chủ service cung cấp tool và dữ liệu.)
- Chat cần **xác nhận của người dùng giữa luồng** (tổng chi phí, approval, form dữ liệu cá nhân) và
  **thanh toán bất đồng bộ** (ZaloPay trả link / QR, chờ kết quả). Cả hai cần dừng và tiếp tục cùng một
  lượt xử lý.
- Kiểm kết quả, tổng chi phí, bộ nhớ người dùng, gợi ý bước tiếp theo và trần chi phí cần dùng chung
  state với plan.

Yêu cầu "bàn giao độc lập" vẫn giữ ở mức **module**: Intake và Planner là hai interface riêng
(`Intake`, `Planner`), test riêng, người khác implement riêng (issue #12, #13); chỉ không còn là hai
deployable riêng.

## Alternatives

1. Giữ ADR-006: hai service HTTP, Planner mức tool, SQLite.
2. Giữ hai service của ADR-006 và thêm một graph trong Chat API gọi chúng qua HTTP. Có hai nơi giữ
   state (SQLite của Routing và checkpoint của graph), hai nơi quyết định approval.
3. Một LangGraph graph trong Chat API; Planner mức lĩnh vực giao task cho subagent qua contract chung;
   tái dùng các phần an toàn của ADR-006.

## Decision

Chọn phương án 3. Đây là mô tả của code hiện có trên nhánh tích hợp.

**Graph** ([`graph.py`](../../src/agents/graph.py)): `load_context` → `intake` → Routing Orchestrator
(`orchestrator` + `executor` + `change_impact`) → node `*_agent` của từng lĩnh vực (`property`, `map`,
`flight`, `relocation`) → `validator` → `cost_summary` → `confirm` (`interrupt`) → `transaction` ⇄
`await_payment` (`interrupt`) → `respond`. Topology cố định; plan (DAG) là dữ liệu trong state.

**Hiểu và lập kế hoạch.**
- `Intake` và `Planner` là interface; node quanh chúng kiểm bằng code: evidence là lời người dùng, lọc
  dữ liệu cá nhân, tính phần thiếu (`resolve_missing`), `validate_plan` (DAG, registry, input schema,
  chỉ đặt thứ người dùng yêu cầu, không đặt lại, không đặt cọc).
- Mỗi task là **một mục tiêu cho một lĩnh vực**, không phải một lần gọi tool. Planner mặc định là
  `TemplatePlanner` (tất định); LLM Planner cắm vào làm `fallback`. Intake dùng LLM theo
  [intake-llm.md](../architecture/intake-llm.md).

**Subagent.**
- Contract chung (`AgentManifest`, `AgentTaskRequest`, `AgentTaskResult`, quy tắc R1–R12), JSON Schema
  xuất ra [`docs/api/agent-contract/`](../api/agent-contract/), bộ kiểm `check_conformance`.
- Subagent **chỉ đọc**; gọi qua `run_with_policy` (timeout, ngân sách, retry một lần cho lỗi đường
  truyền, lỗi thành dữ liệu cho validator).
- Kênh: `LocalAgent` (Python trong process), `RemoteAgent` (MCP tool `run_task`), `FakeAgent`,
  `FallbackAgent`. Subagent do nhóm AI phát triển từ **subagent nền** tất định bọc MCP tool đọc
  (`subagents/services/`); chủ service cung cấp tool, dữ liệu và thao tác ghi.

**Ghi.**
- Chỉ node `transaction` ghi, sau khi `confirm` kiểm approval do backend tạo (khớp người dùng, thread,
  `payload_hash`, hạn ≤ 30 phút, không dùng lại, đủ `pii_refs`).
- `McpTransaction` gọi tool ghi theo chuỗi tất định, không qua LLM: vé = giữ chỗ → tạo thanh toán →
  chờ `PAID` → xuất vé; chuyển đồ = báo giá lại với liên hệ thật → ghi approval sang Moving (ADR-003,
  Q22) → tạo đơn trả tiền mặt.
- Khoá chống trùng theo (thread, plan version, action, phương án); commit tuần tự. Một thao tác lỗi thì
  dừng và **không tự huỷ** thao tác đã đặt: báo người dùng phần đã đặt / phần lỗi rồi hỏi có muốn huỷ
  không (huỷ là thao tác mới qua `confirm` + approval). Kết quả không rõ → `pending_verification`,
  không tự gọi lại. Chuyển đồ dùng mã đối soát (`tracking_number`) để tìm lại đơn đã tạo.
- Giá thực tế được lệch trong khoảng người dùng đồng ý ở bước xác nhận (chuyển đồ ±5%, vé đúng giá);
  khoảng giá nằm trong `payload_hash`, ngoài khoảng thì xin xác nhận lại.
- Dữ liệu cá nhân chỉ đi qua form → `pii_ref` → `PiiPort`; không vào LLM, state hay log (ADR-015).

**Kết nối service.** `McpToolClient` (Streamable HTTP + Bearer, hoặc stdio khi dev) với allowlist tool
đọc / ghi tách riêng theo service; cấu hình trong `.env` (`AGENT_SUBAGENTS=fake|live`). Mỗi service vẫn
là MCP server độc lập (ADR-004, ADR-005, ADR-013, ADR-014).

**State.** LangGraph checkpointer theo `thread_id` là nguồn sự thật duy nhất của hội thoại và plan; không
có store thứ hai. Dev / test dùng `InMemorySaver` (serializer chỉ cho phép kiểu của `src/agents/models`);
checkpointer bền vững chốt ở ADR-017. API chỉ cho một lượt chạy mỗi thread (request thứ hai nhận 409).

**LLM.** OpenAI cho mọi agent (Q20) qua `StructuredLLM`; model theo tầng `light` / `heavy`; node kiểm
trần LLM và task tốn tiền trước khi gọi.

### Đối chiếu từng quyết định của ADR-006

| ADR-006 | Trong ADR-016 |
|---|---|
| Hai entrypoint FastAPI, hai image | Thay bằng một graph trong Chat API; Intake / Planner là interface riêng |
| Intake `extract -> validate`, sửa evidence một lần | Giữ ý: kiểm evidence bằng code, LLM trích lại một lần; fact sai bị bỏ thay vì lỗi cả lượt |
| Routing `plan -> validate`, lifecycle do code quyết | Giữ: `orchestrator` + `validate_plan`; LLM chỉ đề xuất |
| Planner mức tool + registry 13 tool | Chuyển vào bên trong subagent Moving; Planner của graph ở mức lĩnh vực |
| `ToolGateway`, không có Executor agent | Giữ ý: `executor` là code thuần, không phải agent; gọi tool qua `McpToolClient` |
| Pydantic là schema chuẩn; registry sinh từ Zod | Giữ Pydantic cho contract của graph; registry Zod dùng trong subagent Moving |
| SQLite WAL + CAS, không dùng checkpointer thứ hai | Thay bằng LangGraph checkpointer là store duy nhất; CAS thay bằng khoá một lượt mỗi thread |
| Approval qua API `approve`, hạn ≤ 30 phút, không dùng lại | Giữ các kiểm tra; approval do backend tạo, graph chờ bằng `interrupt` |
| Lease, `needs_reconciliation`, ghi một cái một lúc | Giữ: commit tuần tự, `pending_verification` |
| OpenAI Structured Outputs, không fallback giả | Giữ (`StructuredLLM`) |

## Rationale

- Đổi bên trong subagent không phải sửa graph; graph không phải biết từng tool.
- Xác nhận, thanh toán bất đồng bộ, kiểm kết quả, chi phí, bộ nhớ và gợi ý dùng chung một state và một
  checkpoint; không có hai nguồn sự thật.
- Giữ được các cơ chế an toàn đã viết và test ở ADR-006.
- Đã kiểm chứng: 213 test không cần mạng, gồm luồng đặt vé + thanh toán chạy với Flight và Payment MCP
  thật (provider mock), client HTTP + Bearer, luồng đổi ý, đặt một phần, trần chi phí.

## Consequences

- ADR-006 chuyển `Superseded by ADR-016`. SPEC-001 (Intake) và SPEC-003 (Routing) cần cập nhật theo graph.
- `src/agent_services/`, `Dockerfile.agents`, `compose.agents.yaml`, CI `agent-services.yml` vẫn còn trên
  nhánh nhưng chatbot không dùng. Giữ làm tham khảo cho tới khi chủ code (Khoa) quyết định xoá.
- Nhóm AI phát triển subagent cho từng lĩnh vực theo contract và `check_conformance` (issue #18). Service
  có thao tác ghi cung cấp tool ghi tất định và, với Moving, endpoint ghi approval (#16).
- Checkpointer, Approval Store, kho dữ liệu cá nhân, bộ nhớ người dùng bền vững là việc hạ tầng / backend
  (#19); chọn checkpointer ở ADR-017.
- Intake và Planner dùng LLM chưa có (#12, #13); app mặc định trả `UNSUPPORTED` cho tới khi có Intake.
