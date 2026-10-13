# Xem nhà — lịch hẹn theo nhóm

Ngày 12/10/2026. Phạm vi: frontend; giữ backend, payload, xác nhận chủ nhà,
trạng thái hẹn/chốt, travel/overlap validation, map và dữ liệu chung hiện có.
Checklist riêng tại `todo.md`; không ghi đè kế hoạch Roommate ở tasks root.

## Điều chỉnh đã triển khai theo phản hồi người dùng

Ngày/giờ hiện ngay trên card trong danh sách; không cần bước Chọn giờ riêng.
Chọn giờ tự tick căn đó trong giới hạn, bỏ tick vẫn giữ draft. Footer chỉ còn
Xem lại lịch → Xác nhận chung; không còn stepper 3 bước. Các yêu cầu nghiệp vụ,
API, lỗi từng phần và đồng bộ phía dưới giữ nguyên. Phần flow/task wizard bên
dưới mô tả checkpoint thiết kế trước khi người dùng yêu cầu đơn giản hóa.

Phản hồi tiếp theo: bỏ mục Chi tiết và thao tác, đoạn hướng dẫn và tên hội
thoại lặp ở đầu Xem nhà. Hành động cũ hiện trực tiếp theo trạng thái, bỏ chữ
giải thích lặp từng card; giữ cảnh báo và điều kiện. Bảng desktop 560px,
mobile vẫn vừa màn hình. Không thay API, slots hoặc nghiệp vụ.

## Audit và hướng thiết kế

`ViewingPanel` hiện lặp giải thích dài, date/time picker và submit ở từng card.
`PlanPeek` đã có scroll body, header/tabs/footer riêng; map phải còn bên dưới.
API `/threads/{id}/viewings/schedule` nhận đúng một `{listing_id, slot}`;
không có batch transaction. Backend kiểm slots, trùng giờ, thời gian đi,
trạng thái và việc gửi/chờ chủ nhà. `unselect` có thể hủy lịch/yêu cầu liên hệ.

### Flow

1. Card gọn: checkbox, tên 2 dòng, giá, địa chỉ, trạng thái/lịch hiện tại.
   "Chi tiết và thao tác" mở nội dung điều kiện/hủy/visit/chốt/liên hệ hiện có.
2. Chọn tối đa 3 căn cho lượt đặt lịch; Chọn tất cả khi tập đủ điều kiện không
   vượt giới hạn. Giới hạn UI còn phải tôn trọng `viewing.max_selected` server.
   Checkbox là target scheduling; không gọi unselect hoặc đổi giỏ chung.
3. CTA sticky "Đặt lịch cho N căn" → bước chọn giờ: mỗi căn có ngày/giờ riêng,
   dùng slots API. Tiếp → bảng xem lại tên/địa chỉ/ngày/giờ và một CTA duy nhất.
4. "Xác nhận N lịch": gửi serial bằng endpoint cũ, thứ tự theo giờ; dừng khi
   lỗi/không rõ kết quả. Không hủy những căn đã thành công, không auto retry.
5. Kết quả theo từng căn: đã lưu, đã lưu nhưng sync chủ nhà lỗi, lỗi, chưa gửi,
   chưa rõ. Gợi ý chuẩn bị chỉ theo trạng thái đã lưu đúng ở server.

### Giữ nghiệp vụ

- Server là nguồn sự thật cho giỏ, slots, lịch, landlord status, warnings.
  Wizard draft dùng ID, mất ID/đổi trạng thái từ Chat thì bắt review lại.
- Chọn/hủy checkbox không bỏ nhà; nút Bỏ chọn căn riêng đi qua API cũ.
- Nút chung không hứa all-or-nothing. 4xx: giữ lỗi từng căn và draft của phần
  chưa gửi. 5xx/network/response thiếu bằng chứng: kiểm GET trước; không tự POST.
- Cùng giờ đã lưu không cần POST lại nếu yêu cầu đang mở; request đóng/hủy
  muốn đặt lại vẫn là schedule explicit, giữ hành vi sửa cùng giờ đã fix.
- Đổi chéo giờ cũ có thể bị backend từ chối do lịch kia còn chiếm chỗ; không
  tự cancel để né. Giữ lịch cũ, báo rõ cần đổi sang giờ trống hoặc hủy chủ động.
- Không giả định có availability chủ nhà: slots là slots hệ thống, confirmation
  của chủ nhà vẫn riêng. Nguồn không quản lý vẫn ghi lịch thử, không tuyên bố gửi.
