# Bản đồ LifeFlow

Ứng dụng MapLibre cho TP.HCM, Hà Nội và Đà Nẵng. POI được tải từ LifeFlow
Platform API và PostGIS; ba dịch vụ OSRM cục bộ đảm nhiệm định tuyến. File
GeoJSON hiện có vẫn được giữ làm phương án dự phòng khi API tạm ngừng.
Thanh nhóm địa điểm cho chọn Lưu trú, Y tế, Mua sắm, Giáo dục, Ăn uống,
Giao thông, Tiện ích hoặc Giải trí. Mỗi lần chọn chỉ tải category của nhóm đó
từ API; fallback GeoJSON chỉ áp dụng cho Lưu trú.

## Chạy cục bộ

1. Mở Docker Desktop và chờ Docker Engine báo đang chạy.
2. Mở PowerShell và chạy:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Demo AI thực chiến\Maps VN\LifeFlow\Start-LifeFlow.ps1"
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
Chỉ cần chạy `npm install` khi `node_modules` bị xóa hoặc khi cài project trên
máy khác.

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
