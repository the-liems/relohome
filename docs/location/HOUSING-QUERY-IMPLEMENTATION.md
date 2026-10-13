# Hồ sơ triển khai Housing Query

> Historical record: paths, names, commands and measured results below describe the original checkout. For current operation use the [ReloHome location guide](README.md) and [local runbook](../runbooks/local-mvp.md).

> **Tài liệu khảo sát/thiết kế lịch sử — không dùng làm status hiện hành.**
>
> **Cập nhật chỉ dẫn 2026-09-29:** xem [status triển khai](../integration/location-service-implementation-status.md) và [dữ liệu/backup hiện hành](../integration/location-data-status.md). Location hiện có 9 tool, housing thật và MCP HTTP có bearer token. Các số liệu, test và kế hoạch trong ghi chép cũ bên dưới thuộc thời điểm viết, không phải thống kê DB của máy mới. ZIP cũ đã xóa; giữ dữ liệu backup riêng với source trong Git.

## Trạng thái

- Hoàn thành: 2026-09-24
- Phạm vi: nền tảng Housing Query factual, PostGIS, API, MCP chỉ đọc và tích hợp bản đồ
- Không bao gồm: gợi ý/xếp hạng, đặt dịch vụ, thanh toán, triển khai công khai và basemap tùy chỉnh
- An toàn dữ liệu: không sửa file OSM, PBF, OSRM graph hoặc PostgreSQL cũ

## Các thành phần đã triển khai

| Thành phần | Vị trí | Kết quả |
|---|---|---|
| Hợp đồng dùng chung | `packages/contracts` | Zod schema cho địa điểm, tuyến đường và nhà ở |
| Dịch vụ truy vấn | `packages/housing-query` | Bộ lọc SQL/PostGIS và kiểm tra thời gian đi lại qua OSRM |
| Database migration | `database/migrations` | Schema, role, constraint, index và bảng audit |
| Bộ nhập POI | `apps/platform-api/src/import-places.ts` | Nhập dữ liệu theo phiên bản, truy nguồn và nhận diện bản ghi trùng |
| Platform API | `apps/platform-api` | Bảy endpoint factual chạy cục bộ |
| MCP server | `apps/location-mcp` | Sáu tool chỉ đọc qua `stdio` |
| Tích hợp bản đồ | `map-app/src/services/platform-poi.ts` | Tải POI theo thành phố qua API và fallback GeoJSON |
| Vận hành | `Start-LifeFlow.ps1`, `Stop-LifeFlow.ps1` | Khởi động lặp lại được và dừng không xóa dữ liệu |

## Cách ly database

Database LifeFlow chạy trong container `lifeflow-postgis`:

```text
Host: 127.0.0.1
Cổng: 5433
Database: lifeflow
Volume: lifeflow-postgis-data
```

Dịch vụ PostgreSQL Windows có sẵn tại cổng `5432` không bị thay đổi. Vì không
có thông tin đăng nhập của database cũ, quá trình triển khai cố ý không reset,
không sửa và không di chuyển database đó.

Backup logic của database LifeFlow mới nằm tại:

```text
database/backups/lifeflow-20260924.dump
```

## Dữ liệu đã nhập

| Chỉ số | Giá trị |
|---|---:|
| POI trong file nguồn | 13.120 |
| Địa điểm chuẩn đã công bố | 13.118 |
| Mã nguồn bị trùng | 2 |
| Bản ghi bị từ chối | 0 |
| Ranh giới thành phố | 3 |
| Tin đăng nhà ở thật | 0 |

Mỗi địa điểm được chấp nhận đều giữ mã OSM, payload nguồn và thông tin lần nhập.
Kho nhà ở đang rỗng vì workspace chưa có nguồn tin đăng thật.

## Checksum dữ liệu nguồn

