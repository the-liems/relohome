# SPEC-008: Bản đồ và dữ liệu POI

Trạng thái: Draft | Phụ trách: @DungMQ | Review/issue cha: nhóm xác nhận sau

## Mục đích và phạm vi

Người dùng mở bản đồ theo TP.HCM, Hà Nội hoặc Đà Nẵng và xem các nhóm POI đã
nhập. MapLibre vẽ basemap và layer tương tác; POI hiển thị được đọc từ PostGIS
qua Platform API. Basemap hiện dùng style OpenFreeMap qua mạng, chưa phải bộ
PMTiles/style tự lưu trữ. Đây là hai nguồn khác nhau.

POI OSM được nhập vào bảng địa điểm chuẩn và bảng nguồn. POI riêng của ReloHome
hoặc partner cũng phải có nguồn và ghi vào PostGIS qua luồng ingest; không sửa
file OSM gốc. Không coi dữ liệu GeoJSON nguồn là bộ POI đã được xác minh.

## Giao diện và hành vi

- UI: [`map-app/src/components/MapView.tsx`](../../examples/map-app/src/components/MapView.tsx).
- API: `POST /v1/places/map`, `GET /v1/places/:placeId`.
- Schema yêu cầu: [`PlaceMapRequestSchema`](../../packages/contracts/src/place.ts);
  nguồn dữ liệu: [`PlaceService`](../../packages/housing-query/src/place-service.ts).
- Request bản đồ phải có bounding box hợp lệ, tối đa 2 độ mỗi trục. API
  từ chối vùng có trên 50.000 địa điểm thay vì âm thầm cắt bớt.

## Lỗi, giới hạn và ngoài phạm vi

API lỗi thì UI báo lỗi, không dùng file chỉ có một nhóm POI để giả làm dữ liệu
đầy đủ. Chi tiết POI không tồn tại trả 404. Basemap cần mạng; không có cam kết
offline. Thiết kế style riêng bằng Maputnik/PMTiles là công việc khác.

## Tiêu chí nghiệm thu

- **SPEC-008/AC-01:** Chọn thành phố hiển thị basemap, POI của vùng đó và
  chuyển thành phố không phải tải lại trang.
- **SPEC-008/AC-02:** Mặc định các nhóm POI cùng xuất hiện; lọc nhóm chỉ đổi
  layer đang thấy, không xóa dữ liệu gốc.
- **SPEC-008/AC-03:** Bounding box thiếu, quá rộng hoặc vượt 50.000 POI được
  báo lỗi rõ; không trả danh sách bị cắt mà không thông báo.
- **SPEC-008/AC-04:** POI trả về có ID chuẩn, category/nhóm và tọa độ;
  dữ liệu nhập riêng giữ thông tin nguồn để truy vết.

Kiểm chứng: [test API](../../apps/platform-api/tests/api.integration.test.ts),
[test UI](../../examples/map-app/tests/relohome.spec.ts).
Quyết định liên quan: [ADR-009](../adr/ADR-009-postgis-poi-nguon-du-lieu.md).
