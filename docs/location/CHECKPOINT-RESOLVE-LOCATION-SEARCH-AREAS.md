# Checkpoint: resolve_location và search_areas

> Historical record: paths, names, commands and measured results below describe the original checkout. For current operation use the [ReloHome location guide](README.md) and [local runbook](../runbooks/local-mvp.md).

> **Tài liệu khảo sát/thiết kế lịch sử — không dùng làm status hiện hành.**
>
> **Cập nhật chỉ dẫn 2026-09-29:** xem [status triển khai](../integration/location-service-implementation-status.md) và [dữ liệu/backup hiện hành](../integration/location-data-status.md). Location hiện có 9 tool, housing thật và MCP HTTP có bearer token. Các số liệu, test và kế hoạch trong ghi chép cũ bên dưới thuộc thời điểm viết, không phải thống kê DB của máy mới. ZIP cũ đã xóa; giữ dữ liệu backup riêng với source trong Git.

## Thời điểm dừng

- Ngày: 2026-09-24
- Trạng thái: hoàn thành ngày 2026-09-24
- Yêu cầu: thêm hai MCP tool local `resolve_location` và `search_areas`
- Nguyên tắc: dùng dữ liệu PBF đang sở hữu, không phụ thuộc dịch vụ geocoding công khai

## Mục tiêu

### `search_areas`

Tìm khu hành chính theo tên và trả:

- Canonical area ID
- Tên và cấp hành chính
- Khu vực cha nếu xác định được
- Tâm đại diện
- Bounding box
- OSM source ID
- Mức độ khớp tên

Area ID có thể được đưa vào `administrative_area_ids` để lọc chính xác bằng
`ST_Covers`, thay vì dùng vòng tròn gần đúng.

### `resolve_location`

Tìm một tên địa điểm trong cả:

- `catalog.places`
- `geo.administrative_areas`

Tool trả nhiều ứng viên có cấu trúc để LLM chọn đúng ứng viên, không tự khẳng
định một kết quả mơ hồ là chắc chắn.

## Việc đã hoàn thành

### 1. Kiểm tra nền hiện có

- `geo.administrative_areas` đã tồn tại.
- PostGIS và `pg_trgm` đã được bật.
- `search_housing` đã hỗ trợ `administrative_area_ids`.
- `search_places` hiện chưa hỗ trợ `administrative_area_ids`.
- Ubuntu-24.04 đã có `/usr/bin/osmium`.
- Docker image hiện có không chứa Osmium; dùng WSL là phù hợp.

### 2. Chọn nguồn dữ liệu

Không tích hợp public Nominatim vào runtime vì:

- Dịch vụ công khai giới hạn tối đa 1 request/giây.
- Phải có User-Agent, attribution và cache.
- Không phù hợp để làm geocoder chung cho sản phẩm hoặc tải dữ liệu hệ thống.

Giải pháp đã chọn là trích trực tiếp từ:

```text
D:\Demo AI thực chiến\Maps VN\Raw\vietnam-260922.osm.pbf
```

File nguồn chỉ được đọc, không bị thay đổi.

### 3. Artifact đã tạo

```text
D:\Demo AI thực chiến\Maps VN\LifeFlow\data\administrative\vietnam-admin.osm.pbf
D:\Demo AI thực chiến\Maps VN\LifeFlow\data\administrative\vietnam-admin.geojsonseq
```

Lệnh lọc đúng đã dùng:

```bash
osmium tags-filter vietnam-260922.osm.pbf \
  r/boundary=administrative \
  -t \
  -o vietnam-admin.osm.pbf \
  --overwrite
```

`-t` rất quan trọng: nó xóa tag khỏi node/way chỉ được kéo vào để hoàn thiện
relation. Nếu thiếu `-t`, Osmium export sẽ xuất thêm đảo, rừng và nhiều polygon
không phải ranh giới hành chính.

Lệnh export cuối:

