# Điều hướng bước tiếp theo trong kế hoạch — 12/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Lỗi đã xác định

Hội thoại người dùng tìm nhà + chuyển đồ có một căn trong giỏ hẹn xem,
Moving chờ thông tin và sau đó bổ sung Flight. Frontend dùng mọi bước Moving
đang chờ để auto mở form. Đồng thời `advanceAfter` tự chọn workspace còn lại
sau khi chọn vé/xe. Hai hành vi này gây chuyển màn hình ngoài ý muốn.

Căn trong giỏ hẹn xem chưa phải căn đã chốt; đây là trạng thái đúng của nghiệp vụ.
Không sửa trạng thái đó để tạo cảm giác kế hoạch hoàn tất.

## Trải nghiệm hiện tại

- Chọn nhà hẹn xem vẫn ở bản đồ, giữ giỏ và nút hẹn lịch xem hiện có.
- **Xong, hẹn lịch xem** mở bảng kế hoạch phủ lên map, không đóng workspace.
  Lưu/đổi/hủy lịch và tải lại trạng thái checkout không tự đổi màn hình. Map
  đang mở giữ nguyên instance/camera; chọn dịch vụ khác hoặc **Về hội thoại**
  mới đổi màn hình theo thao tác của người dùng.
- Chọn chuyến bay/phương án xe vẫn ở workspace đó, giữ lựa chọn hiển thị.
- Khi có bước khác trong kế hoạch, nút nhắc nhỏ **Bước tiếp theo: [dịch vụ]**
  nằm cạnh các tab dịch vụ trên workspace. Chỉ bấm mới mở bước kế tiếp.
  Không hiện banner lớn và không hiện nhắc riêng ở màn hình chat. Lý do/giới hạn
  chọn nhà được giữ trong tooltip và nội dung hỗ trợ screen reader.
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

## Gợi mở dịch vụ bổ sung

Gợi ý đặt trong từng căn ở tab **Xem nhà**, ngay sau thao tác/lịch đã lưu.
Không hiện nhóm gợi ý thường trực trên đầu workspace. Quy tắc frontend đơn
giản, không gọi LLM để chọn gợi ý:

| Bước hoàn thành | Gợi ý ưu tiên | Lựa chọn thêm |
| --- | --- | --- |
| Lưu lịch xem | Đường đi tới căn đó, cẩm nang xem phòng | Flight, Chuyển đồ |
| Chốt nhà / báo đã trả | Chuyển đồ, Roommate, cẩm nang nhận phòng | Flight |

Chỉ hiện domain đang bật của Agent; cẩm nang là nội dung công khai. Chuyển đồ
đã có trong kế hoạch mở đúng task hiện tại, không tạo một task giả mới. Không
hiện khối chuẩn bị cho buổi xem khi chưa hẹn, hủy lịch, chủ nhà từ chối/đóng
yêu cầu, sync gửi lịch lỗi hoặc chưa tải được trạng thái chủ nhà. Lịch chờ chủ
nhà xác nhận vẫn ghi đúng trạng thái, không coi là đã được chủ nhà đồng ý.

Sau thao tác lưu lịch thành công, khối gợi ý được cuộn vào vùng nhìn thấy và
focus để hỗ trợ bàn phím/screen reader. Khi mở lại kế hoạch không tự giành
focus. Route form điền đích và thành phố từ snapshot của đúng căn được bấm;
không tự chọn GPS/địa chỉ xuất phát. Flight mở form mới. Hủy form giữ nguyên
lịch/nhà đã lưu. Moving mở workspace A/B; Roommate mở route hiện có. Cẩm nang
dẫn trực tiếp tới `xem-phong` hoặc `nhan-phong` theo giai đoạn.
Bấm gợi ý chưa tạo task, chưa gửi chat/action/quote; chỉ sau submit người dùng
thì dùng luồng Agent hiện hành. Không sửa backend/schema/recommendation.

`ViewingPreparation.tsx` trình bày theo trạng thái; Viewings/PlanPeek nối action
về App. Component/helper gợi ý thường trực đã được thay và gỡ khỏi source,
tests của cách cũ được thay bằng test hẹn/route/guide/failure phù hợp. Không
thêm endpoint hoặc dependency mới.

Các luồng xác nhận địa chỉ, báo giá, hẹn lịch, chốt nhà, đặt xe và thanh toán
tiếp tục dùng backend/API/guards hiện có. Mở bước kế tiếp không gọi Agent,
không tạo action lựa chọn hoặc bất kỳ giao dịch nào.

## File liên quan

- `Frontend/src/serviceJourney.ts`: `nextPlanStep`, kiểm tra input theo task ID.
- `Frontend/src/components/PlanNextStep.tsx`: thanh gợi ý, action do người dùng bấm.
- `Frontend/src/App.tsx`: nối CTA; giữ workspace sau selection; ưu tiên form
  clarification hiện tại trước các bước cũ đang chờ.
