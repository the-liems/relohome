# Nhập dịch vụ bằng form và hội thoại — 12/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Yêu cầu và hướng thiết kế

Hai cách sử dụng phải cùng dẫn tới luồng Agent hiện có:

1. Bấm các ô dịch vụ trên màn hình bắt đầu, điền thông tin, xem và lựa chọn kết quả.
2. Nhắn nhu cầu; khi Agent cần thêm thông tin, thao tác trên form ngay trong hội thoại.

Với kế hoạch nhiều dịch vụ, lựa chọn thành công giữ màn hình hiện tại và hiển thị
nút **Bước tiếp theo**. Không tự kéo người dùng sang dịch vụ đang chờ cũ.
[Thiết kế và kiểm chứng điều hướng bước tiếp theo](plan-next-step-2026-10-12.md).

Giữ sáu ô dịch vụ cùng cấp và palette/token ReloHome. Form có label rõ, control
tối thiểu 44–48px, bố cục một cột trên mobile, hỗ trợ VI/EN và sáng/tối.
Không làm lại màn hình map, danh sách kết quả, thanh toán hoặc workspace chủ nhà.

## Đã triển khai

- Flight: một chiều/khứ hồi, nơi đi/đến, đổi hai đầu, gợi ý sân bay phổ biến,
  ngày đi/về, 1–9 người lớn. Kiểm tra endpoint trùng, ngày không hợp lệ/quá khứ,
  ngày về trước ngày đi và số người không hợp lệ trước khi gửi.
- Dùng cùng Flight form cho ô dịch vụ, khung bổ sung trong chat và nút
  **Chỉnh hành trình** tại danh sách chuyến bay hiện hành.
- Tìm nhà: thành phố, khu vực, gần địa điểm, ngân sách; tiêu chí chi tiết nằm
  trong phần mở rộng để người dùng không phải điền mọi trường.
- Đường đi: điểm đi/đến, thành phố, phương tiện; lấy lại thông tin đã nói.
- Khi phản hồi `CLARIFY` có field được hỗ trợ, mở khung form ở phản hồi mới nhất.
  Nếu nhiều dịch vụ cần thông tin, dùng các nút chuyển form; form ẩn vẫn được
  giữ để không mất phần đang nhập trong cùng lượt hỏi.
- Có thể trở lại chat và mở lại form mà giữ bản nháp. Lỗi mạng giữ thông tin
  đã nhập và cho phép thử lại. Nếu Agent vẫn yêu cầu sửa endpoint/ngày đã có,
  lý do được giữ trong Flight form.
- Moving tiếp tục dùng form chọn điểm/map và lấy báo giá sẵn có. Roommate và
  Cẩm nang giữ route và trải nghiệm riêng hiện hành.

## Contract và ngữ cảnh

Chỉ sửa frontend/rendering. Form tạo một message đầy đủ rồi gọi hàm `send`
hiện có: `/web/api/threads/{id}/chat`, body `{request_id, message}`. Không thêm
endpoint, schema, direct provider call hay cờ đặt/thanh toán. Lựa chọn chuyến
vẫn qua action có task ID, plan version, fetched timestamp và entity ID.

Thông tin điền sẵn lấy từ current task/progress/intake của dịch vụ. Không lấy
flight offer hoặc nhà lịch sử để tự điền cho mục tiêu mới. Message của form
bổ sung nêu rõ đây là yêu cầu hiện tại; Agent tiếp tục quyết định kế hoạch và
kiểm tra nghiệp vụ. Không bỏ qua LLM/orchestration hoặc xác nhận giao dịch.

Các câu hỏi field chính xác được thay bằng control ở presentation; lịch sử
response gốc không bị viết lại. Thông báo xác nhận, hạn chế thanh toán, cảnh
báo và câu hỏi khác vẫn giữ. So sánh nhà không bị biến thành search form;
Map nearby/explore không bị mở nhầm form directions.

## File chính

