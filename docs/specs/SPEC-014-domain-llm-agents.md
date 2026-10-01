# SPEC-014 — Domain LLM agents trong LangGraph

Status: Draft (implemented local; chờ nhóm review).

Ngày: 2026-09-30. Quyết định: [ADR-020](../adr/ADR-020-llm-domain-agents.md).
Phạm vi: runtime tích hợp local, không deploy. Bổ sung cho ADR-016/018/019;
không thay MCP contract của teammate.

## Hành vi và tiêu chí chấp nhận

| ID | Yêu cầu |
|---|---|
| SPEC-014/AC-01 | Intake/Planner phân task trong một graph; Housing, Map, Flight, Moving, Payment đăng ký capability riêng. `/api/v1/status` công bố implementation và uses_llm thực tế. |
| SPEC-014/AC-02 | Housing/Map/Flight/Payment gọi OpenAI thật để điều khiển vòng tool. Không fallback dữ liệu giả. Tối đa 4 LLM calls/invocation và chịu budget chung của graph. |
| SPEC-014/AC-03 | Tool đầu thực thi task đã validate, với tham số do adapter ràng buộc; LLM không tự sửa hard filters/ngày/giá/tọa độ. Các bước resolve/search dùng lại adapter hiện có. |
| SPEC-014/AC-04 | Housing/Flight chỉ được đọc chi tiết ID đã nhận từ provider; finish không thêm/bớt ID (thứ tự thiếu ID được bổ sung theo thứ tự provider, AC-11). Khi đổi thứ tự, quote và missing_fields vẫn trỏ đúng option. Map/Payment không có thao tác sắp xếp option. |
| SPEC-014/AC-05 | Kết quả giữ nguồn, dữ kiện, agent_trace và usage. Không sinh SQL hoặc thực thi code do LLM viết. Không khẳng định fare rules tĩnh là dữ kiện live. |
| SPEC-014/AC-06 | Payment chỉ tra ID có bản ghi ownership thuộc user được API xác thực. Kiểm tra trước LLM/MCP; không nhận user_id từ tool args. User khác không đọc được giao dịch. |
| SPEC-014/AC-07 | Không tool tạo/thu/hoàn tiền hoặc tự approve trong domain loop. Giao dịch đi qua luồng xác nhận riêng. Không bật xuất vé mô phỏng. Moving CASH không tự ghép ZaloPay. |
| SPEC-014/AC-08 | Giữ luồng selected housing → Map của teammate. Giữ bộ nhớ hội thoại, invalidate tọa độ cũ khi địa chỉ thay đổi, và hỏi lại khi vị trí mơ hồ. |
| SPEC-014/AC-09 | Timeout/provider lỗi trả thất bại có phân loại, không nói đã có kết quả/thanh toán thành công. Đóng LLM clients khi app shutdown. |
| SPEC-014/AC-11 | (01/10) Housing trả `map_context.viewport` từ dữ liệu Location. `map_view` và `place_choice` chỉ đến từ API đã kiểm; Planner gắn `bounding_box`/`*_place_id` bằng code. POI khớp chính xác trong 150 m là một điểm đến cho Map/Housing (không áp dụng Moving). Câu hỏi chọn địa điểm có `choices` với ID và toạ độ thật. `finish` thiếu ID là ưu tiên đặt đầu, không làm task thất bại, vẫn không thêm ID lạ. Căn chọn từ bản đồ chỉ được ghi `selected:property` sau khi backend đọc lại bằng `get_housing`. |
| SPEC-014/AC-10 | (01/10) Field `city` của Housing/Map phân giải bằng cấu trúc kết quả `search_areas` (cấp cao nhất, khớp tên không fuzzy, ranh giới bao các vùng cùng tên), không bằng danh sách tên cố định. "Hà Nội", "Đà Nẵng" không còn bị hỏi lại; khớp chính xác vẫn ưu tiên; vùng rời nhau vẫn hỏi lại. |
| SPEC-014/AC-12 | (01/10) Moving: lỗi do yêu cầu từ provider (`PROVIDER_REJECTED`, `VALIDATION_ERROR`, `PROVIDER_NOT_FOUND`, `PROVIDER_CONFLICT`, `QUOTE_EXPIRED`, không retryable) được đưa lại cho LLM; sau đó chỉ được `ask_user` hoặc thử dịch vụ catalog chưa thử. Lỗi transport/retryable vẫn làm task thất bại. Câu hỏi chọn điểm có `choices` từ ứng viên Location thật. |
| SPEC-014/AC-13 | (01/10) Moving: endpoint có toạ độ người dùng đã xác nhận (`moving_locations`) được Planner gắn bằng code cả địa chỉ lẫn toạ độ, kể cả khi model giữ marker `selected:property`; model không thể thay bằng địa chỉ khác. `/chat/{id}/state` trả `selections` từ `task_results`, không từ client. |

## Kiểm chứng

`tests/test_llm_agents/test_integrated_live.py`: Housing/Flight/Map thực và trace,
multiturn, Moving báo giá; không tạo giao dịch.
`test_multiturn_live.py`: bảo toàn/sửa ngữ cảnh và liên kết tọa độ.
`test_payment_agent_live.py`: tra giao dịch sandbox **đã tồn tại** và chặn user khác;
skip nếu chưa có giao dịch thật, không tự tạo dữ liệu thay thế.

Test live opt-in bằng `RUN_LIVE_INTEGRATION=1` và
`RUN_LIVE_API_URL=http://127.0.0.1:18000/api/v1`.
Các test phụ thuộc API/LLM/MCP thật; không coi skip hoặc lỗi mạng là pass.

## Giới hạn rõ ràng

Payment chat hiện tra trạng thái, chưa tạo/hoàn tiền qua hội thoại.
Flight hiện tìm chuyến; chưa có provider xuất vé thật.
Các tool nghiệp vụ là composite operations, không phải LLM tự tùy ý gọi mọi MCP tool.
Housing/Map dùng chung Location MCP theo thiết kế teammate, nhưng domain agent riêng.
Chất lượng dữ liệu housing và coverage địa điểm vẫn phụ thuộc snapshot/provider.
