# Kiểm tra đăng nhập trên toàn bộ dịch vụ ReloHome

Ngày: 16/10/2026. Nền code: main `49ab46a`. Phạm vi: trải nghiệm khách, đăng nhập lại khi hết phiên, giữ thao tác chưa gửi và cách ly dữ liệu giữa tài khoản.

## 1. Quyền sử dụng được giữ theo hệ thống hiện tại

| Dịch vụ | Khách được sử dụng | Cần tài khoản |
|---|---|---|
| Chat/AI | Chat và tra cứu các dịch vụ được phép; giữ phiên khách theo cơ chế hiện có | Các công cụ riêng tư bị chặn cả ở gateway và Agent |
| Housing | Tìm kiếm, bản đồ, ảnh/chi tiết nhà, lựa chọn căn để chuẩn bị | Lưu yêu thích, gửi liên hệ, đọc đánh giá chủ nhà qua API riêng tư |
| Xem nhà | Chuẩn bị danh sách, ngày/giờ và xem lại lịch | Gửi/đổi/hủy lịch, đánh giá buổi xem, chốt nhà, báo đã trả tiền |
| Map/Routing | Tìm địa điểm, tiện ích, tính tuyến giữa điểm hoặc từ thiết bị | Quyền vị trí của trình duyệt là điều kiện riêng; không thay bằng đăng nhập |
| Moving | Chuẩn bị A/B và thông tin chuyển đồ; đọc danh mục xe | Gửi lấy báo giá và giao dịch |
| Flight | Tra cứu và xem thông tin chuyến bay | Hồ sơ hành khách, mở tóm tắt thanh toán và thanh toán |
| Thanh toán | Không tạo giao dịch cho khách | Đọc thông tin riêng tư, tạo/kiểm tra thanh toán, QR và thao tác tester |
| Roommate | Trang giới thiệu dịch vụ | Hồ sơ thật, tìm người, ảnh riêng tư, liên hệ, kết nối, cài đặt; vẫn cần điều kiện tuổi/điều khoản/quyền sử dụng |
| Chủ nhà | Có thể xem giới thiệu trên landing | Hồ sơ chủ nhà, quản lý nhà/phòng/tin/ảnh, lịch hẹn và trao đổi với khách |
| Admin | Trang đăng nhập Admin | Phiên Admin và quyền quản trị hợp lệ; tài khoản thường không được nâng quyền |
| Cẩm nang | Đọc nội dung hướng dẫn | Không thêm điều kiện đăng nhập |
| Tài khoản | Mời đăng nhập | Hồ sơ, danh sách đã lưu và thông tin riêng tư |

Đây là mô tả quyền đang có, không phải mở thêm quyền truy cập. Không thay schema, API contract, thuật toán ghép trọ hay cơ chế chuyển quyền hội thoại.

## 2. Lỗi đã tìm thấy và sửa

### Xử lý hết phiên không đồng nhất giữa các client

`api.ts`, client Roommate, client quản lý nhà và hai đường tải ảnh dùng các cách gọi fetch riêng. Một số đường 401 chỉ hiện lỗi, không mở đăng nhập; Roommate có thể đọc sai mã lỗi ở cấp ngoài JSON. Tạo helper `authEvents.ts` dùng chung cho các client này.

- 401 của API riêng tư mở hộp đăng nhập ngay trong workspace.
- Lỗi sai mật khẩu tại `/auth/*` vẫn ở trong form; không tạo vòng lặp đăng nhập.
- 403 thiếu quyền giữ nguyên lỗi quyền hạn.
- Phiên khách hết hạn dùng sự kiện riêng và giữ cơ chế xóa phiên cũ hiện có.
- Admin đăng nhập lại qua `/auth/admin`.

### Xem nhà công khai bị gọi API riêng tư quá sớm

Chi tiết nhà tự gọi analytics, danh sách liên hệ của người dùng và đánh giá chủ nhà. Khách có thể nhận 401 chỉ vì mở nhà. Thêm context quyền ở giao diện, không gọi các API riêng tư này khi là khách. Nút gửi liên hệ hỏi đăng nhập trước khi POST; lời nhắn vẫn được giữ khi đóng hộp đăng nhập.

### Giữ bản nháp và khôi phục sau đăng nhập

- Giữ form, bản xem lại lịch, thông tin A/B, nội dung Roommate khi đăng nhập lại cùng tài khoản.
- Không tự gửi lại yêu cầu đặt lịch, liên hệ, kết nối, tải ảnh hoặc thanh toán.
- Roommate chỉ tải lại các resource GET đang lỗi 401 sau khi đăng nhập lại cùng tài khoản. Không tải lại mọi form đang sửa.
- Ảnh Roommate giữ file và operation key sau 401; người dùng bấm **Thử tải lại ảnh**. Trường hợp chưa rõ kết quả vẫn dùng kiểm tra operation cũ.
- Avatar riêng tư bị lỗi xác thực được tải lại sau đăng nhập.
- Liên kết đăng nhập trên trang giới thiệu Roommate giữ query/tab đích.
- Thanh toán Flight có nút **Thử lại** khi tải tóm tắt thất bại. Lần thử lại đọc cả tóm tắt và hồ sơ hành khách; giữ người đi cùng đã nhập, không tự trả tiền.

