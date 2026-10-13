# SPEC-009: Tìm vị trí và tiện ích gần

Trạng thái: Draft | Phụ trách: @DungMQ | Review/issue cha: nhóm xác nhận sau

## Mục đích và phạm vi

Người dùng tìm POI, tên khu vực hoặc địa chỉ; chọn một kết quả rồi tra tiện
ích gần vị trí đó. Autocomplete dùng kết quả vị trí có nguồn, không coi một
chuỗi trùng tên là địa chỉ duy nhất. Reverse geocoding chưa triển khai trong
API/MCP Location hiện tại.

## Giao diện và hành vi

- API: `/v1/places/search`, `/v1/areas/search`,
  `/v1/locations/resolve`,
  `/v1/places/nearby` (đều là POST).
- Schema chuẩn: [location](../../packages/contracts/src/location.ts)
  và [place](../../packages/contracts/src/place.ts).
- Tìm POI có thể lọc category, nguồn, vùng hành chính, bounding box hoặc
  tâm/bán kính. Không gửi đồng thời bounding box và tâm/bán kính.
- Resolve trả nhiều ứng viên có ID, nguồn và mức khớp. Không có endpoint
  `/v1/locations/reverse` hoặc tool `reverse_location`.
- Nearby dùng khoảng cách không gian theo mét từ PostGIS, không suy ra
  travel distance từ bán kính đường chim bay.
- `find_nearby_places` hiện chọn một POI gần nhất cho mỗi category; muốn trả
  nhiều POI trong X km **đường đi** cần lọc sơ bộ PostGIS rồi kiểm tra/rank
  ứng viên bằng OSRM, với giới hạn số route và trạng thái thiếu graph rõ ràng.

## Lỗi, giới hạn và ngoài phạm vi

Input trống/sai hoặc bán kính vượt giới hạn schema trả lỗi validation.
Không có kết quả thì trả danh sách rỗng, không dựng địa chỉ.
Tìm kiếm không phải dịch vụ geocoding toàn quốc với độ phủ Google Maps.

## Tiêu chí nghiệm thu

- **SPEC-009/AC-01:** Tìm chữ cho gợi ý POI/khu vực trong giới hạn và giữ ID
  chuẩn, nguồn, mức khớp để người dùng phân biệt kết quả cùng tên.
- **SPEC-009/AC-02 (chưa triển khai, ngoài phạm vi đợt này):** Reverse cho biết mức chính xác; thiếu địa chỉ thực thì
  không hiển thị một địa chỉ suy đoán là chính xác.
- **SPEC-009/AC-03:** Nearby lọc theo category và ngưỡng mét; các ngưỡng
  invalid bị từ chối, không biến thành truy vấn không giới hạn.
- **SPEC-009/AC-04:** Không có kết quả là trạng thái rỗng hợp lệ; lỗi API
  được phân biệt với trạng thái rỗng.

Kiểm chứng: [test API](../../apps/platform-api/tests/api.integration.test.ts),
[test contracts](../../packages/contracts/tests/contracts.test.ts).
Quyết định liên quan: [ADR-009](../adr/ADR-009-postgis-poi-nguon-du-lieu.md).
