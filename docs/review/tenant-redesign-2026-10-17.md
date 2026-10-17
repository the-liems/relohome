# ReloHome: triển khai thiết kế chế độ thuê nhà

Nhánh: `feat/tenant-redesign`, tạo từ `origin/main` (`4a14c23`). Chỉ commit cục bộ; không push và không mở PR. Gồm frontend `apps/web` và các thay đổi backend cần cho thiết kế: platform API (đánh giá, tin nhắn), gateway, agent API (mở lại sau báo tiền bị từ chối), dịch vụ chat ở ghép và migration `028_housing_review_meeting.sql`.

## Phạm vi và đối chiếu

Đọc bản xuất DOM bên ngoài repo, lấy màu và bố cục để chuyển thành class/token. Không đưa bản xuất hoặc prompt vào Git. Không đổi tile, marker, bộ style hoặc camera MapLibre. Không sửa `api.ts`, `apiError.ts`, logic nguồn ở ghép, `crawler/`, `preprocess/`, `presentation/` hoặc các file chưa track có sẵn.

| Yêu cầu | File chính | Kết quả |
| --- | --- | --- |
| Kế hoạch còn 4 tab; bỏ Cần phản hồi | `PlanPeek.tsx` | Xong; link `planTab=pending` mở Tiến trình |
| Xác nhận và thanh toán vẫn thao tác trong chat | `App.tsx`, test `app.spec.ts` | Giữ luồng chat; test xác nhận hết hạn và kiểm tra thanh toán |
| Màu thẻ riêng, giữ giữa chọn/xem lại/kết quả | `useViewingScheduler.ts`, `ViewingScheduler.tsx`, `Viewings.tsx`, `ui/tokens.css` | Xong; phân màu theo ID trong một phiên xem nhà, không trùng trong nhóm |
| Khối trong thẻ dùng cùng họ màu; cảnh báo giữ vàng | `visual-polish.css` | Xong; bổ sung token dark |
| Lỗi ngày/giờ ngay trên ô chọn, icon đỏ, viền đỏ | `ViewingSlotPicker.tsx`, `visual-polish.css` | Xong |
| Làm nổi Lịch xem; Đi tiếp | `ViewingScheduler.tsx`, `visual-polish.css` | Xong |
| Chờ xác nhận: Hủy lịch & bỏ chọn; từ chối giờ: sửa/bỏ | `Viewings.tsx` | Xong; `unselect` có sẵn hủy lịch và bỏ căn trong cùng thao tác backend |
| Xem lại: màu từng căn, nhãn giờ xanh đậm/chữ trắng | `ViewingScheduler.tsx`, `visual-polish.css` | Xong |
| Sau buổi xem: bỏ chuẩn bị, checkbox, chọn tất cả, thanh chân rỗng | `ViewingPreparation.tsx`, `Viewings.tsx`, `ViewingScheduler.tsx` | Xong; chọn giờ thay thế vẫn tự chọn căn để gửi lịch mới |
| Tiêu đề thẻ một dòng, trạng thái bên phải | `visual-polish.css` | Xong |
| Nhãn chưa trả/chờ/từ chối/hoàn tất theo màu | `Viewings.tsx`, `visual-polish.css` | Xong |
| Cần trả chủ nhà chỉ hiện trước báo cáo tiền | `Viewings.tsx` | Xong; kiểm tra cả `reported_payment` và `payment_report` |
| Hai nút form và hộp hỏi lại Quay lại/Đồng ý | `Viewings.tsx`, `Dialog.tsx` | Xong; dùng chung `ConfirmDialog`, giữ mặc định các nơi đang dùng |
| Báo trả viền theo căn; từ chối đỏ; lời nhắn riêng có trích dẫn | `Viewings.tsx`, `visual-polish.css` | Xong; chỉ dùng `payment_report.reason` thật |
| Phản hồi lại và thỏa thuận không thành sau từ chối | `Viewings.tsx`, gateway `server.py`, agent `checkout/viewing.py`, `api/viewings.py` | Xong. Gateway tự đọc báo cáo của chủ nhà, chỉ mở lại khi báo cáo hiện tại bị từ chối và đúng report key; báo cáo đang chờ hoặc đã xác nhận vẫn bị chặn |
| Gợi ý chuyển đến cuối thẻ, nét đứt cùng màu | `ViewingPreparation.tsx`, `Viewings.tsx`, `visual-polish.css` | Xong |
| Khách hẹn xem: đăng nhập và cảnh báo vàng | `guest-chat.spec.ts` | Giữ flow main; cập nhật tên nút trong test |
| Thanh đầu trang kính mờ, mặc định ẩn, hover/focus; touch luôn hiện | `App.tsx`, `visual-polish.css`, `ui/tokens.css` | Xong; dùng chung các workspace |
| Xem phương án co theo nội dung | `visual-polish.css` | Xong |
| Thông số Diện tích, Cọc, Phòng ngủ, Phòng tắm | `Housing.tsx` | Xong |
| Bỏ giá/m² ở chi tiết và so sánh bản đồ | `Housing.tsx`, `locales/en.json` | Xong |
| Chi phí vào ở gồm cọc + tháng đầu đủ phí đã biết | `housingCost.ts`, `housing-cost.contracts.spec.ts` | Xong; 8.500.000 + 8.600.000 = 17.100.000; vẫn báo tạm tính nếu thiếu phí/số lượng |
| Cọc trước tổng vào ở; tổng tháng cỡ chữ đồng nhất | `Housing.tsx`, `housing-decision.css` | Xong |
| Hai khung chi phí xanh lá, liên hệ xanh dương; textarea 100% | `housing-decision.css`, `ui/tokens.css` | Xong; màu light lấy từ DOM xuất |
| Khóa viết đánh giá ở API cho tới hẹn xem và báo đã gặp | `housing-reviews.ts`, migration 028, gateway `server.py` | Xong. Thêm `contact_requests.visit_met_at`; `can_review` và PUT đánh giá cần người thuê đã báo gặp sau giờ hẹn được chủ nhà xác nhận. Đây là người thuê tự báo, không phải bằng chứng độc lập. Người quản lý không tự đánh giá nhà mình |
| Khóa đánh giá ở UI, cảnh báo vàng/icon đỏ | `HousingReviews.tsx` | Xong; mô tả quyền đánh giá cập nhật theo điều kiện mới |
| Khách xem đánh giá đăng nhập | `HousingReviews.tsx`, `guest-chat.spec.ts` | Giữ flow main |
| Đã xem dưới tin cuối người thuê khi chưa có trả lời | `ContactThread.tsx`, `MessageComposer.tsx`, `housing-management.ts` | Xong. API tin nhắn trả `counterparty_read_at` đã lưu và `request.revision`. Không coi mở hội thoại là đã đọc |
| Đã xem cho ở ghép | `roommate/chatTypes.ts`, `RoommateThread.tsx`, `relohome_roommate/services/chat.py` | Xong. API trả `counterparty_read_message_id` từ `chat_reads`; chỉ hiện khi đúng tin cuối của người xem và chưa có trả lời |
| Bỏ bộ đếm nổi và cảnh báo ranh giới trên bản đồ | `MapWorkspace.tsx` | Xong; giữ nguyên dữ liệu/đường ranh trên bản đồ |
| Danh sách nhà quanh đây xanh ngọc, nút chọn và so sánh | `visual-polish.css`, `ui/tokens.css` | Xong |
| Thông tin chi tiết cạnh giá, mở dialog nhà đầy đủ | `MapWorkspace.tsx` | Xong; dùng lại `HousingDetail` |
| Hướng dẫn so sánh, bảng gộp viền/đường chia/đổi màu xen kẽ | `Housing.tsx`, `housing-decision.css` | Xong; 1 cột tiêu chí + N căn; dùng cùng `estimateCost` |
| Tài khoản còn 4 tab, bỏ Liên hệ chủ nhà | `App.tsx`, xóa `TenantRequests.tsx` | Xong; kiểm kê thao tác bên dưới |
| Hồ sơ & bảo mật, bảo mật giữa cá nhân và người đặt vé, không lặp email | `App.tsx`, `visual-polish.css` | Xong; link `?tab=security` chuyển `?tab=profile` |
| Lịch sử 2 cột có đường chia; mobile 1 cột | `visual-polish.css` | Xong |
| Sở thích AI 4/2/1 cột; tiện nghi cả hàng | `visual-polish.css` | Xong |
| Nhà đã lưu có khung, bo góc, nền theo theme | `visual-polish.css` | Xong |
| Dịch Việt/Anh cho nhãn mới, bỏ key tab/giá cũ không còn dùng | `locales/en.json` | Xong |

