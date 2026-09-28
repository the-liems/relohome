# ADR-009: PostGIS là nguồn truy vấn vị trí chuẩn

Ngày: 2026-09-25  
Trạng thái: Proposed (chờ nhóm duyệt)  
Người đề xuất: @DungMQ | Review: người phụ trách dữ liệu/API

## Bối cảnh

OSM/GeoJSON là dữ liệu đầu vào; LifeFlow còn cần POI riêng, địa giới, tin nhà
và nguồn gốc bản ghi. Frontend phải hiển thị cùng các nhóm POI và lọc theo
không gian. Basemap là vấn đề vẽ nền, không phải kho dữ liệu nghiệp vụ.

## Các phương án

1. Frontend đọc trực tiếp nhiều GeoJSON và tự ghép/tìm kiếm: dễ demo nhưng
   khó quản lý nguồn, cập nhật và truy vấn theo bán kính.
2. Ghi dữ liệu chuẩn vào PostGIS; API/MCP truy vấn từ đó, MapLibre chỉ vẽ.

## Quyết định đề xuất

Chọn phương án 2. POI trong `catalog.places` đi kèm nguồn trong
`catalog.place_sources`; nhà và service area ở schema riêng. Importer
không sửa OSM gốc. MapLibre nhận dữ liệu đã truy vấn, còn style basemap
hiện được lấy qua OpenFreeMap.

## Lý do

PostGIS hỗ trợ lọc không gian, ID chuẩn và truy nguồn thống nhất cho API,
UI và MCP. Tách dữ liệu nghiệp vụ khỏi basemap giúp thêm POI LifeFlow/partner
mà không phải xuất lại bản đồ nền.

## Hệ quả

Ứng dụng cần PostGIS và quy trình import/migration. Request map phải có
bounding box/giới hạn để không đẩy toàn bộ dữ liệu một lần. Style/PMTiles
tự lưu trữ vẫn là việc tương lai, không phải tính năng đã có.

Liên quan: [SPEC-008](../specs/SPEC-008-ban-do-va-poi.md),
[SPEC-009](../specs/SPEC-009-tim-kiem-va-tien-ich-gan.md),
[SPEC-010](../specs/SPEC-010-tim-nha-o.md).
