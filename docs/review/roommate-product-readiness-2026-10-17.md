# Roommate: kiểm tra mức sẵn sàng cho người dùng — 17/10/2026

## Kết luận

**Đủ luồng để team dùng tài khoản riêng, tự đăng nhu cầu và thử như người dùng thật.**
Không còn nguồn hồ sơ demo trong runtime, trang Roommate hoặc bản đồ. Chưa xác nhận
vận hành production công khai ở quy mô lớn: cấu hình và dữ liệu cloud không thuộc
môi trường kiểm thử đợt này. Không coi việc mở PR hoặc CI xanh là đã deploy thành công.

Baseline `main`: `4a14c23`; thay đổi sản phẩm: `cf3bcf8` trên `QuangDung`.
Không tìm thấy lỗi mới cần chặn PR trong phần bỏ demo sau review và các test dưới đây.

## Luồng và bằng chứng

| Phần | Đã kiểm tra | Kết quả |
| --- | --- | --- |
| Đăng nhập và điều kiện sử dụng | Khách không đọc hồ sơ riêng; xác nhận tuổi/điều khoản là thao tác chủ động | Có trạng thái đăng nhập/eligibility/disabled riêng, không tự cấp consent |
| Hồ sơ | Bản giới thiệu riêng không tự công khai; preview rồi publish, pause/resume và gia hạn 30 ngày | Chrome qua gateway/API/SQLite; đăng hồ sơ và phiên bản thật trong DB test |
| Khám phá | Bộ lọc, lý do phù hợp, dữ liệu thiếu, hồ sơ hết hiệu lực, block/restriction | Matching bằng code hiện có; không tạo người hoặc điểm giả khi thiếu dữ liệu |
| Danh sách trống | Không có bài phù hợp | CTA “Đăng nhu cầu của tôi”, không dẫn sang demo |
| Kết nối/chat | Gửi, nhận, đồng ý, chat hai chiều, chưa đọc, phân trang, retry và đóng | Không cần Phone/Zalo cho kết nối chat mới; không tự mở chat trước accept |
| Lịch sử chat | 60/90 tin, gửi và poll, bỏ lỡ một cửa sổ, trang cũ đến sau khi đóng | Giữ cursor/lịch sử và trạng thái mới; retry cùng message ID |
| Inbox và recovery | Tên đối phương, chưa đọc, nhắc gia hạn, kết quả ghi không rõ sau reload | Đối soát rồi chủ động thử lại cùng operation key, không tự gửi lại |
| Media/moderation | Upload, duyệt ảnh, avatar; báo cáo; người thường mở moderation | Server kiểm quyền; user thường không đọc được queue; ảnh không tự công khai |
| Riêng tư | Tải dữ liệu/phân trang export, xóa, chặn, tài khoản hạn chế, actor thay đổi | Không mở quyền bằng cách sửa UI; xóa dữ liệu và chặn vẫn được thực thi ở server |
| Housing map | Chỉ marker người đăng công khai có consent vị trí; phản hồi backend cũ trộn real/demo | Giữ marker thật và link hồ sơ, lọc demo; không tự nhận đã xác minh quyền ở phòng |
| Link/cấu hình demo cũ | `?tab=demo`, cờ demo cũ, đường dẫn dataset không tồn tại, `include_demo=true` | Mở discovery thường; không nạp dataset; endpoint demo 404; không phá marker thật |
| Responsive/accessibility | Desktop/mobile, light/dark, VI/EN, bàn phím và axe ở các màn được test | Qua các bộ browser hiện có; không đánh đồng với audit mọi thiết bị/screen reader |

## Kiểm thử

- **255 passed**: toàn bộ Roommate SQLite/PostgreSQL, Roommate gateway và auth matrix.
  PostgreSQL dùng database test riêng, được xóa sau khi test; không ghi DB người dùng.
- **42 passed**: `roommate.spec.ts`, desktop/mobile; gồm chat, hồ sơ, lỗi, trạng thái trống,
  age/terms, retry, lịch sử và light/dark VI/EN.
- **16 passed bổ sung trong đợt audit này**: `roommate-production.spec.ts`, desktop/mobile;
  inbox, quản lý contact/chặn, moderator/user thường, recovery, restriction và accessibility.
- **4 passed**: `housing-gallery.spec.ts`, desktop/mobile; gallery và marker thật/demo cũ.
- **4 passed**: `roommate.integration.spec.ts`, Chrome → gateway → API → SQLite;
  đăng hồ sơ, ảnh, kết nối/chat, đóng và privacy erase.
- Production web build, Ruff và diff whitespace đã qua ở commit sản phẩm.

Tổng bằng chứng local: **255 backend + 66 browser**. Các lần chạy dùng model/provider
fixture hoặc service nội bộ cùng DB test, không gọi LLM/provider trả phí và không đăng
bài hộ tài khoản thật trên cloud. Test live cần provider ngoài không được chạy đợt này.
CI của PR cần kiểm tra riêng theo SHA sau push.

## Điều kiện cần xác nhận trên cloud khi triển khai

1. Backend thật nhận `ROOMMATE_ENABLED=true`, token gateway đồng nhất và moderator là
   account ID thật. Availability cần trả `enabled:true`, `demo_enabled:false`, có `chat`.
   Không suy luận giá trị hiệu lực từ `.env` local hoặc chỉ từ `/health`.
2. Giữ private volume/schema và contact key hiện có. PR không có migration, không yêu
   cầu đổi key hoặc import/xóa dữ liệu. Các cờ demo cũ có thể bỏ khỏi Coolify; không cần
   biến mới. `ROOMMATE_CHAT_RETENTION_DAYS` giữ nguyên, mặc định 180 ngày.
3. Có người phụ trách moderation/ảnh và biết cách xử lý báo cáo. Không tự duyệt ảnh
   hoặc gắn nhãn “đã xác minh danh tính”: hiện tuổi/thông tin sinh hoạt là tự khai.
4. Xác minh lịch backup, nơi giữ key, restore và theo dõi lỗi/dung lượng trên cloud.
   Test backup/restore local không chứng minh lịch backup staging đang chạy.
5. Dùng SQLite với private disk và topology phù hợp, hoặc PostgreSQL được cấu hình
   sẵn. Chưa đo tải/throughput hoặc chứng minh HA toàn ReloHome. Chat cập nhật bằng poll,
   không hứa realtime tức thì; tình trạng mạng có thể làm thông báo cập nhật chậm.
6. Sau deploy, team tự đăng hai tài khoản, đăng một hồ sơ, tìm/kết nối/accept rồi chat
   hai chiều; thử block và pause. Đây là smoke test cloud cần thực hiện trên bản mới.

## Phạm vi PR

Bỏ demo và cập nhật hướng dẫn/test tương ứng. Giữ thuật toán ghép, quota/consent,
luồng Phone/Zalo legacy, thời hạn chat, API nghiệp vụ khác và workflow CI. Hai field
legacy `demo_enabled:false` và `include_demo` được giữ tương thích, không còn khả năng
bật dữ liệu giả. Dataset/generator tổng hợp chỉ phục vụ kiểm thử offline.
