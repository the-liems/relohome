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

Mỗi task phải giữ contract Housing/Moving/Flight/Roommate hiện tại, có test tập trung và build sạch trước khi đánh dấu hoàn tất.

