# ADR-013: Tách chức năng vé máy bay thành MCP server riêng trong `src/mcp_servers/`

Pending layout revision: [ADR-025](ADR-025-monorepo-layout.md) proposes to
supersede only the source-layout portions on acceptance. Existing status and
domain decisions remain unchanged while ADR-025 is Proposed.

**Ngày:** 2026-09-25
**Trạng thái:** Proposed (chờ nhóm review trong PR; chuyển thành Accepted khi merge)
**Liên quan:** [ADR-012](ADR-012-flight-data-source.md) ·
[README flight MCP server](../../src/mcp_servers/flights/README.md) ·
[Ví dụ request/response](../api/examples/flights/README.md) ·
các chủ đề ADR-002 (service adapter boundary) và ADR-003 (approval & idempotency) trong
`docs/project-organization.md`

## Bối cảnh (Context)

Chức năng tìm và đặt vé cần dùng được từ agent LangGraph của dự án, và cả từ client MCP
bên ngoài (Claude Code/Desktop, MCP Inspector) để thử và demo. Cây thư mục của template
(`README.md`, `docs/guide/chapter-02.md`) chỉ có sẵn `agents/`, `api/`, `models/`,
`services/`, `config.py`. Không có chỗ cho một **process server chạy riêng**.
`docs/project-organization.md` yêu cầu giữ code trong `src/` và ghi ADR khi thay đổi bố cục.

Hai ràng buộc khác:

- Nhiều thành viên sửa song song các file chung (`src/config.py`, `src/models/schemas.py`). Cần hạn chế merge conflict.
- Các client có thể mở/đóng kết nối MCP giữa các lần gọi tool. Trạng thái nghiệp vụ phải tồn tại qua các kết nối và lần khởi động lại server, nên được lưu trong SQLite.

## Các lựa chọn (Alternatives)

### Lựa chọn 1: `@tool` LangChain trong `src/agents/tools/`
- Ưu điểm: Đúng cây thư mục template, đơn giản nhất.
- Nhược điểm: Chỉ agent LangGraph dùng được. Không theo chuẩn MCP, không test được bằng Inspector hay Claude.

### Lựa chọn 2: Đặt toàn bộ vào `src/services/flights/`, dùng `src/config.py` và `src/models/schemas.py`
- Ưu điểm: Theo quy ước hiện có (settings chung, schema chung).
- Nhược điểm: `services/` đang là nơi chứa client gọi ra ngoài (`llm.py`), không phải nơi chứa một server có entrypoint riêng. Sửa file cấu hình và schema chung thì dễ conflict. Khó tách thành service độc lập sau này.

### Lựa chọn 3: Package riêng `src/mcp_servers/flights/`, tự chứa cấu hình, schema và dữ liệu
- Ưu điểm: Ranh giới rõ ràng. Chạy độc lập bằng `python -m src.mcp_servers.flights`, ngang hàng với `src/main.py`. Gần như không đụng file chung. Dễ tách ra repo hoặc container riêng.
- Nhược điểm: Thêm một thư mục cấp cao mới trong `src/`. Có thêm một class settings thứ hai (`FlightSettings`) bên cạnh `src/config.py`.

## Quyết định (Decision)

Chọn **Lựa chọn 3**, với các ranh giới sau:

```text
src/mcp_servers/flights/            # MCP server (MCPServer, mcp>=2.3,<3)
  server.py    tools.py              # lớp MCP: đăng ký tool/resource/prompt, không chứa logic nghiệp vụ
  search/      booking_engine.py     # lớp nghiệp vụ / adapter: provider tìm chuyến, engine đặt vé
  storage.py                         # SQLite: offer, search cache, booking
  schemas.py   settings.py  catalog_data/  # hợp đồng dữ liệu (Pydantic) + cấu hình FLIGHT_*
src/agents/tools/flight_mcp.py       # cầu nối LangGraph ↔ MCP (langchain.mcp.MCPAdapter)
tests/test_mcp_flights/              # test theo module, giống tests/test_agents/, tests/test_api/
```

- **Tool ↔ adapter ↔ HTTP:**
  - `tools.py` chỉ validate và điều phối.
  - `search/*` là adapter của từng nguồn dữ liệu.
  - Chỉ `search/serpapi.py` biết HTTP, và không bao giờ đưa URL chứa API key vào message lỗi.