- `Frontend/src/ui/workspaces.css`, `locales/en.json`: bố cục và nhãn.
- `ViewingPreparation.tsx`, `Viewings.tsx`, `PlanPeek.tsx`: gợi ý theo trạng thái
  của từng lịch/căn, focus sau lưu thành công, nối callback về form đúng căn.
- `Frontend/tests/browser/scope-contracts.spec.ts`, `service-input.spec.ts`,
  `runtime-audit.live.spec.ts`: regression và browser thật.
- `Frontend/tests/browser/viewing-suggestions.spec.ts`: appointment success/error,
  cancel/decline/sync failure, route prefill, guide route, availability và chốt nhà.

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

Lượt trước khi chuyển gợi ý vào lịch hẹn: **29 contract pass**, **18 browser pass**.
Browser kiểm nút nhắc cao tối đa 52px/rộng dưới 360px ở desktop, nằm trong
navigation của workspace; về chat không còn banner. Từ map bấm gợi ý Flight
mở form, hủy trả về đúng map, không có chat/action phát sinh. Các assertions
response/draft/retry/selection vẫn giữ.

Lượt thay gợi ý thường trực bằng gợi ý theo hẹn/chốt: **28 contract pass**;
**32 browser pass** (18 form/next-step, 6 closed-request và 8 preparation).
Sau bổ sung focus và VI/EN/sáng/tối: 8 preparation test chạy lại đều qua,
320/768/1440px không tràn, axe và console qua.
Nút đường đi nằm trong viewport ngay sau schedule success; screenshot ở
`viewing-suggestions-*/immediately-after-scheduling.png`. Tests chỉ dùng fixture,
không gửi lịch hoặc liên hệ tới chủ nhà thật. Request schedule/cancel giữ nguyên.

Đây là kiểm chứng có mục tiêu cho lỗi điều hướng. Các ca fail của full suite
trước đó trong `service-regression-2026-10-12.md` chưa được đóng bởi thay đổi này.
Push/PR vẫn tạm dừng theo yêu cầu người dùng để họ kiểm tra bản sửa local.

### Regression giữ map khi hẹn lịch

Phát hiện `openViewings` còn `setWorkspace(null)` từ luồng cũ. Đã bỏ lệnh đóng
map khi mở tab Xem nhà và đánh dấu refresh read-only là thao tác giữ workspace,
để reply mới trong snapshot không tự điều hướng về chat/Moving. Response muộn
của thread khác không được thay trạng thái của thread hiện tại.

Test tích hợp UI bắt đầu từ map: bấm Xong → hẹn lịch → gợi ý → mở rồi hủy
Flight → mở lại kế hoạch → bấm Moving. Assertion kiểm canvas vẫn là instance
ban đầu sau mở/lưu lịch; composer chat không xuất hiện. Kể cả fixture refresh
có assistant reply mới cũng không mất map. Chỉ bấm Moving mới bỏ map, không
gửi chat/quote tự động. Nhóm lịch/gợi ý/closed-request: **16 pass** desktop/mobile.
Đã chạy build và cập nhật bản phục vụ tại 8503; screenshot
`viewing-suggestions-*/map-retained-after-scheduling.png`.
Nhóm form/multi-service chạy lại: **18 pass**; tổng 34 browser assertions theo
các ca đã chạy, không thay thế kết quả full suite còn mở trong báo cáo trước.

## Checkout local

Tab Thanh toán được render từ `state.checkout`; không bị xóa trong redesign.
Launcher `start-local-mvp.ps1` dùng chế độ đọc mặc định, nên lần bật app trước
không có checkout, khác cấu hình demo trên staging. Ngày 12/10 đã restart đúng
API và Flight với `scripts/local-integration.py <component> --payment-demo`:
`app_payment=true`, Flight giữ chỗ/vé mô phỏng, Payment vẫn ZaloPay sandbox,
Moving writes vẫn tắt. Không sửa `.env`, không tạo đơn/thu tiền, không tự thêm
tài khoản tester. `PAYMENT_TESTER_CONFIRM_ENABLED=false` được truyền riêng
cho lần khởi động để không bật nút giả lập xác nhận đã trả.

Read endpoint checkout của chính hội thoại được báo trả HTTP 200/enabled,
state projection có checkout. Tải lại trang để gateway đọc trạng thái mới.
Browser build thật sau restart: form Flight tìm được offers, tab Thanh toán
có trong Kế hoạch và mở được bảng tổng: **1 pass**, không tạo thanh toán.
Khi khởi động lại sau này, chạy API và Flight với `--payment-demo` nếu muốn
test cùng cấu hình này; launcher mặc định không tự bật giao dịch/demo.