- Map/camera giữ nguyên khi mở wizard/lưu lịch. Chỉ click đổi service mới đổi.

## Design contract

### Nguồn tham khảo sản phẩm

- [Zillow — Tour houses](https://www.zillow.com/buy/touring/): chọn căn → ngày/giờ → kết nối để hẹn xem; Touring Hub có checklist. Áp dụng vào các bước rõ ràng và gợi ý chuẩn bị sau khi lưu.
- [Zillow Rental Manager — Tour scheduling FAQ](https://help.zillowrentalmanager.com/hc/en-us/articles/47479822560275-Instant-tour-scheduling-FAQ-for-landlords): phân biệt Instant Book với Review and Confirm. ReloHome giữ xác nhận chủ nhà hiện có; không giả định availability thật hay booking tức thì.
- [Airbnb — Reservation requests](https://www.airbnb.com/help/article/85): nhập thông tin, xem lại trước khi gửi; phân biệt request với xác nhận. Áp dụng bảng review và trạng thái từng căn.

Đọc nguồn chính thức ngày 12/10/2026. Bulk tối đa 3 căn, footer cố định và xử lý lỗi từng phần là thiết kế cho contract của ReloHome; không tuyên bố các nền tảng trên dùng cùng batch flow.

Xanh lá/token cũ; checkbox/control >=44px; card border gọn, không thêm gradient.
Body cuộn; footer sticky theo đúng scroll container, không đè nội dung hay nút
footer của PlanPeek. Mobile 320px: ngày/giờ xếp dọc, CTA full width; desktop
hai field cùng hàng. Stepper 3 bước Chọn căn → Chọn giờ → Xem lại; không hỏi lại
bằng chat. Warning chặn/lỗi luôn lộ; giải thích chung xuất hiện một lần.
Đóng/click ngoài khi đang gửi không hủy ngầm job; báo trạng thái rồi reconcile.
Không thêm thư viện date picker/global store/API/batch endpoint.

## Tasks và checkpoints

| ID | Mục tiêu | Dependency | Files/modules | Acceptance & test |
|---|---|---|---|---|
| BVS-01 | Eligibility/draft/validation thuần | Không | viewingSchedule.ts + contracts test/config | Không chọn visited/chốt/backup đã xem; slots đúng server; <=3 và giới hạn server; overlap theo slot_minutes; test thuần |
| BVS-02 | Sender serial qua contract cũ | 01 | viewingSchedule.ts + contracts test | Exact payload; stop lỗi/unknown/sync failure; no rollback/auto retry; skip giờ không đổi open request; mock callbacks prove count/order |
| BVS-03 | Wizard ngày/giờ → review → kết quả | 01–02 | ViewingScheduler.tsx, ViewingSlotPicker.tsx, CSS | Draft riêng từng ID, back giữ draft; 1 CTA cuối; messages per row; browser fixture |
| BVS-04 | Card gọn, checkbox, disclosure, sticky footer | 03 | Viewings.tsx, PlanPeek.tsx, CSS, en.json | Giỏ chung không đổi bởi checkbox; thao tác cũ trong disclosure; map còn; footer visible; browser schedule/closed-request |
| BVS-05 | Regression/a11y/responsive/handoff | 04 | browser specs, docs/integration | Success/partial/unknown/cancel/closed same-slot; map instance; keyboard+axe+VI/EN/dark/320/768/1024/1440; build + contracts |

Checkpoint 01–02: red/green tests contract; chưa có request backend thật.
Checkpoint 03–04: fixture E2E từ map/plan đến kết quả, payload không đổi.
Checkpoint 05: đủ verified mới build phục vụ local; không auto push PR #127.

## Verification commands

- `npm run test:contracts`
- `npm exec --offline --workspace Frontend -- playwright test viewing-bulk.spec.ts viewing-suggestions.spec.ts viewing-closed-request.spec.ts service-input.spec.ts --workers=2`
- `npm run build:web`
- Readiness/asset check local; không đặt lịch/liên hệ tới chủ nhà thật trong tests.

## Không thuộc scope

Không batch API/schema/migration, scheduler tự đặt giờ, thay thuật toán route,
auto cancel/reorder lịch, đổi semantics hẹn/chốt, provider/payment hay design
các tab/service khác. GitHub issue/PR cho scope này chỉ publish khi được yêu cầu;
checklist local riêng dùng trong lượt triển khai được user cho phép.