```bash
osmium export vietnam-admin.osm.pbf \
  --geometry-types=polygon \
  --add-unique-id=type_id \
  --output-format=geojsonseq \
  -o vietnam-admin.geojsonseq \
  --overwrite
```

`--add-unique-id=type_id` giữ OSM relation ID để truy ngược nguồn.

### 4. Thống kê trước lần export thêm source ID

Artifact đã lọc có:

| Chỉ số | Giá trị |
|---|---:|
| Tổng polygon hành chính | 8.732 |
| `admin_level=0` | 1 |
| `admin_level=4` | 33 |
| `admin_level=6` | 3.322 |
| `admin_level=8` | 27 |
| `admin_level=9` | 5.331 |
| Không có admin level | 18 |
| Kích thước GeoJSON sequence | khoảng 93 MB |

Lần export cuối chỉ bổ sung source ID nên số feature dự kiến không đổi, nhưng
cần kiểm tra lại trước khi import.

### 5. Phát hiện liên quan Gò Vấp

Trong PBF ngày 2026-09-22 không còn polygon quận cũ tên chính xác `Gò Vấp`.
Dữ liệu hiện có các khu hành chính mới:

- `Phường Gò Vấp`
- `Phường Hạnh Thông`
- `Phường Thông Tây Hội`
- `Phường An Hội Đông`

Vì vậy:

- Query `Gò Vấp` nên ưu tiên `Phường Gò Vấp` nếu người dùng nói theo đơn vị hiện hành.
- Nếu người dùng muốn phạm vi quận Gò Vấp cũ, cần dataset ranh giới lịch sử hoặc alias/legacy area riêng.
- Không được âm thầm coi một phường mới là toàn bộ quận cũ.

## Trạng thái sau khi tiếp tục

- Đã áp dụng migration `005_administrative_area_search.sql`.
- Đã nhập 8.732 ranh giới OSM, không có bản ghi bị từ chối.
- Đã giữ nguyên ba boundary `local_boundary`.
- Đã thêm contract và `LocationService`.
- Đã thêm endpoint `/v1/areas/search` và `/v1/locations/resolve`.
- Đã đăng ký `search_areas` và `resolve_location`; MCP hiện có tám tool.
- Đã mở rộng `search_places` với `administrative_area_ids`.
- Đã kiểm tra contract, query, API và MCP stdio.
- Đã tạo backup PostgreSQL trước migration/import.

## Thiết kế cần triển khai tiếp

### Migration `005_administrative_area_search.sql`

1. Bật extension `unaccent`.
2. Tạo hàm chuẩn hóa tên immutable, ví dụ `geo.normalize_search(text)`.
3. Tạo GIN trigram index trên tên khu vực đã chuẩn hóa.
4. Tạo B-tree index cho `level`, `source`, `source_id`.
5. Giữ GiST index trên `geom`.
6. Có thể thêm `parent_id`; nếu thêm phải suy ra bằng quan hệ không gian.

### Importer

Tạo:

```text
platform-api/src/import-admin-areas.ts
```

Yêu cầu:

- Đọc GeoJSON sequence theo ký tự Record Separator `0x1E`, không đọc như JSONL thường.
- Chỉ nhận feature có `boundary=administrative`.
- Dùng ID ổn định dạng `osm:relation:<id>`.
- Lưu toàn bộ properties vào `attributes`.
- Dùng `ST_Multi(ST_CollectionExtract(ST_MakeValid(...), 3))`.
- Upsert theo `source='osm'` và `source_id`.
- Không xóa các area `local_boundary` hiện có.
- Ghi import run, accepted/rejected và checksum.

### Contract

Thêm file:

```text
packages/contracts/src/location.ts
```

Schema dự kiến:

- `SearchAreasRequestSchema`
- `AdministrativeAreaSchema`
- `ResolveLocationRequestSchema`
- `ResolvedLocationSchema`

Không dùng một “confidence” giả. Nên trả:

