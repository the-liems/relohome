# Bàn giao Admin Ở ghép và gỡ upload ảnh

Ngày: 17/10/2026. Baseline `origin/main:456b6d0`.
Nhánh: `feat/roommate-admin-no-media`. PR: [#220](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/220).
Đã push bản đầu; đang bổ sung hai bản sửa P2. Chưa merge/deploy.

## 1. Những thay đổi đã làm

- Riêng Admin → Ở ghép: header gọn, KPI có liên kết, hai nhóm Báo cáo/Hồ sơ,
  bảng desktop và card mobile. Giữ nhận diện Emerald/Rose, light/dark.
- Tìm tên/giới thiệu/mã, lọc trạng thái/thành phố/nhu cầu/ngân sách và sắp xếp
  trên server; phân trang 20. Ngân sách là VND/người/tháng, lọc khoảng giao nhau.
- Count/list thống nhất TTL: hồ sơ hết hạn không tiếp tục bị coi là đang tìm.
- Drawer thông tin và lịch sử xử lý, footer cố định. Hạn chế/khôi phục cần lý do;
  kiểm tra version trước khi ghi, trả 409 nếu dữ liệu thay đổi. Giữ operation key.
- Chọn nhiều báo cáo trong trang và đánh dấu đã xem xét sau xác nhận. Gọi tuần
  tự; báo thành công/lỗi/chưa gửi, giữ mục thất bại, không tự gửi lại khi refresh.
- Bỏ upload/gắn avatar của user và tab/CTA duyệt ảnh ở Admin, kể cả khi backend
  cũ vẫn quảng bá feature `media`. Gỡ component `AvatarEditor`.

Không đổi thuật toán ghép, consent, quy trình đăng hồ sơ, giới thiệu riêng,
kết nối, chat, quyền Housing Admin hoặc các tab duyệt nhà/người đăng/đánh giá.
Không bổ sung bước duyệt toàn hồ sơ và không cấp quyền cá nhân cho Admin.

## 2. API và tương thích

Các đường dẫn bên dưới là suffix sau `/roommate` ở backend và
`/web/api/roommate` ở gateway.

| API | Thay đổi |
| --- | --- |
| `GET /availability` | Bỏ `media` trong features |
| `POST /media` | Đã đóng, 404/405 |
| `PUT /me/profile/avatar` | Đã đóng, 404/405 |
| `GET /moderation/media` | Đã đóng, 404/405 |
| `POST /moderation/media/{id}` | Đã đóng, 404/405 |
| `GET /me/media`, `GET /media/{id}`, `DELETE /media/{id}` | Giữ quyền truy cập/xóa legacy |
| `GET /moderation/profiles` | Thêm q/city/need/min_budget/max_budget/sort, giữ status/paging |
| `GET /moderation/profiles/{id}` | Mới, projection cho moderator |
| `GET /moderation/profiles/{id}/history` | Mới, phân trang audit cho moderator |
| `POST /moderation/profiles/{id}` | Thêm `expected_version` tùy chọn, giữ client cũ |
| `GET /moderation/reports` | Thêm tên hồ sơ đích nếu nội dung còn được phép đọc |
| `GET /moderation/summary` | Thêm restricted_profiles, pending_media=0 chỉ để tương thích |

Bộ lọc và sort được validate/allowlist. Truy vấn tham số hóa, escape LIKE,
không lấy toàn bộ danh sách về client rồi lọc. SQLite hỗ trợ Unicode casefold;
PostgreSQL dùng LOWER theo collation của database.

Detail/history không đọc hồ sơ nháp/đã xóa, preferences riêng, contact hoặc
tin nhắn. Route mới qua cùng gateway bearer, cookie session và moderator
server như cũ; không tin role/account ID tự gửi từ browser. Restriction vẫn
đóng quyền kết nối/chat theo policy cũ; restore đưa hồ sơ về paused.

Giữ database, MediaService, private blobs và audit ảnh cũ để phục vụ archive,
privacy/export và ảnh đang tồn tại. Không xóa dữ liệu hoặc key. Không thêm
schema migration, dependency, cấu hình CI hay biến môi trường mới.

## 3. Vị trí code

- UI mới: `apps/web/src/admin/roommate/` (Workspace, Details, types, format, CSS).
- Entry cũ: `apps/web/src/roommate/Moderation.tsx` tái xuất workspace dùng chung.
- User: `roommate/MyProfile.tsx`, `Workspace.tsx`; bỏ AvatarEditor.
- Query: `packages/python/roommate/src/relohome_roommate/services/moderation_queries.py`.
- Moderation service, API model và draft normalization trong cùng package.
- API: `roommate_safety.py`, `roommate_media.py`, `roommate_access.py`.
- Gateway: `apps/browser-gateway/src/relohome_gateway/roommate_gateway.py`.

## 4. Kết quả kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| Roommate backend + gateway trên SQLite/PostgreSQL, dữ liệu test riêng | **263 passed** |
| Admin browser, desktop/mobile, light/dark, axe, filter, detail/action, batch lỗi một phần | **14 passed** |
| Browser qua gateway/API/SQLite thật (platform account fixture) | **5 passed** |
| Hồi quy Roommate, Housing và service auth trên desktop/mobile | **128 passed, 2 failed** |
| Production web build TypeScript/Vite | Đạt |
| Ruff và kiểm tra whitespace diff | Đạt |

Hai ca hồi quy thất bại là cùng test `service-auth.spec.ts:329`, desktop/mobile:
"Roommate intro survives expiry and same-account login; a different account
gets a fresh editor". Nút lưu bản giới thiệu vẫn disabled tại bước đổi account.
Lỗi này đã được tái hiện trên baseline main trước các thay đổi Admin. Không
sửa/skip test hoặc hạ assertion; không kết luận toàn bộ regression xanh.

Test đã chứng minh: user không upload dù backend cũ quảng bá media; HTTP cũ
không upload/duyệt được; Admin không cần consent cá nhân; outsider bị từ chối;
version cũ không ghi đè; filter Unicode/TTL/paging; batch lỗi một phần không tự
gửi lại mục thành công; đăng hồ sơ/kết nối/chat và privacy vẫn hoạt động.
Review đã thử đảo điều kiện kiểm tra version: test hồi quy SQLite thất bại đúng
ở ca stale version; sau khi khôi phục source, focused test đạt lại. Test browser
cũng kiểm tra khoảng cách icon tìm kiếm để bắt CSS chung ghi đè padding.

Artifacts local (bị gitignore):

- `apps/web/test-results/admin-redesign-final/`: ảnh Admin light/dark desktop/mobile.
- `apps/web/test-results/admin-redesign-integration/`: tích hợp browser thật.
- `apps/web/test-results/admin-redesign-regression/`: hồi quy và hai failure artifacts.

Kiểm tra đầy đủ sau này có thể dùng các Playwright config đã có:

```powershell
# Từ apps/web; cần backend fixture Python có dependencies của workspace.
node ../../node_modules/@playwright/test/cli.js test roommate-admin.spec.ts --config=playwright.roommate-ui.config.ts
node ../../node_modules/@playwright/test/cli.js test --config=playwright.roommate.config.ts --workers=1
node ../../node_modules/@playwright/test/cli.js test roommate.spec.ts roommate-production.spec.ts housing-product.spec.ts service-auth.spec.ts --config=playwright.config.ts
npm run build
```

## 5. Phát hành và phần chưa xác minh

Build/deploy **cả web/gateway và backend từ cùng revision**. Frontend mới cần
detail/history và filter server mới; không triển khai riêng frontend rồi coi
backend cũ tương thích toàn bộ giao diện quản trị.

Giữ `ROOMMATE_ENABLED`, `HOUSING_MODERATOR_IDS`, DB/private volume và key hiện
có; không thêm biến cho ảnh hoặc moderation mới. Nếu `/availability` vẫn trả
enabled=false, đó là runtime/config cần kiểm tra riêng, bản UI này không tự bật.

PR #220 đã có CI xanh ở commit `a5ac700`; kết quả đó không xác nhận bản sửa P2
chưa push bên dưới. Chưa deploy/smoke cloud và chưa kiểm tra thủ
công zoom 200%/tablet trên bản triển khai. Sau deploy: kiểm tra availability,
đăng nhập Admin duyệt nhà hiện có, mở Ở ghép, lọc/xem hồ sơ, xử lý báo cáo test,
hạn chế/khôi phục tài khoản test, kiểm tra lịch sử và chuyển lại tab Housing.
User không còn upload ảnh nhưng vẫn đăng hồ sơ, kết nối/chat theo consent cũ.

Rollback bằng revision trước cho cả web và backend; không cần hoàn tác schema,
không xóa hoặc tái tạo DB/key.

## 6. Hai lỗi P2 sau review #220

### Khôi phục quyền xóa riêng ảnh cũ

`LegacyPhotos` trong **Hồ sơ của tôi** dùng `GET /me/media`, private image read
và `DELETE /media/{id}` đã có. Có xem ảnh, xác nhận xóa và hủy. Sau khi xóa tải
lại danh sách/profile để lấy avatar và version mới. Không thêm upload, attach,
đổi ảnh hoặc API mới; hồ sơ không có ảnh thì không hiện khối này.

### Dừng batch khi kết quả chưa xác định

Batch dừng theo `RoommateError.code === operation_unknown`, kể cả response
HTML 502, thay vì chỉ dựa trên 401/503. Exception ngoài dự kiến cũng được xem
là chưa rõ kết quả và dừng. Phân biệt thành công / lỗi / chưa rõ / chưa gửi;
chỉ bỏ chọn mục đã xác nhận thành công. Refresh không gửi mutation trở lại.

### Kiểm thử bổ sung

- Hai ca tái hiện mới thất bại trên code trước sửa ở cả desktop/mobile (4 failed).
- Sau sửa: **34/34 browser Admin + production Roommate**, **6/6 tích hợp thật**.
- Hồi quy tìm/đăng/kết nối/chat và privacy Roommate: **42/42 browser**.
- Backend/gateway chạy lại với SQLite và PostgreSQL test riêng: **263 passed**,
  không bỏ qua ca PostgreSQL. Đây là local, chưa xác minh database staging.
- Tích hợp seed ảnh lịch sử qua MediaService nội bộ trong DB test; HTTP upload
  vẫn đóng. Sau xóa avatar=null, version tăng một, content/state giữ nguyên,
  không đọc lại được ảnh. Không seed vào runtime hoặc DB người dùng.
- Build TypeScript/Vite và Ruff đạt. CI commit mới sẽ cập nhật sau push;
  không lấy CI xanh commit cũ làm kết quả của bản sửa.
- Lần tích hợp đầu bị nhiễu vì build thay static assets trong lúc chạy test;
  chạy lại sau khi build hoàn tất đạt 6/6, không hạ assertion hoặc bỏ test.