## Thao tác của tab Liên hệ chủ nhà trước khi bỏ

| Thao tác cũ | Nơi thực hiện sau thay đổi |
| --- | --- |
| Xem tên căn, lời nhắn đầu và ngày gửi | Danh sách tin nhắn và `ContactThread` |
| Xem trạng thái new/contacted/viewing/resolved/declined | Dòng Trạng thái yêu cầu trong `ContactThread`; danh sách hộp tin nhắn giữ cả yêu cầu đã đóng |
| Xem lịch, phản hồi và cập nhật | Tin hệ thống trong hội thoại và thẻ Xem nhà |
| Đọc/gửi tin, số chưa đọc | Hộp tin nhắn dùng chung nhà thuê/ở ghép |
| Hủy yêu cầu new/contacted | Nút Hủy yêu cầu trong `ContactThread`, đọc revision mới nhất từ endpoint `/housing/contact-requests/me` sẵn có trước khi hủy |
| Gửi lại báo cáo chuyển tiền lỗi | Thẻ nhà trong Kế hoạch → Xem nhà |

## Kiểm tra

Chromium dùng bản có sẵn trong cache; các thư viện còn thiếu được giải nén riêng vào `/tmp`, không cài hệ thống. Test database chạy trên container PostGIS tạm, xóa sau khi xong.

