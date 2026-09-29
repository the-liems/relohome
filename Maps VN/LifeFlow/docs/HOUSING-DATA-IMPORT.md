# Nhập dữ liệu housing vào LifeFlow

> **Cập nhật chỉ dẫn 2026-09-29:** xem [status triển khai](../../../docs/integration/location-service-implementation-status.md) và [dữ liệu/backup hiện hành](../../../docs/integration/location-data-status.md). Location hiện có 9 tool, housing thật và MCP HTTP có bearer token. Các số liệu, test và kế hoạch trong ghi chép cũ bên dưới thuộc thời điểm viết, không phải thống kê DB của máy mới. ZIP cũ đã xóa; giữ dữ liệu backup riêng với source trong Git.

Tài liệu này mô tả luồng nhập file `housing_clean_2026-09-26.jsonl` vào PostGIS mà không xóa
file nguồn hoặc dữ liệu lịch sử.

## Nguyên tắc an toàn

- Importer chỉ mở file JSONL ở chế độ đọc.
- Payload gốc của từng dòng được lưu trong `integration.source_records`.
- Dữ liệu đã chuẩn hóa được stage trong `integration.housing_staging` theo từng `import_run_id`.
- Chạy lại cùng một file là idempotent: listing, property, unit và media không bị nhân bản.
- Khi giá thay đổi, offer cũ chuyển sang `is_active=false`; bản ghi cũ không bị xóa.
- Listing đã được xác minh `lifeflow_verified` không bị importer ghi đè.
- Tin có cờ `likely_commercial` hoặc `quality.publishable=false` được quarantine, không xuất hiện trên map.
- File nguồn không được commit vào Git hoặc đóng vào Docker image. Luôn giữ file theo phiên bản và checksum.

## Ánh xạ dữ liệu

```text
JSONL source                    PostGIS
source + raw payload       ->  integration.source_records
location + address         ->  catalog.places (housing_anchor)
property_type              ->  housing.properties
unit                       ->  housing.units
listing                    ->  housing.listings
offer                      ->  housing.offers
media                      ->  housing.listing_media
```

`housing.listings.source_type` luôn là `partner`. Tên nhà cung cấp thật được giữ trong
`attributes.provider`, còn khóa nguồn có dạng `nhatot:<source_listing_id>`.

## Chạy lần đầu

Không chạy import khi Docker Desktop chưa hoạt động.

```powershell
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"

npm run db:up
npm run db:migrate

$env:HOUSING_SOURCE_PATH = "D:\DEMO_AI\DEMO_1\Maps VN\Data\housing_clean_2026-09-26.jsonl"
$env:HOUSING_SOURCE_VERSION = "housing-clean-2026-09-26"
npm run db:import:housing
```

Không dùng `docker compose down -v`, `docker volume rm` hoặc xóa file JSONL. Các lệnh đó không cần
thiết cho việc cập nhật dữ liệu.

## Kiểm tra sau import

```sql
SELECT id, status, source_checksum, input_count, accepted_count,
       rejected_count, duplicate_count, published_count, diagnostics
FROM geo.import_runs
WHERE source_type = 'housing_partner'
ORDER BY started_at DESC
LIMIT 5;

SELECT count(*) FROM housing.listings WHERE deleted_at IS NULL;
SELECT count(*) FROM housing.current_offers;
SELECT count(*) FROM housing.listing_media;

SELECT validation_status, count(*)
FROM integration.housing_staging
WHERE import_run_id = '<IMPORT_RUN_ID>'
GROUP BY validation_status;
```

Điều kiện đúng là tổng `accepted + rejected + duplicate + quarantined` bằng `input_count`.

## API bản đồ

Frontend gọi `POST /v1/housing/map` theo bbox và zoom hiện tại. Ở zoom thấp API trả cluster; ở
zoom cao API trả marker listing và thumbnail. Sau khi kéo hoặc zoom, request cũ bị hủy và request mới
được debounce để tránh gây tải thừa cho PostGIS.

Ví dụ:

```json
{
  "bounding_box": {
    "west": 106.60,
    "south": 10.70,
    "east": 106.80,
    "north": 10.90
  },
  "zoom": 13,
  "limit": 1000
}
```

Housing anchor bị loại khỏi `/v1/places/map`, do đó một căn nhà không xuất hiện đồng thời như POI và
housing marker. POI tiện ích vẫn được hiển thị ở layer riêng.

## Cập nhật snapshot mới

1. Không ghi đè file cũ; đặt file mới cạnh file cũ với ngày/version mới.
2. Đổi `HOUSING_SOURCE_PATH` và `HOUSING_SOURCE_VERSION`.
3. Chạy migration rồi chạy importer.
4. Kiểm tra `geo.import_runs` và staging trước khi demo.
5. Chỉ sau khi xác nhận snapshot mới hoạt động mới thay đổi file mặc định trong `.env` của từng máy.

Importer hiện không tự đánh stale các tin vắng mặt trong snapshot mới, vì một file có thể chỉ là
snapshot một phần. Việc đánh stale phải được thực hiện bằng job riêng có TTL và xác nhận snapshot đầy
đủ; tuyệt đối không suy đoán rồi xóa listing cũ.
