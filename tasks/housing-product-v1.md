# Housing Product V1 — Implementation checklist

- [x] HP-01: additive schema + migration tests
- [x] HP-02: Landlord contracts and authorization service
- [x] HP-03: property/unit/listing/offer/fee/media write API
- [x] HP-04: publication, availability and moderator workflow
- [x] HP-05: tenant contact request + landlord inbox
- [x] HP-06: real analytics events + overview counters
- [x] HP-07: browser gateway and secure image upload
- [x] HP-08: Tenant cost calculator, shortlist and contact UX
  - Chi phí chỉ dùng phí chủ nhà công bố và số liệu người thuê tự nhập; khoản thiếu là "Chưa rõ", không tính 0.
  - Tách phí bắt buộc, tùy chọn và một lần; cần chuẩn bị khi vào ở = cọc + tháng đầu + phí một lần.
  - So sánh 2–4 căn đã lưu trong Tài khoản; tab "Liên hệ chủ nhà" xem và hủy yêu cầu (`new`/`contacted`).
- [x] HP-09: Landlord workspace responsive UI
  - Bộ sửa phí linh hoạt (để trống = chưa rõ), xóa tin, từ chối yêu cầu, lý do trả lại, tìm tọa độ từ địa chỉ.
  - Tab "Duyệt tin" chỉ hiện với tài khoản trong `HOUSING_MODERATOR_IDS`; không tự duyệt địa điểm/tin mình quản lý.
- [x] HP-10: Agent/read compatibility, tests and full regression
  - Tin tự đăng dùng `source.type = user` (attributes `self_service`) để khớp contract đọc hiện có.
  - Test tích hợp `platform-api/tests/housing-management.integration.test.ts` cho AC-01/02/03/05/06 trên PostGIS thật.
  - Trạng thái `viewing` của yêu cầu liên hệ chỉ dẫn người thuê sang luồng Kế hoạch → Xem nhà.

- [x] HP-11: Chế độ chủ nhà trên cùng tài khoản ([host-mode-design](../docs/review/host-mode-design.md))
  - Nút chuyển chế độ trên header; lần đầu khai hồ sơ người đăng; kiểm duyệt xác minh thủ công (pilot).
  - Chưa làm: điều khoản người đăng (bật bằng `HOST_TERMS_VERSION`), tạm khóa người đăng, xác minh điện tử.

- [x] HP-12: Lịch xem ở tab "Xem nhà" gửi tới chủ nhà và chờ xác nhận ([viewing-landlord-confirmation](../docs/review/viewing-landlord-confirmation.md))
- [x] HP-13: Chủ nhà phải xác nhận giờ thì người thuê mới ghi kết quả và chốt; tin nhắn giữa hai bên trên từng yêu cầu
- [x] HP-14: Đánh giá chủ nhà 1–5 sao theo mục 14 ([housing-feedback-design](../docs/review/housing-feedback-design.md))
  - Người đã liên hệ đánh giá theo property, sửa/rút, tổng hợp điểm thật và histogram; chủ nhà trả lời/báo cáo; moderator ẩn/giữ và rà soát cờ nhiều nhà/nhiều tác giả.
  - Migration 018, bảo vệ danh tính, projection Agent chỉ có điểm tổng hợp, UI desktop/mobile/VI/EN; RV-01..07 có tests PostGIS.
  - Các ý tưởng phản hồi phức tạp ở mục 1–13 (Bayes/ML/LLM, tự xử lý tin) vẫn là mở rộng, không thuộc task này.
- [x] HP-12 regression: hủy lịch rồi đặt lại cùng giờ gửi yêu cầu mới cho chủ nhà; lịch còn mở giữ câu trả lời.

Mỗi task phải giữ contract Housing/Moving/Flight/Roommate hiện tại, có test tập trung và build sạch trước khi đánh dấu hoàn tất.

