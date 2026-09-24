# Nền tảng bản đồ và vị trí LifeFlow

LifeFlow hiện có một nền tảng dữ liệu vị trí chạy cục bộ, được xây dựng từ dữ
liệu OSM, OSRM và dữ liệu lưu trú sẵn có. Hệ thống gồm:

- PostgreSQL 16 và PostGIS 3.5 chạy trong Docker volume riêng.
- Kho địa điểm chuẩn hóa, có thể truy ngược về nguồn.
- Mô hình dữ liệu tách riêng bất động sản, căn/phòng, tin đăng và báo giá.
- Dịch vụ Housing Query có kiểu dữ liệu rõ ràng và lọc cứng bằng PostGIS.
- Platform API chạy tại `127.0.0.1:4100`.
- Tám MCP tool chỉ đọc, giao tiếp qua `stdio`.
- Ứng dụng MapLibre chạy tại `127.0.0.1:5173`.
- Chín dịch vụ OSRM: ba thành phố nhân với ba chế độ ô tô, xe máy và đi bộ.
- GeoJSON gốc vẫn được giữ làm phương án dự phòng cho frontend.

Nguồn hiện tại có 13.120 POI. Sau khi chuẩn hóa, hệ thống lưu 13.118 địa điểm
chuẩn và ghi nhận hai mã nguồn bị trùng. Hiện chưa có nguồn tin đăng nhà ở thật,
vì vậy truy vấn nhà ở trả về danh sách rỗng thay vì tự tạo dữ liệu giả.
PostGIS còn lưu 8.732 ranh giới hành chính OSM có ID truy nguồn, bên cạnh ba
boundary thành phố cục bộ.

## Cấu trúc dữ liệu routing

```text
Maps VN/
  Raw/                              PBF gốc, không chỉnh sửa
  Routing/
    source/
      vietnam-260922.osm.pbf        Bản nguồn toàn quốc dùng cho routing
    hcm/
      driving/                      Graph ô tô TP.HCM
      motorcycle/                   Graph xe máy TP.HCM
      walking/                      Graph đi bộ TP.HCM
    hanoi/
      driving/
      motorcycle/
      walking/
    danang/
      driving/
      motorcycle/
      walking/
  LifeFlow/
    Setup-Routing.ps1               Build/kiểm tra các graph và container
    Start-LifeFlow.ps1              Khởi động hằng ngày
    Stop-LifeFlow.ps1               Dừng hằng ngày, không xóa dữ liệu
```

Quy tắc đặt tên container là `lifeflow-osrm-<city>-<profile>`, ví dụ
`lifeflow-osrm-hcm-motorcycle`. Các cổng được chia theo profile để dễ nhớ:

| Thành phố | Ô tô | Đi bộ | Xe máy |
|---|---:|---:|---:|
| TP.HCM | `5000` | `5010` | `5020` |
| Hà Nội | `5001` | `5011` | `5021` |
| Đà Nẵng | `5002` | `5012` | `5022` |

Khi cài mới, kiểm tra health hoặc cần build profile còn thiếu, chạy:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Demo AI thực chiến\Maps VN\LifeFlow\Setup-Routing.ps1"
```

Script xác minh checksum trước khi tiếp tục một build dở dang, không ghi đè graph
hoàn chỉnh và chỉ báo `Ready` sau khi endpoint trả route thật.

Khi cập nhật sang PBF mới, không chép đè vào thư mục graph đang chạy. Hãy build
trong thư mục phiên bản mới rồi mới chuyển container sau khi acceptance test đạt.

## Khởi động hằng ngày

1. Mở Docker Desktop và chờ Docker Engine báo đang chạy.
2. Mở PowerShell.
3. Chạy:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Demo AI thực chiến\Maps VN\LifeFlow\Start-LifeFlow.ps1"
```

4. Mở các địa chỉ:

```text
Bản đồ: http://127.0.0.1:5173/
Kiểm tra API: http://127.0.0.1:4100/health
```

Script khởi động sẽ:

1. Bật `lifeflow-postgis` tại cổng `5433`.
2. Bật chín container `lifeflow-osrm-<city>-<profile>`.
3. Build backend và chạy các migration có kiểm tra checksum.
4. Khởi động Platform API.
5. Khởi động frontend MapLibre.

Script không tự nhập lại dữ liệu, không xóa dữ liệu và không tạo lại Docker
volume.

