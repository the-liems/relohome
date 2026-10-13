# Map Việt Nam, hai ô Moving A/B và khởi động local — 04/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Yêu cầu hiện hành

- Mở camera xem Việt Nam, thay giới hạn riêng ba thành phố ở đợt trước.
- Moving chỉ có hai ô địa chỉ A/B; nhập ngay trong ô để tìm gợi ý rồi chọn.
- Giữ chat, chọn trên map, ngày/giờ và hợp đồng gửi báo giá hiện có.
- Giữ studio 0 → 1 đã thực hiện. Không sửa logic agent, báo giá, đặt đơn hay `.env`.

## 1. Hai ô A/B

Trong `Frontend/src/components/ServiceWorkspaces.tsx`, form Moving hiển thị:

- **A · Điểm lấy đồ**: ô địa chỉ và danh sách gợi ý ngay bên dưới.
- **B · Điểm giao đồ**: cùng cách dùng; căn đã chọn vẫn có thể điền sẵn điểm đến.
- Ngày chuyển, giờ xe đến và nút **Xác nhận và lấy báo giá** giữ nguyên.

Từ 2 ký tự, đợi 400 ms sau khi gõ rồi gọi `/web/api/map/search` có sẵn. Enter có
thể tìm ngay. Không có ô tìm thứ ba hay nút Tìm. Chọn gợi ý điền tên vào đúng ô,
ghim tọa độ và focus map; chạm map vẫn chọn điểm cho ô đang hoạt động.

Đổi địa chỉ bỏ pin cũ để xác nhận lại. Khi đổi ô/nội dung hoặc rời workspace,
request tìm cũ bị hủy và kết quả hết hiệu lực không cập nhật vào ô mới.
ID/alias vẫn dùng bộ gộp POI hiện có. Không tự gửi báo giá khi tìm/chọn;
payload `moving_locations` giữ address, lat, lng, confirmed như trước.

## 2. Camera và tuyến tham khảo

`Frontend/src/mapScope.ts` dùng khung hiển thị `[101, 7]` → `[118, 24.5]`.
Có thể kéo/thu nhỏ xem Việt Nam, fit các điểm khác thành phố và focus điểm ngoài
ba vùng dữ liệu OSRM. Không thêm nút đổi thành phố. Áp dụng cho MapPanel, map
phóng lớn, workspace nhà, form Moving và workspace báo giá Moving.

Đây là khung camera chữ nhật, không phải polygon biên giới. Một phần nước lân cận
vẫn có thể xuất hiện trong khung. Style, tile và nhãn của provider không đổi.
Map-app độc lập trong `Maps VN/LifeFlow/map-app` không thay đổi.

Tuyến Moving vẫn lấy GeoJSON thật từ API đọc OSRM hiện có; không quay lại đường
nối thẳng A/B. **Coverage OSRM vẫn chỉ TP.HCM, Hà Nội, Đà Nẵng**; hai điểm phải
thuộc cùng vùng có dữ liệu để lấy tuyến tham khảo. Chưa có tuyến thì giữ marker
và báo giá, thông báo thiếu tuyến; không dùng route này tính lại phí AhaMove.

## 3. Lỗi runtime tìm thấy và đã khắc phục

Tại đầu lượt kiểm tra, Docker Desktop và cả sáu process ứng dụng không chạy.
Đã khởi động Docker, PostGIS, 9 OSRM và các process Location, Platform, Moving
MCP, Moving API, Agent API, UI bằng runner hiện có, ở chế độ không cho giao dịch.

Moving `/health` trả 200 nhưng `/ready` trả 503: thiếu toàn bộ 5 bảng
`moving.quotes`, `approvals`, `order_actions`, `orders`, `webhook_events`.
Đã chạy:

```powershell
.venv/Scripts/python.exe scripts/local-integration.py migrate
```

Chỉ migration **008_moving_service.sql** có sẵn được áp dụng mới; các migration
đã áp dụng được bỏ qua, quyền service được cấp bằng runner cũ. Moving API 4200
và MCP 4400 `/ready` sau đó trả **200**. Không viết migration mới hoặc sửa source
backend trong lượt này. Không kết luận mọi lỗi Moving cũ đều do OSRM: lịch sử
được kiểm tra chưa chứa một báo giá lỗi có geometry để tái hiện đúng lượt đó.

## 4. Bằng chứng kiểm tra

| Kiểm tra | Kết quả |
| --- | --- |
| TypeScript + Vite production build | Qua, gateway 8503 phục vụ đúng `Frontend/dist/index.html` |
| Playwright desktop/mobile | 14 ca map, nhà, Moving qua; bổ sung cả hai ô A/B tự tìm: 2 ca qua. Sau chỉnh trạng thái hủy tìm, chạy lại 6/6 ca form/POI/A-B qua. 16 ca khác nhau được kiểm tra, không chạy lại toàn bộ suite |
| Camera MapLibre thật | Kéo/zoom/resize 390, 1440, 3840 px trong khung Việt Nam; fit HN/HCM; focus Đà Lạt ngoài 3 vùng OSRM |
| Tuyến gateway → Platform → OSRM local | HCM 53, Hà Nội 72, Đà Nẵng 105 điểm; geometry khớp chính xác, tọa độ đầu vào giữ nguyên |
| Readiness / UI | Platform4100 `/health`, Moving4200/4400 `/ready`, Agent8000 `/health`, UI8503 `/ai` đều 200 |
| MovingRepository thật, credential runtime | Lưu/đọc quote thử thành công; ROLLBACK và xác minh quote không còn. Không gọi provider |
| Hai tool đọc catalog AhaMove staging qua MCP thật | `list_service_areas` trả 71 thành phố; `list_moving_services` trả 5 dịch vụ tại thành phố được kiểm tra |

Kiểm tra này có **0 LLM**, **0 báo giá provider**, **0 đặt đơn**, **0 thanh toán**.
Lưu/đọc quote thử kiểm tra database, không chứng minh provider đã báo giá thật.
Test UI dùng fixture; chất lượng hội thoại và báo giá qua LLM cần test tương tác
tiếp theo của người dùng.

Báo cáo local (không commit dữ liệu/key):

- `data/country-map-moving-20261004/moving-route-live-verification.json`.
- `data/country-map-moving-20261004/moving-storage-verification.json`.
- `data/country-map-moving-20261004/moving-catalog-verification.json`.
- Log startup: `data/startup-country-map-20261004-231210/`.

## 5. Test giao diện

Mở **http://127.0.0.1:8503**, tải lại **Ctrl + F5**. Trong Moving, gõ vào A/B,
chọn gợi ý hoặc chạm map, điền ngày/giờ rồi xác nhận lấy báo giá. Việc tìm/chọn
địa điểm không tạo đơn. Dịch vụ vẫn cần key/LLM hiện có để xử lý lượt chat.

Chuẩn hóa studio đã hoàn thành ở đợt trước, không chạy lại trong đợt này:
[báo cáo studio](mainland-map-moving-studio-update-2026-10-04.md).