- `Frontend/src/serviceRequest.ts`: nhận diện clarification, defaults hiện hành,
  tạo/kiểm tra message Flight và xử lý text hiển thị.
- `Frontend/src/components/FlightSearchForm.tsx`, `FlightRouteFields.tsx`:
  form Flight và bộ control chọn hành trình.
- `Frontend/src/components/ServiceInputPanel.tsx`: khung bổ sung trong chat.
- `Frontend/src/components/Forms.tsx`: dùng lại form trong dialog/embedded,
  điền sẵn tiêu chí nhà/đường đi.
- `Frontend/src/App.tsx`, `ServiceWorkspaces.tsx`: nối entrypoints, plan đang
  chờ và sửa yêu cầu Flight; các flow selection/booking được giữ.
- `serviceRequest.css`, `locales/en.json`: style có scope và label VI/EN.

## Kiểm tra

- `npm run build` trong Frontend: qua TypeScript và Vite.
- `npx playwright test --config playwright.contracts.config.ts`: **26 qua**,
  gồm contract Housing/Moving hiện có và 5 test form/context mới.
- Browser suite tập trung: **12 qua** (desktop/mobile), gồm direct entry,
  clarification có defaults, giữ bản nháp sau đóng/mở/lỗi mạng, chỉnh hành
  trình, selection action, nhiều form, route Roommate/Guides và regression
  Flight cũ. API responses ở các browser test này là fixture, không phải dữ
  liệu nhà cung cấp thật.
- Chrome kiểm layout 320/768/1024/1440px, sáng/tối, VI/EN, Escape/focus restore;
  các axe WCAG 2/2.1 AA audit đã chạy không có violation. Bài kiểm tra console
  không ghi nhận lỗi JavaScript; lỗi HTTP chủ động trả trong test failure là
  tình huống kiểm chứng, không được coi là giao dịch live.

Screenshot và output test ở `Frontend/test-results/` và
`data/frontend-contract-results/` (ignored).

Lượt kiểm tra đầu chỉ dùng fixtures; lần kiểm tra tiếp theo đã thử Agent/provider
thật tại local, gồm Flight từ ô dịch vụ và từ form clarification trong chat,
Housing map và catalog Moving. [Báo cáo lỗi, bản sửa và regression toàn dịch vụ](service-regression-2026-10-12.md)
ghi rõ các ca còn fail trong suite cũ. Chưa kiểm tra lại deployment cloud hoặc booking/payment.
Form dùng số người lớn theo contract Agent hiện tại; không thêm hạng vé/trẻ em
khi Agent chưa truyền các trường đó. Bản nháp ở form có scope của lượt hỏi;
không ghi riêng vào DB hay trộn sang cuộc trò chuyện khác.

## Mở rộng Xem nhà: lịch hẹn theo nhóm

Tab Xem nhà có card gọn, chọn ngày/giờ ngay trên từng card → xem lại → một
nút xác nhận chung. Không cần màn hình chọn giờ riêng hoặc stepper.
Footer nằm ngoài vùng cuộn, map được giữ khi lưu lịch.
Các thao tác hủy/chốt/liên hệ hiện trực tiếp trên card, dùng logic và API
hiện có. Bỏ phần giới thiệu lặp đầu tab, nới bảng desktop lên 560px.
Xem [bàn giao bulk scheduling](viewing-bulk-scheduling-2026-10-12.md) để biết
contract, xử lý lỗi từng phần, test và nguồn UX tham khảo.

## Gợi ý dịch vụ đơn và điều hướng đa dịch vụ

Đã audit Housing, Flight, Moving, Map, Roommate và Guides. Đa dịch vụ theo
intent hiện có dùng nút Bước tiếp theo; dùng riêng có gợi ý tùy chọn sau
chọn/kết quả, chỉ mở form/page khi bấm. Xem [báo cáo và bàn giao](service-followup-2026-10-12.md)
cho điều kiện hiển thị, contract và 48 ca browser/35 contracts đã kiểm.
