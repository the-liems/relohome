# Bàn giao — search scope, luồng dịch vụ và Roommate DEMO (08/10/2026)

Issue: [#73](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/73).
PR: [#74](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/74) (Draft, chờ review/dependency).
Requirements: [SPEC-018](../specs/SPEC-018-search-scope-and-roommate-map.md), Draft.
PR nối tiếp trên `fix/70-workspace-repairs` (#71); #71 đang dựa trên QuangDung.
#42 chưa merge tại lúc kiểm tra; không đổi base sang main trước khi dependency sẵn sàng.

## Những điểm sửa

1. Location trả GeoJSON polygon/multipolygon khi `include_geometry=true`, mặc định
   false. Housing scope dùng đúng ID khu con, không OR với ID thành phố làm mở rộng
   tìm kiếm. Local hiện có **Phường Cầu Giấy**, không có polygon quận cũ được xác nhận.
2. Map vẽ đường bao thật; circle chỉ cho "gần địa điểm". Bbox chỉ là envelope/viewport,
   không phải boundary hành chính. Boundary thiếu không bị thay bằng đường bao giả.
3. Pan map giữ center/radius. Backend hỗ trợ bbox AND radius; trường hợp chứng minh
   giao rỗng trả rỗng sớm bằng bounding extent bảo thủ. Đây không phải cache hay tự
   nới tìm kiếm; trường hợp cực/dateline/không chắc vẫn để PostGIS quyết định.
4. Workspace ready (nhà/chuyến bay) được xem trước form Moving thiếu thông tin.
   Sau chọn, dùng progress mới để mở dịch vụ tiếp. Đã sửa lỗi dựa vào `intake.domains`
   không được serialize trong API; không dùng keyword người dùng để đoán pending service.
   Back về chat giữ ở chat, các kết quả vẫn mở lại từ Kế hoạch.
5. Kết quả đã chọn được xác nhận ngắn trong chat; nội dung cũ vẫn có ở mục mở rộng.
   So sánh/order và kết quả nhiều dịch vụ chưa chọn đủ không bị tự giấu.
6. Roommate có liên kết phòng tự nguyện (`has_room` + explicit room opt-in), backend
   đọc listing thật trước save/publish. Marker thật chỉ cho active/chưa hết hạn,
   đủ điều kiện truy cập, không block/restricted. Không trả contact.
7. Bổ sung 100 người DEMO ở dataset riêng, không seed DB người thật. 60 hồ sơ có
   phòng minh họa, 40 cùng tìm nhà; Hà Nội 34, HCM 33, Đà Nẵng 33. Không tạo accounts,
   không tạo consent, không cho kết nối/contact với người giả. Namespace `demo_`
   không được làm authenticated actor. Vàng/nhãn chi tiết phân biệt DEMO với người thật.
8. Workspace Housing khởi tạo data/source khi style sẵn sàng, không chờ mọi tile
   nền tải xong mới truy vấn Housing. Chú giải đặt trong layout, không che nút Back.

Không bỏ Intake/Planner/domain LLM, không cài Redis, không deploy, không đặt xe/thanh toán.
Thao tác xem/chọn/pan vẫn là structured action; geometry phục vụ UI không vào context
LLM quyết định. Không hardcode tên thành phố/khu vực/tọa độ làm đường đi đặc biệt.

## Mở thử trên máy Khoa

Server hiện chạy ở `http://127.0.0.1:8503`. Reload trang sau frontend build.
Hỏi: **Tìm phòng trọ ở Cầu Giấy, Hà Nội dưới 6 triệu/tháng. Sau khi tôi chọn nhà
thì chuyển đồ từ Đại học Bách khoa Hà Nội đến căn đó. Chưa đặt xe.**

- Xem tên scope Phường Cầu Giấy và polygon đỏ nét đứt, không phải vòng tròn tâm quận.
- Căn có DEMO minh họa ghép trọ có pin vàng, nhãn DEMO và chi tiết rõ nguồn.
- Chọn một căn → form Moving giữ thông tin đã biết, hỏi ngày/giờ chưa có.
- Back → chat; Kế hoạch → Tìm nhà mở lại kết quả. Không cần nhắc lại yêu cầu.
- `/roommate?tab=demo`: phân trang người giả. Người dùng chưa đồng ý Roommate vẫn
  không có quyền discovery thật chỉ vì đã xem DEMO.

## Cách tái tạo DEMO trên máy teammate

Sau khi cấu hình Location và bật các dịch vụ đọc thật:

```powershell
.venv/Scripts/python.exe scripts/generate-roommate-demo.py --output logs/private-roommate/demo-100.json
# Tuỳ chọn phạm vi minh họa: resolve khu vực thật, không thay đổi search production
.venv/Scripts/python.exe scripts/generate-roommate-demo.py --output logs/private-roommate/demo-100-focused.json --area 'hanoi:Cầu Giấy'
```

Script từ chối ghi đè. Generator gọi search_areas/search_housing thật, không gọi LLM.
Nếu dữ liệu/ID nhà khác nhau, generate lại trên DB của máy đó; không copy claim về người
đang ở phòng. Dataset hết hạn sau 30 ngày; cần generate file mới và chủ động đổi path.

Trong `.env` local (không commit):

```dotenv
ROOMMATE_DEMO_ENABLED=true
ROOMMATE_DEMO_DATASET=logs/private-roommate/demo-100-focused.json
```

Giữ cấu hình Roommate runtime/token/moderator hiện có, không thay key/private DB.
Restart API để nạp dataset. Production từ chối DEMO; default `.env.example` là false.
Máy Khoa hiện dùng `logs/private-roommate/demo-100-v2.json`, giữ v1 để truy vết.

## Kiểm chứng local (không phải CI green)

| Nhóm | Kết quả | Phạm vi |
|---|---|---|
| Roommate Python | 164 pass | SQLite/ASGI/lifecycle thật; 5 test thêm về room contract, access/block/restriction/expiry, thiếu provider và cấm DEMO production |
| TS Contracts | 34 pass | Geometry opt-in, ring/holes, bbox AND radius; toàn bộ package contracts |
| Spatial scope | 2 pass | Chỉ short-circuit giao rỗng được chứng minh, không loại sai vùng cực/dateline |
| MCP/PostGIS live | 3 pass | Polygon ward thật, giữ radius khi pan, cấu trúc/đếm 100 DEMO riêng; 0 LLM |
| Browser + UI contracts | 6 pass | 4 pure contract checks; 2 actual Chrome/provider tests (DEMO isolation và workflow đọc lại hội thoại thật) |
| Build | pass | Frontend TS/Vite và 8 packages LifeFlow |

Đã kiểm tra cả một hội thoại mới với LLM thật. Harness ban đầu timeout 15s trước
response, trong khi server đã hoàn thành và lưu kết quả; nâng timeout dành riêng cho
chat lên 120s, mở lại **chính hội thoại mới** để kiểm tra polygon → Back → chọn nhà
→ form Moving → chat ngắn → Kế hoạch → pin vàng/detail DEMO, không gọi lại LLM.
Không xem thời gian replay UI 6–8s là latency chat/LLM mới.

Browser dùng session của tài khoản test tự đăng ký trong DB web dùng riêng, không
đọc session người dùng. Không intercept/fulfill provider responses. Screenshot/log
trong data/ và profile DEMO trong logs/ được ignore, không publish như dữ liệu thật.

Đã bắt và sửa: chú giải che nút Back; pending domain không serialize;
map pan ra ngoài radius bị query timeout; phụ thuộc load tile khi mở lại workspace.
Chạy nhầm lệnh package housing-query toàn suite khi chưa có POSTGRES_APP_USER báo lỗi
cấu hình integration; suite spatial được chạy riêng và live PostGIS được xác nhận như trên.
Không đổi fixtures hay giả provider để biến lượt chạy thiếu cấu hình thành pass.

CI không tự trigger cho PR base nhánh feature vì workflow đang lọc PR main.
Sau dependency merge/retarget cần CI và review. Không tự merge chỉ vì local tests pass.

Toàn suite Python trên publication branch: **527 pass, 30 fail, 87 skip**.
Chạy cùng môi trường trên base #71: **522 pass, 30 fail, 84 skip**;
so sánh từng test ID cho thấy **không có failure mới hay failure bị che mất**.
30 failure có sẵn (Flight/API/Moving và fixtures cũ), vẫn cần owner/CI xử lý.
Đã cập nhật một assertion contract cũ để tính `include_geometry=true`;
không tạo hoặc sửa provider fixture để ép test xanh.

Để phép so sánh không bị live-test collection nạp `.env` local, dùng
`PYTHON_DOTENV_DISABLED=1`, `ROOMMATE_DEMO_ENABLED=false`,
`LANGSMITH_TRACING=false`, `APP_ENV=test` và key test không có giá trị sử dụng.
Lượt chưa cô lập báo 45 fail do nhiều test thừa hưởng cấu hình live/DEMO;
không coi đó là kết quả CI chuẩn. Build trên publication sạch cũng đã pass,
không chỉ build root integration checkout.

`npm ci` LifeFlow vẫn báo high-severity dependency advisories (trong đó
`source-map-js`). Lockfiles không đổi trong PR này; không tự chạy audit fix hay
trộn nâng dependency vào tính năng. Cần chủ CI/security xử lý trước release.

## Giới hạn còn lại

- Liên kết room là thông tin tự khai, **chưa xác minh đang ở/được phép đăng phòng**.
  Chưa có check tự động room ↔ city/area của hồ sơ; cần review trước mở rộng production.
- Chỉ căn có tọa độ Housing mới hiện trên map; pin gần đúng không biến thành rooftop.
  Cụm trùng tọa độ ghi số phòng có nhu cầu, không nói tất cả cùng một phòng.
- Provider được kiểm ở thời điểm save/publish; không cam kết freshness/occupancy liên tục.
- Map Roommate refresh mỗi 30s/visibility/filter; removal sau pause/block có thể cần
  lượt refresh, không phải realtime websocket.
- Với repository lớn, cần query/index room lookup thay cho scan hồ sơ; chưa tự thêm Redis
  hoặc cache nội dung nhạy cảm. Không tuyên bố đã hoàn thành performance/load/security audit.
- Bộ 26/36 lượt chat cũ và mọi provider giao dịch không chạy lại trong lượt này.