### Cách ly tài khoản

Tái hiện được phản hồi `/saved` của tài khoản cũ về muộn sau khi đăng nhập bằng tài khoản khác và hiện trong tài khoản mới. `refresh()` và cập nhật danh sách lưu kiểm tra chủ sở hữu trước khi cập nhật state. Workspace riêng tư được tạo lại khi đổi tài khoản; Chat giữ mount khi nâng từ khách lên tài khoản, chỉ tạo lại khi chuyển giữa hai tài khoản thật.

## 3. Kết quả kiểm thử

| Nhóm kiểm thử | Kết quả |
|---|---|
| Gateway: ma trận dịch vụ riêng tư/công khai, phiên khách, claim; Agent: chặn công cụ riêng tư | **58 passed** |
| Checkout, viewing, housing management, Admin và vận hành gateway | **132 ca**: 127 qua lần đầu; 5 test backup lỗi quyền ACL trong sandbox, chạy lại ngoài sandbox đều qua (19/19 của hai file vận hành) |
| Browser: `service-auth`, `guest-chat`, `housing-product`, `roommate`, `roommate-production` | **120 passed**, Chrome desktop 1440×960 và mobile 390×844 |
| Moving đăng nhập giữ form, payment approval hết hạn | **4 passed**, desktop/mobile |
| Bản build thực tế gateway 8503: 8 luồng chính × 2 kích thước | **16 passed** |
| TypeScript, production build, Ruff và `git diff --check` | Qua |
| Health của web, Agent, Platform, Location MCP, Moving API/MCP, Flight MCP và Payment MCP | **8/8 HTTP 200** |

Các test dùng API giả lập hoặc database tạm; không gửi liên hệ thật, không thay hồ sơ người dùng thật, không trả tiền. Health check chỉ xác nhận service phản hồi, không chứng minh toàn bộ tích hợp ngoài đã chạy thành công.

### Hai kịch bản Flight có sẵn trên main còn thất bại

Đã chạy kiểm tra rộng hơn và đối chiếu frontend nguyên bản của cùng commit main ở cổng riêng 5296:

1. `flight results open a flight workspace with sorting and selection`: không tìm thấy region “Chuyến bay”.
2. `flight detail keeps the latest request, shows provider airport codes and stays closed`: không tìm thấy nút “Xem hành trình” của hãng trong fixture.

Cả hai cũng thất bại ở main nguyên bản với cùng điểm kiểm tra, trước các thay đổi đăng nhập. Trên bản đang sửa, mỗi kịch bản thất bại ở cả desktop/mobile (4 test). Chưa kết luận là lỗi sản phẩm hay fixture không còn đúng contract; cần điều tra riêng dữ liệu kết quả Flight và điều kiện render workspace. Không sửa/xóa/skip test để che lỗi, không tuyên bố toàn bộ suite hay CI xanh.

## 4. Chạy lại kiểm thử

Từ thư mục gốc, Python môi trường dự án:

```powershell
.venv/Scripts/python.exe -m pytest apps/browser-gateway/tests/test_service_auth_matrix.py apps/browser-gateway/tests/test_guest_gateway.py apps/browser-gateway/tests/test_guest_sessions.py apps/browser-gateway/tests/test_guest_body_limit.py tests/test_agents/test_guest_access.py -q --basetemp=.tmp/auth-services-repeat
```

Từ `apps/web`, với cổng dev 5174 còn trống (config tự khởi động Vite):

```powershell
npm run test:e2e -- tests/browser/service-auth.spec.ts tests/browser/guest-chat.spec.ts tests/browser/housing-product.spec.ts tests/browser/roommate.spec.ts tests/browser/roommate-production.spec.ts
```

Phiên kiểm tra này dùng config tạm trong `.tmp` để chạy Vite 5295, đối chiếu main 5296 và bản build 8503. Không chỉnh CI/config test được commit. Xem thêm [các sửa lịch xem và Moving](viewing-auth-moving-fixes-2026-10-16.md).

## 5. Dùng thử và triển khai

- Local đã build, mở `http://127.0.0.1:8503/ai`; tải lại trang để nhận JS/CSS mới.
- Sửa lần này ở frontend và test. Gateway/Agent giữ nguyên phân quyền. Các sửa viewing/SSE từ công việc trước vẫn nằm trong working tree, được ghi riêng trong tài liệu tương ứng.
- Cloud/staging cần triển khai bản frontend mới và giữ `RELOHOME_GUEST_ENABLED=true` trên gateway nếu muốn cho chat khách. Không tự thay cấu hình cloud trong lần kiểm tra này.
- Chưa commit, push, tạo PR hay thay workflow CI trong nhiệm vụ này.