- **Cấu hình:**
  - `FlightSettings` đọc cùng file `.env`, nhưng chỉ lấy biến có tiền tố `FLIGHT_`.
  - Không sửa `src/config.py`.
- **Schema:**
  - Model Pydantic trong `schemas.py` là nguồn chuẩn duy nhất.
  - MCP tự sinh `inputSchema`/`outputSchema` từ các model này. Tài liệu chỉ có ví dụ, không chép lại schema.
- **Trạng thái:** offer, cache và booking lưu trong SQLite (`FLIGHT_DB_PATH`), để server stateless giữa các process.
- **Duyệt trước khi đặt (approval) và idempotency:**
  - Đặt vé bắt buộc 2 bước: `hold_booking` (HELD) rồi mới `confirm_booking` (TICKETED).
  - Chỉ booking HELD còn hạn mới xuất được vé.
  - Gọi lặp `hold_booking` với cùng offer + hành khách trả về booking cũ; gọi lặp `confirm_booking` không xuất trùng vé.
  - Hủy vé cũng có bước báo phí (`confirm=false`) trước khi hủy thật.
  - Tool ghi được đánh dấu `destructiveHint`, để client có thể hỏi người dùng trước khi gọi.

## Lý do (Rationale)

1. MCP là chuẩn mở. Cùng một server phục vụ được cả agent của nhóm lẫn công cụ bên ngoài, nên test và demo dễ hơn.
2. Để server trong package riêng giữ đúng tinh thần "không tái cấu trúc" của `chapter-02`: chỉ **thêm** thư mục, không di chuyển hay sửa bố cục cũ.
3. Chỉ phải sửa 2 file chung (`requirements.txt`, `.env.example`), mỗi file một khối ở cuối, nên rủi ro conflict khi merge rất thấp.
4. Lưu trạng thái trong SQLite là cách đơn giản nhất để đúng với cả hai cách dùng: stateless (`get_flight_tools()`) và giữ phiên (`flight_tools_session()`).
5. Server tự kiểm soát bước duyệt, không dựa vào việc LLM "tự giác". Điều này đáp ứng yêu cầu "approval enforced before booking" của milestone M2.

## Hệ quả (Consequences)

- `README.md` gốc (mục "Cấu trúc thư mục") và `ARCHITECTURE.md` nên thêm `src/mcp_servers/` khi nhóm chấp nhận ADR này.
- Có hai nơi khai báo settings. Quy ước: biến dùng chung đặt trong `src/config.py`, biến riêng của một MCP server đặt trong `settings.py` của server đó, với tiền tố riêng.
- Dùng `mcp>=2.3,<3` và `langchain[mcp]==1.4.5`; khai báo trực tiếp `fastmcp==4.1.0` vì cầu nối import HTTP transport từ package này.
- Server mới phải chạy từ thư mục gốc dự án (hoặc đặt `PYTHONPATH`) vì template không đóng gói `src/` thành package cài được.
- MCP server khác sau này (ví dụ khách sạn, di chuyển) dùng lại mẫu `src/mcp_servers/<tên>/` này.
- HTTP dùng bearer-token verifier và auth middleware của MCP SDK; xem [hợp đồng xác thực nội bộ](../specs/internal-mcp-auth.md). Transport bind `127.0.0.1` khi chạy local và `0.0.0.0` trong container (xem [ADR-014](ADR-014-containerized-mcp-servers.md)).


## MCP SDK 2 / LangChain migration

The current runtime uses `mcp>=2.3,<3` (`MCPServer`) and
`langchain[mcp]==1.4.5` (`MCPAdapter`), replacing `langchain-mcp-adapters`.
FastMCP 4.1.0 is also declared directly because the bridges import its transport API.
Flight and payment
bridges pass a single-server HTTP transport to the adapter to preserve unprefixed tool names and
bearer headers. Server prompts and resources remain available through the MCP SDK.
LangChain 1.4.5 preserves compatibility with the existing LangGraph 1.2.11 pin.

Python HTTP authentication uses the SDK's bearer backend and auth middleware
with a pre-shared-token verifier. Servers use `MCPServer` directly; there is no
`HttpServiceMCP` subclass. The entrypoints pass host/port to the HTTP app and
Uvicorn, and stdio remains independent of HTTP authentication.
