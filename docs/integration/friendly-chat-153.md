# Chat ngắn, thân thiện — issue #153

Nhánh: `fix/153-friendly-chat`, nền `main` tại `0c53c6e`. Chỉ sửa lớp trình bày kết quả và các test, không đổi Planner, Intake, domain LLM, API contract, DB hay giao dịch.

## Hiển thị mới

Tìm nhà bình thường:

> Mình tìm được 5 căn trong lượt này. Bạn mở bản đồ xem thử nhé.

Khi có giá chưa xác minh, thêm đúng một dòng:

> Giá chưa xác minh chưa tính vào ngân sách; mình đã đánh dấu trên từng tin.

Ví dụ người dùng phản ánh giảm từ khoảng 55 từ (50 từ chat + nhãn UI 5 từ) xuống 31 từ, 2 dòng. Kết quả bình thường còn 15 từ, 1 dòng. Đây là số từ tách theo khoảng trắng, **không phải token hoặc phép đo latency**.

- Không thêm câu mở đầu “Đây là kết quả mình tìm được”.
- Không thêm nhãn “Có kết quả: Tìm nhà” cho một dịch vụ. Vẫn giữ nút mở lại phương án.
- Nhiều dịch vụ vẫn có tên từng dịch vụ và điều hướng; nhãn không khẳng định thành công khi danh sách rỗng.
- Flight/Moving chỉ tóm tắt số phương án, không chép lại cả danh mục vốn đã có trên workspace. Khứ hồi vẫn nói rõ chiều về và giá tham khảo; báo giá không bị mô tả thành đặt đơn.
- Roommate mời người dùng xem và tự chọn kết nối; không tuyên bố hệ thống tự ghép người. Điều kiện đăng nhập/18 tuổi/điều khoản vẫn giữ.
- Tuyến đường dùng tên phương tiện dễ hiểu, giữ km/phút, sai số và cảnh báo không tính giao thông thực tế.
- So sánh nhà vẫn là bảng riêng, không sinh nhãn tìm nhà hoặc thay nhà đã chọn.
- Phân trang/phạm vi thị trường của Housing nằm trên workspace; `has_more` và toàn bộ dữ liệu vẫn được trả về, số trong chat luôn ghi “trong lượt này”.

Giữ cảnh báo giá, nguồn sandbox/demo, tọa độ gần đúng, bộ lọc nhớ/nới, kết quả một phần, câu hỏi cần bổ sung và thông tin giao dịch. Không cắt mù chuỗi theo số ký tự; không sửa lịch sử tin nhắn đã lưu. Các phản hồi lỗi/thanh toán và lý do giới hạn của domain khác không bị thay bằng lời báo thành công ngắn.

## Kiểm chứng

- Bộ `tests/test_agents`: 324 passed, 1 skipped; gồm 32 ca chuyên biệt về lời chat và giữ dữ liệu.
- UI contracts: 42 passed.
- `npm run build`: passed, gồm kiểm tra assets MapLibre.
- Ruff lint/format và `git diff --check`: passed.
- Mypy với cùng cấu hình/import path trên main và nhánh sửa: cùng 27 lỗi có sẵn, không có lỗi mới. **Không coi typecheck toàn bộ là xanh.**
- Browser: 22 ca hồi quy cũ đạt; 6 ca mới đạt (3 tình huống × desktop/mobile). Dùng transport fixtures, không gọi LLM/provider hoặc thực hiện giao dịch. Kiểm tra chat một/nhiều dịch vụ, VI/EN, so sánh tách riêng, form và chuyển bước dịch vụ.
- Dọn Vite test trên Windows bị kẹt; đã xác minh và chỉ dừng PID của Vite test tại cổng 5174. Không dừng các service local chính hoặc CI. Bộ 6 ca chạy lại kết thúc exit code 0.

Không chạy test trả phí: lỗi nằm ở formatter và nhãn UI, nên có thể kiểm chứng trực tiếp với dữ liệu có cấu trúc. Không tăng lượt LLM. Chưa đổi bản local đang chạy/main hay deploy staging; cần review, CI và merge PR trước khi cập nhật môi trường chính.
