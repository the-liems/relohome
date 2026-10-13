# LifeFlow Location MCP - tài liệu bàn giao

> Historical record: paths, names, commands and measured results below describe the original checkout. For current operation use the [ReloHome location guide](README.md) and [local runbook](../runbooks/local-mvp.md).

Cập nhật 29/09/2026: [contract và kiểm thử](../integration/location-service-implementation-status.md),
[dữ liệu và backup](../integration/location-data-status.md).
Rebuild image để có tool thứ 9. Token xác thực client; DB/OSRM URL và mạng phải
được cấu hình riêng, token không tự kết nối database trên máy cá nhân.

## Phạm vi bàn giao

Đây là một MCP server duy nhất cho toàn bộ chức năng vị trí và bản đồ của LifeFlow.
Server được đóng gói thành container `lifeflow-location-mcp` và công khai 9 tool chỉ đọc:

| Nhóm | Tool | Nguồn dữ liệu |
|---|---|---|
| Housing | `search_housing`, `get_housing` | PostGIS |
| Place | `search_places`, `get_place`, `find_nearby_places` | PostGIS |
| Location | `search_areas`, `resolve_location` | PostGIS |
| Routing | `calculate_route`, `calculate_route_between_entities` | PostGIS + OSRM |

Phần crawl/thu thập dữ liệu housing **không nằm trong container này**. MCP chỉ truy vấn dữ
liệu đã được chuẩn hóa và nhập vào PostGIS. Khi chưa có dữ liệu housing thật,
`search_housing` trả về danh sách rỗng thay vì tạo dữ liệu giả.

## Kiến trúc chạy

```text
MCP client / LifeFlow Agent
          |
          | Streamable HTTP + Bearer token
          v
lifeflow-location-mcp (stateless)
          |---------------------> PostGIS (user chỉ đọc lifeflow_app)
          `---------------------> 9 endpoint OSRM
```

- Endpoint MCP từ máy host: `http://127.0.0.1:3000/mcp`
- Liveness: `GET http://127.0.0.1:3000/healthz`
- Readiness database: `GET http://127.0.0.1:3000/readyz`
- `stdio` vẫn được giữ lại cho phát triển và MCP client chạy cùng máy.
- Source code tool được chia theo registry trong `mcp-server/src/tools/`; tất cả registry
  được ghép lại trong `mcp-server/src/create-server.ts`.

## Chạy trên máy của leader hoặc thành viên team

Yêu cầu: Docker Desktop/Docker Engine, file `.env`, database đã chạy migration và các
container OSRM hiện có đã được khởi động.

```powershell
Set-Location "D:\DEMO_AI\DEMO_1\Maps VN\LifeFlow"
Copy-Item .env.example .env
# Sửa các password và MCP_AUTH_TOKEN trong .env trước khi chạy.
npm run mcp:up
```

`mcp:up` sẽ build image, bật PostGIS nếu cần và bật MCP. Nó không chạy crawler, không import
dữ liệu và không xóa dữ liệu hiện có.

