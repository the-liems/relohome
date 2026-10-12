# ReloHome Housing — kết quả triển khai và kiểm thử

Ngày 12/10/2026. Người dùng đã duyệt triển khai, bao gồm database và khả năng chạy
cloud. Nhánh `feat/housing-management-cloud`, baseline **main `df4999b`** sau khi
PR127 được merge; QuangDung `67a5522` có cùng code tree. Không đổi nhánh main,
không sửa các file crawler/preprocess/presentation của người dùng.

## Thay đổi đã hoàn tất

- Khách/chủ nhà giữ chung tài khoản và cách chuyển workspace. `/admin` có login
  riêng, session workspace riêng, không có đăng ký Admin công khai. Backend xác
  thực trusted gateway actor, kiểm ID Admin và ownership mỗi thao tác; không tự
  duyệt hồ sơ/địa điểm/tin mình quản lý.
- Chủ nhà tạo/sửa nhà, phòng, tin; gallery nhiều ảnh, bìa/thứ tự/xóa, preview riêng,
  checklist thông tin thiếu, lưu nháp, gửi duyệt, ẩn và vacant/rented/paused.
  Retry tạo tin cùng request ID không tạo thêm listing; upload trùng bytes trả
  ảnh cũ. Thay đổi title/description/giá/phí/ảnh/phòng/địa chỉ rút tin về nháp.
- Địa chỉ → Autocomplete v4 → Place v4 → xác nhận pin. Token xác nhận ràng buộc
  user, địa chỉ, tọa độ và expiry. Key chỉ ở server. Nhập tọa độ tay chỉ lưu nháp,
  không giả tọa độ khi provider lỗi. Địa chỉ hai cấp được hỗ trợ; pin gần đúng
  được ghi nhận là approximate.
- Admin có queue/filter/search/detail, chủ nhà/giá/phí/ảnh/pin, review đúng revision,
  reason bắt buộc khi reject và lịch sử quyết định. Hồ sơ/địa điểm dùng workflow
  xác minh thủ công hiện có; không thêm CCCD, AI moderation hay microservice.
- Dashboard tổng quan, danh sách tin theo nhà/trạng thái/tình trạng phòng, drill-down,
  hộp thư có filter, lịch xem gắn cuộc trò chuyện, thống kê 7/30 ngày theo nhà/tin.
  Publication và availability tách biệt; không lấy event save làm số người hiện
  còn lưu. Số liệu dựa trên event thực, timezone Việt Nam.
- Migration 023 additive: revision cho property/unit, approved_revision, location
  confirmation, media metadata, review history, visibility view và trigger đồng
  bộ. Search, Map và MCP dùng cùng public gate. Ảnh chưa công khai cũng bị chặn.
  24 migration records vì baseline có hai migration mang tiền tố 008.
- Docker web/platform/location/migration, cấu hình Coolify server-only key,
  readiness schema, migration advisory lock, volume bền vững, công cụ operator
  tạo Admin và backup SQLite/WAL/ảnh/khóa mã hóa. URL ảnh upload trong snapshot
  local được web client đưa về origin cloud, giữ nguyên canonical data.

## Bảo toàn dữ liệu

Đã pg_dump database local hiện hữu vào file private, restore sang PostGIS tách
biệt và so sánh fingerprint theo ID trước/sau. Places **190.279**, properties
**38.235**, units/listings/offers **38.245**, media **247.527**, map points **38.244**
giữ nguyên các cột cũ. **22 tin managed public và 1 draft** được giữ nguyên.
Các tin crawl không bị coi là draft/unapproved chỉ vì chưa có managed record.
Legacy đã duyệt mà chưa có host profile không bị mất công khai; sửa nội dung
vẫn đưa về nháp và phải theo workflow mới trước khi duyệt lại.

Chi tiết aggregate/checksum: [migration preservation](housing-migration-preservation-2026-10-12.json).
Audit source PR127: [data verification](pr127-housing-data-verification-2026-10-12.md).
Không reimport hoặc chạy geocode hàng loạt. Những pin street/approximate từ
snapshot vẫn cần được nhìn nhận đúng giới hạn; migration không biến chúng
thành tọa độ chính xác hoặc độc lập xác minh toàn bộ tin crawl.

