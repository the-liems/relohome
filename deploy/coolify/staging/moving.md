# Moving service: contract bàn giao Coolify staging

Đây là đặc tả resource cho teammate infra, không phải file Coolify tự thực thi.
Chưa tạo resource, domain hay token Coolify từ workspace.

## Images và processes

Build từ `Maps VN/LifeFlow/Dockerfile.moving`, context `Maps VN/LifeFlow`:

| Target / image suffix | Start command | Port | Loại |
|---|---|---|---|
| `moving-mcp` | `node moving-mcp-server/dist/http-server.js` | 4400 | Private MCP application |
| `moving-api` | `node moving-api/dist/server.js` | 4200 | Webhook application |
| `moving-migrate` | `node packages/moving-service/dist/migrate.js` | Không | One-off migration job |

Workflow publish dưới `ghcr.io/<owner>/<repo>/moving-{mcp,api,migrate}:<commit-sha>`
(tên registry viết thường). Infra lấy digest thực tế từ build, dùng
`image@sha256:<digest>`; không dùng `latest`. Cùng `RELEASE_SHA` cho ba image.

## Runtime configuration

Hai app cùng cần `AHAMOVE_ENV=staging`, `AHAMOVE_API_KEY`, `AHAMOVE_MOBILE`
hoặc `AHAMOVE_USER_TOKEN`, và `MOVING_DATABASE_URL` dùng role `moving_app`.
DB URL này ưu tiên hơn `DATABASE_URL` của backend Python. Password trong URL
cần percent-encode nếu có ký tự đặc biệt. Dùng secret storage của infra.

MCP cần `MOVING_MCP_AUTH_TOKEN` (ít nhất 32 ký tự) và
`MOVING_MCP_ALLOWED_HOSTS=localhost,127.0.0.1,moving-mcp,<hostname-no-port>`.
Thêm hostname mà proxy/AI thực sự gửi trong Host; không dùng wildcard.
`MOVING_MCP_ALLOWED_ORIGINS` để trống khi chỉ backend gọi. Container mặc định
bind `0.0.0.0`, port 4400; giao diện stdio vẫn có thể chạy bằng command override.

API cần `AHAMOVE_WEBHOOK_AUTH_MODE` và `AHAMOVE_WEBHOOK_SECRET` thống nhất với
AhaMove. Gửi đúng header `apikey` / `Authorization` theo mode. Không dùng MCP
token làm webhook secret. HTTP callback cần HTTPS ingress ổn định do infra cấp.

Migration job chỉ nhận `MOVING_DATABASE_ADMIN_URL`, `MOVING_DB_APP_USER=moving_app`
và `MOVING_DB_APP_PASSWORD`. Runtime app không nhận credential admin.
Job dùng lại migration canonical `008_moving_service.sql` và bổ sung audit table,
không tạo dữ liệu mẫu, không cần PostGIS. Runtime được giới hạn các bảng Moving
và INSERT vào audit. Không chạy đồng thời migrator LifeFlow cũ và Moving migrator.

Giữ `AHAMOVE_WRITE_ENABLED=false`, `AHAMOVE_RATING_ENABLED=false`,
`AHAMOVE_PRODUCTION_ENABLED=false` cho giai đoạn discovery/read-only staging.

## Deploy sequence

1. Chuẩn bị PostgreSQL thật, secret storage và network riêng. Có thể dùng Postgres
   chung của đội với schema `moving` + `audit`, không bắt buộc thêm DB server riêng.
2. Backup trước thay đổi schema có dữ liệu; chạy image migration đúng release.
3. Chỉ khi job exit 0 mới deploy hai app bằng digest đã chọn.
4. Health check container: GET `/ready` trên port tương ứng, interval 15s,
   timeout 10s, start period 20s, retries 3. `/health` dùng cho liveness.
5. Cho AI Service kết nối MCP qua mạng riêng và bearer token; cấu hình TLS nếu
   request đi qua mạng không tin cậy. Chỉ expose callback ra Internet.
6. Verify release qua `/health`, schema/grants qua `/ready`, và chạy
   `scripts/verify-moving-deployment.mjs` với `MOVING_MCP_URL`, `MOVING_API_URL`,
   `MOVING_MCP_AUTH_TOKEN`, `RELEASE_SHA`. Script chỉ gọi đọc AhaMove staging.
7. Lưu kết quả kiểm tra gắn với digest thực chạy; báo deploy fail nếu readiness
   hoặc smoke test fail. Promote production là task riêng của infra.

## Runtime / recovery

- User non-root; app root filesystem read-only, `/tmp` tmpfs, drop capabilities.
- Khởi đầu 512 MiB RAM / 1 CPU mỗi app; điều chỉnh theo đo đạc, không phải SLA.
- Graceful stop ít nhất 35 giây; tránh kill giữa thao tác provider đang xử lý.
- Không mount Docker socket vào app. DB không public, domain state ở PostgreSQL.
- Log JSON không in Authorization, API key hoặc body nghiệp vụ MCP.
- Container rollback chỉ đổi image/config, không đảo schema, order hoặc booking.
- Sao lưu DB và thử restore trước production. Không xóa volume khi cập nhật app.
- Write UAT, webhook delivery thực tế và kết nối human-approval backend vẫn là
  điều kiện trước khi bật thao tác ghi. HTTP transport không tự bổ sung UI approval.
