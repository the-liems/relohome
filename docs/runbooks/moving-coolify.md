# Moving service: contract bàn giao Coolify staging

Đây là contract Moving cho teammate infra. Stack tích hợp dùng
[compose.coolify.yaml](../../compose.coolify.yaml) và [runbook deployment](../../deploy/README.md);
không tạo resource, domain hay token Coolify từ workspace.

## Images và processes

Build từ `deploy/moving/Dockerfile.moving`, context gốc repository (`.`):

| Target / image suffix | Start command | Port | Loại |
|---|---|---|---|
| `moving-mcp` | `node --import @relohome/telemetry/register moving-mcp-server/dist/http-server.js` | 4400 | Private MCP application |
| `moving-api` | `node --import @relohome/telemetry/register moving-api/dist/server.js` | 4200 | Webhook application |
| `moving-migrate` | `node packages/moving-service/dist/migrate.js` | Không | One-off migration job |

Workflow `CI` publish dưới
`ghcr.io/ai20k-build-phase-cohort-4/p-044/moving-{mcp,api,migrate}:<commit-sha>`.
`Moving containers` chỉ validate và kiểm tra staging thủ công. Coolify đọc Compose
từ Git tại commit đã chọn; `SOURCE_COMMIT` chọn tag SHA cho ba image.
Cùng `RELEASE_SHA` cho ba image; không dùng `latest`.

## Runtime configuration

Hai app cùng cần `AHAMOVE_ENV=staging`, `AHAMOVE_API_KEY`, `AHAMOVE_MOBILE`
hoặc `AHAMOVE_USER_TOKEN`, và `MOVING_DATABASE_URL` dùng role runtime riêng
(`p044_moving_app` mặc định trong stack Coolify; tên theo environment nếu dùng chung cluster).
DB URL này ưu tiên hơn `DATABASE_URL` của backend Python. Password trong URL
cần percent-encode nếu có ký tự đặc biệt. Dùng secret storage của infra.

MCP cần `MOVING_MCP_AUTH_TOKEN` (ít nhất 32 ký tự). Compose đặt
`MOVING_MCP_ALLOWED_HOSTS=localhost,127.0.0.1,moving-mcp`. Nếu dùng hostname khác,
đổi danh sách trong Compose theo Host mà proxy/AI thực sự gửi; không dùng wildcard.
`MOVING_MCP_ALLOWED_ORIGINS` để trống khi chỉ backend gọi. Container mặc định
bind `0.0.0.0`, port 4400; giao diện stdio vẫn có thể chạy bằng command override.

Compose cố định `AHAMOVE_WEBHOOK_AUTH_MODE=api-key`; API cần
`AHAMOVE_WEBHOOK_SECRET` thống nhất với AhaMove và header `apikey`. Không dùng
MCP token làm webhook secret. HTTP callback cần HTTPS ingress ổn định do infra
cấp riêng; stack Coolify hiện chỉ có domain cho web.

Credential DB của migration job là `MOVING_DATABASE_ADMIN_URL`, `MOVING_DB_APP_USER`
và `MOVING_DB_APP_PASSWORD`. `MOVING_DB_APP_USER` mặc định là `p044_moving_app` trong
stack Coolify; khi dùng chung cluster, chọn role riêng như `moving_app_staging`
và dùng đúng role đó trong runtime URL. Runtime app không nhận credential admin.
Job dùng lại migration canonical `008_moving_service.sql` và bổ sung audit table,
không tạo dữ liệu mẫu, không cần PostGIS. Runtime được giới hạn các bảng Moving
và INSERT vào audit. Không chạy đồng thời migrator ReloHome cũ và Moving migrator.

Giữ `AHAMOVE_WRITE_ENABLED=false`, `AHAMOVE_RATING_ENABLED=false`,
`AHAMOVE_PRODUCTION_ENABLED=false` cho giai đoạn discovery/read-only staging.

