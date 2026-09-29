# Mục lục SPEC Maps

Bắt đầu từ [SPEC-007](SPEC-007-location-platform.md) để hiểu toàn cảnh, rồi
đọc đúng phần cần làm. SPEC nói **hệ thống phải làm gì**; ADR nói **vì sao
chọn cách làm**. Phần lớn spec còn `Draft` để nhóm review; SPEC-012 là thiết kế
lịch sử chưa triển khai trong Location. [Status hiện hành](../integration/README.md)
là nơi tra code, kiểm thử và dữ liệu đã xác nhận.

| Cần tìm hiểu | SPEC | API hoặc nơi sử dụng |
|---|---|---|
| Toàn cảnh và ranh giới với agent | [007 - Location Platform](SPEC-007-location-platform.md) | Maps workspace |
| Basemap, POI, nguồn dữ liệu | [008 - Bản đồ và POI](SPEC-008-ban-do-va-poi.md) | `/v1/places/map` |
| Resolve và nearby (chưa có reverse) | [009 - Tìm vị trí](SPEC-009-tim-kiem-va-tien-ich-gan.md) | `/v1/locations/resolve`, `/v1/places/nearby` |
| Tin nhà và commute | [010 - Tìm nhà](SPEC-010-tim-nha-o.md) | `/v1/housing/*` |
| Tuyến A đến B | [011 - Định tuyến](SPEC-011-dinh-tuyen.md) | `/v1/routes` |
| Vùng dịch vụ và giá (thiết kế lịch sử) | [012 - Mobility](SPEC-012-vung-dich-vu-va-gia.md) | Chưa có API Location; thuộc Moving |
| Công cụ cho agent khác gọi | [013 - MCP](SPEC-013-mcp-vi-tri.md) | MCP `stdio` / Streamable HTTP |

**Cách dùng:** khi làm một tính năng, dẫn mã tiêu chí như `SPEC-011/AC-03`
trong Issue/PR/test. Giữ nguyên mã đã có khi bổ sung tiêu chí. Field/giới hạn
chính xác lấy từ Zod tại
[`packages/contracts/src/`](../../Maps%20VN/LifeFlow/packages/contracts/src/),
không chép lại schema vào SPEC. Mẫu cho tính năng mới:
[`_template.md`](_template.md).

Ví dụ "tìm nhà cách BKHN tối đa 2 km đường đi": đọc SPEC-009 để xác định
đúng vị trí, SPEC-010 để lọc nhà, SPEC-011 để hiểu quãng đường OSRM. Không
dùng bán kính PostGIS làm kết luận cuối cùng về quãng đường di chuyển.

SPEC-001 đến SPEC-006 không nằm trong bộ spec Maps này; không suy ra chức năng
agent đã triển khai từ số thứ tự spec.
