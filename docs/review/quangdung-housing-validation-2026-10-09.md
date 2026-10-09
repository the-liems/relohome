# QuangDung — Housing update và kiểm chứng ngày 09/10/2026

- Nhánh đang kiểm tra: `QuangDung`.
- Commit: `4a7ed0c7d6aa93b507969d0279229c0cf27429c4`.
- So sánh với bản người dùng đã push: `9edfbf6`.
- Đã lấy code bằng fast-forward; giữ nguyên code của nhánh remote. Báo cáo này không sửa nghiệp vụ.
- Có 10 commit mới, 45 file thay đổi (bao gồm tài liệu và việc bỏ các file khóa test khỏi tracking).

## Phần bạn của chủ sản phẩm đã triển khai

| Nhóm | Khả năng có trong code mới |
| --- | --- |
| Workspace chủ nhà | Quản lý nhiều địa điểm/phòng; sửa thông tin địa điểm và pin; sửa tin với dữ liệu hiện tại được nạp lại; bộ phí linh hoạt; ảnh; bản nháp, gửi duyệt, ẩn/xóa, đổi tình trạng phòng. |
| Hai chế độ trên cùng tài khoản | Header chuyển người thuê/chủ nhà, ghi nhớ chế độ trên thiết bị, onboarding hồ sơ người đăng lần đầu. Có chủ nhà, người được ủy quyền, môi giới và doanh nghiệp. |
| Xác minh và kiểm duyệt | Hồ sơ người đăng được xác minh thủ công; địa điểm và tin cần duyệt; moderator không tự duyệt tài nguyên của mình; tab duyệt và lý do yêu cầu bổ sung. |
| Công cụ người thuê | Ước tính chi phí bằng code, phân biệt phí bắt buộc/tùy chọn/một lần, trường chưa biết không đổi thành 0; so sánh 2–4 nhà đã lưu và đọc lại chi tiết trước khi so sánh. |
| Liên hệ | Người thuê gửi/xem/hủy yêu cầu; chủ nhà có inbox và trạng thái xử lý; hội thoại riêng trên từng yêu cầu, chỉ hai phía có quyền xem. |
| Lịch xem | Lịch đặt trong tab Xem nhà được chuyển sang inbox chủ nhà; chủ nhà xác nhận/từ chối; tin tự đăng phải được xác nhận giờ trước khi người thuê ghi kết quả buổi xem. |
| Vận hành | Bộ đếm từ event thực, storage ảnh bền vững cho Coolify, giới hạn kích thước upload ngay khi đọc request body, migration 014–017 và grants bổ sung. |
| Map | Địa điểm tự đăng dùng `housing_anchor`, không xuất hiện nhầm như POI. |

Các thay đổi chính: `d23e790`, `7ffb9cf`, `b756bbd`, `4c4b55f`, `0a1f722`, `1342568`, `73ec3d9`.

## Phần chưa được triển khai

- Đánh giá chủ nhà 1–5 sao, báo cáo/phản hồi của người thuê và gắn cờ nhiều đánh giá xấu: **mới có thiết kế**, HP-14 chưa đánh dấu hoàn tất.
- Xác minh điện tử, tạm khóa người đăng, biểu đồ xu hướng/funnel theo thời gian, đối chiếu giá thị trường và UI lịch sử giá thuộc phần mở rộng sau V1.
- Điều khoản người đăng có cơ chế bật bằng `HOST_TERMS_VERSION`; nội dung/phiên bản điều khoản là việc vận hành cần chốt.
- Có bộ đếm analytics thực; chưa nên mô tả thành dashboard biểu đồ phân tích đầy đủ của toàn bộ proposal.

## Hệ thống local đã bật