## Dừng hệ thống hằng ngày

Nhấn `Ctrl+C` trong cửa sổ PowerShell đang chạy frontend, sau đó chạy:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Demo AI thực chiến\Maps VN\LifeFlow\Stop-LifeFlow.ps1"
```

Lệnh này dừng Platform API, chín container OSRM và container PostGIS của LifeFlow.
Nó không xóa container, volume, database, image hoặc file dữ liệu nguồn.

## Luồng kiến trúc

```text
Frontend MapLibre
  |-- tải POI theo thành phố --> Platform API --> PostGIS
  |-- dự phòng --------------> accommodations.geojson
  `-- định tuyến tương tác --> OSRM của từng thành phố

LifeFlow Agent
  `-- MCP server qua stdio
        |-- search_housing / get_housing --> Housing Query --> PostGIS
        |-- search_places / get_place ----> Place Query ---> PostGIS
        |-- search_areas -----------------> Area Query ----> PostGIS
        |-- resolve_location -------------> Location Query > PostGIS
        |-- find_nearby_places -----------> PostGIS
        `-- calculate_route -------------> OSRM
```

Phần Housing Query chỉ trả dữ liệu thực tế. Nó không xếp hạng, chấm điểm hoặc
gợi ý căn nhà. Sau này module Recommendation riêng có thể sử dụng các hợp đồng
và kết quả này.

## Platform API

| Phương thức | Đường dẫn | Công dụng |
|---|---|---|
| `GET` | `/health` | Kiểm tra PostgreSQL/PostGIS |
| `POST` | `/v1/places/search` | Tìm địa điểm theo chữ, loại và không gian |
| `GET` | `/v1/places/:placeId` | Lấy chi tiết địa điểm chuẩn |
| `POST` | `/v1/places/nearby` | Tìm địa điểm gần nhất bằng spatial index |
| `POST` | `/v1/areas/search` | Tìm ranh giới hành chính không phân biệt dấu |
| `POST` | `/v1/locations/resolve` | Phân giải tên thành nhiều ứng viên area/POI |
| `POST` | `/v1/housing/search` | Lọc nhà ở theo các điều kiện bắt buộc |
| `GET` | `/v1/housing/:listingId` | Lấy chi tiết tin đăng |
| `POST` | `/v1/routes` | Lấy route OSRM theo `driving`, `motorcycle` hoặc `walking` |

Ví dụ route xe máy:

```json
{
  "city": "hcm",
  "origin": { "lng": 106.7009, "lat": 10.7769 },
  "destination": { "lng": 106.7218, "lat": 10.7952 },
  "profile": "motorcycle"
}
```

Trong môi trường phát triển, API chỉ lắng nghe trên máy cục bộ.

## MCP server

Build và chạy MCP server cục bộ:

```powershell
Set-Location "D:\Demo AI thực chiến\Maps VN\LifeFlow"
npm run build
npm run dev:mcp
```

Cấu hình dành cho MCP client:

```json
{
  "command": "node",
  "args": [
    "D:\\Demo AI thực chiến\\Maps VN\\LifeFlow\\mcp-server\\dist\\server.js"
  ],
  "env": {
    "LIFEFLOW_ENV_FILE": "D:\\Demo AI thực chiến\\Maps VN\\LifeFlow\\.env"
  }
}
```

Các tool đang cung cấp:

```text
search_housing
get_housing
search_places
get_place
search_areas
resolve_location
find_nearby_places
calculate_route
```

Hệ thống cố ý không cung cấp tool `recommend_housing`.

## Nhập dữ liệu POI mới

Importer đọc file được cấu hình qua `POI_SOURCE_PATH`. Nó giữ payload gốc, ghi
checksum, thống kê từng lần nhập và không ghi đè bản ghi đã được xác minh ở mức
`lifeflow_verified`.

```powershell
Set-Location "D:\Demo AI thực chiến\Maps VN\LifeFlow"
npm run db:up
npm run db:migrate
npm run db:import:places
```

Luôn giữ file nguồn theo phiên bản. Không ghi đè trực tiếp file OSM/PBF đang hoạt
động. Dữ liệu OSM và dữ liệu riêng của LifeFlow được phân biệt theo nguồn, nên
dữ liệu tùy chỉnh không bị mất khi cập nhật OSM.

