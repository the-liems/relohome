# Nâng cấp Admin → Ở ghép

Ngày: 17/10/2026. Trạng thái: **đã triển khai và kiểm thử local**, chưa push/deploy.
Baseline: `origin/main` tại `456b6d0`, đã đồng bộ vào nhánh triển khai.

## 1. Phạm vi đã chốt

Thiết kế lại riêng **Admin → Ở ghép**, dùng Emerald/Rose và shared components của
ReloHome. Theo yêu cầu bổ sung, **bỏ upload ảnh của người dùng và bỏ duyệt ảnh ở
Admin**. Đây là thay đổi thay thế phần hàng đợi ảnh trong kế hoạch ban đầu.

- Giữ thanh điều hướng và các tab Housing Admin hiện có.
- Giữ thuật toán ghép, consent, đăng hồ sơ, giới thiệu riêng, kết nối và chat.
- Không thêm bước duyệt toàn hồ sơ trước khi đăng, không biến hạn chế tài khoản
  thành thao tác ẩn riêng một tin.
- Không thêm dữ liệu demo, migration, biến môi trường hoặc thư viện mới.
- Giữ dữ liệu/ảnh cũ; không xóa hàng loạt database hoặc tạo lại key.

## 2. Đối chiếu mô hình sản phẩm

| Nội dung | Cách thể hiện đúng dữ liệu hiện tại |
| --- | --- |
| Tin đăng | Một hồ sơ hiện hành mỗi tài khoản, tên + giới thiệu + nhu cầu |
| Giá | Ngân sách **VND/người/tháng**, không phải giá thuê cả căn |
| Trạng thái hồ sơ | Đang tìm, Tạm dừng, Đã tìm được, Hết hạn, Bị hạn chế |
| Hồ sơ nháp/đã xóa | Không đưa nội dung vào danh sách hoặc chi tiết moderation |
| Báo cáo | Chưa xử lý / Đã xem xét, độc lập với trạng thái hồ sơ |
| Hạn chế tài khoản | Tác động quyền Roommate và kết nối/chat theo policy cũ |
| Khôi phục quyền | Hồ sơ về tạm dừng; chủ hồ sơ cần chủ động đăng lại |
| Ngày | Cập nhật và hết hạn thật; không tạo ngày đăng lần đầu giả |
| Admin | Dùng quyền moderator server hiện có; không cần tạo hồ sơ cá nhân |

`active` không có nghĩa đã được Admin xác minh. `reviewed` không có nghĩa tài
khoản đã bị hạn chế. Không lấy email, contact, chat hoặc preferences riêng để
lấp đầy giao diện quản trị.

## 3. Vấn đề và bố cục mới

Screenshot ban đầu có nhiều lớp card, khoảng trống lớn và các nút chuyển hàng
đợi cao. Dòng hồ sơ thiếu ngân sách/khu vực nhưng nút hạn chế lại quá nổi bật.

```text
Thanh điều hướng Admin hiện có

Hồ sơ và báo cáo                              [Làm mới]
[Báo cáo chờ]        [Đang tìm]       [Hồ sơ bị hạn chế]

[Báo cáo] [Hồ sơ]
[Tìm tên / giới thiệu / mã] [Trạng thái] [Thành phố] [Bộ lọc]
[Chọn trong trang, nếu là báo cáo]       Tổng kết quả / Xóa lọc
------------------------------------------------------------
Bảng desktop / thẻ mobile
------------------------------------------------------------
20 mục mỗi trang                         Trước · Trang · Sau

Xem chi tiết → drawer bên phải, footer thao tác cố định.
```

- Mặc định mở báo cáo chưa xử lý, KPI nhấn được để vào đúng hàng đợi.
- KPI là aggregate phía server, không đếm phần tử của trang hiện tại.
- Bảng hồ sơ: tên/mã/giới thiệu, nhu cầu, thành phố, ngân sách, trạng thái, chi tiết.
- Báo cáo: tên/mã đối tượng, lý do, thời gian, trạng thái, nút xem báo cáo.
- Không có tab ảnh, nút upload, nút duyệt ảnh hay số ảnh chờ.
- Light/dark dùng semantic tokens; mobile chuyển thành thẻ, không tràn ngang.
- Shared Dialog giữ focus trap/keyboard; reduced motion theo CSS hiện có.

## 4. Tìm kiếm, lọc và phân trang

