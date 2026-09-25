# Flight MCP server — Đặt vé máy bay nội địa Việt Nam

MCP server (theo chuẩn [Model Context Protocol](https://modelcontextprotocol.io)) cho phép
LLM/agent **tìm chuyến bay, giữ chỗ, xuất vé và hủy vé** trên các chặng nội địa Việt Nam.
Server dùng được với agent LangGraph của dự án, Claude Code/Desktop, MCP Inspector
và các client MCP khác.

Tài liệu liên quan:
[ADR-004 — nguồn dữ liệu](../../../docs/adr/ADR-004-flight-data-source.md) ·
[ADR-005 — bố cục MCP server](../../../docs/adr/ADR-005-flight-mcp-server-layout.md) ·
[Ví dụ request/response của từng tool](../../../docs/api/examples/flights/README.md)

> ⚠️ Phần **giữ chỗ / xuất vé / hủy là GIẢ LẬP**. Server không trừ tiền và không tạo vé thật.
> Điều kiện hành lý, phí đổi và phí hủy trong `catalog_data/airlines.json` là số liệu mẫu, không
> phải quy định chính thức của hãng.

## Bắt đầu nhanh (3 phút, không cần API key)

```bash
# Linux / macOS / Git Bash — chạy ở thư mục gốc dự án
source .venv/bin/activate
pip install -r requirements.txt
pytest tests/test_mcp_flights -q          # kiểm tra cài đặt
python - <<'EOF'
import asyncio
from mcp.shared.memory import create_connected_server_and_client_session
from src.mcp_servers.flights import create_server

async def main():
    async with create_connected_server_and_client_session(create_server()) as c:
        r = await c.call_tool("search_flights", {"request": {"origin": "HAN", "destination": "SGN", "departure_date": "2026-12-20"}})
        print(r.structuredContent["message"] if not r.isError else r.content[0].text)

asyncio.run(main())
EOF
```

Trên Windows PowerShell: dùng `.venv\Scripts\activate`, rồi chạy các lệnh Python trong mục
[Tích hợp vào phần khác](#tích-hợp-vào-phần-khác). Nhớ đổi `departure_date` thành một ngày
trong tương lai.

## Vì sao chọn nguồn dữ liệu này

| Lựa chọn | Tình trạng (09/2026) |
|---|---|
| Duffel | Theo tìm hiểu của nhóm, chưa hỗ trợ tài khoản tại Việt Nam |
| Amadeus Self-Service | Đã đóng ngày 17/07/2026 |
| Vietnam Airlines, Vietjet, Bamboo, Vietravel | Không có API công khai; chỉ bán qua hợp đồng đại lý (B2B) |
| **SerpApi – Google Flights** | Giá và giờ bay thật, có chặng nội địa VN, miễn phí 100 lượt/tháng. Chỉ đọc dữ liệu, không đặt vé được |

Vì vậy server tách làm hai phần:

- **Tìm chuyến**: `mock` (mặc định, offline, dùng cho test/CI/demo) hoặc `serpapi` (dữ liệu thật).
- **Đặt vé**: engine giả lập lưu trong SQLite (`booking_engine.py`).

## Cấu trúc

```text
src/mcp_servers/flights/
├── __main__.py        # python -m src.mcp_servers.flights
├── server.py          # create_server(): đăng ký tool, resource, prompt
├── tools.py           # FlightTools: phần xử lý của từng tool (docstring = mô tả cho LLM)
├── schemas.py         # Pydantic model: input/output của tool
├── settings.py        # FlightSettings: biến môi trường FLIGHT_*
├── catalog.py         # Sân bay, hãng bay, điều kiện vé, tìm sân bay không dấu
├── storage.py         # SQLite: offer cache, search cache
├── booking_engine.py  # Giữ chỗ → xuất vé → hủy (giả lập)
├── errors.py          # Lỗi nghiệp vụ; message trả thẳng cho client
├── search/
│   ├── base.py        # Protocol FlightSearchProvider, validate, sort
│   ├── mock.py        # Sinh lịch bay giả lập, deterministic
│   └── serpapi.py     # Gọi SerpApi Google Flights
└── catalog_data/      # airports.json (22 sân bay), airlines.json (VN, VJ, QH, VU, 9G)

src/agents/tools/flight_mcp.py   # Nạp tool vào LangGraph qua langchain-mcp-adapters
tests/test_mcp_flights/          # Unit test + test MCP in-memory
tests/test_agents/test_flight_mcp.py  # Test chạy server thật qua stdio
```

Server có cấu hình riêng (`settings.py`, tiền tố `FLIGHT_`) và không sửa `src/config.py`,
để hạn chế xung đột khi merge với code của các thành viên khác.

## Cài đặt

```bash
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # đã có mcp[cli] và langchain-mcp-adapters
```

`mcp` được giới hạn `<2` vì `langchain-mcp-adapters` chưa hỗ trợ mcp 2.x (ở bản 2.x,
`FastMCP` được đổi tên thành `MCPServer`).

## Cấu hình (`.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `FLIGHT_SEARCH_PROVIDER` | `mock` | `mock` hoặc `serpapi` |
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
# stdio (Claude Code/Desktop, LangGraph)
python -m src.mcp_servers.flights

# Streamable HTTP tại http://127.0.0.1:8765/mcp
python -m src.mcp_servers.flights --transport streamable-http
```

### Thử bằng MCP Inspector (cần Node.js)

```bash
npx @modelcontextprotocol/inspector .venv/bin/python -m src.mcp_servers.flights
# Windows: npx @modelcontextprotocol/inspector .venv\Scripts\python.exe -m src.mcp_servers.flights
# Ghi đè biến cho riêng lần chạy: thêm -e FLIGHT_SEARCH_PROVIDER=serpapi ngay sau "inspector"
```

Mở link được in ra, bấm **Connect**, vào tab **Tools** rồi chọn **List Tools**. Nội dung mẫu
để nhập cho từng tool có trong [file ví dụ](../../../docs/api/examples/flights/README.md).

### Kết nối Claude Code

```bash
claude mcp add flights -- .venv/bin/python -m src.mcp_servers.flights
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
      "args": ["-m", "src.mcp_servers.flights"],
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

```python
import asyncio

from langchain.agents import create_agent

from src.agents.tools.flight_mcp import flight_tools_session, get_flight_tools
from src.services.llm import get_llm


async def main() -> None:
    # Cách 1: mỗi lần gọi tool mở một process server mới (đơn giản)
    tools = await get_flight_tools()

    # Cách 2: giữ một process cho cả phiên hội thoại (nhanh hơn)
    async with flight_tools_session() as tools:
        agent = create_agent(get_llm(), tools)
        result = await agent.ainvoke({"messages": [("user", "Tìm vé SGN đi PQC ngày 2026-12-20")]})
        print(result["messages"][-1].content)


asyncio.run(main())
```

- Hai cách đều dùng được, vì offer và booking được lưu trong SQLite chứ không nằm trong RAM của process.
- Tool nhận được là `BaseTool` của LangChain, nên dùng được với `ToolNode`, `bind_tools` hay `create_agent`.
- Việc gắn tool vào graph chính (`src/agents/graph.py`) do người phụ trách tool routing quyết định.
- Cần `OPENAI_API_KEY` trong `.env` cho `get_llm()`.

### B. Gọi trực tiếp như thư viện Python

Không đi qua giao thức MCP, không mở process con. Hợp khi viết endpoint FastAPI hoặc một node
LangGraph cần gọi tìm vé một cách chắc chắn, không qua LLM.

```python
from datetime import date

from src.mcp_servers.flights import build_services
from src.mcp_servers.flights.schemas import FlightSearchRequest
from src.mcp_servers.flights.tools import FlightTools

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

Chạy server ở chế độ HTTP (`python -m src.mcp_servers.flights --transport streamable-http`).
Sau đó mọi client MCP đều kết nối được tới `http://127.0.0.1:8765/mcp`, dù viết bằng Python,
TypeScript hay ngôn ngữ khác.

```python
import asyncio

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


async def main() -> None:
    async with streamablehttp_client("http://127.0.0.1:8765/mcp") as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool("search_airports", {"query": "phu quoc"})
            print(result.structuredContent)


asyncio.run(main())
```

Với LangGraph, khai báo kết nối kiểu `{"transport": "streamable_http", "url": "http://127.0.0.1:8765/mcp"}`
trong `MultiServerMCPClient`.

⚠️ Server chưa có xác thực và mặc định chỉ nghe ở `127.0.0.1`. Không đặt
`FLIGHT_MCP_HOST=0.0.0.0` trên máy public (xem ADR-005).

## Tool, resource, prompt

| Tool | Loại | Mô tả |
|---|---|---|
| `search_airports(query, limit)` | chỉ đọc | Tra mã IATA, không phân biệt dấu: "Đà Nẵng" → DAD, "sài gòn" → SGN |
| `search_flights(request)` | chỉ đọc | Tìm chuyến **một chiều** (khứ hồi thì gọi 2 lần). Có thể lọc bay thẳng, sắp xếp theo `price`, `departure_time` hoặc `duration` |
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
ruff check src/ tests/
```

Test không gọi mạng. Phần SerpApi được test bằng `httpx.MockTransport` với dữ liệu mẫu trong
`tests/test_mcp_flights/fixtures/`.

## Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `ModuleNotFoundError: No module named 'src'` | Chạy không ở thư mục gốc dự án | `cd` về thư mục gốc (nơi có `requirements.txt`), hoặc đặt `PYTHONPATH` trỏ tới thư mục đó |
| `No module named 'mcp.server.fastmcp'` | Máy đang cài mcp 2.x | `pip install "mcp[cli]>=1.26,<2"` (hoặc `pip install -r requirements.txt`) |
| `FLIGHT_SEARCH_PROVIDER=serpapi nhưng chưa đặt FLIGHT_SERPAPI_API_KEY` | Thiếu key trong `.env` | Thêm key, hoặc chuyển về `mock` |
| `FLIGHT_SERPAPI_API_KEY không hợp lệ` / `Đã hết lượt gọi SerpApi` | Key sai, key đã tạo lại, hoặc hết 100 lượt/tháng | Kiểm tra key trên dashboard SerpApi, hoặc tạm chuyển về `mock` |
| `Sân bay 'XXX' không nằm trong danh sách nội địa…` | Mã không có trong `catalog_data/airports.json` | Dùng `search_airports` để tra mã |
| `Ngày bay … đã qua` | Ví dụ cũ có ngày trong quá khứ | Đổi `departure_date` thành ngày trong tương lai |
| `Offer … đã hết hạn` / booking `EXPIRED` | Quá 30 phút (offer) hoặc 15 phút (giữ chỗ) | Tìm lại hoặc giữ chỗ lại; thời hạn chỉnh bằng `FLIGHT_OFFER_TTL_MINUTES` / `FLIGHT_HOLD_MINUTES` |
| Muốn xóa sạch dữ liệu test | | Xóa file `data/flights.db`; server tự tạo lại khi chạy |

## Giới hạn và hướng mở rộng

- Với SerpApi, giá là giá tổng Google Flights hiển thị cho số khách đã chọn. `seats_left` không có.
- Khi dùng SerpApi, một offer có thể gồm chặng quá cảnh. Điều kiện vé lấy theo hãng của chặng đầu.
- Chưa có tool đổi vé và chưa hỗ trợ tìm nhiều chặng (multi-city).
- Có thể thêm provider mới (ví dụ API đại lý B2B) bằng cách viết class theo `FlightSearchProvider`
  (`search/base.py`) rồi đăng ký trong `search/__init__.py`.