## Kiểm thử đã qua

| Nhóm | Kết quả và phạm vi |
|---|---|
| Build monorepo | `npm run build`: toàn bộ workspaces + MapLibre assets qua. Web final build sau adapter ảnh qua. |
| Python/gateway/deploy | 95 tests + 85 subtests qua: auth/session, ownership proxy, upload, viewing/chat, backups/provisioning, image layout, Coolify config. Operator provisioning không thay trạng thái run đang chạy. |
| Housing/Platform TS | 89 tests qua, 20 test tùy chọn bỏ qua do điều kiện fixture; bộ gallery mới thêm sau đó: 9/9 management integration qua. Dataset API suite chạy riêng trên bản sao chứa POI/admin-area: 12/12 qua. |
| Contract/UI | 42 pure contracts qua. 18 browser checks desktop/mobile qua, có Admin, mapping form, pin reset, filters/drill-down, inbox, dark theme, EN và kiểm accessibility. Provider/form dùng fixture, không gọi key thật. |
| Node CI suite | Contracts 38, MCP core 19, Moving HTTP/fixtures và 41 UI contracts trước khi bổ sung contract ảnh qua; các integration cần domain fixture vẫn được đánh dấu skip như baseline. |
| Migration image | Image runtime chạy đầy đủ migration và app/ingest grants trên DB mới; chạy lần hai giữ nguyên history/checksum. Test dùng PostGIS 16/3.5 native AMD64 của máy hiện tại. |
| MCP runtime image | Kết nối authenticated client: 9 tools, `get_housing` đọc được tin đã duyệt và trả lỗi cho draft. |
| Container end-to-end | Image web + platform với named volume và PostGIS tách biệt: đăng ký, Admin login, owner draft/upload/dedup, chặn ảnh riêng và account khác, duyệt property/tin, public detail/photo, restart còn session/ảnh, edit chuyển private và owner preview. 15 checks qua. |

Browser dependencies thiếu trên máy được đặt trong `/tmp` để chạy test; không
thay dependency repository. Runtime local đã áp dụng migration 023 và restart
web/platform/location. PostGIS/data cũ giữ nguyên. Các service khỏe: web8503,
platform4100, location4300 (`/healthz`/`/readyz`), moving4400, moving-api4200,
flight8765, payment8766, agent8000.

## Cấu hình còn cần từ operator trước khi mở cloud

- Máy local chưa có `VIETMAP_API_KEY`, nên integration với tài khoản Vietmap thật
  chưa được thử; flow/schema/error cases được kiểm qua provider fixture.
- Cập nhật 13/10/2026: tài khoản operator người dùng chỉ định đã được tạo trên
  local, thêm ID vào Platform và kiểm tra Admin login/queue 200; login thường
  của cùng account nhận 403 khi gọi moderation. Mật khẩu nằm trong file local
  ignored, quyền 0600; không ghi vào Git. Account/ID trên cloud được cấp riêng
  theo database web của resource, không dùng nhầm ID local.
- Cập nhật 13/10/2026: người dùng chọn Coolify hiện hữu của repo. Các biến
  staging/production và secrets deploy đã có trên GitHub; CI/deploy staging của
  main `df4999b` đã thành công. Bản nâng cấp cần được review/merge vào main để
  pipeline build và deploy staging; chưa thay đổi service cloud của nhóm. Coolify
  hiện có image PostGIS/routing ARM64; chọn host tương thích hoặc chuẩn bị image
  và graph phù hợp trước khi dùng AMD64.

Hướng dẫn cụ thể: [Housing cloud runbook](../runbooks/housing-cloud.md). Giữ một web
replica/worker và backup ngoài host cho demo cloud. Chưa triển khai dashboard
thu tiền/lease/accounting hoặc mô hình đặt phòng theo đêm; không giả số liệu.
