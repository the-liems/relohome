# Bản đồ ReloHome

Ứng dụng MapLibre cho TP.HCM, Hà Nội và Đà Nẵng. POI được tải từ ReloHome
Platform API và PostGIS; chín dịch vụ OSRM (ba thành phố × ba profile) đảm nhiệm định tuyến.
Thanh nhóm địa điểm cho chọn Lưu trú, Y tế, Mua sắm, Giáo dục, Ăn uống,
Giao thông, Tiện ích hoặc Giải trí. API map tải POI theo bbox; không thay lỗi API
bằng bộ GeoJSON lưu trú cũ. Số tiện ích phụ thuộc bbox và bộ lọc, không phải tổng DB.
Xem [status dữ liệu](../../docs/integration/location-data-status.md).

## Chạy cục bộ

1. Mở Docker Desktop và chờ Docker Engine báo đang chạy.
2. Mở PowerShell và chạy:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/relohome/Start-ReloHome.ps1
```

3. Mở `http://127.0.0.1:5173`.

Script tự khởi động PostGIS, chín container OSRM, Platform API và frontend. Nhấn
`Ctrl+C` để dừng frontend, sau đó chạy `scripts/relohome/Stop-ReloHome.ps1` từ repository root để
dừng các dịch vụ còn lại mà không xóa dữ liệu.

### Chạy riêng frontend

```powershell
# From repository root
npm run dev:map
```

Khi chạy theo cách này, Platform API và các OSRM container phải được bật trước.
Chạy `npm ci` tại gốc repository khi cài project hoặc thay lockfile.
Dùng Node 24/npm 11; xem [root tooling](../../docs/runbooks/root-tooling.md).

Các cổng đang dùng:

| Dịch vụ | Cổng |
|---|---:|
| Platform API | 4100 |
| Frontend | 5173 |
| OSRM TP.HCM | 5000 |
| OSRM Hà Nội | 5001 |
| OSRM Đà Nẵng | 5002 |

## Kiểm thử

```powershell
npm run lint
npm run build
npm run test:e2e
```

`public/data/accommodations.geojson` là sample được giữ nguyên. Frontend tải
POI từ Platform API; dữ liệu local không được copy vào source.

`public/maplibre/` không được lưu trong Git. Root `npm ci`, `npm run dev` và
`npm run build` tự chạy `prepare:worker` để copy worker từ phiên bản MapLibre
đã cài. Khi build thủ công, chạy `npm run prepare:worker` trước khi đóng gói.


## Offline POI preparation

`prepare:data` is an optional conversion utility, separate from API-backed map
startup. It accepts an input and output via CLI arguments or exported
`RELOHOME_POI_INPUT` / `RELOHOME_POI_OUTPUT` (see `.env.example`). Both are
required; missing configuration fails with an actionable message. CLI arguments
take precedence. Paths are resolved from the map workspace (`examples/map-app`),
so absolute paths are recommended. Output must be outside the repository and
must differ from the input; the tracked sample is never overwritten.

```sh
npm run prepare:data --workspace @relohome/map-app -- /absolute/input.geojson /absolute/output.geojson
# Or export RELOHOME_POI_INPUT and RELOHOME_POI_OUTPUT before the same command.
```

The utility does not load `.env.example` automatically. Export the variables or
pass CLI arguments; normal map dev commands load the existing root `.env.local`.
Browser hooks `__LIFEFLOW_MAP__`, map source/layer IDs, and
`LIFEFLOW_MAP_TEST_URL` remain compatible.
