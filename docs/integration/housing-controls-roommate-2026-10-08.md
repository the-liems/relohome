# Bàn giao — so sánh Housing, chỉ đường và Roommate

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Theo [issue #79](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/79),
[SPEC-020 (Draft)](../specs/SPEC-020-housing-controls-roommate-discovery.md).
Nhánh giao: `khoa`; PR riêng vào `main`, chưa tự merge/deploy.

Follow-up nghiệm thu vị trí: [issue #81](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/81).
Device directions đã có route lỗi rõ ràng, map GPS, và đường xa qua OSRM công khai
sau checkbox + hành động đồng ý riêng. Không dùng public làm fallback tự động cho
agent/MCP/commute. Xem [ADR-023](../adr/ADR-023-consented-public-device-routing.md)
và [kết quả 3 tuyến thật](../../eval/device-routing-2026-10-08.md).

## Những thay đổi trong lần này

- Danh sách và chi tiết nhà trên map có nút **So sánh**. Khay giữ 2–4 căn cụ thể,
  bỏ từng căn/bỏ tất cả, giữ các căn khi khám phá map. Bảng đọc lại chi tiết thật
  song song, có trạng thái chờ/lỗi từng lượt và nhắc dữ kiện còn thiếu. Không đổi
  căn đã chốt, kế hoạch hoặc Moving; không gọi Intake/Planner/LLM.
- **Chỉ đường** xin quyền vị trí trình duyệt sau khi bấm, lấy tọa độ mới của thiết
  bị, gọi Platform `routes/entities` với điểm đến Housing ID được backend đọc lại.
  Có khoảng cách, thời gian tham khảo và route trên map; có cảnh báo sai số thiết
  bị/địa chỉ gần đúng. GPS hoặc route không khả dụng thì báo lỗi, không dùng điểm
  giả hoặc đường thẳng thay tuyến đường. Tọa độ chỉ giữ trong component, không ghi
  vào hồ sơ/chat. Hủy đóng dialog bỏ callback đến muộn và hủy request.
- Bỏ icon mở tin gốc ở **footer chi tiết trên map**. Metadata nguồn và các chỗ
  hiển thị nguồn khác không bị xóa.
- Roommate có lựa chọn nguồn **Hồ sơ thật / Trải nghiệm hồ sơ DEMO** rõ ràng. File
  DEMO được cấu hình hiện ra thành danh sách hồ sơ, không chỉ marker trên map.
  Không trộn DEMO vào hồ sơ thật, không có nút lấy liên hệ/kết nối DEMO.
- Danh sách thật tự tải thành phố mặc định/đã lưu; đổi thành phố tự tìm. Nút tìm
  nằm ngay dưới thành phố; thông tin cá nhân và lọc nâng cao mặc định thu gọn.
  Bộ lọc đã đặt có số lượng và nút xóa, không âm thầm xóa tiêu chí đã lưu. Các nhóm
  khu vực/ngân sách/thời gian/thói quen được tách dễ đọc, không hạ validation hoặc
  bỏ tuổi/điều khoản/preview/consent khi đăng hồ sơ thật.
- Bỏ ResizeObserver trùng trong Housing map: `installMapScope` đã có observer
  kiểm tra kích thước; resize dư có thể ngắt camera lúc thay đổi nội dung sidebar.

## Kiểm chứng

- TypeScript/Vite build: đạt.
- 7 contract tests frontend: đạt; chỉ kiểm tra state/validation, không giả provider.
- 46 tests Python liên quan comparison/progress/memory/DEMO và health readiness: đạt
  sau khi đồng bộ `main`.
- `ruff check src/ tests/`: đạt trên nền local lúc kiểm tra.
- Browser + gateway/API/Location/PostGIS thật: so sánh 4 căn, giới hạn căn thứ 5,
  bỏ một căn, chi tiết không còn source icon, lỗi quyền GPS, giữ nguyên revision
  và selected state, mở bảng trên mobile: đạt. Thao tác sau bước chat ban đầu có
  **0 chat/action/transaction writes**, không gọi LLM.
- Browser Roommate thật: bộ DEMO cấu hình có danh sách; không có thao tác kết nối;
  chuyển nguồn thật, tự tải danh sách, field tùy chọn đóng, không đưa DEMO vào kết
  quả thật, kiểm tra chiều rộng mobile: đạt.
- Lượt Housing đầu chọn vùng toàn Hà Nội chưa zoom nên chưa có từng card; sửa
  harness để zoom map thật, không tạo dữ liệu hoặc gọi lại prompt trả phí. Một lượt
  sau camera/list thay đổi trong khi click; bỏ observer resize trùng và chạy lại
  thành công. Các lượt kiểm tra UI dùng lại hội thoại **của harness riêng**, không
  phát lại/mô phỏng provider và không sửa hội thoại của người dùng.

Lệnh opt-in ở `Frontend/` (cần các local service thật đang chạy):

```powershell
npm run build
npx playwright test --config=playwright.contracts.config.ts
$env:RUN_HOUSING_CONTROLS_LIVE='1'
npx playwright test --config=playwright.housing-controls.config.ts
```

Browser harness dùng DB riêng trong `logs/local/issue79-browser-*`; không tạo
listing/real profile hoặc đặt xe/thanh toán. Snapshot/log/screenshots riêng không
commit. Không bật `--payment-demo` để kiểm thử các thao tác này.

## Những điều chưa được chứng minh

- Browser tự động kiểm tra **lỗi/không cấp quyền GPS**, không bịa tọa độ để giả
  thành công. Cần người dùng thử cấp quyền thật trên máy/điện thoại để nghiệm thu
  đường từ vị trí thiết bị thực tế. HTTPS/localhost và quyền định vị OS phải bật.
- Vùng đường nội bộ là các dataset OSRM cấu hình. Device directions công khai có
  opt-in đường xa, nhưng không cam kết SLA/đường toàn quốc chính xác hoặc giao thông
  thực tế; dịch vụ do FOSSGIS vận hành có lưu log request.
- Hồ sơ thật trống là trạng thái đúng khi chưa có người chủ động đăng. DEMO là dữ
  liệu tổng hợp, không phải bài đăng của người thật. Production không bật DEMO.
- Đây không phải chứng nhận toàn bộ project/CI hoặc bản deploy production.

## Phạm vi PR tích hợp

Theo xác nhận của Khoa, PR `khoa → main` có **cả nền tích hợp** đã lấy từ QuangDung
(Housing/Map/Roommate/UI và checkout/Flight khứ hồi), không chỉ diff issue #79.
Cần các chủ service review cả phần nền; không coi xác nhận UI là xác nhận giao
dịch/provider thật. Cấu hình vận hành vẫn có gate riêng; không tự bật flight
simulation, payment demo hoặc tester-confirm.

### Kết quả kiểm tra nền sau đồng bộ main

Giữ các sửa CI/CD mới trên `main`; không chạy deployment. Gateway chỉ còn một
endpoint `/health`, dùng kiểm tra SQLite readiness từ `main`, không để các probe
local cũ che mất endpoint này.

Lượt chạy toàn bộ Python trên Windows ban đầu: **653 passed, 89 skipped,
34 failed, 8 errors** (kết quả trước khi sửa health và cô lập lại môi trường test).
Không được diễn giải các bài riêng đạt là toàn bộ CI đạt. Kiểm tra lại các bài
thất bại với UTF-8 và Roommate tắt cho test API không liên quan vẫn còn:

- Map planner: kỳ vọng task/anchor cũ chưa khớp luồng hiện tại.
- Moving: fixture cũ thiếu `catalog_cache`/`moving`; contract catalog có thêm
  `delivery_type` so với kỳ vọng cũ.
- Flight: danh sách tool kỳ vọng chưa có `search_return_flights`.
- API: fixture kiểm tra `initialize_agents()` chưa nhận tham số
  `roommate_runtime=None` mới.
- Các bài runner/smoke dành cho Linux gặp Bash/symlink privilege trên Windows;
  phải xác nhận lại trên runner Linux, không tự bỏ bài khỏi CI.

Không tạo mock provider hay mock test mới để né các lỗi. PR tích hợp ở trạng thái
Draft để review được ngay, nhưng **chưa đủ điều kiện merge**: cần giải quyết
tương thích nền và CI thật. Log kiểm tra lại riêng nằm
ở `logs/local/issue79-main-recheck.txt`, không đưa vào Git.

ZIP `project-data-quangdung-20261008.zip` không còn lưu trong Git (#164); nhóm gửi
trực tiếp khi bàn giao máy mới. File JSON 30 hồ sơ có trong Git và file local người
dùng cung cấp đều dùng được độc lập; không cần ZIP đó hoặc restore DB để thử Roommate.

`.env` và bản `roommate-demo-30.json` ở gốc do người dùng cung cấp giữ nguyên,
không đưa vào commit. Chọn đường dẫn qua `ROOMMATE_DEMO_DATASET` rồi restart API
nếu trước đó đang chạy với cấu hình cũ. Giao diện mới chỉ cần build và tải lại.