- Build frontend (gồm `tsc -b`) và build platform API: qua.
- Contracts: 49 test qua.
- Platform API: unit đánh giá 7 qua; integration housing + migration 028: 18 qua; roommate chat/API trên Postgres: 17 qua.
- Python (xem nhà, gateway activity, roommate chat/API): 45 qua, 3 bỏ qua khi không có Postgres (đã chạy trên Postgres tạm). Gateway housing management + viewing consistency: 53 qua.
- Playwright toàn bộ (sau khi bổ sung nền trang và đối chiếu lại canvas): 582 qua, 0 lỗi, 34 bỏ qua (ca live/integration thiếu backend thật). Lần chạy trước có 4 lỗi; 3 ca qua khi chạy lại, ca bản đồ chuyển đồ trên mobile được sửa: test bấm vào vùng bản đồ trống bên dưới các nút.
- Read receipt ở ghép: 8 ca mới (chưa đọc, đọc tin trước, đã xem, đã trả lời; desktop/mobile) qua.
- Kiểm tra mới: hai hộp xác nhận, ẩn hiện yêu cầu trả tiền, màu trạng thái, không chọn lại sau buổi xem, tab tài khoản, header hover/focus/touch, khóa đánh giá, công thức chi phí, nhãn Đã xem, mở chi tiết và so sánh từ bản đồ.
- Xung đột: `origin/main` vẫn ở `4a14c23`. Thử merge với PR mở #218, #213, #208 (cùng đụng `MapWorkspace.tsx`, `roommate.spec.ts`, gateway `server.py`): đều merge sạch; build web sau khi gộp #218 qua.

## Triển khai

- Migration 028 (`ALTER TABLE housing.contact_requests ADD COLUMN visit_met_at timestamptz`) cần chạy trước khi deploy API mới. Không backfill: đánh giá cũ chỉ dựa vào liên hệ vẫn hiển thị nhưng không mở quyền đánh giá mới.

## Khác biệt có chủ đích / giới hạn dữ liệu

- Canvas dùng các bộ dữ liệu và màu căn khác nhau ở một số màn; code giữ màu ID trong phiên xem nhà thay vì đổi theo trạng thái. Theme tối dùng các màu tương ứng để giữ độ tương phản.
- Không lấy nền bản đồ giả từ canvas. Không dùng số tiền 17.000.000 ở màn so sánh cũ.
- Không hiện lời nhắn chủ nhà khi API không trả `reason`.
- Các ảnh kiểm tra và thư viện xem trước dùng fixture Playwright riêng trong test, không đưa dữ liệu mẫu vào ứng dụng sản phẩm.
