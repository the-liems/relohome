# ADR-020 — LLM domain agents trong graph tích hợp

Date: 2026-09-30
Status: Superseded by [ADR-021](ADR-021-mission-driven-domain-tools.md).
Related: ADR-016, ADR-018, ADR-019.
Specification: [SPEC-014](../specs/SPEC-014-domain-llm-agents.md).

## Context

Housing, Map, Flight đã có domain adapter nhưng chưa có LLM điều khiển như Moving.
Người dùng yêu cầu hoàn thiện các subagent trong cùng LangGraph, không dựng thêm
graph/service giữ state riêng và không phát triển giao diện/deploy trong đợt này.

## Decision

- Giữ Intake/Planner/Moving và các node kiểm tra của graph. Thêm vòng LLM đọc tool
  riêng cho Housing, Map, Flight; dùng chung runtime giới hạn call/deadline.
- Tool nghiệp vụ có thể gộp chuỗi MCP đọc tất định đã được kiểm tra (resolve địa
  điểm rồi tìm nhà, resolve sân bay rồi tìm chuyến). Đây không phải chuyển mọi
  phép validate/thao tác giao thức sang LLM. LLM chọn đọc thêm chi tiết, thứ tự
  kết quả đã quan sát hoặc kết thúc; không sửa ràng buộc người dùng và giá provider.
- Payment là domain **tra cứu** trong graph, chỉ đọc giao dịch đã được backend
  ghi nhận thuộc người dùng hiện tại. Danh tính đi từ API qua execution context,
  không từ LLM/request tool. Không cho model create/refund/cancel hoặc tự xác nhận.
- Giao dịch vẫn thuộc confirm/transaction/await_payment. ZaloPay sandbox form
  độc lập vẫn hoạt động; không tự gắn thanh toán vào Moving CASH và không bật vé giả.
- Mọi domain trả cùng AgentTaskResult, usage, nguồn và lỗi. Không fallback sang
  dữ liệu giả khi mất LLM/MCP. Dữ liệu và quote cuối được tạo từ provider đã đọc.

## Alternatives and consequences

Update 30/09: executor cấp ngân sách LLM riêng cho từng task trước fan-out;
không giữ khóa trong thời gian agent gọi provider. Các task độc lập chạy đồng
thời trong một đợt LangGraph, task phụ thuộc chạy ở đợt sau fan-in. Cấp ngân sách
và trạng thái dependency là code xác định, không do model tự xin thêm quyền.

Giữ adapter tất định tiết kiệm call nhưng chưa đáp ứng yêu cầu agent theo domain.
Cho LLM toàn quyền tự viết SQL/tool args làm mất các kiểm tra và dữ kiện đã chốt.
Chọn tool nghiệp vụ giới hạn, tái sử dụng adapter và contract của teammate.
Có thêm chi phí/độ trễ; cần live regression nhiều lượt và theo dõi ngân sách.
Đây không phải chứng nhận production hay bổ sung provider xuất vé.
