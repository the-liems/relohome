# ReloHome location, housing and map

Run commands from the repository root with Node 24/npm 11 and the root Python
virtual environment. Install with `npm ci` and `python -m pip install -r
requirements-dev.txt`, then `npm run build`. Configure the existing root
`.env.local` using [local configuration](../runbooks/local-mvp.md); keep old
credentials and database volumes. `npm run dev:init` is an explicit setup step,
not part of relocation or service startup.

| Source | Current location |
| --- | --- |
| Platform / Location MCP | `apps/platform-api/`, `apps/location-mcp/` |
| Map example | `examples/map-app/` (`@relohome/map-app`) |
| Location Streamlit lab | `examples/location-streamlit/` (`relohome_location_demo`) |
| SQL migrations and rollback SQL | `deploy/database/` |
| Location / Moving Compose | `deploy/location/`, `deploy/moving/` |
| Routing / extraction / launch scripts | `scripts/relohome/` |
| POI extraction filter | `config/location/poi-tags-filter.txt` |
| Coverage evidence | `eval/location/poi-coverage-v2.json` |

For a configured local stack, use root `npm run db:up`, `npm run db:migrate`
(explicit database write), `npm run dev:api` and `npm run dev:map` in separate
terminals. `npm run dev:mcp` runs stdio and `npm run dev:mcp:http` runs HTTP.
The [map README](../../examples/map-app/README.md) covers the full Windows
launcher and configured offline POI preparation. The
[Streamlit guide](STREAMLIT_MVP.md) covers both retained labs.

```powershell
# From repository root, against your configured local stack only:
powershell -ExecutionPolicy Bypass -File scripts/relohome/Start-ReloHome.ps1
powershell -ExecutionPolicy Bypass -File scripts/relohome/Stop-ReloHome.ps1
# Explicit routing/extraction operations (read their prerequisites first):
powershell -ExecutionPolicy Bypass -File scripts/relohome/Setup-Routing.ps1
powershell -ExecutionPolicy Bypass -File scripts/relohome/Extract-Poi-V2.ps1
```

Runtime state stays at `Maps VN/LifeFlow/.runtime/`; routing graphs remain at
`Maps VN/Routing/`, raw/extracted datasets at `Maps VN/Raw/` and
`Maps VN/Extracts/`, city boundaries at `Maps VN/Cities/`. No local dataset or
credential belongs in these source directories. Compose project, image,
container and volume names retain their `lifeflow` identifiers; migration SQL
and history/checksum identities are unchanged. Root entrypoints pass
`.env.local` explicitly; runtime loaders consume `process.env` and do not add
new env discovery. Existing `LIFEFLOW_ENV_FILE` interfaces stay unchanged.

See [Moving containers](../runbooks/moving-containers.md),
[TypeScript relocation](../runbooks/typescript-relocation.md) and
[location relocation evidence and rollback](../integration/location-relocation.md).

## Root import and report entrypoints

Configure the existing input environment variables in root `.env.local`, then
invoke the same root commands: `npm run db:import:places`,
`npm run db:import:pois:v2`, `npm run db:import:housing`,
`npm run db:import:areas`, `npm run db:deduplicate:pois` and
`npm run db:report:pois`. Imports/deduplication write to the configured database;
reports write to `eval/location/poi-coverage-v2.json`. Relative importer inputs
launched via the Platform npm workspace still resolve from the former
`Maps VN/LifeFlow/platform-api/` directory, so existing `.env.local` values keep
opening the same datasets. Explicit absolute paths remain absolute. No importer
or migration runs as part of installation, asset preparation or relocation.

## Historical operational transcript

The following dated instructions and results describe the former layout.
Use the current guide above for commands; old data/backup names remain evidence.

# Nền tảng bản đồ và vị trí ReloHome

TypeScript source now lives in repository-root `apps/` and `packages/`.
See the [relocation runbook](../../docs/runbooks/typescript-relocation.md).
This directory retains data, scripts, environment files and compatibility commands until #115.

## Cập nhật POI — 04/10/2026

[Bàn giao QuangDung: file thay đổi, gói dữ liệu và cách cập nhật máy cũ](../../docs/integration/quangdung-changes-and-data-handoff-2026-10-04.md).

Đã xóa vật lý **20.853 POI có tên trùng**, chỉ khi chung đối tượng OSM và không
xung đột loại tiện ích, tầng, phòng/cơ sở. Còn **131.191 POI active** trên local;
38.222 housing anchors và dữ liệu nhà giữ nguyên. Khác tầng/tiện ích hoặc thiếu
tên vẫn giữ riêng. ID cũ và pin đã xác nhận vẫn đọc được với tọa độ cũ.