Khi tích hợp transaction: cấp riêng `MOVING_MCP_WRITE_TOKEN` cho MCP/backend
(13 tool), giữ `MOVING_MCP_AUTH_TOKEN` chỉ đọc (9 tool). Cấp
`MOVING_APPROVAL_TOKEN` riêng cho API/backend, tối thiểu 32 ký tự mỗi token.
Backend gọi `http://moving-api:4200/v1/internal/moving/approvals` trên mạng riêng.
Public ingress chỉ mở đường webhook, không mở đường approval. Không cấp các
token ghi/approval cho subagent hay frontend. Bật ghi staging là thao tác
operator có chủ đích sau UAT approval, không tự bật cùng release.

## Deploy sequence

1. Chuẩn bị PostgreSQL, secret storage và network cho staging. Mỗi environment có
   database/roles/credentials riêng; không dùng chung database hoặc schema `moving`
   và `audit` với production. Postgres chung của đội chỉ phù hợp nếu tách database,
   đặt tên role riêng theo environment và xác minh cả role migration lẫn runtime
   của staging không thể kết nối hay sửa dữ liệu/roles của production. Migrator
   hiện tại tạo/đổi password role, nên không cấp quyền admin toàn cluster nếu
   cluster chứa production. Nếu chưa chứng minh được giới hạn quyền này, dùng
   PostgreSQL instance riêng cho environment (có thể trên cùng host). Đây là
   đường triển khai hiện tại: admin chỉ quản lý instance của environment đó.
   Shared cluster chưa được hỗ trợ bởi handoff này nếu chưa có thiết kế quyền
   được kiểm thử cho cả CREATE ROLE và ALTER ROLE; chỉ tạo sẵn runtime role
   không đủ vì migrator luôn ALTER ROLE để đặt password. Không bỏ quyền cần
   thiết rồi kỳ vọng migration vẫn chạy, và không mở rộng quyền staging sang
   production để tránh lỗi quyền.
   Xác minh database đích trong cả hai URL trước khi chạy migration.
2. Backup trước thay đổi schema có dữ liệu; dispatch `deploy.yml` với environment
   và SHA main đã chọn. Compose chạy `moving-migrate` sau khi `moving-db` healthy.
3. Chỉ khi job exit 0 mới khởi động hai app bằng tag SHA đã chọn.
4. Health check container: GET `/ready` trên port tương ứng, interval 15s,
   timeout 10s, start period 20s, retries 3. `/health` dùng cho liveness.
5. Cho AI Service kết nối MCP qua mạng riêng và bearer token; cấu hình TLS nếu
   request đi qua mạng không tin cậy. Chỉ expose callback ra Internet.
6. Verify release qua `/health`, schema/grants qua `/ready`, và chạy
   `scripts/relohome/verify-moving-deployment.mjs` với `MOVING_MCP_URL`, `MOVING_API_URL`,
   `MOVING_MCP_AUTH_TOKEN`, `RELEASE_SHA`. Script chỉ gọi đọc AhaMove staging.
7. Lưu kết quả kiểm tra gắn với SHA thực chạy; báo deploy fail nếu readiness
   hoặc smoke test fail. Job CD chờ deployment finished, commit khớp và Application
   running:healthy. Production chọn cùng SHA bằng workflow thủ công.

## Runtime / recovery

- User non-root; Compose drop capabilities và bật no-new-privileges.
  Root filesystem read-only và `/tmp` tmpfs là đề xuất hardening, chưa có trong stack Coolify.
- Đề xuất khởi đầu 512 MiB RAM / 1 CPU mỗi app; Compose hiện chưa đặt limits.
  Điều chỉnh theo đo đạc, không phải SLA.
- Graceful stop ít nhất 35 giây; tránh kill giữa thao tác provider đang xử lý.
- Không mount Docker socket vào app. DB không public, domain state ở PostgreSQL.
- Log JSON không in Authorization, API key hoặc body nghiệp vụ MCP.
- Container rollback chỉ đổi image/config, không đảo schema, order hoặc booking.
- Sao lưu DB và thử restore trước production. Không xóa volume khi cập nhật app.
- Write UAT, webhook delivery thực tế và kết nối human-approval backend vẫn là
  điều kiện trước khi bật thao tác ghi. HTTP transport không tự bổ sung UI approval.
