# Điều hướng bước tiếp theo trong kế hoạch — 12/10/2026

## Lỗi đã xác định

Hội thoại người dùng tìm nhà + chuyển đồ có một căn trong giỏ hẹn xem,
Moving chờ thông tin và sau đó bổ sung Flight. Frontend dùng mọi bước Moving
đang chờ để auto mở form. Đồng thời `advanceAfter` tự chọn workspace còn lại
sau khi chọn vé/xe. Hai hành vi này gây chuyển màn hình ngoài ý muốn.

Căn trong giỏ hẹn xem chưa phải căn đã chốt; đây là trạng thái đúng của nghiệp vụ.
Không sửa trạng thái đó để tạo cảm giác kế hoạch hoàn tất.

## Trải nghiệm hiện tại

- Chọn nhà hẹn xem vẫn ở bản đồ, giữ giỏ và nút hẹn lịch xem hiện có.
- Chọn chuyến bay/phương án xe vẫn ở workspace đó, giữ lựa chọn hiển thị.
- Khi có bước khác trong kế hoạch, thanh **Tiếp tục kế hoạch của bạn** hiển thị
  **Bước tiếp theo: [dịch vụ]** và **Xem kế hoạch**. Chỉ bấm mới mở bước kế tiếp.
- CTA dùng progress/current plan và đúng task ID. Bỏ qua lịch sử, so sánh,
  phương án đã chọn, kết quả đã duyệt và dịch vụ không có trong kế hoạch.
- Nhà trong giỏ hẹn xem được coi là đã xem qua ở tầng điều hướng để có thể
  chuẩn bị Moving. Không gán `selected:property`, không tự chốt nhà, không
  chọn pin B, không đổi mode chờ nhà hay gửi báo giá.
- Khi Flight cần thông tin trong phản hồi cùng câu hỏi Moving cũ, form Flight
  được hiển thị trong chat. Một bước Moving chờ trong progress không tự mở
  form và che Flight. Moving-only clarification vẫn mở form như trước.
- Nút **Về hội thoại** vẫn quay về chat khi người dùng chủ động bấm.
- Dùng cùng token hiện hành; CTA 44px, responsive, VI/EN và sáng/tối.

Các luồng xác nhận địa chỉ, báo giá, hẹn lịch, chốt nhà, đặt xe và thanh toán
tiếp tục dùng backend/API/guards hiện có. Mở bước kế tiếp không gọi Agent,
không tạo action lựa chọn hoặc bất kỳ giao dịch nào.

## File liên quan

- `Frontend/src/serviceJourney.ts`: `nextPlanStep`, kiểm tra input theo task ID.
- `Frontend/src/components/PlanNextStep.tsx`: thanh gợi ý, action do người dùng bấm.
- `Frontend/src/App.tsx`: nối CTA; giữ workspace sau selection; ưu tiên form
  clarification hiện tại trước các bước cũ đang chờ.
- `Frontend/src/ui/workspaces.css`, `locales/en.json`: bố cục và nhãn.
- `Frontend/tests/browser/scope-contracts.spec.ts`, `service-input.spec.ts`,
  `runtime-audit.live.spec.ts`: regression và browser thật.

## Kiểm chứng

- TDD: ca mixed Flight/Moving fail vì form Flight không xuất hiện; qua sau sửa.
- Contract: **28 pass**, gồm chọn nhà hẹn xem không biến thành căn đã chốt,
  bỏ qua historical/comparison và không tạo dịch vụ ngoài kế hoạch.
- Browser form/next step: **18 pass**, desktop/mobile, Moving chờ không giành
  Flight, chọn vé không nhảy màn, CTA mới chỉ mở Moving khi bấm, nhà hẹn xem
  không thành điểm giao. Kiểm 320/768/1440, dark/EN, axe không có violation ở CTA.
- Moving regression hiện có: **8 pass**, gồm payload/add-ons/CASH, giữ form
  khi lỗi, căn đã chốt điền B và câu hỏi Moving mở form.
- Browser thật với tài khoản test riêng: tìm nhà Quận 1/HCM + Moving, chọn
  một căn vào giỏ hẹn xem, giữ map, hiện CTA và mở Moving khi bấm: **1 pass**.
  Không gửi yêu cầu hẹn lịch/chủ nhà, quote, order hoặc payment.
- Lượt browser thật đầu dùng phạm vi cả thành phố vào chế độ gom nhóm và
  timeout vì chưa có nút chọn từng căn; lượt kiểm chứng chọn căn được thu hẹp
  tới Quận 1. Không sửa policy gom nhóm hoặc dữ liệu bản đồ để làm test qua.
- Frontend build qua, bản mới phục vụ tại cổng 8503.

Đây là kiểm chứng có mục tiêu cho lỗi điều hướng. Các ca fail của full suite
trước đó trong `service-regression-2026-10-12.md` chưa được đóng bởi thay đổi này.
Push/PR vẫn tạm dừng theo yêu cầu người dùng để họ kiểm tra bản sửa local.
