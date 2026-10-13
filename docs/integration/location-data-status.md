# Location — dữ liệu, snapshot và backup

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Cập nhật tài liệu: **29/09/2026**. Số liệu dưới đây có mốc đo riêng.
Lượt đồng bộ tài liệu này kiểm tra file/report/đường dẫn, **không chạy lại import,
restore hoặc đếm lại DB**. Bằng chứng DB/test ngày 29/09 đến từ lượt triển khai
ngay trước đó, chi tiết tại [status triển khai](location-service-implementation-status.md).

## 1. Phân biệt các số đếm

| Số liệu | Nguồn/mốc | Ý nghĩa và giới hạn |
|---|---|---|
| 13.120 input, 13.118 canonical | Import accommodation ban đầu, 24/09 | Baseline lịch sử trước POI v2; không phải tổng POI hiện hành |
| 156.276 input = 152.206 accepted + 4.070 rejected | Báo cáo POI v2, 24/09 | Số bản ghi nguồn/staging, không phải số POI sau gộp nguồn |
| 152.044 canonical active | Báo cáo POI v2, 24/09 | Snapshot catalog tại thời điểm trước housing; không áp nguyên số này cho catalog sau import housing |
| HCM 34.322; Hà Nội 32.022; Đà Nẵng 8.414 | Bbox bản đồ của báo cáo POI v2, 24/09 | Không phải tổng toàn quốc, không phải số nhà, không phải địa giới hành chính |
| 38.930 dòng nguồn housing | JSONL 26/09 đã khảo sát | Số dòng trước lọc/validation; không phải số listing đang publish |
| 38.222 listing tổng | Dump đã restore thử trong lượt bàn giao trước | Bao gồm nhiều loại/trạng thái; không đồng nghĩa tin thuê còn hiệu lực |
| 190.266 hàng catalog tổng | Cùng dump restore thử | Gồm POI và housing anchor; không gọi toàn bộ là tiện ích |
| HCM 28.947; Hà Nội 4.910; Đà Nẵng 3.284 | Query DB local 29/09, trong bbox routing | Active rent + offer VND/month, listing/property/place không deleted, place active; không phải thống kê theo nhãn địa chỉ nguồn |

Báo cáo POI gốc: [poi-coverage-v2.json](../../eval/location/poi-coverage-v2.json),
`generated_at=2026-09-24T15:53:09.652Z`. Không đổi ngày report cũ để làm nó trông như vừa chạy.
Con số 34.322 giải thích bbox HCM của snapshot đó; số UI hôm nay còn phụ thuộc
viewport/bộ lọc và DB thực tế. Không kết luận mất dữ liệu chỉ từ chênh lệch hai số khác phạm vi.

Housing anchor là điểm định vị gắn với nhà trong `catalog.places`, có
`attributes.entity_role='housing_anchor'`. API POI loại điểm này ra; nhà có API riêng.
Listing là tin đăng, property là bất động sản, offer là giá/điều kiện hiệu lực.
Một `place_id`, `property_id`, `listing_id` không được dùng thay nhau.

**Lưu ý khi tạo report mới:** script `platform-api/src/report-poi-coverage.ts`
hiện đếm catalog và coverage chưa loại `housing_anchor`. Sau khi nhập housing,
không gọi số tổng của script đó là tổng tiện ích. Dùng SQL phân loại bên dưới
để báo cáo POI riêng; không ghi đè snapshot cũ rồi so sánh như cùng phạm vi dữ liệu.

## 2. Dữ liệu đang giữ trên máy này

Đường dẫn tương đối tính từ root repo:

| File/thư mục | Trạng thái kiểm tra file 29/09 |
|---|---|
| `Maps VN/Data/housing_clean_2026-09-26.jsonl` | Có, 168.752.543 byte; nguồn housing theo phiên bản |
| `Maps VN/LifeFlow/backups/Leader-LifeFlow-Updateable-2026-09-29/database/lifeflow.dump` | Có, 532.892.879 byte; custom-format dump đã restore thử trong lượt trước |
| `Maps VN/LifeFlow/backups/Leader-LifeFlow-Updateable-2026-09-29/Data/` | Dữ liệu nguồn trong bộ backup |
| Cùng thư mục backup: `Cities/`, `Raw/`, `Routing/` | Nguồn không gian và graph, phục vụ chạy/cập nhật về sau |
| Cùng thư mục backup: `SHA256SUMS.txt` | Manifest checksum để kiểm tra sau chuyển file |
| `Maps VN/LifeFlow/backups/*.dump` | 5 dump lịch sử 24/09; không mặc định chứa housing mới |

Không có ZIP bàn giao hiện hành. Thư mục `Leader-LifeFlow-Updateable-2026-09-29`
hiện chỉ có `Cities`, `Data`, `database`, `Raw`, `Routing`, `SHA256SUMS.txt`.
Không còn source/deploy/README trong bộ data đó. Source, Dockerfile và hướng dẫn
deploy lấy từ repo; gửi riêng data theo kênh lưu trữ của nhóm. Các file data lớn
bị Git ignore, nên clone repo không tự có dump/JSONL/graph.

