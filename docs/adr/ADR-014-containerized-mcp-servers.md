# ADR-014: Mỗi service cung cấp một MCP server đóng gói bằng Dockerfile riêng

**Ngày:** 2026-09-26
**Trạng thái:** Proposed (chờ nhóm review trong PR; chuyển thành Accepted khi merge)
**Liên quan:** [ADR-013](ADR-013-flight-mcp-server-layout.md) ·
[README flight MCP server](../../src/mcp_servers/flights/README.md)

## Bối cảnh (Context)

Yêu cầu dự án: *"Each service shall provide an MCP server that is containerized using Dockerfile."*

Trước ADR này, flight MCP server chỉ chạy được bằng `python -m src.mcp_servers.flights` trên máy
dev. `Dockerfile` gốc chỉ đóng gói FastAPI backend. Ngoài ra, `create_server()` tạo `FastMCP`
với host mặc định `127.0.0.1` rồi mới gán host sau, nên FastMCP luôn bật chống DNS rebinding
và chỉ nhận header `Host: localhost`. Service khác trong mạng Docker gọi bằng
`http://flights-mcp:8765/mcp` sẽ bị từ chối.

## Các lựa chọn (Alternatives)

### Lựa chọn 1: Dùng chung `Dockerfile` gốc, đổi `CMD` trong compose
- Ưu điểm: Không thêm file.
- Nhược điểm: Image kéo toàn bộ LangChain/FastAPI, copy cả repo. Các MCP server không build hay deploy độc lập được.

### Lựa chọn 2: Mỗi MCP server có `Dockerfile` + `requirements.txt` riêng trong thư mục của nó
- Ưu điểm: Image nhỏ, chỉ chứa code của server đó. Build, chạy, scale độc lập. Thêm server mới chỉ cần thêm một thư mục.
- Nhược điểm: Lặp lại một ít boilerplate Dockerfile giữa các server.

## Quyết định (Decision)

Chọn **Lựa chọn 2**. Mọi MCP server `src/mcp_servers/<tên>/` phải có:

| File | Yêu cầu |
|---|---|
| `Dockerfile` | Build context là thư mục gốc dự án; multi-stage; chạy bằng user thường (`USER`); `EXPOSE` cổng; `HEALTHCHECK` gọi `/health`; `CMD` chạy `--transport streamable-http` |
| `requirements.txt` | Chỉ dependency server cần (không kéo LangChain) |
| `__main__.py` | Chạy được bằng `python -m src.mcp_servers.<tên>` |
| `/health` | Route HTTP trả `{"status": "ok", ...}` (FastMCP `custom_route`) |
| `docker-compose.yml` | Service tên `<tên>-mcp`, dữ liệu trong named volume |

Quy ước được kiểm tra tự động bởi `tests/test_mcp_servers_layout.py` (thiếu Dockerfile là
test đỏ). CI job `mcp-images` build image của mọi server (`make mcp-build`) và smoke test
container của mọi server (cổng đọc từ dòng `EXPOSE`).

Chi tiết cho flight server:

- Image `flights-mcp`, cổng 8765, endpoint MCP `http://<host>:8765/mcp`.
- `create_server(services, host, port)` nhận host ngay khi khởi tạo `FastMCP`. Chạy local
  (`127.0.0.1`) vẫn giữ chống DNS rebinding; trong container (`0.0.0.0`) nhận mọi Host để service
  khác gọi bằng tên service.
- Agent chọn transport qua `FLIGHT_MCP_URL`: có biến thì dùng Streamable HTTP tới container,
  không có thì tự mở process stdio như trước. Compose đặt sẵn biến này cho `backend`.

## Hệ quả (Consequences)

- Thêm server mới (ví dụ `hotels`) = tạo `src/mcp_servers/hotels/` theo bảng trên + thêm service
  `hotels-mcp` vào compose. `make mcp-build` tự nhận Dockerfile mới.
- Container không có `.env`: cấu hình truyền qua biến môi trường (`env_file` trong compose hoặc `-e`).
- Trong container, transport HTTP không có xác thực và không chống DNS rebinding. Chỉ publish
  cổng ra ngoài khi dev/demo; deploy công khai cần reverse proxy có auth (ADR riêng).
- SQLite nằm trong volume `flights-data`, nên chỉ chạy **một** replica flights-mcp. Muốn scale
  ngang phải chuyển storage sang DB dùng chung.