- Docker Desktop, PostGIS `lifeflow-postgis` và 9 OSRM container HCM/Hà Nội/Đà Nẵng × driving/walking/motorcycle.
- Áp dụng migration `014_housing_host_profiles`, `015_housing_viewing_requests`, `016_self_service_places_are_housing_anchors`, `017_housing_contact_messages` qua runner chính thức.
- Location 4300, Platform 4100, Moving MCP 4400, Moving API 4200, Agent API 8000, Web 8503 đều trả health/readiness HTTP 200.
- 9 request routing thật qua Platform đều trả `Ok` với khoảng cách; truy cập workspace/hồ sơ chủ nhà chưa đăng nhập trả 401.
- URL dùng thử: `http://127.0.0.1:8503`, workspace chủ nhà: `/landlord`.
- Không reset/import lại database. Test Housing integration tạo tài nguyên ngẫu nhiên và dọn các row thuộc lần test đó.

## Kết quả đã kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| Build frontend | PASS |
| Build 8 workspace backend LifeFlow | PASS |
| Python regression ứng dụng + gateway | 714 passed, 90 skipped; 2 lỗi subtest che đường dẫn log trên Windows |
| Gateway Housing/Auth/Moving/action tập trung | 13 passed |
| Housing API authorization | 3 passed |
| TypeScript regression (runner chỉ nhận thư mục backend) | 81 passed, 14 live tests skipped; trong đó 9 test từ dist cũ cũng bị runner nhận, nên đây không phải 81 test nguồn độc lập |
| Housing management với PostGIS thật | 5 passed |
| Platform read integration với PostGIS thật | 12 passed sau khi DB ổn định; lần đầu có 1 timeout 5 giây |
| Browser Housing mới desktop/mobile, bao gồm axe | 10 passed |
| Browser runtime với gateway/Agent/provider thật | 3 passed: Housing map, Moving geocode/catalog, Flight search |
| Browser báo giá Moving thật với radio picker hiện tại | 1 passed: lịch quá gần trả 422, giữ form/lựa chọn, sửa lịch và nhận giá dương từ AhaMove; không tạo đơn |
| Browser toàn hệ thống, 1 worker, desktop + mobile | 134 passed, 26 skipped, 34 failed (17 trường hợp × 2 kích thước), 0 flaky; tổng 194 ca, khoảng 15 phút |
| MCP/PostGIS live search scope | 2 passed; 1 test yêu cầu 100 hồ sơ demo thất bại do cấu hình đang trỏ dataset 30 hồ sơ |

Kết luận kiểm chứng: build và các luồng mới/chính chạy thật đã qua, nhưng **chưa thể kết luận toàn bộ regression xanh hoặc sẵn sàng production**. Cần xử lý H-01 và đối chiếu các ca legacy còn lỗi. Không nới timeout, bỏ assertion hoặc sửa code sản phẩm để làm test xanh trong lượt audit.

Test live giao dịch có ghi dữ liệu provider (đặt đơn, xuất vé, thu tiền) không được bật trong lượt audit này. Test nghiệp vụ thanh toán/approval thuộc bộ Python; kết quả tìm kiếm/catalog/Flight live không chứng minh giao dịch production đã hoàn tất.

## Lỗi đã tái hiện và giới hạn kiểm chứng

### H-01 — Hủy rồi đặt lại cùng giờ không gửi lại lịch cho chủ nhà

- File: `Frontend/server.py`, hàm `landlord_viewings`, điều kiện ở dòng 700.
- Tình huống: request cũ có `viewing_status=cancelled` và `status=declined`; người thuê đặt lại đúng timestamp cũ.
- Gateway chỉ kiểm tra timestamp trùng nên bỏ qua PUT, sau đó đưa trạng thái `cancelled` trở lại UI.
- Test tái hiện riêng ở `logs/local/test_quangdung_rebook_20261009.py` đã thất bại: cần 1 PUT nhưng thực tế 0 PUT.
- Hướng sửa: chỉ bỏ qua khi request còn mở và slot đã được gửi/xác nhận/từ chối hợp lệ; lịch đã hủy phải được gửi lại. Thêm regression cho cancelled và request đã đóng.
- Chưa sửa code trong lượt lấy code và review này.

