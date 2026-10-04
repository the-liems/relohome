# ADR-006 — Standalone Intake and Routing Orchestrator

- Date: 2026-09-28
- Status: Superseded by [ADR-016](ADR-016-agent-graph-with-domain-subagents.md) (2026-09-29)
- Scope: implementation of direction B authorized by Khoa; team integration remains separate.
- Related: SPEC-001, SPEC-003, ADR-003, ADR-004

> **Đã được thay thế.** Chatbot dùng một LangGraph graph (ADR-016). Bảng "Đối chiếu từng quyết định
> của ADR-006" trong ADR-016 ghi phần nào được giữ, phần nào thay. Code `src/agent_services/` vẫn còn
> làm tham khảo nhưng không nằm trên đường chạy của chatbot.

## Context

Sơ đồ mới chọn Intake hiểu mục tiêu và Routing sở hữu toàn bộ vòng đời kế hoạch.
Người dùng yêu cầu xây hai thành phần độc lập như cách bàn giao Moving, chưa nối
toàn hệ thống, không mock data/mock test. Python app hiện tại chỉ là graph mẫu.

## Decision

- Giữ code trong `src/agent_services/`, hai entrypoint FastAPI, hai Docker targets/images.
- Intake có graph LangGraph `extract -> validate`; Routing có `plan -> validate`.
  Lifecycle task/approval/concurrency do code xác định; LLM chỉ đề xuất thông tin và plan.
- Routing tự sở hữu scheduling và gọi tool qua internal `ToolGateway` port. Port
  này không phải agent, API worker hay container Executor thứ ba.
- Dùng Pydantic làm canonical schema. Domain schema xuất offline từ Zod hiện có;
  JSON registry là artifact sinh ra, không sửa tay và không chứa dữ liệu provider.
- Hai agent dùng HTTP API nội bộ, không bắt buộc cung cấp MCP server. Domain MCP
  vẫn độc lập theo ADR-004; client adapter chỉ được nối trong milestone tích hợp.
- Intake stateless, nhận context từ caller. Routing dùng SQLite WAL và CAS revision
  cho single-host standalone; không trộn state store với DB domain services.
- Không cấu hình live domain adapter trong bản này. `advance` báo chờ tích hợp.
- LLM thật dùng OpenAI Responses Structured Outputs, không fallback giả. Tham khảo
  [tài liệu OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs).

## Alternatives

Một graph chung trong Chat API triển khai ngắn hơn nhưng không phù hợp yêu cầu
bàn giao hai thành phần độc lập lần này. Tách Planner và Executor thành hai agent
không phù hợp cách phân quyền B. PostgreSQL/distributed workers chưa cần cho
phạm vi một host và làm tăng phụ thuộc khi chạy thử.

## Consequences

Mỗi thành phần có thể khởi động và kiểm tra riêng; không cần Postgres để thử.
Không tuyên bố đã tích hợp end-to-end hoặc đã xác minh provider execution.
Khi scale nhiều host cần ADR/migration state store; không chia sẻ SQLite qua network
filesystem. Workflow checkpoint lưu toàn trạng thái nên không dùng LangGraph
checkpointer thứ hai tạo hai nguồn sự thật cạnh tranh.