**Cần cài migration 011 và 012 trước khi chạy query mới**. Log làm sạch dùng
`geo.import_runs` sẵn có; bảng `catalog.poi_dedup_runs` đã bỏ, chỉ giữ mapping
ID cũ trong `catalog.poi_aliases`. Bộ dữ liệu portable nằm tại
`../../data/poi-clean/2026-10-04/`: GeoJSON, nguồn gốc, ID cũ và manifest checksum.
Máy khác cần apply hoặc nhập bộ sạch vào DB đã cài schema; pull code chưa đổi dữ liệu.
Xem [quy trình làm sạch, xuất/nhập và khôi phục](POI-CANONICALIZATION.md).

## Chạy nhanh trên DEMO_1

### Audit Map/Housing/OSRM — 04/10/2026

- OSRM **đã được gọi thực tế** trong route và housing commute; 9 container chạy
  MLD. Kiểm tra 9 tuyến API khớp Docker, MCP và housing commute đạt.
- Đã sửa **8.795 unit DB / 8.840 dòng crawl** phòng thuê 0 → 1, sau đó thêm
  **1.521 studio** 0 → 1 theo yêu cầu; giữ metadata giá trị gốc và tin mâu thuẫn.
- Frontend SIU đã mở camera xem toàn Việt Nam theo yêu cầu mới, không còn khóa
  riêng từng thành phố. Không thay style/nhãn/đường biên trong dữ liệu nhà cung cấp.
- Workspace Moving của SIU đã dùng geometry OSRM qua API đọc sẵn có, tuyến tham
  khảo ô tô; báo giá/đặt xe AhaMove giữ nguyên. Map-app độc lập chưa đổi camera.
- Form Moving dùng hai ô A/B tự tìm gợi ý; không còn ô tìm địa điểm riêng.
  Local đã chạy migration **008_moving_service.sql** có sẵn để bổ sung 5 bảng
  Moving còn thiếu; API 4200 và MCP 4400 `/ready` trả 200. Khi dùng snapshot cũ,
  chạy `scripts/local-integration.py migrate` trước khi kiểm tra báo giá.

Triển khai và giới hạn hiện hành:
[map Việt Nam / Moving A/B và khởi động local](../../docs/integration/vietnam-map-moving-update-2026-10-04.md).
Coverage OSRM vẫn là TP.HCM, Hà Nội, Đà Nẵng; mở camera không bổ sung dữ liệu routing.

Ảnh, trace, checksum và giới hạn:
[báo cáo chi tiết](../../docs/integration/map-housing-osrm-audit-2026-10-04.md).

Yêu cầu: Docker Desktop đang chạy, Node.js/npm đã cài và PowerShell.

### Cài lần đầu

```powershell
Set-Location "D:\DEMO_AI\DEMO_1" # repository root; Node 24/npm 11
npm ci
Set-Location "Maps VN/LifeFlow"
```

Nếu các container OSRM chưa từng được tạo trên máy, tạo và kiểm tra graph một
lần:

```powershell
powershell -ExecutionPolicy Bypass -File .\Setup-Routing.ps1
```

### Khởi động hằng ngày

```powershell
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"
powershell -ExecutionPolicy Bypass -File .\Start-LifeFlow.ps1
```

Giữ cửa sổ PowerShell này mở để frontend MapLibre tiếp tục chạy. Mở bản đồ tại
<http://127.0.0.1:5173/> và kiểm tra API tại
<http://127.0.0.1:4100/health>.

### Dừng hệ thống

Trong cửa sổ PowerShell khác:

```powershell
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"
powershell -ExecutionPolicy Bypass -File .\Stop-LifeFlow.ps1
```

Lệnh dừng không xóa database, Docker volume, graph routing hoặc file nguồn.

LifeFlow hiện có một nền tảng dữ liệu vị trí chạy cục bộ, được xây dựng từ dữ
liệu OSM, OSRM và dữ liệu lưu trú sẵn có. Hệ thống gồm:

- PostgreSQL 16 và PostGIS 3.5 chạy trong Docker volume riêng.
- Kho địa điểm chuẩn hóa, có thể truy ngược về nguồn.
- Mô hình dữ liệu tách riêng bất động sản, căn/phòng, tin đăng và báo giá.
- Dịch vụ Housing Query có kiểu dữ liệu rõ ràng và lọc cứng bằng PostGIS.
- Platform API chạy tại `127.0.0.1:4100`.
- Chín MCP tool chỉ đọc cho Housing/Map, giao tiếp qua `stdio` hoặc Streamable
  HTTP, và một Moving MCP server độc lập cho AhaMove.
- Ứng dụng MapLibre chạy tại `127.0.0.1:5173`.
- Chín dịch vụ OSRM: ba thành phố nhân với ba chế độ ô tô, xe máy và đi bộ.
- GeoJSON gốc được giữ làm dữ liệu nguồn; API map không fallback sang bộ lưu trú cũ.

