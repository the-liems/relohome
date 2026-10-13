# Housing: câu trả lời tìm nhà ngắn gọn (#122)

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Nguyên nhân và thay đổi

`src/agents/nodes/respond.py` trước đây liệt kê 5 tin nhà bằng template trong chat: tên, giá, địa chỉ, phòng ngủ và tiện ích. Việc rút gọn sau khi chọn nhà hoặc khi so sánh không áp dụng cho lượt tìm mới.

Lượt tìm mới chỉ báo số căn **trong lượt hiện tại** và mời mở bản đồ. Không dùng số căn trả về làm tổng số căn trên map/toàn thị trường. Ví dụ:

> Đã tìm được 5 căn trong lượt này. Mở bản đồ để xem và chọn.

Nếu cần, bổ sung cảnh báo chung về giá chưa xác minh (không tính vào tổng ngân sách), tọa độ gần đúng, phân trang và bán kính đường thẳng mặc định. Nhận xét dài của AI được giữ nguyên trong `results[*].data.agent_assessment` và `limited_tasks`, nhưng chat chỉ báo ngắn rằng kết quả còn hạn chế theo đánh giá AI, không phải xác nhận của nhà cung cấp.

Lượt chọn nhà vẫn nêu tên và giá căn đã chọn, không khẳng định đã thuê/đặt. Full `candidates`, ID, tọa độ, giá, cảnh báo từng tin, nguồn và dữ liệu cho workflow vẫn được giữ trong payload. Không sửa bộ lọc, Intake/Planner/domain LLM, contract, database hoặc giao dịch. Bảng so sánh và câu hỏi cần xác nhận của các dịch vụ khác không bị cắt.

## Kiểm chứng

- Thêm 12 regression case thuần formatter: kết quả 1/5/12 căn, cảnh báo giá, không có kết quả, bán kính/phân trang/tọa độ, chọn căn, nhiều dịch vụ, lỗi một phần, nhận xét AI dài, bảng so sánh và domain khác.
- Python tests + Frontend Python tests trên Windows: **807 passed, 90 skipped, 64 subtests passed**. Không chạy các module phụ thuộc Linux/container runner: `test_ci_runner`, `test_ci_container_smoke`, `test_ci_images`, `test_web_image_layout`, `test_prompt_hooks`.
- `ruff check src/ tests/` và `git diff --check`: đạt.
- Không gọi LLM/provider trả phí, không đặt đơn, không thanh toán trong lần kiểm chứng này. CI GitHub của PR cần được kiểm tra riêng.

## Review và triển khai

Nhánh riêng từ main `481288a`: `fix/122-concise-housing-chat`. Không nối vào PR #120 và không tự merge/deploy. Chỉ các câu trả lời mới sau khi phiên bản được triển khai sẽ thay đổi; tin chat đã lưu không được viết lại. Thay đổi này không xử lý polygon TP.HCM có phần biển — đó là vấn đề dữ liệu/camera bản đồ riêng.