Lượt này chỉ kiểm tra sự tồn tại/kích thước, không tính lại toàn bộ checksum của
bộ backup. Sau khi chuyển file, kiểm tra theo manifest ở chính thư mục gốc bộ backup.
Không dùng một dump POI cũ để kết luận hệ thống chưa nhập housing.

## 3. Kiểm tra dữ liệu trên máy leader

Kết nối **DB đích** bằng cấu hình của môi trường đó rồi chạy các truy vấn chỉ đọc
dưới đây. Không đưa password/connection string vào báo cáo chia sẻ.

```sql
-- Không cộng housing anchor vào số tiện ích.
SELECT
  count(*) AS catalog_all_rows,
  count(*) FILTER (
    WHERE status = 'active' AND deleted_at IS NULL
      AND COALESCE(attributes->>'entity_role', '') <> 'housing_anchor'
  ) AS active_poi,
  count(*) FILTER (
    WHERE status = 'active' AND deleted_at IS NULL
      AND attributes->>'entity_role' = 'housing_anchor'
  ) AS active_housing_anchors
FROM catalog.places;

SELECT status, listing_type, count(*) AS listing_count
FROM housing.listings
WHERE deleted_at IS NULL
GROUP BY status, listing_type
ORDER BY status, listing_type;

-- Cùng định nghĩa bbox routing với số housing local 29/09 ở trên.
WITH boxes(city, west, south, east, north) AS (VALUES
  ('hcm', 106.34, 10.34, 107.05, 11.20),
  ('hanoi', 105.28, 20.55, 106.04, 21.40),
  ('danang', 107.78, 15.88, 108.42, 16.30)
)
SELECT b.city, count(*) AS active_rent_vnd_month
FROM boxes b
JOIN catalog.places cp ON ST_Intersects(cp.geom,
  ST_MakeEnvelope(b.west, b.south, b.east, b.north, 4326))
JOIN housing.properties p ON p.place_id = cp.id
JOIN housing.listings l ON l.property_id = p.id
JOIN housing.current_offers o ON o.listing_id = l.id
WHERE cp.status = 'active' AND cp.deleted_at IS NULL
  AND p.deleted_at IS NULL AND l.status = 'active' AND l.deleted_at IS NULL
  AND l.listing_type = 'rent' AND o.currency = 'VND' AND o.price_period = 'month'
GROUP BY b.city ORDER BY b.city;

SELECT id, source_type, source_version, status, started_at,
       input_count, accepted_count, rejected_count, duplicate_count, published_count
FROM geo.import_runs
ORDER BY started_at DESC LIMIT 10;
```

Ghi kèm ngày query, môi trường, phiên bản source/dump và checksum khi trao đổi số liệu.
Bbox routing có thể khác bbox UI và nhãn city trong JSONL; dùng cùng điều kiện
nếu muốn so sánh hai DB. Offer có thời hạn nên số active có thể đổi theo thời điểm query.

Sau restore/import: gọi `tools/list` (9 tool), `search_housing`, `get_housing`,
`search_places`, `search_areas` và route mẫu từng city/profile.
`/healthz` sống không chứng minh dữ liệu đã nạp; `/readyz` không thay thế kiểm tra
chất lượng dữ liệu và đủ 9 graph. Migration chỉ tạo schema, không tự nhập nguồn.

## 4. Ý nghĩa dữ liệu trả cho Graph

- `deposit: null` = thiếu thông tin cọc; không phải miễn cọc.
- `location_accuracy: approximate/unknown` = không khẳng định tọa độ cửa nhà.
- `active` = trạng thái dữ liệu, không phải chủ nhà vừa xác nhận còn trống.
- Thiếu amenity trong mảng có thể là chưa khai báo; không tự gán có tiện ích.
- `source.observed_at`, thời gian import và thời gian xác minh là các mốc khác nhau.
- Chưa áp TTL/stale mới. Việc nguồn ngừng xuất hiện trong snapshot một phần
  không đủ để tự xóa hoặc làm stale toàn bộ listing.
- OSRM dùng graph đã lưu, không phải thời gian giao thông trực tiếp; bbox không
  bảo đảm mọi tọa độ đều có đường trong snap radius.

## 5. Trạng thái kiểm chứng và vận hành

Lượt triển khai 29/09: build/Docker pass, **93 test pass, 9 test POI chuyên biệt skip**,
9 route mẫu thành phố/profile pass; các góc biên thử trả `NO_ROUTE`.
Checkpoint 24/09 ghi 9 test POI pass là bằng chứng của **lần chạy khác**.
Không gọi lần kiểm thử hiện tại là toàn bộ test POI đã chạy lại.

Cuối lượt kiểm thử trước, PostGIS/chín OSRM đã dừng lại theo trạng thái ban đầu;
container MCP thử đã xóa. Đây là lịch sử thao tác, không phải health check thời gian thực.
Leader phải khởi động dịch vụ và kiểm tra runtime của mình. Chưa xác nhận deploy
VM/cloud hoặc end-to-end Graph; không có công bố dữ liệu tự đồng bộ giữa hai máy.

Hướng dẫn liên quan: [deploy MCP](../location/MCP-CONTAINER-HANDOFF.md),
[import housing](../location/HOUSING-DATA-IMPORT.md),
[contract/lỗi/test](location-service-implementation-status.md).
