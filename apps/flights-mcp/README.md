# Flight MCP server — Đặt vé máy bay nội địa Việt Nam

MCP server (theo chuẩn [Model Context Protocol](https://modelcontextprotocol.io)) cho phép
LLM/agent **tìm chuyến bay, giữ chỗ, xuất vé và hủy vé** trên các chặng nội địa Việt Nam.
Server dùng được với agent LangGraph của dự án, Claude Code/Desktop, MCP Inspector
và các client MCP khác.

Tài liệu liên quan:
[ADR-012 — nguồn dữ liệu](../../docs/adr/ADR-012-flight-data-source.md) ·
[ADR-013 — bố cục MCP server](../../docs/adr/ADR-013-flight-mcp-server-layout.md) ·
[Ví dụ request/response của từng tool](../../docs/api/examples/flights/README.md)

> ⚠️ Phần **giữ chỗ / xuất vé / hủy là GIẢ LẬP**. Server không trừ tiền và không tạo vé thật.
> Điều kiện hành lý, phí đổi và phí hủy trong `catalog_data/airlines.json` là số liệu mẫu, không
> phải quy định chính thức của hãng.

Mặc định server chỉ cung cấp `search_airports`, `search_flights` và `get_offer`.
Để thử luồng đặt vé giả lập, đặt `FLIGHT_SIMULATION_ENABLED=true` rõ ràng; chọn nguồn
`mock` không tự bật các tool booking. Chế độ này không cấp quyền đặt vé thật hay thanh toán thật.

## Bắt đầu nhanh (3 phút, không cần API key)

```bash
# Linux / macOS / Git Bash — chạy ở thư mục gốc dự án
source .venv/bin/activate
pip install -r requirements.txt
pytest tests/test_mcp_flights -q          # kiểm tra cài đặt
FLIGHT_SEARCH_PROVIDER=mock python - <<'EOF'  # ví dụ offline, không cần SerpApi key
import asyncio
from mcp.shared.memory import create_connected_server_and_client_session
from relohome_flights_mcp import create_server

async def main():
    async with create_connected_server_and_client_session(create_server()) as c:
        r = await c.call_tool("search_flights", {"request": {"origin": "HAN", "destination": "SGN", "departure_date": "2026-12-20"}})
        print(r.structured_content["message"] if not r.is_error else r.content[0].text)

asyncio.run(main())
EOF
```

Trên Windows PowerShell: dùng `.venv\Scripts\activate`, rồi chạy các lệnh Python trong mục
[Tích hợp vào phần khác](#tích-hợp-vào-phần-khác). Nhớ đổi `departure_date` thành một ngày
trong tương lai.

## Giao diện demo (Streamlit)

```bash
make ui            # hoặc: streamlit run examples/streamlit/src/relohome_demos/flight_demo.py
```

Start the Flight HTTP service first and set `FLIGHT_MCP_URL` and the matching
`FLIGHT_MCP_AUTH_TOKEN`. Each HTTP service requires `MCP_AUTH_TOKEN` (at least 32
ASCII token characters); local settings also accept `FLIGHT_MCP_AUTH_TOKEN`.
See the [internal authentication contract](../../docs/specs/internal-mcp-auth.md).
Open <http://localhost:8501>; the demo connects over HTTP.

- Provider mode belongs to the service. To compare modes, run separate services and set `FLIGHT_MOCK_MCP_URL` and `FLIGHT_SERPAPI_MCP_URL`.
- **Kiểm tra ngay**: handshake MCP over HTTP and list service tools/resources. Provider credentials stay on the service.
- Tab Tìm chuyến dùng được trong cả hai chế độ. Để chạy đủ luồng Đặt vé → Tra cứu/Hủy
  giả lập, cần bật `FLIGHT_SIMULATION_ENABLED=true` trong shell hoặc `.env`; công tắc nguồn
  dữ liệu không bật simulation. Ví dụ: `FLIGHT_SIMULATION_ENABLED=true make ui`.
- Mỗi lần gọi đều có request/response JSON và độ trễ, tab **Nhật ký API** tải được toàn bộ
  log dạng JSON.

## Vì sao chọn nguồn dữ liệu này

| Lựa chọn | Tình trạng (09/2026) |
|---|---|
| Duffel | Theo tìm hiểu của nhóm, chưa hỗ trợ tài khoản tại Việt Nam |
| Amadeus Self-Service | Đã đóng ngày 17/07/2026 |
| Vietnam Airlines, Vietjet, Bamboo, Vietravel | Không có API công khai; chỉ bán qua hợp đồng đại lý (B2B) |
| **SerpApi – Google Flights** | Giá và giờ bay thật, có chặng nội địa VN, miễn phí 100 lượt/tháng. Chỉ đọc dữ liệu, không đặt vé được |

Vì vậy server tách làm hai phần:

- **Tìm chuyến**: `serpapi` (mặc định, dữ liệu thật) hoặc `mock` (offline, dùng cho test/CI/demo).
- **Đặt vé**: engine giả lập lưu trong SQLite (`booking_engine.py`), chỉ đăng ký khi bật simulation.

## Cấu trúc

```text
apps/flights-mcp/                     # pyproject.toml, Dockerfile, requirements.txt
└── src/relohome_flights_mcp/          # __main__, server, tools
packages/python/flight/src/relohome_flight/
├── schemas.py, settings.py, catalog.py, storage.py, booking_engine.py, errors.py
├── search/                          # base, mock, serpapi
└── catalog_data/                    # airports.json, airlines.json (wheel resources)
apps/agent-api/src/relohome_agent/services/adapters/mcp.py  # backend MCP client
tests/test_mcp_flights/
```


Server có cấu hình riêng (`settings.py`, tiền tố `FLIGHT_`) và không sửa `apps/agent-api/src/relohome_agent/config.py`,
để hạn chế xung đột khi merge với code của các thành viên khác.

## Cài đặt

```bash
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # đã có MCP SDK
```

Dùng MCP SDK 2.x (`MCPServer`).

## Cấu hình (`.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `FLIGHT_SEARCH_PROVIDER` | `serpapi` | `mock` hoặc `serpapi` |
| `FLIGHT_SIMULATION_ENABLED` | `false` | Bật rõ ràng để cung cấp tool booking, resource booking và prompt đặt vé giả lập |
| `FLIGHT_SERPAPI_API_KEY` | trống | Key tại <https://serpapi.com/manage-api-key> (bắt buộc khi dùng `serpapi`) |
| `FLIGHT_DB_PATH` | `./data/flights.db` | File SQLite lưu offer, cache và booking (`data/` đã có trong `.gitignore`) |
| `FLIGHT_SEARCH_CACHE_TTL` | `3600` | Số giây cache kết quả SerpApi, giúp tiết kiệm lượt gọi |
| `FLIGHT_OFFER_TTL_MINUTES` | `30` | Thời hạn của một offer, quá hạn phải tìm lại |
| `FLIGHT_HOLD_MINUTES` | `15` | Thời hạn giữ chỗ trước khi xuất vé |
| `FLIGHT_MCP_HOST` / `FLIGHT_MCP_PORT` | `127.0.0.1` / `8765` | Dùng khi chạy transport HTTP |

**Về SerpApi key:**
- Mỗi thành viên tự tạo key riêng (miễn phí, đăng ký bằng email) và ghi vào `.env` của máy mình.
- Không chia sẻ key, không commit key, và **không dán key vào khung chat AI**: hook ghi log AI của repo sẽ gửi nội dung prompt lên server chấm điểm mỗi lần `git push`.
- Lỡ để lộ key thì tạo lại key trên dashboard của SerpApi, key cũ sẽ mất hiệu lực.
- Khi đang code hoặc test, nên để `mock` để không tốn lượt.

## Chạy server

Luôn chạy từ **thư mục gốc dự án** để Python tìm thấy package `src` và đọc được file `.env`.

```bash
# HTTP service (default), tại http://127.0.0.1:8765/mcp
python -m relohome_flights_mcp
```

### Chạy bằng Docker

Server có `Dockerfile` riêng trong thư mục này (quy ước ở
[ADR-014](../../docs/adr/ADR-014-containerized-mcp-servers.md)). Image chỉ chứa code của
server và `requirements.txt` cùng thư mục, chạy Streamable HTTP tại `:8765/mcp`, healthcheck ở `/health`.

```bash
# Cách 1: docker compose (đọc .env, dữ liệu SQLite trong volume flights-data)
make mcp-up                 # = docker compose up -d --build flights-mcp
curl localhost:8765/health  # {"status":"ok","server":"vn-flight-booking","provider":"mock"}
make mcp-down

# Cách 2: docker thuần (build context là thư mục gốc dự án)
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
docker build -f apps/flights-mcp/Dockerfile -t flights-mcp .
docker run --rm -p 8765:8765 -e MCP_AUTH_TOKEN -e FLIGHT_SEARCH_PROVIDER=mock flights-mcp
# Giá thật: -e FLIGHT_SEARCH_PROVIDER=serpapi -e FLIGHT_SERPAPI_API_KEY=...
```

Cho agent LangGraph dùng server trong container: đặt `FLIGHT_MCP_URL=http://localhost:8765/mcp`
(trong compose, `backend` đã được đặt sẵn `http://flights-mcp:8765/mcp`). Missing URL leaves the domain unconfigured; clients never start a server.

### Thử bằng MCP Inspector (cần Node.js)

```bash
npx @modelcontextprotocol/inspector .venv/bin/python -m relohome_flights_mcp
# Windows: npx @modelcontextprotocol/inspector .venv\Scripts\python.exe -m relohome_flights_mcp
# Ghi đè biến cho riêng lần chạy: thêm -e FLIGHT_SEARCH_PROVIDER=serpapi ngay sau "inspector"
```

Mở link được in ra, bấm **Connect**, vào tab **Tools** rồi chọn **List Tools**. Nội dung mẫu
để nhập cho từng tool có trong [file ví dụ](../../docs/api/examples/flights/README.md).

### Kết nối Claude Code

```bash
claude mcp add flights -- .venv/bin/python -m relohome_flights_mcp
# Gỡ: claude mcp remove flights
```

Thử hỏi: *"Tìm vé Hà Nội đi Đà Nẵng ngày 10/10 cho 2 người lớn, lấy chuyến rẻ nhất"*.

### Kết nối Claude Desktop

Claude Desktop không chạy server từ thư mục dự án, nên phải khai báo `PYTHONPATH` và đường
dẫn tuyệt đối:

```json
{
  "mcpServers": {
    "flights": {
      "command": "/đường/dẫn/P-044/.venv/bin/python",
      "args": ["-m", "relohome_flights_mcp"],
      "env": {
        "PYTHONPATH": "/đường/dẫn/P-044",
        "FLIGHT_DB_PATH": "/đường/dẫn/P-044/data/flights.db",
        "FLIGHT_SEARCH_PROVIDER": "mock"
      }
    }
  }
}
```

## Tích hợp vào phần khác

Chọn cách phù hợp với phần bạn đang làm. Code mẫu của A, B, C đều đã được chạy thử. Cách A
còn có test tự động trong `tests/test_agents/test_flight_mcp.py`.

| Bạn đang làm | Cách dùng |
|---|---|
| Agent LangGraph (tool routing, planning) | [A. Nạp tool MCP vào LangGraph](#a-agent-langgraph) |
| Backend Python cùng repo (FastAPI, node trong graph) | [B. Gọi trực tiếp như thư viện](#b-gọi-trực-tiếp-như-thư-viện-python) |
| Service khác, process khác, máy khác | [C. Gọi qua HTTP (Streamable HTTP)](#c-gọi-qua-http) |
| Thử tay hoặc demo | MCP Inspector, Claude Code (xem phần trên) |

### A. Agent LangGraph

The backend calls this service through `relohome_agent.services.adapters.mcp.McpToolClient`.
`ServiceRegistry` builds its endpoints from `FLIGHT_MCP_URL` and `FLIGHT_MCP_AUTH_TOKEN`
(`apps/agent-api/src/relohome_agent/services/adapters/registry.py`). The model only sees the
agent's curated tools, which call this server; it never gets the raw MCP tool list.

### B. Gọi trực tiếp như thư viện Python

Không đi qua giao thức MCP, không mở process con. Hợp khi viết endpoint FastAPI hoặc một node
LangGraph cần gọi tìm vé một cách chắc chắn, không qua LLM.

```python
from datetime import date

from relohome_flights_mcp import build_services
from relohome_flight.schemas import FlightSearchRequest
from relohome_flights_mcp.tools import FlightTools

flight_tools = FlightTools(build_services())  # tạo một lần, dùng lại


async def find_cheapest() -> None:
    result = await flight_tools.search_flights(
        FlightSearchRequest(origin="HAN", destination="DAD", departure_date=date(2026, 12, 20))
    )
    print(result.message, result.offers[0].total_price)
```

- Các method `search_airports`, `get_offer`, `hold_booking`, `confirm_booking`, `get_booking` và `cancel_booking` có cùng tên và tham số với tool MCP.
- Lỗi nghiệp vụ được raise thành `FlightError` (trong `errors.py`). Khi viết FastAPI, bắt lỗi này và trả về HTTP 400.

### C. Gọi qua HTTP

Chạy server ở chế độ HTTP (`python -m relohome_flights_mcp --transport streamable-http`).
Sau đó mọi client MCP đều kết nối được tới `http://127.0.0.1:8765/mcp`, dù viết bằng Python,
TypeScript hay ngôn ngữ khác.

```python
import asyncio

from mcp import ClientSession
import os
import httpx2
from mcp.client.streamable_http import streamable_http_client


async def main() -> None:
    headers = {"Authorization": f"Bearer {os.environ['FLIGHT_MCP_AUTH_TOKEN']}"}
    async with httpx2.AsyncClient(headers=headers) as http:
        async with streamable_http_client("http://127.0.0.1:8765/mcp", http_client=http) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool("search_airports", {"query": "phu quoc"})
                print(result.structured_content)


asyncio.run(main())
```

Backend dùng `McpToolClient` (`apps/agent-api/src/relohome_agent/services/adapters/mcp.py`);
`ServiceRegistry` đọc `FLIGHT_MCP_URL` và `FLIGHT_MCP_AUTH_TOKEN`.
Server kiểm tra bearer token bắt buộc; xem
[internal authentication contract](../../docs/specs/internal-mcp-auth.md).

## Tool, resource, prompt

Ba tool tìm kiếm/offer đầu tiên và resources `flights://airports`, `flights://airlines`
luôn có. `hold_booking`, `confirm_booking`, `get_booking`, `cancel_booking`, resource
`flights://bookings/{booking_ref}` và prompt `plan_domestic_trip` chỉ có khi
`FLIGHT_SIMULATION_ENABLED=true`. Trong chế độ mặc định, client không thể gọi các tool,
resource hay prompt booking này. Ví dụ chạy demo offline:

```bash
FLIGHT_SEARCH_PROVIDER=mock FLIGHT_SIMULATION_ENABLED=true python -m relohome_flights_mcp
```

| Tool | Loại | Mô tả |
|---|---|---|
| `search_airports(query, limit)` | chỉ đọc | Tra mã IATA, không phân biệt dấu: "Đà Nẵng" → DAD, "sài gòn" → SGN |
| `search_flights(request)` | chỉ đọc | Tìm chuyến một chiều, hoặc khứ hồi (`trip_type=round_trip` + `return_date`: trả danh sách chiều đi). Có thể lọc bay thẳng, sắp xếp theo `price`, `departure_time` hoặc `duration`. Xem mục *Vé khứ hồi* |
| `search_return_flights(outbound_offer_id, max_results)` | chỉ đọc | Khứ hồi: danh sách chiều về cho chuyến đi đã chọn, mỗi kết quả là offer hành trình (đi + về) có tổng giá |
| `get_offer(offer_id)` | chỉ đọc | Chi tiết offer kèm hành lý và điều kiện đổi/hoàn |
| `hold_booking(request)` | ghi | **Bước 1/2**: giữ chỗ và tạo PNR, trạng thái `HELD` |
| `confirm_booking(booking_ref)` | ghi, có hệ quả | **Bước 2/2**: xuất vé (giả lập). Gọi lại nhiều lần không xuất trùng vé |
| `get_booking(booking_ref)` | chỉ đọc | Tra cứu theo `booking_id` hoặc PNR |
| `cancel_booking(booking_ref, confirm)` | ghi, có hệ quả | `confirm=false` chỉ báo phí; `confirm=true` mới hủy |

- Resources: `flights://airports`, `flights://airlines`, `flights://bookings/{booking_ref}`
- Prompt: `plan_domestic_trip(origin, destination, departure_date)`

Mỗi tool khai báo `ToolAnnotations` (`readOnlyHint`, `destructiveHint`, ...) và trả về
dữ liệu có cấu trúc (`outputSchema` / `structuredContent`) sinh từ model Pydantic.

### Vòng đời booking

```text
hold_booking ──► HELD ──confirm_booking──► TICKETED ──cancel_booking(confirm=true)──► CANCELLED
                  │  └──cancel_booking(confirm=true)──► CANCELLED (miễn phí)
                  └── quá FLIGHT_HOLD_MINUTES ──► EXPIRED
```

Người dùng phải duyệt trước khi xuất vé, và server bắt buộc điều này: chỉ `confirm_booking`
mới xuất vé, và chỉ xuất được cho booking `HELD` còn hạn. Gọi `hold_booking` lặp lại với cùng
offer và cùng hành khách sẽ trả về booking cũ, không giữ chỗ trùng.

### Kiểm tra dữ liệu đầu vào

- Chỉ nhận sân bay trong `catalog_data/airports.json`. Ngày bay phải nằm trong khoảng từ hôm nay đến 330 ngày tới.
- Tối đa 9 khách. Số em bé không vượt quá số người lớn.
- Tuổi tính tại ngày bay: người lớn ≥ 12, trẻ em 2–11, em bé < 2. Số khách từng loại phải khớp với offer.
- Tên được chuẩn hóa về dạng viết hoa, không dấu: "Nguyễn Văn An" → `NGUYEN` / `VAN AN`.

## Quy tắc dữ liệu mock

- Chỉ có chuyến bay thẳng. Một tuyến có chuyến khi ít nhất một đầu là HAN, SGN hoặc DAD.
- Vietnam Airlines và Vietjet bay mọi tuyến có chuyến. Bamboo, Vietravel và Sun PhuQuoc Airways chỉ bay các tuyến trục (`TRUNK_ROUTES`).
- Giá tính theo khoảng cách, hệ số hãng, hạng ghế, phụ thu cuối tuần (+15%) và một hệ số ngẫu nhiên.
  Trẻ em trả 75%, em bé trả 10% giá người lớn.
- Kết quả **deterministic**: cùng tuyến và cùng ngày luôn ra cùng lịch bay, thuận tiện cho test và demo.

## Test

```bash
pytest tests/test_mcp_flights tests/test_agents/test_flight_mcp.py -v
npm run lint:python
```

Test không gọi mạng. Phần SerpApi được test bằng `httpx.MockTransport` với dữ liệu mẫu trong
`tests/test_mcp_flights/fixtures/`.

## Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `ModuleNotFoundError: No module named 'src'` | Chạy không ở thư mục gốc dự án | `cd` về thư mục gốc (nơi có `requirements.txt`), hoặc đặt `PYTHONPATH` trỏ tới thư mục đó |
| `No module named 'mcp.server.fastmcp'` | Code cũ dùng SDK 1.x | Cập nhật code dùng `from mcp.server import MCPServer` và cài lại `requirements.txt` |
| `FLIGHT_SEARCH_PROVIDER=serpapi nhưng chưa đặt FLIGHT_SERPAPI_API_KEY` | Thiếu key trong `.env` | Thêm key, hoặc chuyển về `mock` |
| `FLIGHT_SERPAPI_API_KEY không hợp lệ` / `Đã hết lượt gọi SerpApi` | Key sai, key đã tạo lại, hoặc hết 100 lượt/tháng | Kiểm tra key trên dashboard SerpApi, hoặc tạm chuyển về `mock` |
| `Sân bay 'XXX' không nằm trong danh sách nội địa…` | Mã không có trong `catalog_data/airports.json` | Dùng `search_airports` để tra mã |
| `Ngày bay … đã qua` | Ví dụ cũ có ngày trong quá khứ | Đổi `departure_date` thành ngày trong tương lai |
| `Offer … đã hết hạn` / booking `EXPIRED` | Quá 30 phút (offer) hoặc 15 phút (giữ chỗ) | Tìm lại hoặc giữ chỗ lại; thời hạn chỉnh bằng `FLIGHT_OFFER_TTL_MINUTES` / `FLIGHT_HOLD_MINUTES` |
| Muốn xóa sạch dữ liệu test | | Xóa file `data/flights.db`; server tự tạo lại khi chạy |

## Vé khứ hồi

Theo thiết kế thanh toán đa dịch vụ ([payment-design.md](../../docs/review/payment-design.md) §8.2–8.4), quyết
định 07/10/2026. Khứ hồi dùng **chế độ khứ hồi của SerpApi** thay cho hai lần tìm một chiều.

| Thành phần | Thay đổi |
|---|---|
| `FlightSearchRequest` | Thêm `trip_type` (`one_way` mặc định, `round_trip`) và `return_date` (bắt buộc khi `round_trip`, không trước `departure_date`) |
| Provider SerpApi | Khứ hồi gửi `type=1` + `return_date`; kết quả là danh sách **chiều đi**, mỗi chuyến có `departure_token`. Server giữ token, chỉ trả `offer_id` |
| Tool mới `search_return_flights(outbound_offer_id)` | Chỉ đọc. Gọi SerpApi với `departure_token` của chuyến đi đã chọn; trả **offer hành trình** gồm hai chặng, tổng giá, hạn. Lọc chuyến về cất cánh trước giờ hạ cánh chuyến đi cộng khoảng cách tối thiểu (`FLIGHT_ROUND_TRIP_MIN_GAP_MINUTES`, mặc định 120 phút) |
| `get_offer` | Đọc được offer hành trình hai chặng |
| `hold_booking`, `confirm_booking`, `cancel_booking` | Nhận offer hành trình: một booking mô phỏng có hai chặng, hạn giữ 15 phút |
| Lưu booking (`storage.py`, `booking_engine.py`) | Chỉ lưu `passenger_ref` (tham chiếu tới kho dữ liệu cá nhân mã hóa của agent) và tóm tắt không định danh (số người theo loại). Dữ liệu hành khách chỉ dùng trong bộ nhớ để kiểm và chuẩn hóa tên, không ghi xuống bảng `bookings` như hiện nay |
| Provider mock | Hỗ trợ cùng contract để test không cần SerpApi key |

`get_offer` đọc offer đã lưu (kết quả SerpApi được cache 1 giờ), nên giá là **giá tham khảo tại thời điểm lấy**, không
phải giá hãng vừa xác minh; giữ chỗ mô phỏng không bảo đảm còn ghế thật. Mỗi offer ghi `price_scope` (một chiều hay cả
hành trình, số khách, loại tiền); không tự cộng hay chia giá.

Giá SerpApi (kiểm bằng lần gọi thật 08/10/2026): ở danh sách chiều đi, giá mỗi chuyến là **giá khứ hồi thấp nhất có
chuyến đi đó** (`kind=round_trip_outbound`, `price_scope=round_trip_from`); offer này không giữ chỗ được. Ở danh sách
chiều về, giá là **tổng cả hành trình** (`kind=round_trip`, `price_scope=round_trip`) và chỉ offer này mới giữ chỗ.
Provider mock lấy giá chiều đi cộng chiều về rẻ nhất cho cùng contract.

Khi bên gọi đưa `passenger_ref`, booking lưu `passengers=[]`, `contact=null` và `passenger_counts`; số vé xuất theo
`passenger_counts`.

## Giới hạn và hướng mở rộng

- Với SerpApi, giá là giá tổng Google Flights hiển thị cho số khách đã chọn. `seats_left` không có.
- Khi dùng SerpApi, một offer có thể gồm chặng quá cảnh. Điều kiện vé lấy theo hãng của chặng đầu.
- Chưa có tool đổi vé và chưa hỗ trợ tìm nhiều chặng (multi-city).
- Có thể thêm provider mới (ví dụ API đại lý B2B) bằng cách viết class theo `FlightSearchProvider`
  (`search/base.py`) rồi đăng ký trong `search/__init__.py`.