Dữ liệu đã có pipeline nhập POI v2 và tin nhà thật. Số bản ghi phụ thuộc
snapshot được restore/import trên từng máy; bản ghi active không xác nhận căn
vẫn còn trống. Xem [trạng thái tích hợp Location](../../docs/integration/location-service-implementation-status.md)
để biết contract mới, kết quả kiểm thử và hướng dẫn cho phía graph.

[Status dữ liệu và backup](../../docs/integration/location-data-status.md) phân biệt
thống kê nguồn, POI, housing anchor và listing trên DB đích.

Tool mới `calculate_route_between_entities` nhận housing listing ID, POI ID
hoặc tọa độ. `search_housing`/`get_housing` bổ sung `location_accuracy`,
`location_method`, `deposit`. Cần build lại MCP image sau khi lấy code mới;
backup database không chứa code của tool.

## Cấu trúc dữ liệu routing

Quy ước dataset cho nhiều thành phố: [city catalog](../../Maps%20VN/Cities/README.md) và
[quy trình DVC / object storage](../../docs/runbooks/map-data.md).

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
powershell -ExecutionPolicy Bypass -File "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow\Setup-Routing.ps1"
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
powershell -ExecutionPolicy Bypass -File "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow\Start-LifeFlow.ps1"
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
powershell -ExecutionPolicy Bypass -File "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow\Stop-LifeFlow.ps1"
```

Lệnh này dừng Platform API, chín container OSRM và container PostGIS của LifeFlow.
Nó không xóa container, volume, database, image hoặc file dữ liệu nguồn.

## Luồng kiến trúc

```text
Frontend MapLibre
  |-- tải POI theo thành phố --> Platform API --> PostGIS
  |-- dự phòng --------------> accommodations.geojson
  `-- định tuyến tương tác --> OSRM của từng thành phố

LifeFlow Agent / MCP client
  |-- Housing/Map MCP server qua stdio hoặc Streamable HTTP
        |-- search_housing / get_housing --> Housing Query --> PostGIS
        |-- search_places / get_place ----> Place Query ---> PostGIS
        |-- search_areas -----------------> Area Query ----> PostGIS
        |-- resolve_location -------------> Location Query > PostGIS
        |-- find_nearby_places -----------> PostGIS
        `-- calculate_route -------------> OSRM
  `-- Moving MCP container qua HTTP (local vẫn hỗ trợ stdio)
        |-- discovery / estimate --------> AhaMove API v3
        |-- get / tracking / events -----> AhaMove API v3
        `-- approved create/update/cancel > AhaMove API v3
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

Tài liệu đóng gói, vận hành và bàn giao container nằm tại
[`docs/MCP-CONTAINER-HANDOFF.md`](MCP-CONTAINER-HANDOFF.md).

Build và chạy MCP server cục bộ:

```powershell
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"
npm run build
npm run dev:mcp
```

Cấu hình dành cho MCP client:

```json
{
  "command": "node",
  "args": [
    "--env-file=<repository>/.env.local",
    "<repository>/apps/location-mcp/dist/server.js"
  ]
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

Moving/AhaMove chạy bằng một MCP server riêng, nhưng dùng chung contracts và
chuẩn handler/audit:

```powershell
npm run dev:moving-mcp
npm run dev:moving-api
```

Để chạy Moving độc lập bằng Docker, bao gồm database và migration tự động:

```powershell
npm run moving:up
npm run moving:verify
```

AI Service kết nối `http://moving-mcp:4400/mcp` trên cùng Docker network,
qua bearer token nội bộ. Xem [hướng dẫn container](../../docs/runbooks/moving-containers.md)
và [bàn giao infra](../runbooks/moving-coolify.md).

Moving API nhận webhook tại
`POST /v1/integrations/ahamove/webhooks/order-status`. Staging, write tools,
rating và production có các kill switch độc lập. Xem
[`docs/runbooks/ahamove-staging.md`](../../docs/runbooks/ahamove-staging.md).

## Nhập dữ liệu POI mới

Importer đọc file được cấu hình qua `POI_SOURCE_PATH`. Nó giữ payload gốc, ghi
checksum, thống kê từng lần nhập và không ghi đè bản ghi đã được xác minh ở mức
`lifeflow_verified`.

```powershell
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"
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
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"
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
npm exec --workspace @relohome/platform-api -- vitest run tests/poi-v2.integration.test.ts
Remove-Item Env:RUN_POI_V2_INTEGRATION
```

## Nhập dữ liệu địa giới mới

Importer đọc GeoJSON sequence được cấu hình qua `ADMIN_AREA_SOURCE_PATH`, tính
checksum, nhập theo batch và chỉ upsert các bản ghi `source='osm'`. Nó không xóa
boundary cục bộ hoặc dữ liệu tùy chỉnh:

```powershell
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"
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
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"
npm run build
npm test

Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow\map-app"
npm run lint
npm run build
npm run test:e2e
```

Kết quả triển khai chi tiết nằm trong
`docs/HOUSING-QUERY-IMPLEMENTATION.md`.
