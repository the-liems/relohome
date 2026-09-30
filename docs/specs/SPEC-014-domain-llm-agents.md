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
| SPEC-014/AC-04 | Housing/Flight chỉ được đọc chi tiết ID đã nhận từ provider; finish không thêm/bớt ID. Khi đổi thứ tự, quote và missing_fields vẫn trỏ đúng option. Map/Payment không có thao tác sắp xếp option. |
| SPEC-014/AC-05 | Kết quả giữ nguồn, dữ kiện, agent_trace và usage. Không sinh SQL hoặc thực thi code do LLM viết. Không khẳng định fare rules tĩnh là dữ kiện live. |
| SPEC-014/AC-06 | Payment chỉ tra ID có bản ghi ownership thuộc user được API xác thực. Kiểm tra trước LLM/MCP; không nhận user_id từ tool args. User khác không đọc được giao dịch. |
| SPEC-014/AC-07 | Không tool tạo/thu/hoàn tiền hoặc tự approve trong domain loop. Giao dịch đi qua luồng xác nhận riêng. Không bật xuất vé mô phỏng. Moving CASH không tự ghép ZaloPay. |
| SPEC-014/AC-08 | Giữ luồng selected housing → Map của teammate. Giữ bộ nhớ hội thoại, invalidate tọa độ cũ khi địa chỉ thay đổi, và hỏi lại khi vị trí mơ hồ. |
| SPEC-014/AC-09 | Timeout/provider lỗi trả thất bại có phân loại, không nói đã có kết quả/thanh toán thành công. Đóng LLM clients khi app shutdown. |

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