| Nguồn | SHA-256 |
|---|---|
| `Raw/vietnam-260922.osm.pbf` | `3B03E0DE5ADD781BB3B68C71FBF651D432C88C534CDA600BEE50C95A3AB5627A` |
| `Cities/pbf/hcm.osm.pbf` | `8F58F5B90BCC2E6FA6601C694DEC088CE47860C6C7E9D20F20578457CBA44E8E` |
| `Cities/pbf/hanoi.osm.pbf` | `D15D1E71220768DBE1B97917DFC16FEC589E60E39A53D197007C853492DAC062` |
| `Cities/pbf/danang.osm.pbf` | `79F69C99FF31B013EE9C6B5684F54EB79AAA117FD090A75519371E5E6A6CF07D` |
| `Extracts/accommodations.geojson` | `9E274066919B2975032C8428C3C0460405D3A0AC022420CDCBD685F4FEDA2561` |

Các checksum này là mốc để so sánh trong lần cập nhật OSM sau.

## Ranh giới bảo mật

- Platform API và frontend chỉ bind vào `127.0.0.1`.
- MCP dùng `stdio` cục bộ.
- Role `lifeflow_app` được đọc nhưng không được chèn dữ liệu vào bảng địa điểm chuẩn.
- Role `lifeflow_ingest` dành riêng cho quá trình nhập dữ liệu.
- Migration dùng kết nối quản trị riêng.
- MCP không cung cấp tool chạy SQL hoặc HTTP tùy ý.
- Audit MCP chỉ lưu tên tool, thời gian, trạng thái và tên các khóa đầu vào; không lưu giá trị đầu vào.
- Xác thực người dùng và phân quyền tenant cho production vẫn là công việc của giai đoạn triển khai thật.

## Kết quả nghiệm thu

| Hạng mục | Kết quả |
|---|---|
| Build toàn workspace | Đạt |
| Contract test | 9 test đạt |
| Test tích hợp Housing/PostGIS | 5 test đạt |
| Test tích hợp Platform API | 5 test đạt |
| Test giao thức MCP | 3 test đạt |
| Playwright cho MapLibre | 5 test đạt |
| Route thật qua OSRM của ba thành phố | Đạt |
| Kiểm tra hình ảnh desktop/mobile | Đạt |
| Sức khỏe PostGIS | Đạt, PostGIS 3.5 |
| Quyền INSERT của role ứng dụng | Bị từ chối đúng thiết kế |
| Không có field/tool Recommendation | Đạt |

Các bài test truy vấn bao phủ giá, số phòng ngủ, giá trị phòng ngủ bị thiếu,
diện tích, khu hành chính, bán kính, địa điểm gần, thời gian đi lại và tính ổn
định của thứ tự kết quả.

Frontend đã được kiểm tra tải POI hoàn toàn qua API:

| Thành phố | Số POI | Số trang API |
|---|---:|---:|
| TP.HCM | 1.368 | 14 |
| Hà Nội | 1.355 | 14 |
| Đà Nẵng | 1.212 | 13 |

## Khôi phục và cập nhật

Migration có checksum và có thể chạy lặp lại. Lệnh dừng Docker không xóa named
volume. GeoJSON gốc vẫn tồn tại để làm fallback, còn container và graph OSRM
hiện tại không bị thay đổi.

Trước mỗi lần cập nhật nguồn:

1. Giữ lại phiên bản file nguồn và routing graph đang hoạt động.
2. Tạo backup database mới.
3. Nhập dữ liệu vào bảng staging/source record.
4. So sánh số lượng accepted, duplicate và rejected.
5. Chỉ công bố sau khi API, MCP, routing và browser test đều đạt.

## Giới hạn hiện tại

- Chưa có dữ liệu tin đăng nhà ở thật.
- Chưa có Recommendation MCP; đây là module độc lập.
- Chưa có xác thực production hoặc Streamable HTTP công khai.
- Chưa có workflow đặt dịch vụ, thanh toán hoặc phê duyệt.
- Chưa có basemap PMTiles mang phong cách riêng của LifeFlow.

Các mục trên thuộc roadmap sau nền tảng factual, không phải lỗi của bản triển
khai hiện tại.
