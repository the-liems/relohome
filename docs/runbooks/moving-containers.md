# Chạy riêng Moving/AhaMove bằng container

Moving có **hai image chạy thường trực**: `moving-mcp` (AI gọi tools qua HTTP)
và `moving-api` (nhận webhook). Image thứ ba `moving-migrate` chạy một lần rồi
thoát để chuẩn bị database. `Dockerfile.moving` dùng ba build targets để tạo
ba image này; các thư viện contracts/service không cần container riêng.

## Chạy local

Yêu cầu: Node 24, Docker Desktop Linux engine đang chạy, AhaMove staging credential
thật trong cấu hình local hiện có. Root commands nạp `.env.local` rõ ràng;
runtime loaders chỉ đọc process environment (không tự tìm `.env`).
Tên biến `LIFEFLOW_ENV_FILE` được giữ để tương thích với công cụ cũ.
Không sửa/di chuyển file credential cũ.

Trong PowerShell tại thư mục gốc repo:

```powershell
npm ci # repository root
# From repository root
$env:LIFEFLOW_ENV_FILE = (Resolve-Path '.env.local').Path
npm run moving:up
npm run moving:verify
```

`moving:up` đọc mật khẩu DB và token MCP từ `.env.local` (`npm run dev:init` tạo sẵn;
máy cũ chuyển giá trị từ `Maps VN/LifeFlow/.runtime/moving-secrets.json` sang). Chúng là secret nội bộ
hệ thống, không phải thông tin AhaMove cần cấp thêm. Giữ nguyên giá trị khi dùng lại
volume DB; không thay mật khẩu admin nếu volume đã được khởi tạo.
Đổi mật khẩu database đang tồn tại cần thực hiện ở PostgreSQL trước.

Compose luôn dùng AhaMove staging và tắt tạo/cập nhật/hủy/đánh giá. PostgreSQL
không publish port lên host; volume và tên container được Compose quản lý.

| Địa chỉ | Ý nghĩa |
|---|---|
| `http://127.0.0.1:4400/mcp` | MCP HTTP, bắt buộc bearer token |
| `http://127.0.0.1:4400/health` | MCP process còn sống |
| `http://127.0.0.1:4400/ready` | DB, schema và quyền runtime sẵn sàng |
| `http://127.0.0.1:4200/health` | Webhook API còn sống |
| `http://127.0.0.1:4200/ready` | DB và cấu hình webhook sẵn sàng |
| `/v1/integrations/ahamove/webhooks/order-status` | Callback POST của AhaMove |

`moving:verify` kiểm tra readiness, release nếu được chỉ định, xác thực HTTP,
9 tool đọc và gọi danh sách thành phố thật. Không tạo đơn hàng.

```powershell
npm run moving:status
npm run moving:down
```

`moving:down` dừng/xóa container của stack nhưng giữ volume DB. Không dùng
`down --volumes` với dữ liệu cần giữ.

## AI Service gọi MCP

Khi cùng Docker network: dùng `http://moving-mcp:4400/mcp`. Khi chạy AI Service
trên host: dùng `http://127.0.0.1:4400/mcp`. HTTP client gửi
`Authorization: Bearer <MOVING_MCP_AUTH_TOKEN>` từ secret storage.

```typescript
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
const client = new Client({ name: 'lifeflow-ai', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MOVING_MCP_URL!), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.MOVING_MCP_AUTH_TOKEN}` } },
}))
const result = await client.callTool({ name: 'list_service_areas', arguments: { country_id: 'VN' } })
await client.close()
```

Đây là cấu hình client để teammate AI tích hợp; graph Python hiện tại chưa được
nối tự động. Không đưa token vào prompt hay tool arguments. Việc ghi approval
vẫn do backend xử lý quyết định người dùng chịu trách nhiệm, không có tool tự duyệt.

Server dùng HTTP stateless, hỗ trợ client MCP cũ qua nhánh legacy stateless của
SDK. Không cần sticky sessions. GET/DELETE cho session cũ có thể trả 405 theo SDK.
Origin mặc định từ chối mọi browser origin; client backend không cần gửi Origin.
Nếu cho phép browser, khai báo chính xác `MOVING_MCP_ALLOWED_ORIGINS` và thiết kế
auth phía người dùng trước. Đây chưa phải OAuth MCP công khai.

## Build từng image

### Quyền ghi và approval nội bộ

- `MOVING_MCP_AUTH_TOKEN`: subagent chỉ đọc, thấy 9 tool.
- `MOVING_MCP_WRITE_TOKEN`: backend transaction, thấy 13 tool; vẫn phải qua
  `AHAMOVE_WRITE_ENABLED`, approval và kiểm tra trạng thái nghiệp vụ.
- `MOVING_APPROVAL_TOKEN`: chỉ cấp cho Moving API và backend tin cậy để đăng ký
  approval; không cấp cho LLM/subagent/browser. Sinh độc lập, tối thiểu 32 ký tự.
- Không đặt token ghi: server không mở đường truy cập tool ghi. Không đặt token
  approval: endpoint đăng ký trả 503. Stdio mặc định cũng chỉ có 9 tool đọc;
  transaction dùng HTTP với token ghi riêng.
- `MOVING_APPROVAL_URL=http://moving-api:4200/v1/internal/moving/approvals`
  khi graph cùng mạng Docker. Không expose endpoint nội bộ qua public webhook
  ingress; proxy chỉ route đúng `/v1/integrations/ahamove/webhooks/order-status`.
