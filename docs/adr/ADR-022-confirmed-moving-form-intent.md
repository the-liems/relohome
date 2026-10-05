# ADR-022 — Typed intent cho form báo giá Moving đã xác nhận

Ngày: 2026-10-05

Trạng thái: Proposed

Người đề xuất: @drpie143 (Codex thay mặt, theo yêu cầu) | Review: Moving, Agent và UI owners

## Bối cảnh

Form Moving đã có điểm lấy/giao, giờ và tùy chọn có cấu trúc, nhưng gửi chúng thành
câu chat. Một lượt thực tế mất 25,612 s với 6 lượt LLM (Intake 1, Planner 1, Moving 4),
20.752 token. Không có phép đo riêng HTTP AhaMove của lượt đó.

Hội thoại tự nhiên vẫn cần Intake, Planner và subagent LLM. Form xác nhận rõ ý định
không cần hiểu lại câu chữ hoặc nhờ model chọn lại gói xe người dùng đã chọn.

## Các phương án

1. Giữ form đi qua chat: ít đường xử lý hơn, nhưng lặp quyết định và tăng độ trễ.
2. Backend đoán câu nào đơn giản bằng keyword: dễ sai ý định, không chọn.
3. Typed endpoint riêng, sử dụng cùng contract, runtime policy và checkpoint.

## Quyết định đề xuất

Chọn 3, chỉ áp dụng cho **báo giá** từ form có cả hai pin được người dùng xác nhận.

- Gateway gửi `MovingQuoteForm`; Planner module tạo/sửa đúng một task quote, không
  suy diễn câu tự nhiên. Nhiều task quote thì yêu cầu chọn rõ, không chọn task đầu.
- Có `service_id`: kiểm catalog thật rồi estimate, không gọi LLM chọn lại.
- Chưa chọn xe: đọc catalog thật trước, LLM Moving chọn dịch vụ; trả dữ kiện ngay
  sau estimate thành công, không gọi model chỉ để `finish`. LLM vẫn có thể đọc chi
  tiết hoặc xử lý provider từ chối; không hứa mọi ca đều đúng một lượt.
- Agent chạy qua `make_agent_node` / `run_with_policy`, dùng ledger, timeout,
  actor và allowlist đọc hiện có. Không tạo pipeline đặt đơn mới.
- Ghi cùng LangGraph checkpoint, tăng plan version, kiểm nguồn/hạn báo giá, tính
  lại chi phí và progress. Task khác giữ nguyên; task phụ thuộc báo giá cũ trở nên
  stale, lựa chọn liên quan bị xóa. Không tự chạy task downstream.
- Form không mang quyền ghi. Bỏ commit intent/action cũ; muốn đặt phải có yêu cầu
  và approval mới. Luồng đang xác nhận/thanh toán/đối soát hoặc đã đặt Moving bị chặn.
- Pin chưa đủ thì UI dùng chat hiện có; không tự xác nhận tọa độ.

Đây là ngoại lệ hẹp, đề xuất bổ sung quyền ghi state từ typed UI intent cho
[ADR-016](ADR-016-agent-graph-with-domain-subagents.md). Không sửa trạng thái Accepted
của ADR cũ và không thay Planner LLM của hội thoại.

## Lý do

Ý định đã được biểu diễn bằng endpoint/schema, không cần model phân loại thêm.
Giá, khoảng cách, dịch vụ và addon vẫn từ provider thật, không bảng giá/mã xe tự đặt.

## Hệ quả

- Phải review việc đồng bộ quote với selection, plan version và checkpoint.
- Kết quả form ghi `model_assessed: false`: dữ kiện provider, không phải lời bảo đảm
  xe chở vừa hay có người bốc xếp. SIU có thể chọn xe nhưng không có lượt đánh giá
  lại kết quả giá/so sánh sau estimate trên đường form này.
- Timing MCP gồm vận chuyển + backend + provider; không phải latency HTTP AhaMove
  riêng. Cần thêm instrumentation provider nếu muốn tách chính xác.
- Không thay UI layout, model, deployment, CI ownership hay cơ chế giao dịch.

Liên quan: [Issue #52](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/52),
[PR #42](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/42),
[API](../api/moving-quote-form.md), SPEC-004/AC-26..28.