- `match_type`: `exact | prefix | contains | fuzzy`
- `match_score`: độ tương đồng factual từ PostgreSQL

### Service

Thêm:

```text
packages/housing-query/src/location-service.ts
```

`searchAreas`:

- Tìm không dấu và không phân biệt hoa thường.
- Cho phép lọc `levels`, bounding box và giới hạn kết quả.
- Xếp exact trước, prefix, contains, rồi similarity.
- Trả center bằng `ST_PointOnSurface`.
- Trả bounding box từ `ST_Extent`/Box2D.
- Có thể suy parent bằng area chứa tâm và có admin level cha.

`resolveLocation`:

- Tìm song song trong canonical places và administrative areas.
- Cho phép giới hạn theo category, bbox hoặc near/radius.
- Trả nhiều ứng viên, entity type và canonical ID.
- Không gọi Internet.

### Mở rộng `search_places`

Thêm `administrative_area_ids` vào `PlaceSearchRequestSchema`.

SQL:

```sql
EXISTS (
  SELECT 1
  FROM geo.administrative_areas area
  WHERE area.id = ANY($ids)
    AND ST_Covers(area.geom, p.geom)
)
```

Nhờ đó luồng chính xác sẽ là:

```text
search_areas("Phường Gò Vấp")
→ lấy area_id
→ search_places(categories=["hotel"], administrative_area_ids=[area_id])
```

### API

Thêm:

```text
POST /v1/areas/search
POST /v1/locations/resolve
```

### MCP

Đăng ký:

```text
search_areas
resolve_location
```

Cả hai là:

- `readOnlyHint: true`
- `idempotentHint: true`
- `openWorldHint: false`

Sau thay đổi, MCP có tổng cộng tám tool.

## Test bắt buộc

1. `search_areas("Gò Vấp")` trả ít nhất `Phường Gò Vấp`.
2. Tìm không dấu `go vap` vẫn trả kết quả tiếng Việt.
3. Tìm `Hà Nội` không bị lẫn với khu vực cùng tên ở nơi khác khi có bbox.
4. `resolve_location` tìm được cả administrative area và canonical place.
5. Kết quả mơ hồ trả nhiều ứng viên, không tự chọn sai.
6. `search_places` với area ID chỉ trả điểm nằm trong polygon.
7. MCP client liệt kê đủ tám tool.
8. Gọi hai tool mới qua MCP `stdio` thành công.
9. API input sai trả `VALIDATION_ERROR`.
10. Kiểm tra spatial/trigram index bằng `EXPLAIN` khi phù hợp.

## Thứ tự tiếp tục đề xuất

1. Kiểm tra lại feature count và OSM ID của artifact export cuối.
2. Tạo migration 005.
3. Viết importer và nhập area.
4. Kiểm tra `Phường Gò Vấp` trực tiếp trong PostGIS.
5. Viết contract và service.
6. Mở rộng `search_places`.
7. Thêm API và MCP tool.
8. Thêm test contract/query/API/MCP.
9. Build và chạy toàn bộ test.
10. Restart LifeFlow và gọi thử tool thật.
11. Cập nhật README và hồ sơ triển khai.
12. Tạo backup PostGIS mới.

## Lưu ý về thời gian và phạm vi

Hai tool local này có thể hoàn thiện trong phiên làm việc tiếp theo vì artifact
ranh giới đã được tạo. Để đạt đầy đủ như Google Maps còn cần:

- Dữ liệu địa chỉ, đường, số nhà và POI đa loại
- Geocoder/index chuyên dụng hoặc Nominatim tự host
- Reverse geocoding
- Alias, tên cũ và xử lý địa danh mơ hồ
- Dữ liệu cập nhật liên tục
- Traffic, transit, review và dữ liệu doanh nghiệp

Checkpoint hiện tại chỉ nhắm đến hai tool local, chính xác, truy nguồn được và
phù hợp với kiến trúc LifeFlow.
