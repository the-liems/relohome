# ADR-019 — Runtime MVP tích hợp local

Date: 2026-09-30

Status: Accepted cho nhánh MVP local; chưa quyết định kiến trúc deploy.

## Context

Các component LLM và graph tích hợp cần cùng hợp đồng, dữ liệu thật và khả năng
tiếp tục sau restart. Người dùng không muốn mock hoặc triển khai hạ tầng lúc này.

## Decision

- FastAPI lifespan mở LangGraph cùng Intake/Planner/Moving LLM và MCP adapters.
- Local dùng một worker, SQLite checkpoint/runtime, form PII mã hóa có TTL;
  dữ liệu Housing/Map/Moving ở PostGIS, routing ở OSRM riêng.
- Không di chuyển workspace TypeScript sẵn có; phần ứng dụng Python mới giữ ở `src/`.
- Sandbox write tắt mặc định; launcher chỉ cho AhaMove staging và ZaloPay sandbox.
  Flight chỉ tìm kiếm thật; không coi dữ liệu offer là quyền xuất vé.
- Payment demo độc lập với Moving CASH, không tự thu tiền cho dịch vụ khác.
  Đề xuất 07/10/2026 (Draft, chưa code): vé và chuyển đồ đi qua quy trình ZaloPay sandbox như một đơn thanh toán
  riêng cho từng dịch vụ (mô phỏng, không có tiền tới nhà cung cấp); xem
  [payment-design.md](../review/payment-design.md).
- Kết quả write bất định giữ dấu chặn và đối soát, không retry tạo đơn mù.

## Alternatives

Chạy lại các HTTP agent cũ làm trung gian tạo thêm protocol/state không cần thiết.
In-memory runtime mất approval/ownership sau restart. Multi-worker cần cơ chế
khóa và persistence chia sẻ tốt hơn, nằm ngoài MVP local.

## Consequences

Demo local tái lập được và dùng provider thật, nhưng chưa có public identity,
HA, recovery console, retention toàn bộ checkpoint hoặc xác nhận deploy readiness.
Chuyển production cần ADR và đánh giá riêng, không chỉ đổi URL/API key.

Liên quan: ADR-016, ADR-018, SPEC-001, SPEC-003, SPEC-004;
[runbook](../runbooks/local-mvp.md).
