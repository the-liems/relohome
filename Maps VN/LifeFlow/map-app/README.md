# Bản đồ LifeFlow

Ứng dụng MapLibre cho TP.HCM, Hà Nội và Đà Nẵng. POI được tải từ LifeFlow
Platform API và PostGIS; chín dịch vụ OSRM (ba thành phố × ba profile) đảm nhiệm định tuyến.
Thanh nhóm địa điểm cho chọn Lưu trú, Y tế, Mua sắm, Giáo dục, Ăn uống,
Giao thông, Tiện ích hoặc Giải trí. API map tải POI theo bbox; không thay lỗi API
bằng bộ GeoJSON lưu trú cũ. Số tiện ích phụ thuộc bbox và bộ lọc, không phải tổng DB.
Xem [status dữ liệu](../../../docs/integration/location-data-status.md).

## Chạy cục bộ

1. Mở Docker Desktop và chờ Docker Engine báo đang chạy.
2. Mở PowerShell và chạy:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow\Start-LifeFlow.ps1"
```

3. Mở `http://127.0.0.1:5173`.

Script tự khởi động PostGIS, chín container OSRM, Platform API và frontend. Nhấn
`Ctrl+C` để dừng frontend, sau đó chạy `Stop-LifeFlow.ps1` ở thư mục cha để
dừng các dịch vụ còn lại mà không xóa dữ liệu.

### Chạy riêng frontend

```powershell
Set-Location "D:\Demo AI thực chiến\Maps VN\LifeFlow\map-app"
npm run dev:lifeflow
```

Khi chạy theo cách này, Platform API và các OSRM container phải được bật trước.
Chạy `npm ci` tại gốc repository khi cài project hoặc thay lockfile.
Dùng Node 24/npm 11; xem [root tooling](../../../docs/runbooks/root-tooling.md).

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

`public/data/accommodations.geojson` là bản Point GeoJSON được tạo từ file
nguồn. Quá trình chạy frontend không thay đổi dữ liệu gốc.

`public/maplibre/` không được lưu trong Git. Root `npm ci`, `npm run dev` và
`npm run build` tự chạy `prepare:worker` để copy worker từ phiên bản MapLibre
đã cài. Khi build thủ công, chạy `npm run prepare:worker` trước khi đóng gói.
