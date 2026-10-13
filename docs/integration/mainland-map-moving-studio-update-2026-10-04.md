# Giới hạn map, tuyến Moving và studio — 04/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


> Đây là báo cáo đợt triển khai trước. Theo yêu cầu mới, camera đã mở rộng xem
> toàn Việt Nam và form Moving đã gộp tìm gợi ý vào hai ô A/B. Xem
> [cập nhật hiện hành](vietnam-map-moving-update-2026-10-04.md).
> Phần chuẩn hóa studio bên dưới vẫn được giữ.

## Phạm vi đã thống nhất

- Giữ thao tác chat rồi chọn địa điểm. **Không thêm nút đổi thành phố**.
- Chỉ giới hạn camera và sửa đường hiển thị của Moving trong `Frontend`.
- Giữ yêu cầu studio 0 → 1 đã được người dùng xác nhận.
- Không sửa Planner, subagent, báo giá, đặt xe, thanh toán, gateway hoặc `.env` trong đợt này.

## 1. Camera của frontend SIU

`Frontend/src/mapScope.ts` dùng cùng phạm vi phục vụ với RouteService/OSRM:

| Khu vực | Tây, Nam | Đông, Bắc |
| --- | --- | --- |
| TP.HCM | 106.34, 10.34 | 107.05, 11.20 |
| Đà Nẵng | 107.78, 15.88 | 108.42, 16.30 |
| Hà Nội | 105.28, 20.55 | 106.04, 21.40 |

Áp dụng cho map kết quả/đường đi và map phóng lớn (`MapPanel`), workspace nhà
(`MapWorkspace`), form ghim địa điểm Moving và workspace báo giá Moving.

- `maxBounds` chặn kéo ra ngoài khu vực; mức zoom tối thiểu tính theo kích thước
  khung, kể cả mobile và màn hình 4K. Tắt xoay/nghiêng bằng cử chỉ để camera không
  lộ vùng ngoài giới hạn. Không lặp bản đồ thế giới.
- Thành phố tự xác định từ viewport của câu trả lời hoặc tọa độ người dùng chọn.
  Chuyển thành phố bằng camera jump, không bay qua một khung toàn quốc/thế giới.
- Danh sách gợi ý khác thành phố vẫn giữ nguyên. Camera chỉ ôm các điểm cùng khu vực;
  khi chọn điểm khác thành phố sẽ chuyển đúng khu vực. Pin/ID/tọa độ gửi dịch vụ không bị đổi.
- Các vùng biển đảo xa, gồm các khung từng kiểm tra Hoàng Sa/Trường Sa, không thể
  truy cập bằng kéo hoặc zoom-out trên frontend SIU.

Đây là **khung hiển thị vùng phục vụ**, không phải đường biên hành chính/chủ quyền
hay polygon cắt theo đường bờ biển: sông, hồ và phần nước ven bờ trong khung vẫn có
thể xuất hiện. Style/tiles OSM từ nhà cung cấp vẫn giữ nguyên. Map-app độc lập ở
`Maps VN/LifeFlow/map-app` không được sửa trong đợt này; đây không phải frontend
SIU đang phục vụ ở cổng 8503.

## 2. Đường chuyển đồ

Trước sửa, `mv-line` nối thẳng hai điểm A/B. Nay `Frontend/src/movingRoute.ts` gọi
API đọc đã có, dùng **đúng hai tọa độ** của kết quả báo giá:

```text
MovingWorkspace
→ POST /web/api/platform/routes/entities
→ POST /v1/routes/entities
→ RouteEndpointService → RouteService → OSRM driving của thành phố
→ GeoJSON LineString → source mv-line
```

Tuyến ghi rõ **tham khảo · OSRM (ô tô)**. Giá, khoảng cách/phí trên card và thời hạn
báo giá vẫn lấy từ AhaMove. Tuyến này không xác nhận hành trình thực tế của tài xế,
không tính lại tiền và không đặt xe. OSRM chưa có traffic thời gian thực.

Nếu thiếu tọa độ, hai điểm khác khu vực, không có route hoặc API lỗi, frontend giữ
marker/báo giá và thông báo chưa có tuyến; không vẽ đường thẳng thay thế. Request bị
hủy khi rời workspace; đổi tọa độ sẽ lấy lại tuyến.

## 3. Studio 0 → 1

- Đổi **1.521 dòng JSONL** và **1.521 housing.units** từ bedrooms 0 → 1.
- Giữ property_type `studio`; 1 là quy ước một không gian ngủ, không xác minh phòng
  ngủ tách biệt. Studio đã có 1, 2+ hoặc null không bị ghi đè.
- Giữ nguyên **37.409 dòng nguồn còn lại**, tổng file **38.930 dòng**, DB **38.222 unit**.
- ID, giá, tọa độ, ảnh, tiện ích và bảng nguồn/staging không thay đổi. Metadata lưu
  `studio_zero_to_one_v1`, giá trị gốc 0 và thời điểm chuyển.
- Backup và báo cáo nằm ở `data/studio-mainland-map-20261004/`, không commit dữ liệu vào Git.

File nguồn hiện hành: `Maps VN/Data/housing_clean_2026-09-26.jsonl`.
SHA256 sau cả đợt room và studio:
`95c92c1e56046f9f8e7953ff5f0e9c879ff75e3a6b5b14bbb5f6fd1b895953fd`.

Lệnh tái sử dụng cho dữ liệu mới (dry-run trước apply; không chạy lại mù quáng trên
thư mục có backup cũ):

```powershell
python scripts/normalize-housing-room-bedrooms.py --property-type studio
python scripts/normalize-housing-room-bedrooms.py --property-type studio --apply
```

## 4. Kiểm chứng

- So sánh toàn bộ nguồn với backup, toàn bộ unit mục tiêu và fingerprint của unit
  ngoài phạm vi + 8 bảng bảo vệ: chỉ các trường chuẩn hóa được phép thay đổi.
- API detail của 3 studio đã chuyển trả bedrooms 1; tìm studio với filter 1 phòng
  ngủ hoạt động. Studio 0 còn **0** trong DB.
- Tuyến Moving qua gateway thật và OSRM local: HCM **53**, Hà Nội **72**, Đà Nẵng
  **105** điểm; geometry khớp chính xác, tọa độ đầu vào được giữ nguyên.
- Playwright: **10/10 ca desktop/mobile** qua ở lượt cuối (26 giây); camera thật kiểm tra
  zoom-out/pan ra xa, resize 390/1440/3840 px, chọn điểm khác thành phố, viewport
  lớn từ chat; các luồng chọn POI/nhà và báo giá Moving vẫn qua.
- Không chạy LLM, AhaMove hoặc giao dịch provider trong lượt kiểm tra này.

Các báo cáo local: `studio-verification.json`, `moving-route-live-verification.json`.
Build hiện hành được gateway tại 8503 phục vụ; tải lại **Ctrl + F5** để nhận mã mới.