- Server nhận `q`, status, city, need, min/max budget và sort allowlist.
- Tìm trên tên, giới thiệu và mã; debounce 300 ms, tối đa 100 ký tự.
- Search không lưu URL/localStorage. Các bộ lọc không chứa nội dung cá nhân,
  loại hàng đợi và trang được giữ trong URL để Back/Forward hoạt động.
- Ngân sách lọc theo khoảng giao nhau; dữ liệu thiếu không bị coi là 0.
- Sort cập nhật hoặc ngân sách có khóa phụ ổn định; dữ liệu thiếu xếp sau.
- Count và list dùng cùng predicate. Hồ sơ active hết TTL được hiển thị expired,
  không đợi maintenance mới đổi cách nhìn của Admin.
- Truy vấn có tham số, escape LIKE, limit tối đa 50, dùng được SQLite/PostgreSQL.
- Đổi bộ lọc reset trang/selection; response cũ bị hủy; poll tạm dừng khi xử lý.

## 5. Chi tiết và hành động

Drawer có giới thiệu, nhu cầu, thành phố/khu vực, ngân sách/cơ sở phí, thời điểm
vào ở, cập nhật/hết hạn và lịch sử xử lý có phân trang. Chỉ trình bày fields
đang được phép đọc; không dựng before/after hay lịch sử vi phạm suy đoán.

- Hạn chế/khôi phục yêu cầu lý do và xác nhận riêng, nói rõ tác động.
- Gửi version đang xem để phát hiện hồ sơ thay đổi (409), giữ operation key
  và khả năng tra cứu/khôi phục thao tác cũ. Không ghi đè phiên bản mới.
- Báo cáo có thể đánh dấu đã xem xét dù hồ sơ đích không còn được đọc.
- Xem xét báo cáo không tự hạn chế tài khoản.
- Báo lỗi/quyền/phiên hết hạn theo cơ chế dùng chung; không tự replay mutation.

## 6. Xử lý nhiều báo cáo

Chỉ áp dụng đánh dấu **đã xem xét** cho báo cáo đang mở trong trang hiện tại,
tối đa 20 mục. Không có bulk restrict/restore hoặc duyệt toàn hồ sơ.

1. Chọn từng mục hoặc chọn trong trang; checkbox có trạng thái indeterminate.
2. Xác nhận đúng số lượng và ý nghĩa thao tác.
3. Gọi endpoint resolve hiện có tuần tự, ghi số thành công/lỗi/chưa gửi.
4. Dừng khi hết phiên hoặc kết quả không rõ, kể cả `operation_unknown` với HTTP
   502/HTML. Tách số chưa rõ kết quả khỏi số lỗi; giữ mục chưa rõ/lỗi/chưa gửi được chọn.
5. Làm mới count/list; không tự gửi lại các mutation đã thành công.

## 7. Bỏ upload và duyệt ảnh

Gỡ AvatarEditor của người dùng; không phụ thuộc backend cũ còn quảng bá `media`.
Đóng các endpoint upload, gắn avatar và moderation media ở API lẫn gateway.
`availability.features` không còn `media`.

Ảnh cũ vẫn hiển thị qua private API hiện có. Trong Hồ sơ của tôi, chủ sở hữu có
mục **Ảnh đã lưu trước đây** để xem và xác nhận xóa riêng từng ảnh, không xóa
hồ sơ. Không có upload/gắn/đổi ảnh. MediaService/DB/audit cũ được giữ cho archive, privacy/export và dữ liệu
còn tồn tại; không dùng chúng để mở lại upload hay duyệt ảnh qua route khác.
Ảnh Housing và profile tài khoản ngoài Roommate không thuộc thay đổi này.

## 8. Thứ tự triển khai và nghiệm thu

Checklist tiến độ: [tasks/todo.md](../../tasks/todo.md), RA-01–RA-08.

1. Đồng bộ baseline, typed projection và bỏ giao diện/API ảnh.
2. Query/filter/count/detail/history có quyền, test SQLite/PostgreSQL.
3. KPI/list/toolbar/drawer responsive và hành động có version.
4. Batch báo cáo, test lỗi một phần và không gửi lại mutation.
5. Build, kiểm thử browser/integration, review diff và bàn giao.

Kết quả và giới hạn cụ thể:
[bàn giao triển khai](../integration/roommate-admin-redesign-2026-10-17.md).
CI trên commit mới và smoke cloud chỉ có thể xác minh sau khi push/deploy;
không dùng kết quả local để khẳng định staging đã chạy phiên bản này.
