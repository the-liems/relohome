# ADR-016 — Một LangGraph graph với subagent theo lĩnh vực

- Date: 2026-09-29
- Status: Proposed
- Supersedes (khi Accepted): ADR-006 — Standalone Intake and Routing Orchestrator
- Related: ADR-003, ADR-004, ADR-015; [agent graph design](../architecture/agent-graph.md) (D8, D13, D15, D16)

## Context

Nhánh `khoa` đã triển khai Intake và Routing Orchestrator thành hai service HTTP riêng
(ADR-006). Routing lập kế hoạch ở mức từng MCP tool và gọi thẳng các MCP server qua
`ToolGateway`; state nằm trong SQLite. Đội đã quyết định mỗi service (housing /
location, moving, flight) có subagent riêng do chủ service viết. Khi đó Planner không
nên biết từng tool của từng service: số tool tăng theo số service, và chủ service không
đổi được cách dùng tool mà không kéo theo Planner.

## Alternatives

1. Giữ ADR-006: hai service HTTP, Planner mức tool, SQLite store riêng.
2. Một LangGraph graph trong Chat API; Planner mức lĩnh vực giao task cho subagent qua
   contract chung; tái dùng các phần an toàn đã có của ADR-006.

## Decision

Chọn phương án 2.

- Graph gồm `intake` → Routing Orchestrator (`orchestrator` + `executor` +
  `change_impact`) → subagent của từng service → `validator` → `cost_summary` →
  `confirm` → `transaction` / `await_payment` → `respond`.
- Mỗi task trong DAG là một mục tiêu cho một lĩnh vực. Subagent nhận task qua contract
  chung (manifest + `run_task`), chỉ đọc, không hỏi người dùng trực tiếp, không gọi
  chéo lĩnh vực.
- Thao tác ghi chỉ do `transaction` thực hiện sau approval do backend lưu, gọi tool ghi
  một cách tất định, không qua LLM.
- State do LangGraph checkpointer giữ theo `thread_id`; không có store thứ hai.
- Tái dùng từ ADR-006: kiểm evidence của Intake, `validate_plan`, approval binding,
  lease / reconciliation, `StructuredLLM`, `canonical` / `fingerprint`. Registry 13 tool
  Moving và planner mức tool trở thành phần bên trong subagent moving.
- Mọi agent dùng OpenAI, model chọn theo độ nặng của việc.

## Rationale

- Chủ service thay đổi bên trong subagent mà không phải sửa graph.
- Validator, tổng hợp chi phí, xác nhận người dùng, bộ nhớ và gợi ý nằm chung một chỗ
  với plan, dùng chung state và checkpoint.
- Giữ được các cơ chế an toàn đã được viết và test trên nhánh `khoa`.

## Consequences

- Khi ADR này được Accepted, ADR-006 đổi trạng thái thành `Superseded by ADR-016`.
- `src/agent_services/` (HTTP app, SQLite store) không giữ lại; phần tái dùng chuyển
  vào `src/agents/` theo bảng §3.3 của tài liệu thiết kế.
- Mỗi service phải bọc MCP tool hiện có thành subagent theo contract chung và qua bộ
  test tuân thủ trước khi đăng ký.
- Chọn checkpointer thật là một ADR riêng (dự kiến ADR-017).
