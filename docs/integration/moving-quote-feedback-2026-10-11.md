# Moving: phản hồi khi bấm lấy báo giá — issue #102

## Đã xác nhận trong code main

HTTP 200 từ `/web/api/threads/{thread}/moving/quote` chỉ có nghĩa graph đã xử lý
yêu cầu. Moving vẫn có thể trả `ASK_USER`, `ERROR`, hoặc `PARTIAL` không có báo giá.
Trước sửa, `App.send()` chỉ chuyển màn hình khi có quotes; các kết quả còn lại
giữ form nhưng không truyền lý do cho khu vực xác nhận. `WorkspaceChat` của form
còn chủ động bỏ danh sách questions, nên phản hồi có thể không nhìn thấy.

Ảnh staging chưa đủ để xác định vì sao **provider của lượt đó** không trả giá.
Lượt GET status từ môi trường kiểm tra nhận HTTP 403 HTML; không có phiên trình
duyệt đăng nhập hay log staging. Không kết luận AhaMove hỏng hoặc thiếu key chỉ từ ảnh.

## Sửa

- Đọc phản hồi mới nhất; chỉ mở bước báo giá khi có **kết quả Moving mới** với
  `ANSWER`/`PARTIAL`, có quotes và không phải order. Quote cũ lặp trong hội thoại
  không được coi là báo giá mới.
- Quote mới hợp lệ vẫn được mở khi phản hồi chung là `CLARIFY` (ví dụ cần xác nhận
  tổng ngân sách); trước đó UI chặn luôn trường hợp này. Câu hỏi/cảnh báo vẫn nằm
  trong bước xem báo giá với nút về hội thoại; không coi xem giá là duyệt giao dịch.
- Khi graph hỏi thêm hoặc thất bại, hiện câu hỏi/lý do ngay cạnh nút xác nhận.
  Giữ mounted form, điểm ghim, ngày giờ và lựa chọn xe. Không tự gửi lại request,
  không reload thêm cho một business outcome đã nhận HTTP 200.
- Không im lặng bỏ qua một quote action khi hội thoại đang xử lý request khác.
- Form lấy báo giá cần điểm A/B đã xác nhận; địa chỉ chỉ gõ chưa xác nhận không âm thầm
  chuyển qua chat/Intake/Planner. Chat tự nhiên vẫn hoạt động riêng.
  - Điểm A luôn phải chọn từ gợi ý tìm kiếm hoặc ghim trên bản đồ.
  - Chưa chốt nhà (chuyển đồ chạy song song lúc còn xem nhà): điểm B cũng phải chọn
    gợi ý (có thể là một căn đang xem) hoặc ghim.
  - Đã chốt nhà: căn đã chốt là điểm B, không cần bấm thêm. Vị trí tin đăng gần đúng
    vẫn có cảnh báo; người dùng ghim lại hoặc chọn điểm khác thì dùng điểm đó.
    Đang tải vị trí căn thì chờ; không đọc được vị trí thì yêu cầu ghim cổng nhà.
- Kiểm tra lịch theo giờ Việt Nam, tối thiểu 30 phút, khớp backend. Không dùng
  múi giờ laptop và không đợi provider để phát hiện lịch quá sát.
- Cập nhật selector của bài browser live từ dropdown cũ sang family/radio hiện tại.

Không đổi booking/payment, agent reasoning, dữ liệu, Roommate hay cấu hình server.
Không đặt đơn/thanh toán và không tạo provider/GPS giả để chứng minh kết quả.

## Kiểm chứng

- `npx playwright test --config playwright.contracts.config.ts`: **13 passed**,
  gồm 5 test mới về phản hồi business outcome, quote cũ, plan clarification và lịch.
- Cập nhật sau review: contract test điểm B (đã chốt / chưa chốt / đang tải / thiếu
  vị trí / người dùng ghim khác). Ba browser test form chuyển đồ được sửa theo quy tắc
  trên. Năm browser test Moving khác vốn đã hỏng trên `main` trước PR này, không đổi.
- `npm run build` ở `Frontend`: **passed**.
- Pytest Moving options, Moving feedback và Planner: **42 passed**.
- Browser live chưa chạy: không có local stack đang listen, không truy cập được
  phiên staging của user. Bộ live đã cập nhật, nhưng contract/build không thay thế
  kiểm thử staging thật.

## Review và xác nhận sau deploy

PR riêng từ `fix/102-moving-quote-feedback` vào `main`, không tự merge/deploy.
Sau khi CI/review qua và deploy đúng SHA:

1. Thử form với A/B đã ghim, giờ tương lai >30 phút, gói xe có trong catalog.
2. Thử lịch quá sát: thấy lỗi cạnh nút, không gọi quote.
3. Nếu backend HTTP 200 nhưng chưa có giá: phải thấy lý do/câu hỏi, không mất form.
4. Nếu HTTP 4xx/5xx: lưu Status/Response và correlation/request ID để đối chiếu log;
   không đăng key, số điện thoại hoặc tọa độ riêng vào issue công khai.
5. Thử Nhà + Flight + Moving: quote không được thay lựa chọn nhà/chuyến bay;
   quote lịch sử không được tự mở lại như báo giá mới.

Phần tự fallback OSRM thuộc issue #101 riêng, không lẫn vào PR này.
