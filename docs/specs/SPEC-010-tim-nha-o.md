# SPEC-010: Tìm nhà ở theo điều kiện không gian

Trạng thái: Draft | Phụ trách: @DungMQ | Review/issue cha: nhóm xác nhận sau

## Mục đích và phạm vi

Tìm tin nhà ở thực tế theo giá, loại nhà, khu vực, tiện ích gần và giới hạn
đi lại. Kết quả dùng để hiển thị marker/card; Housing Query không tự xếp hạng
hay đưa ra lời khuyên nên thuê căn nào. Kho đã có pipeline nhập tin thật.
Độ phủ và độ mới phải được đánh giá theo snapshot trên DB triển khai.

## Giao diện và hành vi

- API: `POST /v1/housing/search`, `GET /v1/housing/:listingId`.
- Schema chuẩn: [`housing.ts`](../../packages/contracts/src/housing.ts);
  xử lý: [`housing-service.ts`](../../packages/housing-query/src/housing-service.ts).
- Điều kiện gần tiện ích được kiểm tra bằng PostGIS. Với commute, PostGIS
  lấy ứng viên trước, OSRM kiểm tra distance/duration theo profile sau;
  điều kiện commute không được thay bằng khoảng cách Euclid.
- Bộ lọc bắt buộc phải được áp dụng trước khi trả kết quả. Nếu một ứng viên
  không thể xác minh điều kiện gần/commute, không coi nó là đã khớp.
- Kết quả có cursor. Trang rỗng vẫn có thể có cursor tiếp theo nếu còn
  ứng viên chưa kiểm tra hết trong giới hạn quét.
- Search/detail trả `location_accuracy` (`rooftop`, `approximate`, `unknown`),
  `location_method` nullable và `deposit: {amount, currency} | null`.
  Thiếu tiền cọc là `null`, không phải miễn cọc. Xem
  [handoff](../integration/location-service-implementation-status.md).

## Lỗi, giới hạn và ngoài phạm vi

Ngưỡng min/max sai, hai hệ tiền/chu kỳ giá không khớp hoặc yêu cầu commute
thiếu max distance/duration phải bị từ chối. OSRM không khả dụng không được
biến một điều kiện commute thành khớp giả. Nhập tin qua pipeline riêng;
định giá bất động sản và recommendation không thuộc các tool truy vấn.

## Tiêu chí nghiệm thu

- **SPEC-010/AC-01:** Chỉ trả tin từ PostGIS khớp các điều kiện bắt buộc;
  không có dữ liệu thì UI hiện trạng thái rỗng, không tạo marker giả.
- **SPEC-010/AC-02:** Nearby của nhà dùng khoảng cách không gian; thiếu
  bằng chứng khớp thì ứng viên bị loại khỏi kết quả có điều kiện gần.
- **SPEC-010/AC-03:** Commute dùng kết quả OSRM thật để lọc min/max distance
  hoặc duration sau bước tìm ứng viên; không dùng Euclid làm travel distance.
- **SPEC-010/AC-04:** Cursor cho phép đọc tiếp khi còn ứng viên dù trang
  hiện tại rỗng do lọc cứng.

Kiểm chứng: [test housing](../../packages/housing-query/tests/housing-query.integration.test.ts),
[test API](../../apps/platform-api/tests/api.integration.test.ts).
Quyết định liên quan: [ADR-009](../adr/ADR-009-postgis-poi-nguon-du-lieu.md),
[ADR-010](../adr/ADR-010-osrm-routing.md).
