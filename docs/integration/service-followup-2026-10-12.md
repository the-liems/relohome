# Gợi ý sau dịch vụ và bước tiếp theo

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Ngày 12/10/2026. Thực hiện theo yêu cầu: nhiều dịch vụ trong yêu cầu/kế hoạch
thì có Bước tiếp theo; sử dụng dịch vụ riêng thì gợi ý tùy chọn.

## Audit và bản sửa

| Dịch vụ | Trước audit | Trạng thái sau sửa |
|---|---|---|
| Housing | Gợi ý sau lưu hẹn xem/chốt căn đã có | Giữ đường đi, cẩm nang, chuyến bay/chuyển đồ; không mất map |
| Flight | Đã có bước tiếp theo cho mục tiêu đang chờ, thiếu gợi ý khi dùng riêng | Sau chọn chuyến: tìm chỗ ở, xem đường đi |
| Moving | Bước tiếp theo đã có; toast còn hướng dẫn nhắn đặt không khớp checkout | Sau chọn gói: xem đường đi, cẩm nang nhận phòng; sửa toast về ghi nhận phương án |
| Map | Kết quả hiện tại tự chiếm nextPlanStep; nút Tiếp tục kế hoạch về chat | Có next-step thật nếu kế hoạch đa dịch vụ; dùng riêng gợi ý chỗ ở/cẩm nang khi có route hoặc địa điểm |
| Roommate | Có hướng dẫn hồ sơ/consent và liên hệ, chưa có gợi ý sau kết nối | Khi request accepted và grant active: cùng tìm chỗ ở/cẩm nang hợp đồng |
| Guides | Cuối bài chỉ quay về cẩm nang | Thêm lối mở form tìm chỗ ở/đường đi ở cuối bài |

Nhãn `roommate` trong plan navigation được sửa thành **Ở ghép**. Các nút
hẹn xem, thanh toán, tiếp tục chat và consent vẫn giữ API/điều kiện cũ.

## Hai chế độ hiển thị

1. **Đa dịch vụ:** `hasMultipleRequestedServices` đọc
   `state.intake.intent.domains`, tương thích `intake.domains`. Dữ liệu này
   là intent mà backend xác định cho yêu cầu hiện tại. Thread cũ thiếu/empty
   danh sách domain dùng các mục tiêu trong progress, loại bản tìm nhà lịch sử
   và task so sánh, đếm domain khác nhau thay vì số task.
2. **Đơn dịch vụ:** không có nút Bước tiếp theo. Nhóm nhỏ **Bạn có thể cần
   thêm** mở form/page liên quan. Không biến gợi ý thành mục tiêu hay lựa chọn
   đã xác nhận; người dùng gửi form thì mới gọi chat/orchestration hiện có.

Không phân tích từ khóa câu chat bằng frontend và không sửa state để giả
thành kế hoạch nhiều dịch vụ. Nếu user bổ sung domain vào cùng mục tiêu ở
lượt sau, backend vẫn có thể giữ đó là một intent đa dịch vụ. Không thêm
metadata hoặc API để phân nhóm theo số câu trong lịch sử.

Flight/Moving chỉ gợi ý sau khi server lưu lựa chọn trong progress. Đây là
**chọn phương án**, không phải đã đặt vé/trả tiền/tạo đơn. Map cần route hoặc
nearby có địa điểm; kết quả rỗng/lỗi không tự được coi là hoàn thành.
Roommate cần state accepted + grant active; pending/revoked không gợi ý như
kết nối đã thành công, không tự đọc/copy contact hay profile vào Housing.

Housing giữ gợi ý chuẩn bị theo trạng thái đã lưu, không từ checkbox/draft.
Nút đa dịch vụ chỉ nhắc về mục tiêu thực sự đang chờ trong kế hoạch.
Khi Map đã có kết quả, bỏ qua chính kết quả đang hiển thị để chọn next step;
không ghi lựa chọn hoặc hoàn thành nghiệp vụ vào backend.

## UX và contract

- Không tự chuyển workspace/chat sau lựa chọn. Form tùy chọn mở trên kết
  quả hiện tại; đóng form giữ kết quả và trả focus về nút gợi ý.
- Chỉ hiện các dịch vụ khả dụng theo `/status` trong chat; cẩm nang luôn
  đọc được. Gợi ý độc lập trong bài viết/Roommate là link đến form ở `/ai`.
- `/ai?service=property|map|flight` chỉ mở form bằng allowlist rồi bỏ query;
  không tạo thread/task hoặc gửi request. Service không hỗ trợ bị bỏ qua.
- Moving → Map điền A/B từ địa chỉ báo giá hiện tại. Không tự suy ra sân bay,
  chỗ ở hoặc địa chỉ từ dữ liệu thiếu.
- Giữ mọi action/select/checkout qua contract cũ. Không thêm API, database,
  LLM call, provider booking hay dependency.
- Gợi ý dùng chung `ServiceSuggestions.tsx`/`serviceSuggestions.css`, tối đa
  hai lựa chọn ở dịch vụ đơn mới. Housing dùng ViewingPreparation hiện có.
- Sáng/tối, VI/EN, control 44px, layout có scope và co vừa 320px.

## Kiểm chứng

- `npm run test:contracts`: **35 qua**, gồm phân biệt đơn/đa theo intent,
  thread cũ, mục lịch sử và task trùng domain.
- `service-followup.spec.ts`, `service-input.spec.ts`,
  `viewing-suggestions.spec.ts`: **44 desktop/mobile qua**.
- Thêm Map khám phá nearby và intent một dịch vụ cùng các tab cũ: **4 ca
  desktop/mobile qua**. Tổng 48 ca liên
  quan trong checkpoint này; không tuyên bố toàn bộ suite cũ đã xanh.
- Fixture kiểm request writes: gợi ý không gửi chat/select/booking/payment
  hoặc yêu cầu liên hệ. Moving map dùng POST đọc tuyến
  `/platform/routes/entities`; loại đúng endpoint read-only này khỏi bộ đếm
  mutation, giữ assertion các request ghi còn lại.
- Kiểm route form đúng A/B, link guide đúng bài, Roommate accepted/pending/
  revoked, không có completion khi Map rỗng/lỗi, label VI/EN, focus restore,
  320/768/1440px và axe WCAG 2/2.1 AA không có violation ở nhóm gợi ý.
- TypeScript + Vite build qua. Các ca browser dùng fixtures, không đặt vé,
  tạo đơn hoặc gửi liên hệ tới người thật. Chưa kiểm deployment cloud/CI mới.

Screenshots/output ở `Frontend/test-results/` (ignored). Cổng local 8503
phục vụ bundle mới; Ctrl+F5 để test. Phạm vi này chưa push vào PR #127.
