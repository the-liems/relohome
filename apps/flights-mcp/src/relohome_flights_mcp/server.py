from mcp.server import MCPServer
from mcp.types import ToolAnnotations
from relohome_flight.errors import FlightError
from relohome_flight.settings import FlightSettings, get_flight_settings
from relohome_flights_mcp.tools import FlightServices, FlightTools, build_services
from relohome_mcp_http import tool_errors
from starlette.requests import Request
from starlette.responses import JSONResponse

SERVER_NAME = "vn-flight-booking"
INSTRUCTIONS = """\
Server tìm và đặt vé máy bay NỘI ĐỊA Việt Nam. Dữ liệu tìm chuyến lấy từ mock hoặc
Google Flights (SerpApi); phần giữ chỗ/xuất vé/hủy là GIẢ LẬP, không phát sinh vé thật.

Quy trình chuẩn:
1. search_airports nếu người dùng nói tên thành phố thay vì mã IATA.
2. search_flights (một chiều; khứ hồi thì tìm 2 lần).
3. get_offer để xem hành lý và điều kiện hoàn/hủy của lựa chọn.
4. hold_booking -> trình bày tóm tắt và tổng tiền, CHỜ người dùng đồng ý.
5. confirm_booking chỉ sau khi người dùng xác nhận.
Hủy: cancel_booking(confirm=false) để báo phí trước, confirm=true khi người dùng đồng ý.
"""

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
SEARCH = ToolAnnotations(read_only_hint=True, open_world_hint=True)
HOLD = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
COMMIT = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True, open_world_hint=False)


def create_server(
    services: FlightServices | None = None,
    *,
    settings: FlightSettings | None = None,
) -> MCPServer:
    """Tạo MCP server; truyền `services` để test với provider/DB riêng.

    Truyền `settings` để chọn chế độ rõ ràng; nếu không thì đọc FLIGHT_* từ môi trường.
    Chỉ bật tool/resource/prompt booking khi simulation_enabled=True.

    """
    settings = settings or get_flight_settings()
    services = services or build_services(settings)
    tools = FlightTools(services)
    simulation = settings.simulation_enabled
    instructions = (
        INSTRUCTIONS
        if simulation
        else "Search real flights and inspect offers only. Booking, ticketing, cancellation and payment are unavailable."
    )
    mcp = MCPServer(SERVER_NAME, instructions=instructions)

    mcp.add_tool(tool_errors(tools.search_airports, FlightError), title="Tra mã sân bay", annotations=READ_ONLY)
    mcp.add_tool(tool_errors(tools.search_flights, FlightError), title="Tìm chuyến bay", annotations=SEARCH)
    mcp.add_tool(tool_errors(tools.search_return_flights, FlightError), title="Tìm chiều về (khứ hồi)", annotations=SEARCH)
    mcp.add_tool(tool_errors(tools.get_offer, FlightError), title="Chi tiết offer", annotations=READ_ONLY)
    if simulation:
        mcp.add_tool(tool_errors(tools.hold_booking, FlightError), title="Giữ chỗ", annotations=HOLD)
        mcp.add_tool(tool_errors(tools.confirm_booking, FlightError), title="Xuất vé", annotations=COMMIT)
        mcp.add_tool(tool_errors(tools.get_booking, FlightError), title="Tra cứu booking", annotations=READ_ONLY)
        mcp.add_tool(tool_errors(tools.cancel_booking, FlightError), title="Hủy booking", annotations=COMMIT)

    mcp.resource("flights://airports", mime_type="application/json")(tools.airports_resource)
    mcp.resource("flights://airlines", mime_type="application/json")(tools.airlines_resource)
    if simulation:
        mcp.resource("flights://bookings/{booking_ref}", mime_type="application/json")(tools.booking_resource)
        mcp.prompt(name="plan_domestic_trip")(plan_domestic_trip)

    @mcp.custom_route("/health", methods=["GET"])
    async def health(_: Request) -> JSONResponse:
        """Healthcheck cho Docker/compose (chỉ có khi chạy streamable-http)."""
        return JSONResponse({"status": "ok", "server": SERVER_NAME, "provider": services.provider.name})

    return mcp


def plan_domestic_trip(origin: str, destination: str, departure_date: str) -> str:
    """Kịch bản hướng dẫn LLM đặt một chuyến bay nội địa từ đầu đến cuối."""
    return (
        f"Hãy giúp tôi đặt vé máy bay từ {origin} đến {destination} ngày {departure_date}.\n"
        "- Nếu đó là tên thành phố, dùng search_airports để lấy mã IATA.\n"
        "- Hỏi tôi số người lớn/trẻ em/em bé và hạng ghế nếu chưa rõ.\n"
        "- Gọi search_flights, trình bày tối đa 5 lựa chọn (hãng, giờ đi/đến, giá tổng).\n"
        "- Khi tôi chọn, gọi get_offer để nói rõ hành lý và điều kiện hoàn/hủy.\n"
        "- Hỏi thông tin hành khách và liên hệ, gọi hold_booking.\n"
        "- Đọc lại tóm tắt booking và CHỈ gọi confirm_booking khi tôi đồng ý rõ ràng."
    )
