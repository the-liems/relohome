# Xem nhà: đặt lịch theo nhóm

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Ngày 12/10/2026. Phạm vi frontend của ReloHome, mở rộng luồng hẹn xem hiện có.
Kế hoạch và checklist: [plan](../../tasks/viewing-bulk-scheduling/plan.md),
[todo](../../tasks/viewing-bulk-scheduling/todo.md).

## Trải nghiệm người dùng

1. Vào **Kế hoạch → Xem nhà**. Card chỉ hiện tên, giá, địa chỉ, trạng thái và
   lịch hiện tại. Các thao tác liên hệ/hủy/chốt hiện trực tiếp theo trạng thái;
   không còn mục thu gọn Chi tiết và thao tác.
2. Tick các căn muốn đặt giờ, tối đa 3 căn/lượt và không vượt giới hạn server.
   **Chọn tất cả** áp dụng cho tập căn đủ điều kiện nằm trong giới hạn này.
3. Chọn ngày/giờ ngay trên từng card; không có màn hình Chọn giờ riêng.
   Thay đổi ngày/giờ tự tick căn đó nếu chưa vượt giới hạn. Bỏ tick giữ draft.
4. **Xem lại lịch** cho thấy toàn bộ căn, địa chỉ và giờ hẹn. Có thể quay lại
   sửa hoặc đóng/mở bảng mà giữ draft trong cùng cuộc trò chuyện.
5. Một nút **Xác nhận N lịch** gửi lượt đặt lịch. Kết quả hiện riêng từng căn.
   Map vẫn còn; gợi ý chuẩn bị/dịch vụ tiếp theo không tự chuyển workspace.

Checkbox chọn mục tiêu của lượt đặt giờ, không gọi `unselect`. **Bỏ chọn**
trên card vẫn dùng API cũ để gỡ căn khỏi giỏ chung. Những căn đã xem,
đã chốt hoặc đã báo trả không bị đưa trở lại nhóm đặt giờ.

Đã bỏ tên hội thoại lặp lại, đoạn hướng dẫn và Cách hẹn và chốt nhà ở đầu
tab Xem nhà. Bảng Kế hoạch rộng 560px trên desktop (trước 480px); mobile
vẫn co vừa màn hình. Cảnh báo/lỗi và trạng thái chủ nhà vẫn hiện khi cần.
Footer dùng vùng cố định ngoài scroll body của PlanPeek; không che controls.
Ngày/giờ dùng native select và slots server. Mobile 320px xếp dọc, control
44px; sáng/tối, VI/EN dùng token và translation hiện có.

## Tham khảo UX

