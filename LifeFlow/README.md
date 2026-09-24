# Nền tảng bản đồ và vị trí LifeFlow

LifeFlow hiện có một nền tảng dữ liệu vị trí chạy cục bộ, được xây dựng từ dữ
liệu OSM, OSRM và dữ liệu lưu trú sẵn có. Hệ thống gồm:

- PostgreSQL 16 và PostGIS 3.5 chạy trong Docker volume riêng.
- Kho địa điểm chuẩn hóa, có thể truy ngược về nguồn.
- Mô hình dữ liệu tách riêng bất động sản, căn/phòng, tin đăng và báo giá.
- Dịch vụ Housing Query có kiểu dữ liệu rõ ràng và lọc cứng bằng PostGIS.
- Platform API chạy tại `127.0.0.1:4100`.
- Sáu MCP tool chỉ đọc, giao tiếp qua `stdio`.
- Ứng dụng MapLibre chạy tại `127.0.0.1:5173`.
- Ba dịch vụ OSRM hiện có cho TP.HCM, Hà Nội và Đà Nẵng.
- GeoJSON gốc vẫn được giữ làm phương án dự phòng cho frontend.

Nguồn hiện tại có 13.120 POI. Sau khi chuẩn hóa, hệ thống lưu 13.118 địa điểm
chuẩn và ghi nhận hai mã nguồn bị trùng. Hiện chưa có nguồn tin đăng nhà ở thật,
vì vậy truy vấn nhà ở trả về danh sách rỗng thay vì tự tạo dữ liệu giả.

## Khởi động hằng ngày

1. Mở Docker Desktop và chờ Docker Engine báo đang chạy.
2. Mở PowerShell.
3. Chạy:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Bản đồ VN\LifeFlow\Start-LifeFlow.ps1"
```

4. Mở các địa chỉ:

```text
Bản đồ: http://127.0.0.1:5173/
Kiểm tra API: http://127.0.0.1:4100/health
```

Script khởi động sẽ:

1. Bật `lifeflow-postgis` tại cổng `5433`.
2. Bật `osrm-hcm`, `osrm-hanoi` và `osrm-danang`.
3. Build backend và chạy các migration có kiểm tra checksum.
4. Khởi động Platform API.
5. Khởi động frontend MapLibre.

Script không tự nhập lại dữ liệu, không xóa dữ liệu và không tạo lại Docker
volume.

## Dừng hệ thống hằng ngày

Nhấn `Ctrl+C` trong cửa sổ PowerShell đang chạy frontend, sau đó chạy:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Bản đồ VN\LifeFlow\Stop-LifeFlow.ps1"
```

Lệnh này dừng Platform API, ba container OSRM và container PostGIS của LifeFlow.
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
| `POST` | `/v1/housing/search` | Lọc nhà ở theo các điều kiện bắt buộc |
| `GET` | `/v1/housing/:listingId` | Lấy chi tiết tin đăng |
| `POST` | `/v1/routes` | Lấy quãng đường, thời gian và hình học từ OSRM |

Trong môi trường phát triển, API chỉ lắng nghe trên máy cục bộ.

## MCP server

Build và chạy MCP server cục bộ:

```powershell
Set-Location "D:\Bản đồ VN\LifeFlow"
npm run build
npm run dev:mcp
```

Cấu hình dành cho MCP client:

```json
{
  "command": "node",
  "args": [
    "D:\\Bản đồ VN\\LifeFlow\\mcp-server\\dist\\server.js"
  ],
  "env": {
    "LIFEFLOW_ENV_FILE": "D:\\Bản đồ VN\\LifeFlow\\.env"
  }
}
```

Các tool đang cung cấp:

```text
search_housing
get_housing
search_places
get_place
find_nearby_places
calculate_route
```

Hệ thống cố ý không cung cấp tool `recommend_housing`.

## Nhập dữ liệu POI mới

Importer đọc file được cấu hình qua `POI_SOURCE_PATH`. Nó giữ payload gốc, ghi
checksum, thống kê từng lần nhập và không ghi đè bản ghi đã được xác minh ở mức
`lifeflow_verified`.

```powershell
Set-Location "D:\Bản đồ VN\LifeFlow"
npm run db:up
npm run db:migrate
npm run db:import:places
```

Luôn giữ file nguồn theo phiên bản. Không ghi đè trực tiếp file OSM/PBF đang hoạt
động. Dữ liệu OSM và dữ liệu riêng của LifeFlow được phân biệt theo nguồn, nên
dữ liệu tùy chỉnh không bị mất khi cập nhật OSM.

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
Set-Location "D:\Bản đồ VN\LifeFlow"
npm run build
npm test

Set-Location "D:\Bản đồ VN\LifeFlow\map-app"
npm run lint
npm run build
npm run test:e2e
```

Kết quả triển khai chi tiết nằm trong
`docs/HOUSING-QUERY-IMPLEMENTATION.md`.
