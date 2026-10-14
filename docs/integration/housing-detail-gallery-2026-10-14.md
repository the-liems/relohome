# Chi tiết nhà: thư viện ảnh và thao tác tiện ích

## Thay đổi

- Khung chi tiết trên Map bỏ tiêu đề/mô tả tiện ích lặp và dòng tọa độ. Giữ một nút **Xem các tiện ích xung quanh**, dùng nguyên handler phóng bản đồ tới căn nhà ở zoom tối thiểu 15.5.
- `HouseGallery` dùng chung cho chi tiết Map và dialog chi tiết trong Chat/Tài khoản. Trước đây Map chỉ render `images[0]`, dialog chỉ render ảnh đại diện.
- Hiển thị các URL ảnh hợp lệ trong `images` theo thứ tự API, bỏ URL trùng; dùng `thumbnail_url` khi chưa có danh sách ảnh. Có trước/sau, ảnh thu nhỏ, số thứ tự, phím trái/phải và vuốt ngang. Không tự động chạy ảnh.
- Ảnh lỗi có thông báo và người xem vẫn chuyển sang ảnh khác được. Căn một ảnh không hiện bộ điều khiển; căn chưa có ảnh hiện placeholder.
- Trên mobile, khung chi tiết nằm trên thanh danh sách để các nút ở footer không bị che. Header ảnh không co lại khi phần thông tin dài.
- Dùng token hiện tại cho sáng/tối và bổ sung nhãn tiếng Anh.

## Phạm vi dữ liệu và nghiệp vụ

Tái sử dụng `GET /web/api/housing/:id`. Backend hiện trả ảnh được duyệt và chưa bị xóa; gallery chỉ trình bày danh sách này, không hiển thị ảnh chưa được phép công khai và không tự tạo thêm ảnh. API có ít ảnh thì giao diện cũng chỉ có số ảnh đó.

Không sửa backend, database, API contract, agent, CI hoặc các handler chọn/lưu/so sánh/chỉ đường. Chọn nhà vẫn dùng ID và state hiện tại; nút tiện ích không đóng khung chi tiết hoặc chuyển về Chat.

## Kiểm chứng

- `npm run build:web`: thành công, bao gồm TypeScript.
- `npm run test:contracts`: 45 test qua.
- Browser: `housing-gallery.spec.ts`, `coincident-pins.spec.ts`, `map-appearance.spec.ts`: 8 test qua, desktop/mobile.
- Gallery: lấy ảnh từ API chi tiết khi danh sách chỉ có cover, trước/sau/ảnh thu nhỏ/phím/vuốt, ảnh lỗi, ảnh trùng/URL không hợp lệ, một ảnh/không ảnh, đổi ngôn ngữ, nút tiện ích giữ map và chọn đúng ID.
- Axe WCAG A/AA cho gallery ở sáng/tối và dialog: không có violation.
- Test tái hiện trước khi sửa thất bại vì thiếu nút **Ảnh tiếp theo**.

Browser dùng API/ảnh/basemap giả lập và component thực; không gọi provider, không đặt lịch hoặc phát sinh thanh toán. Lúc kiểm tra, dịch vụ local ở 4100/8503 không chạy nên chưa kiểm chứng lại ảnh của một tin live. Build/frontend đã cập nhật tại local; chưa push/deploy staging trong lượt này.