- [Zillow — Touring](https://www.zillow.com/buy/touring/): chọn căn, chọn
  ngày/giờ, chuẩn bị buổi xem. Áp dụng các bước ngắn và gợi ý sau khi lưu.
- [Zillow Rental Manager — Scheduling FAQ](https://help.zillowrentalmanager.com/hc/en-us/articles/47479822560275-Instant-tour-scheduling-FAQ-for-landlords):
  phân biệt đặt ngay với yêu cầu cần chủ nhà duyệt. Giữ mô hình xác nhận
  chủ nhà của ReloHome; không giả định lịch hệ thống là availability chủ nhà.
- [Airbnb — Booking requests](https://www.airbnb.com/help/article/85):
  xem lại trước khi gửi và phân biệt gửi yêu cầu với đã xác nhận.

Các nguồn chính thức được đọc ngày 12/10/2026. Bulk 3 căn, footer và xử lý
lỗi từng phần là lựa chọn riêng phù hợp API ReloHome.

## Contract và đồng bộ

- GET `/web/api/threads/{id}/viewings` ngay trước xác nhận để kiểm giỏ,
  slots và trạng thái hiện tại. Nếu khác bản review thì yêu cầu xem lại.
- POST `/web/api/threads/{id}/viewings/schedule`, đúng body cũ:
  `{listing_id, slot}` cho từng căn; không thêm field hay endpoint.
- Một lần bấm xác nhận chạy các POST tuần tự theo giờ hẹn. API hiện có
  không có batch transaction; không tuyên bố tất cả lịch được lưu cùng lúc.
- Backend vẫn kiểm slot, overlap, khoảng cách/thời gian di chuyển và trạng
  thái. UI chỉ bắt slots không hợp lệ/thiếu và trùng giờ đã biết trước.
- Cùng giờ đã lưu với request đang mở được giữ, không POST lại. Request
  hủy/đóng muốn hẹn lại vẫn dùng schedule explicit, kể cả cùng giờ cũ.
- Chat và Kế hoạch tiếp tục đọc cùng thread state; draft chỉ là UI state theo
  thread ID. Khi gửi, khóa thao tác cạnh tranh; không đóng bảng bằng Escape,
  click ngoài hoặc đổi tab trong lúc xử lý. Rời thread dừng các căn chưa gửi.
- Sau lượt gửi, refresh thread một lần qua callback cũ. Không reset map.
- Nút hủy, gửi lại chủ nhà, ghi kết quả xem, chốt, báo trả, mở lại và chat
  chủ nhà hiện trực tiếp trên card và dùng endpoint/điều kiện hiện có.
  Các tab Chi phí, Thanh toán, Cần phản hồi giữ điều kiện hiển thị cũ.

## Lỗi từng phần

| Tình huống | Hiển thị và hành vi |
|---|---|
| Lưu thành công | Đã lưu lịch; trạng thái chờ/xác nhận chủ nhà riêng |
| Giờ không đổi, request mở | Giữ lịch hiện tại, không gửi lại |
| API từ chối 4xx, trừ 408 | Chưa lưu được; dừng, giữ draft các căn chưa gửi |
| Mạng, 408/5xx, timeout hoặc response thiếu bằng chứng | Chưa rõ kết quả; dừng, kiểm GET trước khi đặt tiếp |
| Lịch lưu nhưng sync chủ nhà lỗi | Đã lưu, cần xử lý với chủ nhà; giữ action gửi lại cũ |
| Các căn sau căn lỗi | Chưa gửi; không rollback căn đã thành công |

POST có timeout 45 giây. Không auto retry, không tự hủy lịch để né conflict
và không tự đổi giờ. Đổi chéo hai lịch đang chiếm giờ nhau có thể bị backend
từ chối; người dùng chọn giờ trống hoặc chủ động hủy bằng thao tác cũ.

Khi có request chưa rõ, journal ở `sessionStorage` giữ tối đa 3 ID, giờ,
trạng thái và baseline lịch/request để tải lại trang vẫn cần đối soát.
Không lưu tên, địa chỉ, nội dung chat, token hay thông báo lỗi provider.
Journal được bỏ khi không còn trạng thái unknown. GET phải có bằng chứng
lịch/request đã thay đổi đúng giờ để chuyển sang đã lưu; nếu vẫn không rõ
thì tiếp tục chặn gửi mới, không tự coi là thất bại rồi gửi lại.

## File chính

- `Frontend/src/viewingSchedule.ts`: eligibility, limit, validation, sender.
- `Frontend/src/useViewingScheduler.ts`: draft, review, preflight, progress,
  kết quả từng phần và journal đối soát.
- `ViewingSlotPicker.tsx`, `ViewingScheduler.tsx`: native controls và wizard.
- `Viewings.tsx`, `PlanPeek.tsx`, `App.tsx`: card gọn, footer portal, khóa gửi,
  refresh chung và giữ map.
- `ui/workspaces.css`, `locales/en.json`: layout có scope và labels.

## Kiểm chứng

Cập nhật giao diện đơn giản theo phản hồi người dùng: **36 browser cases
desktop/mobile qua** (34 regression và 2 ca chọn giờ trực tiếp kiểm riêng).
Ô ngày/giờ hiện ngay khi mở Xem nhà, bỏ nút bắt đầu và stepper 3 bước.
Vẫn kiểm lỗi trùng giờ, preflight, partial/unknown, map và hẹn lại request đóng.
Kiểm responsive/axe sáng/tối VI/EN được chạy lại trên giao diện mới.
Lượt bỏ mục thu gọn và nới bảng: chạy lại đủ 36 ca; kiểm desktop 560px,
không còn summary/đoạn mở đầu, các nút gửi lại chủ nhà/hủy/ghi kết quả
vẫn dùng trực tiếp, footer và panel không tràn mobile.

Kết quả checkpoint trước khi đơn giản hóa:

- `npm run test:contracts`: **34 qua**, gồm 6 test lịch nhóm: eligibility,
  slot/overlap, exact payload/order, partial failure, ambiguous/sync failure,
  giữ lịch mở và gửi lại request đóng cùng giờ.
- Suite liên quan: **52 kịch bản desktop/mobile đã qua**: 50 qua trong lượt
  regression, 2 ca progress được kiểm lại sau sửa locator status có scope.
  Gồm bulk, viewing suggestions, closed request và guided service forms.
- Sau chỉnh journal không lưu thông báo lỗi: kiểm lại 2 ca mất phản hồi rồi
  reload/GET đối soát trên desktop/mobile, đều qua, không có POST trùng.
- Chrome: layout 320/768/1024/1440px, sáng/tối, VI/EN, bàn phím, focus,
  footer trong viewport và axe WCAG 2/2.1 AA ở panel, không có violation.
- Browser map test giữ nguyên canvas instance sau lưu lịch; chỉ chuyển
  service khi người dùng bấm. Các test dùng API fixtures, không gửi lịch
  hay liên hệ cho chủ nhà thật.
- TypeScript + Vite build qua. Health 200 tại các cổng local 8503, 8000,
  8765, 8766, 4100, 4200, 4300, 4400.

Screenshot/output ignored ở `Frontend/test-results/` và
`data/frontend-contract-results/`. Đây là kết quả local của phạm vi này,
không phải CI mới trên GitHub hay xác nhận toàn bộ suite cũ đã hết lỗi.
Chưa publish phần bulk vào PR #127 hoặc triển khai cloud.

## Test thủ công

Mở `http://127.0.0.1:8503/ai`, tìm/chọn 2–3 căn trên map rồi mở Xem nhà.
Tick căn, chọn các giờ đủ khoảng cách, xem lại và xác nhận một lần. Kiểm tra
trạng thái từng căn, dùng ngày/giờ và nút hủy trên card nếu cần. Với tin chủ nhà quản lý
trên ReloHome, chờ chủ nhà xác nhận; tin nguồn khác vẫn là lịch thử như trước.

Nạp lại trang bằng Ctrl+F5 để lấy bundle frontend mới. Không cần migration,
đổi `.env`, API hay database để sử dụng bản giao diện này.