Kiểm tra:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/healthz
Invoke-RestMethod http://127.0.0.1:3000/readyz
docker compose --env-file .env -f infra/compose.yaml ps
```

Dừng MCP mà vẫn giữ database và volume:

```powershell
npm run mcp:stop
```

## Kết nối từ MCP client

Client hỗ trợ Streamable HTTP cần dùng URL và token sau:

```json
{
  "url": "http://127.0.0.1:3000/mcp",
  "headers": {
    "Authorization": "Bearer <giá trị MCP_AUTH_TOKEN>"
  }
}
```

Cú pháp file cấu hình cụ thể phụ thuộc MCP host mà leader sử dụng. Transport HTTP được triển
khai bằng TypeScript SDK chính thức; xem
[hướng dẫn HTTP server của MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md).

Để chạy cục bộ bằng `stdio`:

```json
{
  "command": "node",
  "args": [
    "D:\\DEMO_AI\\DEMO_1\\Maps VN\\LifeFlow\\mcp-server\\dist\\server.js"
  ],
  "env": {
    "LIFEFLOW_ENV_FILE": "D:\\DEMO_AI\\DEMO_1\\Maps VN\\LifeFlow\\.env"
  }
}
```

## Build và chuyển image độc lập

Build từ thư mục gốc repository:

```powershell
docker build -f "apps/location-mcp/Dockerfile" -t lifeflow-location-mcp:0.1.0 .
```

Image không chứa database, dữ liệu crawl, PBF hay graph OSRM. Khi chuyển image sang máy khác,
máy đích vẫn phải có:

1. PostGIS đã áp dụng migration và có dữ liệu cần truy vấn.
2. Chín endpoint OSRM hoặc các URL OSRM tương đương.
3. Biến môi trường kết nối bằng tài khoản ứng dụng `lifeflow_app`.

Không cấp `POSTGRES_ADMIN_PASSWORD` hoặc `POSTGRES_INGEST_PASSWORD` cho MCP container.

## Lưu trữ dữ liệu giữa các máy

Trong môi trường local, dữ liệu PostGIS nằm ở Docker named volume
`lifeflow-postgis-data`. Volume này chỉ thuộc máy đang chạy Docker, nên hai máy không tự động
nhìn thấy cùng một database.

Để team dùng chung hoặc demo sản phẩm:

- triển khai một PostgreSQL/PostGIS dùng chung trên server/VPS hoặc dịch vụ managed;
- chạy migration bằng pipeline/deployment job riêng;
- cấu hình `DATABASE_URL` hoặc bộ `POSTGRES_*` của MCP trỏ tới database đó;
- đặt OSRM trên các service/container riêng và thay các biến `OSRM_*_URL`;
- lưu file crawl thô và snapshot ở object storage, không nhét vào image MCP;
- backup database định kỳ và phục hồi thử trước khi demo.

MCP server là lớp truy vấn stateless. Việc deploy phiên bản mới không làm mất dữ liệu nếu
database/volume được quản lý độc lập.

## Khi đưa lên môi trường công khai

Cấu hình hiện tại mặc định chỉ bind cổng host vào `127.0.0.1`. Trước khi mở ra Internet:

1. Đặt reverse proxy có HTTPS phía trước MCP.
2. Đặt `MCP_AUTH_TOKEN` bằng secret manager, không commit token vào Git.
3. Cập nhật `MCP_ALLOWED_HOSTS` và `MCP_ALLOWED_ORIGIN_HOSTS` theo hostname thật.
4. Chỉ mở `/mcp` cho các client cần thiết; giữ database ở private network.
5. Với sản phẩm nhiều người dùng, thay static token bằng OAuth hoặc identity gateway.

## Thêm tool mới sau này

1. Khai báo schema dùng chung trong `packages/contracts`.
2. Viết query/service trong `packages/housing-query` hoặc package domain phù hợp.
3. Đăng ký tool trong registry tương ứng ở `mcp-server/src/tools/`.
4. Nếu là domain mới, thêm một registry rồi gọi registry đó từ `create-server.ts`.
5. Bổ sung integration test và tăng version image.

Không tạo MCP container riêng cho từng tool. Một image `lifeflow-location-mcp` tiếp tục là
điểm tích hợp duy nhất cho leader.

## Checklist nghiệm thu

```powershell
# repository root
npm run build:ts
npm exec --offline --workspace @relohome/location-mcp -- vitest run tests/mcp-http.integration.test.ts
docker compose --env-file "Maps VN/LifeFlow/.env" -f "Maps VN/LifeFlow/infra/compose.yaml" config --quiet
docker build -f "apps/location-mcp/Dockerfile" -t lifeflow-location-mcp:0.1.0 .
```

Kết quả đạt khi `/healthz` trả `200`, `/readyz` trả `200`, request không có token bị từ chối
và MCP client có token nhìn thấy đúng 9 tool.
