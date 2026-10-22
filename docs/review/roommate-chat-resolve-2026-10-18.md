# Xác nhận ở cùng và gỡ tin Roommate

## Hành vi

- Trong cuộc chat Roommate đang mở, người có nhu cầu công khai ở trạng thái `active` thấy nút **Xác nhận ở cùng & gỡ tin đăng**.
- Một lần bấm chuyển **tin của người bấm** sang `resolved` (Đã tìm được), loại khỏi tìm kiếm và lớp Roommate trên bản đồ.
- Người còn lại phải tự bấm để gỡ tin của họ. Không tự thay đổi dữ liệu người khác.
- Giữ bản giới thiệu riêng, nội dung tin và cuộc chat. Hai người vẫn gửi/đọc tin nhắn được.
- Theo lifecycle `resolve` hiện có, hủy các yêu cầu kết nối đang chờ ở cả chiều gửi và nhận; đăng lại không khôi phục các yêu cầu này. Lời nhắc trước nút nêu rõ việc hủy yêu cầu và giữ chat đã kết nối bằng tiếng Việt/Anh.
- Có thể tiếp tục tìm người bằng thao tác đăng lại nhu cầu hiện có trong Hồ sơ của tôi.
- Không tác động tin nhà Housing, lịch xem nhà hoặc chat chủ nhà.

## Thiết kế

- GET tin nhắn bổ sung `own_profile: {state, version} | null` cho chính người đang đăng nhập; không trả hồ sơ riêng của đối phương.
- Dùng lại POST `/me/profile/actions` với `action: resolve`, `expected_version` và kiểm tra actor/session hiện có.
- Không thêm endpoint ghi, bảng dữ liệu, migration, biến môi trường hay luồng xác nhận hai lần.
- Sau khi server xác nhận thành công, cập nhật trạng thái chat; phát sự kiện để hồ sơ và lớp Roommate trên bản đồ tải lại.
- Mất phản hồi: chỉ đọc lại trạng thái, không tự gửi lại lệnh ghi. Nếu chưa xác định được kết quả, người dùng chọn kiểm tra hoặc thử lại đúng phiên bản ban đầu.
- Nếu tin đã đổi/đăng lại: từ chối phiên bản cũ, tải trạng thái mới và yêu cầu một thao tác chủ động mới.

## Kiểm chứng ngày 18/10/2026

- Backend Roommate: **210 đạt, 10 bỏ qua**; các ca cần PostgreSQL riêng chưa chạy.
- Browser Roommate hiện có và mới: **92 đạt** trên desktop/mobile, dùng API fixture.
- Build Web: đạt.
- API ASGI với SQLite: đạt; xác nhận metadata qua router, chỉ đổi hồ sơ của actor và tiếp tục gửi tin được sau resolve.
- Test bản đồ SQLite: resolve ẩn marker Roommate, resume khôi phục marker.
- Hai ca giao diện happy path chạy lại sau khi thêm ảnh chụp: đạt; đã xem ảnh desktop/mobile.
- Thử cố tình trả `active` sau khi resolve: test hồi quy thất bại đúng chỗ; phục hồi source và chạy lại đạt.
- Chưa kiểm chứng PostgreSQL hoặc staging/production cho thay đổi này. Chưa deploy.

## Chỉnh hồ sơ theo yêu cầu tiếp theo

- Tên hiển thị và giới tính ở hàng đầu trên desktop; giới thiệu ngắn chiếm toàn bộ hàng bên dưới. Mobile dùng một cột.
- Giới tính có dấu bắt buộc và placeholder chọn rõ ràng, không tự suy đoán giới tính cho hồ sơ cũ.
- Vẫn dùng `facts.self_traits.gender`; bỏ ô trùng khỏi nhóm thói quen tùy chọn. Các giá trị giới tính hiện có đều được hỗ trợ.
- Form và backend yêu cầu giới tính khi xem trước/đăng lại nhu cầu hoặc gửi kết nối mới. Bản nháp phía backend vẫn cho thiếu thông tin; dữ liệu cũ không bị xóa hay sửa tự động.
- Bản giới thiệu cũ thiếu giới tính mở editor khi tạo kết nối mới; người dùng bổ sung trước khi gửi.
- Chat đã kết nối và thao tác gỡ tin của bản sửa trước tiếp tục hoạt động.
- Backend sau cập nhật: 215 đạt, 10 bỏ qua (PostgreSQL riêng). Build Web và Ruff đạt.
- Bộ browser sau cập nhật cuối: 94 đạt trên desktop/mobile, bao gồm kiểm tra chặn gửi khi giới tính trống, bổ sung giới tính cho bản giới thiệu cũ, accessibility tiếng Việt/Anh và chat hiện có.
- Local đã build lại Web và restart backend; Roommate bật và gateway phục vụ đúng bundle mới. Không thay đổi env hoặc dữ liệu người dùng.
- Sau rebase main `eedd7fc`: 215 test Roommate đạt (10 bỏ qua); 2 test khởi động fixture browser và gateway/session/API/SQLite thật đạt. Fixture browser cung cấp giới tính rõ ràng cho các nhân vật tổng hợp theo quy tắc bắt buộc mới.
- Sau góp ý P3, cập nhật lời nhắc hủy yêu cầu chờ Việt/Anh; build Web đạt và 12 ca gỡ tin desktop/mobile đạt. Test chuyển tab hồ sơ bằng thao tác thu gọn/mở lại chat để không click xuyên cửa sổ nổi, nhất là khi lời nhắc dài hơn trên mobile.
