# Chạy riêng Moving/AhaMove bằng container

Moving có **hai image chạy thường trực**: `moving-mcp` (AI gọi tools qua HTTP)
và `moving-api` (nhận webhook). Image thứ ba `moving-migrate` chạy một lần rồi
thoát để chuẩn bị database. `Dockerfile.moving` dùng ba build targets để tạo
ba image này; các thư viện contracts/service không cần container riêng.

## Chạy local

Yêu cầu: Node 24, Docker Desktop Linux engine đang chạy, AhaMove staging credential
thật trong `.env`. Script đọc `LIFEFLOW_ENV_FILE` nếu có; nếu không, tìm `.env`
tại LifeFlow hoặc thư mục gốc repository. Không sửa/di chuyển file credential cũ.

Trong PowerShell tại thư mục gốc repo:

```powershell
Set-Location 'Maps VN/LifeFlow'
$env:LIFEFLOW_ENV_FILE = (Resolve-Path '../../.env').Path
npm ci
npm run moving:up
npm run moving:verify
```

`moving:up` tự tạo mật khẩu DB và token MCP nếu chưa cấu hình. Các giá trị được
lưu ở `.runtime/moving-secrets.json` (Git ignore, không gửi lên GitHub). Chúng là
secret nội bộ hệ thống, không phải thông tin AhaMove cần cấp thêm. Giữ file này
khi dùng lại volume DB; không thay mật khẩu admin nếu volume đã được khởi tạo.
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
13 tools và gọi danh sách thành phố thật. Không tạo đơn hàng.

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

Build context luôn là `Maps VN/LifeFlow`, không phải riêng thư mục MCP.

```powershell
docker build -f Dockerfile.moving --target moving-mcp -t lifeflow/moving-mcp:local .
docker build -f Dockerfile.moving --target moving-api -t lifeflow/moving-api:local .
docker build -f Dockerfile.moving --target moving-migrate -t lifeflow/moving-migrate:local .
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

Workflow `Moving containers` kiểm tra file ứng dụng thay đổi, build 3 targets,
và publish lên GHCR bằng commit SHA khi merge `main`. PR không có credential
AhaMove. Docs/test-only không publish image. Required check nên chọn
`Moving container gate`, vì check này luôn kết thúc kể cả không có image cần build.
Thay đổi test/Compose vẫn chạy build TypeScript, kiểm tra contract và validate
Compose; live tests không tự gọi provider khi PR chưa có credential được duyệt.

Muốn chạy container + AhaMove thật trên GitHub, tạo environment `moving-staging`
có review/access policy của đội và secrets `AHAMOVE_API_KEY`, `AHAMOVE_MOBILE`.
Chạy workflow thủ công với `verify_staging=true` trên ref đã review. Job tạo DB thật,
cổng ngẫu nhiên và chỉ cleanup stack của chính job. Image build/publish thành công
chưa phải bằng chứng staging của cùng digest đã đạt.

Xem [bàn giao Coolify](../../deploy/coolify/staging/moving.md) để teammate infra
gắn đúng image, secrets, network, HTTPS callback và migration vào pipeline deploy.

## Giới hạn kiểm chứng

Đã kiểm tra native PostgreSQL 18, migration lặp, HTTP authentication, Host/Origin,
MCP SDK discovery/calls, audit persistence và callback không xác thực. Ngày
2026-09-26 đã build đủ ba image trên Docker Desktop Linux engine, chạy Compose với
PostgreSQL 16, migration exit 0 và xác nhận MCP/API healthy; smoke test đọc AhaMove
staging qua MCP HTTP thành công. Test báo giá cần hành trình thật do đội cung cấp;
tạo/hủy và webhook thật cần UAT đã được duyệt với AhaMove.
