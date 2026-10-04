# ADR-018: LLM-first Intake, Routing Planner và Moving subagent

Ngày: 2026-09-29  
Trạng thái: Accepted cho phần component trên nhánh `khoa`; ghép graph cần review chung.  
Người đề xuất: Khoa | Review: Đoàn, AI/DS và service owners

## Bối cảnh

ADR-016 thay hai HTTP agent cũ bằng các interface trong graph. Chủ task yêu cầu
Orchestrator có LLM làm bộ phận suy luận chính, không chỉ dùng LLM làm fallback của
TemplatePlanner. Triển khai component trước; chưa thay wiring hoặc chạy graph end-to-end.

## Các phương án

1. Giữ HTTP agent ADR-006: thêm adapter và hai hệ state, lệch contract graph hiện tại.
2. TemplatePlanner trước, LLM fallback: dễ kiểm soát nhưng không đúng yêu cầu LLM-first.
3. LLM-first theo interface ADR-016, kiểm tra và quyền thực thi bằng code: chọn.

## Quyết định

- `LlmIntake.understand(IntakeInput) -> IntakeResult`: hiểu lời người dùng, ý định,
  dữ kiện có evidence. Node hiện có chịu trách nhiệm gộp lịch sử, tính thiếu và gửi câu hỏi.
- `LlmPlanner.plan(PlannerInput) -> PlannerOutput`: LLM lập/sửa DAG theo domain,
  đọc kết quả/feedback trước; không mặc định chạy TemplatePlanner trước nó.
- `MovingLlmAgent.run_task(AgentTaskRequest) -> AgentTaskResult`: LLM chọn tool đọc,
  quan sát rồi chọn bước tiếp. Không có quyền đặt/hủy/sửa đơn.
- Code kiểm schema, dữ kiện, DAG, service IDs đã quan sát, deadline, số lượt gọi.
  Transaction/approval vẫn thuộc graph backend, không phải một agent Executor mới.
- Component factory là explicit; không thay `AgentService.create`, node hay graph edges.
- Model mỗi component cấu hình riêng; mặc định mới `gpt-4.1-mini`, đã kiểm thử live.
  Đây là lựa chọn cho bộ thử hiện tại, không bảo đảm mọi câu người dùng luôn đúng.
- Không thêm mock model/provider/test. Dữ liệu nhà và kết quả MCP phải từ service thật.

## Hệ quả

Linh hoạt hơn mẫu cố định, nhưng phát sinh độ trễ/chi phí và sai số LLM. Intake/Planner
tối đa hai lượt, Moving tối đa tám lượt LLM/tám lượt MCP, chịu deadline và ngân sách caller.
Hết lượt/không xác minh được thì hỏi lại hoặc báo lỗi; không fallback thành dữ liệu giả.
Tài liệu Structured Outputs chỉ bảo đảm cấu trúc, không bảo đảm nội dung đúng: vẫn kiểm evidence.

Không đặt ràng buộc cùng thành phố. Không suy diễn bốc xếp/sức chở từ tên xe. Không tự
phê duyệt biên giá ±5%. Graph integration phải áp dụng `price_tolerance={}` theo quyết định
của chủ task; cấu hình cũ trong graph chưa được thay ở đợt component này.

Cập nhật 01/10: Planner LLM được trả `needs_input {domain, field, question}` cho lĩnh vực
được yêu cầu mà input có mặt nhưng chưa dùng được. Đây là quyền **hỏi lại**, không phải quyền
bỏ yêu cầu: code kiểm lĩnh vực/field theo manifest, rồi graph hỏi người dùng thay vì báo
`PLAN_INVALID`. Kiểm tra "lĩnh vực đủ input phải có task" vẫn giữ cho lĩnh vực không hoãn.

Liên quan: [SPEC-001](../specs/SPEC-001-goal-understanding.md),
[SPEC-003](../specs/SPEC-003-planning-and-execution.md),
[SPEC-004](../specs/SPEC-004-ahamove-moving-service.md),
[bàn giao](../integration/llm-agents-handoff.md). ADR-016 vẫn là kiến trúc tổng thể;
quyết định này điều chỉnh phần dùng TemplatePlanner làm mặc định khi ghép component mới.

Tham khảo: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).