- `MOVING_MCP_ALLOWED_HOSTS` chứa hostname **đích** trong HTTP Host, không phải
  tên container gọi. Kết nối khác Compose cần infra nối chung network.

Chỉ sau khi approval backend và graph đã được kiểm tra, operator bật ghi staging
bằng overlay `compose.moving.staging-write.yaml`. Cấp hai token mới qua secret
storage/env, cùng cấu hình DB/provider như stack hiện có:

```powershell
docker compose --env-file .env.local -f deploy/moving/compose.moving.yaml -f deploy/moving/compose.moving.staging-write.yaml config --quiet
docker compose --env-file .env.local -f deploy/moving/compose.moving.yaml -f deploy/moving/compose.moving.staging-write.yaml up -d --build
```

Overlay không được áp dụng trong bài test tự động. `moving:up` vẫn dùng Compose
cơ sở read-only. Không chạy `config` thiếu `--quiet` vì có thể in secrets.
Xem [contract approval](../api/moving-internal-approvals.md).

Build context là gốc repository để dùng root lockfile. Từ gốc repo:

```powershell
docker build -f "deploy/moving/Dockerfile.moving" --target moving-mcp -t lifeflow/moving-mcp:local .
docker build -f "deploy/moving/Dockerfile.moving" --target moving-api -t lifeflow/moving-api:local .
docker build -f "deploy/moving/Dockerfile.moving" --target moving-migrate -t lifeflow/moving-migrate:local .
```

Các image dùng user `node`, chỉ chứa output build và dependencies production.
`Dockerfile.moving.dockerignore` chỉ cho phép input của Moving; `.env`, ảnh,
map data, `.runtime`, log và test source không vào build context.

## Không có Docker nhưng muốn kiểm thử thật

Nếu máy có PostgreSQL binaries, script dưới tạo cụm DB riêng trong temp, chạy
migration hai lần, test HTTP với AhaMove thật, rồi dừng DB. Không đụng DB đang dùng.

```powershell
npm run build:moving
$env:MOVING_TEST_POSTGRES_BIN = 'C:\Program Files\PostgreSQL\18\bin'
npm run test:moving:native
```

Các artifact DB tạm được giữ tại đường dẫn script in ra để xem lỗi; password file
được xóa khi kết thúc. Không có mock provider, mock database hoặc fixture đơn giả.
Kiểm tra native không thay thế kiểm tra image Linux; phải chạy `moving:up` và
`moving:verify` khi Docker có thể khởi động.

## CI và bàn giao

Workflow `Moving containers` kiểm tra file ứng dụng thay đổi và validate Moving.
Workflow `CI` sở hữu build/publish ba image release trên `main`, dùng tag
`<commit-sha>` cùng với các image ứng dụng khác. PR chỉ build image
bị ảnh hưởng và không publish GHCR hay dùng credential AhaMove. Required check
nên chọn `Moving container gate` và `CI results`; các gate luôn kết thúc kể cả
khi không có image cần build. Tag commit SHA do CI ứng dụng publish, không do workflow Moving.
Thay đổi test/Compose vẫn chạy build TypeScript, kiểm tra contract và validate
Compose; live tests không tự gọi provider khi PR chưa có credential được duyệt.

Muốn chạy container + AhaMove thật trên GitHub, tạo environment `moving-staging`
có review/access policy của đội và secrets `AHAMOVE_API_KEY`, `AHAMOVE_MOBILE`.
Chạy workflow thủ công với `verify_staging=true` trên ref đã review. Job tạo DB thật,
cổng ngẫu nhiên và chỉ cleanup stack của chính job. Job staging tự build stack
Compose dùng một lần. Image build/publish từ CI
thành công chưa phải bằng chứng staging của cùng digest đã đạt.

Xem [bàn giao Coolify](moving-coolify.md) để teammate infra
gắn đúng image, secrets, network, HTTPS callback và migration vào pipeline deploy.

## Giới hạn kiểm chứng

Đã kiểm tra native PostgreSQL 18, migration lặp, HTTP authentication, Host/Origin,
MCP SDK discovery/calls, audit persistence và callback không xác thực. Ngày
2026-09-26 đã build đủ ba image trên Docker Desktop Linux engine, chạy Compose với
PostgreSQL 16, migration exit 0 và xác nhận MCP/API healthy; smoke test đọc AhaMove
staging qua MCP HTTP thành công. Test báo giá cần hành trình thật do đội cung cấp;
tạo/hủy và webhook thật cần UAT đã được duyệt với AhaMove.
