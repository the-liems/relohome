# Chỉ đường tự fallback công khai — issue #101

## Chẩn đoán

Ảnh đã lấy được GPS, nhưng báo không kết nối routing. Main có một thiếu sót:
`compose.coolify.yaml` không chuyển `OSRM_PUBLIC_DRIVING_URL` vào Platform;
config cũ không có default và public routing sẽ báo `OSRM_OFFLINE` khi thiếu URL.
Đây là thiếu sót đã xác nhận từ code, **chưa phải chứng minh cấu hình thực tế hoặc
egress của server staging**. GET status staging bị HTTP 403 HTML từ môi trường
kiểm tra, không có phiên user/log server để kiểm chứng lượt trong ảnh.

## Thay đổi

- UI không cần checkbox public riêng. Hiện thông báo forwarding/logging và policy
  trước khi xin quyền GPS; gửi `routing_policy: auto`.
- Local-first, một public attempt khi local không hỗ trợ/không dùng được. Public
  chỉ dùng driving, endpoint HTTPS approved; không mở fallback cho MCP/commute.
- Config unset có default approved; compose Platform chuyển config; explicitly
  empty vẫn là kill switch. Không sửa `.env` thật hoặc Roommate.
- Deadline device tổng 20 s, local attempt 2,5 s, public request 10 s, UI 25 s;
  cancel/disconnect không tiếp tục gửi public. Throttle/queue cũ vẫn giữ.
- GPS không đổi, đích đọc canonical Housing SQL, không tạo đường giả hay nới snap
  tự động. Legacy client không gửi policy vẫn local-only nếu chưa chọn public.

Chi tiết và hạn chế production: [ADR-024](../adr/ADR-024-auto-public-device-routing.md).

## Kết quả

Ba kiểm tra thật bằng `scripts/check-device-provider.mjs`, điểm tham chiếu công
cộng, không phải GPS user hoặc dữ liệu nhà bịa:

| Ca | Kết quả | Khoảng cách | Thời gian |
|---|---|---:|---:|
| Hà Nội, local thực sự connection-refused | public_osrm | ~2 km | 631 ms |
| Hải Phòng → Hà Nội, ngoài local | public_osrm | ~116 km | 703 ms |
| TP.HCM → Hà Nội, tuyến xa | public_osrm | ~1.492 km | 1.736 ms |

Đã kiểm tra geometry thật, distance/time dương, snap ≤500 m và input không đổi.
Đây là **provider/service-layer check**, không phải GPS browser + Housing DB E2E.
`scripts/check-device-routing.mjs` đã đổi sang auto cho kiểm thử với listing thật,
nhưng chưa chạy khi local stack/DB không có sẵn.

Contracts: 38 passed. Housing-query unit: 25 passed (gồm 6 policy/config tests mới).
Build contracts, housing-query và platform: passed.
Platform entity-route API: 3 passed; frontend contracts: 8 passed; frontend build: passed.
Chạy toàn bộ housing-query tests gặp lỗi ở hai DB integration suites vì thiếu
`POSTGRES_APP_USER`/DB; không coi đó là kết quả xanh, không sửa harness ngoài scope.

## Bàn giao

Issue → nhánh `fix/101-device-routing-auto` → PR riêng main; không merge/deploy.
Sau deploy kiểm tra SHA, cấu hình URL (không in credentials), DNS/HTTPS egress tới
FOSSGIS và Status/Response `/routes/device`. Nếu vẫn offline, cần log server để
phân biệt upstream timeout/TLS/HTTP, không suy đoán do user chưa cấp GPS.

Không dùng public demo như SLA production; nhiều replicas cần quota chung hoặc
provider riêng. Các thay đổi Moving nằm PR #103 riêng.