### T-01 — Bộ test cũ chưa đồng bộ với cấu hình hoặc UI mới

- Test API cũ vô tình nạp cờ demo/Roommate/viewing của `.env` local. Chạy với môi trường test riêng giải quyết lỗi token và trạng thái bật/tắt.
- `test_hundred_demo_profiles_never_enter_real_discovery_or_identity` hardcode 100 hồ sơ và 60 hồ sơ có phòng, nhưng môi trường local trỏ `roommate-demo-30.json`. Đây là lệch tiền điều kiện test, chưa đủ để kết luận Roommate production lỗi.
- Test keyboard dùng `End` rồi đòi focus tab Đã lưu, trong khi tab mới cuối cùng là Liên hệ chủ nhà. Cần cập nhật assertion theo tab cuối.
- Nhiều test legacy đưa Flight/Moving component vào hội thoại nhưng plan chỉ có task Housing; `serviceTargets`/`nextServiceTarget` chỉ mở task thuộc plan hiện hành. Kết quả runtime thật của cả Flight/Housing/Moving đã qua, nhưng regression legacy cần đồng bộ fixture và cách mở kết quả mới trước khi có thể coi suite xanh.
- Test browser Moving live cũ tìm combobox `Gói dịch vụ AhaMove` nhưng UI hiện dùng nhóm loại xe + radio. Hai ca cũ dừng trước khi gửi báo giá; test audit riêng theo UI hiện tại đã gửi báo giá và qua.
- 34 lỗi full browser gồm: workspace/timeline/chi tiết Flight, workspace/expiry/partial Moving, card Housing trong chat, kế hoạch thiếu progress trong fixture, POI distance/tracking selector, và keyboard tab. Một số nguyên nhân fixture đã xác nhận ở trên; các ca còn lại cần review riêng, không tự coi tất cả là lỗi test.
- Test CI Linux/bash không chạy hợp lệ như trên CI khi gọi trực tiếp trên Windows. Hai lỗi còn lại của Python sau tách cấu hình thuộc `tests/test_prompt_hooks.py`, không thuộc Housing.

### Các điểm cần gia cố nếu tăng lưu lượng

- Inbox và lịch sử tin nhắn trả toàn bộ row, chưa có phân trang; dashboard join đồng thời units/listings/requests/events trước khi `COUNT(DISTINCT)`, có thể tăng chi phí truy vấn khi event nhiều.
- Giới hạn tốc độ nhắn tin và kiểm tra request còn mở được đọc trước INSERT, chưa khóa transaction; request gửi đồng thời cần thêm test trước khi kỳ vọng rate limit là giới hạn cứng.

## File evidence local

- `logs/local/quangdung-browser-20261009.log`: full browser regression.
- `logs/local/quangdung-browser-summary-20261009.json`: số lượng và danh sách 34 ca thất bại.
- `logs/local/quangdung-real-browser-20261009.log`: 3 luồng provider thật.
- `logs/local/quangdung-postgis-read-20261009.log`: 12 Platform/PostGIS tests.
- `logs/local/quangdung-node-regression-20261009.log`: backend TypeScript tests.
- `logs/local/quangdung-moving-quotes-browser-20261009.log`: kiểm tra form báo giá thật.
- `logs/local/quangdung-current-moving-quote-20261009.log`: báo giá thật với radio picker hiện tại, 1 passed.

Logs và tài khoản/browser evidence dùng thư mục ignored local; không đưa secrets hoặc cấu hình `.env` vào báo cáo.

## Cập nhật sau audit: sửa H-01 và triển khai đánh giá

H-01 đã sửa trong commit `8afd69d` trên `feature/housing-landlord-reviews`. Đánh giá 1–5 sao mục 14 đã triển khai; xem [bàn giao và kiểm chứng](../integration/housing-landlord-reviews-2026-10-09.md). Các kết quả/lỗi trong phần audit phía trên ghi lại bản QuangDung gốc trước khi sửa, không phải trạng thái của feature mới.
