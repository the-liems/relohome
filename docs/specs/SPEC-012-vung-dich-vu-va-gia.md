# SPEC-012: Vùng dịch vụ và ước tính giá

Trạng thái: Đề xuất lịch sử, chưa triển khai trong Location hiện tại.

**Cập nhật 2026-09-29:** các API/tool/module mobility mô tả bên dưới không
có trong registry Location hiện tại. Vùng phục vụ và báo giá đối tác thuộc
phần Moving. Các liên kết module/test bên dưới là đường dẫn dự kiến của
thiết kế cũ, không phải file đã tồn tại. Xem
[trạng thái triển khai Location](../integration/location-service-implementation-status.md).

## Mục đích và phạm vi

Cho phép hỏi một tuyến có nằm trong vùng phục vụ đã lưu hay không; nếu là
dịch vụ nội bộ ReloHome và có biểu giá hiệu lực thì trả ước tính từ tuyến
OSRM. Đây là khả năng sẵn sàng tích hợp, **không phải** kết nối báo giá trực
tiếp với Ahamove hoặc Grab.

## Giao diện và hành vi

- API: `POST /v1/mobility/service-area` và `POST /v1/mobility/estimate`.
- Schema chuẩn: [`mobility.ts`](../../packages/contracts/src/mobility.ts);
  service: [`mobility-service.ts`](../../packages/housing-query/src/mobility-service.ts).
- Một polygon hợp lệ phải chứa **cả điểm đi và điểm đến**. Không có cấu
  hình trả `not_configured`; có vùng nhưng không phủ cả hai trả `unavailable`.
- Chỉ `provider=lifeflow` được tính giá khi có vùng, rule còn hiệu lực và
  route OSRM; kết quả nêu `pricing_source` và phiên bản rule.

## Lỗi, giới hạn và ngoài phạm vi

Vùng hết hạn hoặc bị tắt không được dùng. Có vùng partner không đồng nghĩa có
API báo giá được cấp quyền: estimate Ahamove/Grab vẫn `not_configured` và
`amount_vnd=null`. Chưa có adapter, đồng bộ vùng động hay cam kết giá đối tác.

## Tiêu chí nghiệm thu

- **SPEC-012/AC-01:** Phân biệt `available`, `unavailable`,
  `not_configured` theo dữ liệu vùng còn hiệu lực và cả hai đầu tuyến.
- **SPEC-012/AC-02:** Chỉ giá ReloHome hợp lệ mới dùng OSRM và rule version;
  thiếu rule trả `not_configured`, không tạo số tiền mặc định.
- **SPEC-012/AC-03:** Ahamove/Grab không trả tiền ước tính hoặc coi dữ liệu
  vùng là báo giá từ đối tác.
- **SPEC-012/AC-04:** Thất bại OSRM khi cần tính giá được báo lỗi, không suy
  ra giá từ khoảng cách Euclid.

Kiểm chứng: [test mobility](../../packages/housing-query/tests/mobility-service.test.ts).
Quyết định liên quan: [ADR-011](../adr/ADR-011-ranh-gioi-gia-doi-tac.md).