### POI v2 từ PBF gốc

Script extract đọc PBF tại `../Raw/vietnam-260922.osm.pbf`, lọc theo
`config/poi-tags-filter.txt` bằng Osmium trong Ubuntu-24.04 và ghi GeoJSON
sequence tại `../Extracts/POI/vietnam-260922/`. Importer đọc các đường dẫn
`OSM_PBF_PATH` và `POI_V2_SOURCE_PATH` từ `.env`. Cần cài Osmium trong WSL.
Script extract không ghi đè artifact đã có.

```powershell
Set-Location "D:\Demo AI thực chiến\Maps VN\LifeFlow"
powershell -ExecutionPolicy Bypass -File .\Extract-Poi-V2.ps1
npm run db:migrate
npm run db:import:pois:v2
npm run db:report:pois
```

Importer stage từng dòng, lưu source geometry và OSM identity, đưa canonical
point về `ST_PointOnSurface`, giữ raw tags và không tự đặt tên. POI trùng OSM
identity được upsert; POI có `lifeflow_verified` không bị ghi đè. Lần import
đầu không mark stale các legacy source ID đang là hash. `reports/poi-coverage-v2.json`
ghi accounting và coverage theo bounding box bản đồ TP.HCM, Hà Nội, Đà Nẵng,
kèm độ đầy đủ name/address/phone/website/opening_hours theo category. Bounding
box này không phải ranh giới hành chính.

Osmium xuất polygon với ID `a...`; importer giải mã ID này về way/relation gốc
và giữ nguyên feature ID trong payload. Chỉ POI legacy có nguồn OSM mới được
tự động ghép theo tên, category và khoảng cách rất nhỏ.

Mốc dữ liệu 24/09/2026: 156.276 feature đầu vào, 152.206 accepted, 4.070
rejected vì category chưa hỗ trợ, 0 duplicate; 152.044 canonical POI. Chạy lại
cùng artifact cho 0 POI publish mới. Số liệu chi tiết theo thành phố/category
nằm trong báo cáo JSON và thay đổi khi nhập phiên bản PBF khác.

Sau khi import, chạy test dữ liệu thật:

```powershell
$env:RUN_POI_V2_INTEGRATION = '1'
npm exec --workspace @lifeflow/platform-api -- vitest run tests/poi-v2.integration.test.ts
Remove-Item Env:RUN_POI_V2_INTEGRATION
```

## Nhập dữ liệu địa giới mới

Importer đọc GeoJSON sequence được cấu hình qua `ADMIN_AREA_SOURCE_PATH`, tính
checksum, nhập theo batch và chỉ upsert các bản ghi `source='osm'`. Nó không xóa
boundary cục bộ hoặc dữ liệu tùy chỉnh:

```powershell
Set-Location "D:\Demo AI thực chiến\Maps VN\LifeFlow"
npm run db:up
npm run db:migrate
npm run db:import:areas
```

Luồng dùng cho LLM:

```text
search_areas({ text: "go vap" })
  -> lấy area_id = "osm:relation:38522189"
  -> search_places({
       categories: ["hotel"],
       administrative_area_ids: ["osm:relation:38522189"]
     })
```

`resolve_location` tìm đồng thời trong ranh giới hành chính và POI, luôn trả
danh sách ứng viên có `match_type`/`match_score`; tool không tự khẳng định một
kết quả mơ hồ là duy nhất.

## Thêm dữ liệu nhà ở

Dữ liệu nhà ở cần được ánh xạ theo chuỗi:

```text
catalog.places
  -> housing.properties
  -> housing.units
  -> housing.listings
  -> housing.offers
```

Không chèn dữ liệu minh họa vào database thật. Mỗi nguồn mới cần một bộ nhập liệu
riêng và phải lưu nguồn gốc trong `integration.source_records`. Khi có tin đăng
thật, API và MCP hiện tại có thể truy vấn ngay mà không cần thay đổi hợp đồng.

## Chạy kiểm thử

```powershell
Set-Location "D:\Demo AI thực chiến\Maps VN\LifeFlow"
npm run build
npm test

Set-Location "D:\Demo AI thực chiến\Maps VN\LifeFlow\map-app"
npm run lint
npm run build
npm run test:e2e
```

Kết quả triển khai chi tiết nằm trong
`docs/HOUSING-QUERY-IMPLEMENTATION.md`.
