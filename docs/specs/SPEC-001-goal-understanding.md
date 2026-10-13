# SPEC-001 — Intake / Goal Understanding

> Cập nhật 2026-09-29 — hướng ADR-016/018: implementation mới là
> [`LlmIntake`](../../apps/agent-api/src/relohome_agent/agents/intake_llm.py), nhận `IntakeInput`, trả `IntakeResult`
> của `apps/agent-api/src/relohome_agent/agents/`. Node graph kiểm/gộp facts rồi tính thiếu/hỏi lại. Chưa thay wiring.
> Xem [bàn giao](../integration/llm-agents-handoff.md) và
> [live tests](../../tests/test_llm_agents/test_live_components.py).
> Phần HTTP/container/`src/agent_services` dưới đây mô tả bản ADR-006 cũ,
> không phải contract phải dùng khi ghép LangGraph.

## Acceptance bổ sung cho graph-compatible component

- `SPEC-001/AC-08`: LLM thật hiểu nhiều domain, đổi ý, phân biệt báo giá với yêu cầu đặt;
  ý định đặt không cấp approval. Facts/selection có evidence và đúng option IDs được cấp.
- `SPEC-001/AC-09`: Tối đa hai LLM calls; output không xác minh được sau repair tạo conflict,
  không tự nới điều kiện. Usage riêng từng invocation kể cả gọi đồng thời.
- `SPEC-001/AC-10`: Component không tự tải session, truy DB/MCP hay thay graph wiring.
- `SPEC-001/AC-11` (01/10): Đổi thao tác của một lĩnh vực (khoá chọn thao tác đọc từ
  `input_schema` manifest, ví dụ Map `nearby` → `route`) không bị coi là mâu thuẫn ở lượt
  `REFINE`. Mâu thuẫn thật hỏi lại bằng nhãn tiếng Việt, không lộ tên khoá nội bộ.

## Bản standalone trước ADR-016 (lưu để đối chiếu)

- Owner: Khoa (`drpie143`)
- Reviewers: AI/DS, Backend/Security, Routing owner
- Status: Draft
- Parent issue: existing Goal Understanding/Intake issue; assignment pending authenticated GitHub access.
- Related ADR: [ADR-006](../adr/ADR-006-standalone-intake-routing.md)
- Canonical schemas: [`relohome_agent_services.intake_models`](../../packages/python/agent-services/src/relohome_agent_services/intake_models.py)

## Problem and scope

Chuyển câu tiếng Việt cùng lịch sử/ngữ cảnh được cấp thành yêu cầu có cấu trúc.
Intake là thành phần độc lập, không truy cập MCP, không lập DAG và không phê duyệt
đặt/hủy đơn. Không tự tải lịch sử hoặc đọc DB của service khác. Trusted caller chịu
trách nhiệm tải đúng context của người dùng trước khi gọi.

## Behavior and interfaces

`POST /v1/intake` nhận `IntakeRequest`; trả `IntakeResult` phiên bản `1.0.0`.
Các trường gồm request/session ID, normalized goal, nhiều intent, entities,
constraints, missing fields, conflicts, câu hỏi làm rõ, confidence và trạng thái.
Entities/constraints có evidence nguyên văn và nguồn `message`, `history` hoặc
`confirmed_context`. Evidence trong history chỉ được lấy từ câu của người dùng.
`user_confirmed_facts` được sao chép từ trusted input; LLM không tự đặt cờ xác nhận.

Graph nội bộ `extract -> validate` dùng Structured Outputs từ LLM thật. Nếu evidence
không khớp nguồn, cho LLM trích lại đúng một lần rồi kiểm lại; vẫn sai thì trả lỗi. Validation
kiểm schema và evidence; thiếu/mâu thuẫn hoặc confidence thấp chuyển sang
`needs_clarification`. Context hiện tại ưu tiên lời người dùng mới; thời gian tương
đối không được tự đổi thành một ngày tuyệt đối chưa được xác nhận.

## Non-goals

- Chưa nối Chat API hiện tại, Routing, Housing, Maps, Moving, Flight hoặc Payment.
- Chưa làm UI, memory retrieval, xác thực tài khoản người dùng hay RAG.
- Không tạo giá/đơn hàng/listing giả; không fallback sang câu trả lời LLM giả.

## Failure, security and operational limits

Token service riêng >=32 ký tự; API là internal, không dùng token chung thay cho
đăng nhập người dùng. Key LLM chỉ ở runtime environment. Không log nội dung prompt,
context, output hoặc credential. Request <=256 KiB, message <=8.000 ký tự, history
<=20 turns. Mỗi LLM call có timeout và giới hạn output; tối đa hai call khi cần sửa
evidence, không retry vô hạn.
Thiếu key trả 503 `LLM_NOT_CONFIGURED`; provider lỗi/refusal/output sai trả lỗi có
mã, không tự bịa kết quả. `/health` kiểm process; `/ready` kiểm cấu hình, không
chứng minh provider đang online. Intake không cần database.

## Acceptance criteria

- `SPEC-001/AC-01`: Một yêu cầu có thể chứa nhiều intent trong enum được khai báo.
- `SPEC-001/AC-02`: Output chỉ chứa schema hợp lệ; fact không có evidence bị từ chối.
- `SPEC-001/AC-03`: Thiếu thông tin/mâu thuẫn/độ chắc chắn thấp phải có trạng thái hỏi lại.
- `SPEC-001/AC-04`: Không sinh plan, tool call, approval hoặc dữ liệu provider.
- `SPEC-001/AC-05`: Thiếu token/key, invalid input, refusal và timeout trả lỗi rõ ràng.
- `SPEC-001/AC-06`: Chạy độc lập bằng image non-root, có health/readiness và tài liệu API.
- `SPEC-001/AC-07`: Kiểm LLM thật bằng opt-in live test; không thay bằng mock nếu chưa có key.

## Open questions

- Team xác nhận tập intent và tập câu đánh giá tiếng Việt khi tích hợp các domain khác.
- Chọn provider/model cho deployment; bản này theo OpenAI provider đã có trong repo.

Test: [`tests/test_agent_services/`](../../tests/test_agent_services/).
Runbook: [Chạy hai agent độc lập](../runbooks/agent-services.md).
