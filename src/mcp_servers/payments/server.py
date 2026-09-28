from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from starlette.requests import Request
from starlette.responses import JSONResponse

from src.mcp_servers.payments.tools import PaymentServices, PaymentTools, build_services

SERVER_NAME = "vn-payment"
INSTRUCTIONS = """\
Server tạo và theo dõi thanh toán (VND) qua cổng mock hoặc ZaloPay sandbox. Không có tiền thật.

Quy tắc dữ liệu: chỉ truyền mã nội bộ vô danh (ví dụ booking_id). KHÔNG truyền tên, email,
số điện thoại hay số giấy tờ vào bất kỳ tham số nào.

Quy trình:
1. create_payment -> đưa link/QR cho người dùng.
2. get_payment để kiểm tra đã PAID chưa (có thể gọi lại sau vài giây).
Hoàn tiền: refund_payment(confirm=false) để báo trước, confirm=true khi người dùng đồng ý.
"""

READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=True)
CREATE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=True)
COMMIT = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=True)


def create_server(services: PaymentServices | None = None, host: str = "127.0.0.1", port: int = 8766) -> FastMCP:
    """Tạo MCP server; truyền `services` để test với cổng/DB riêng. `host` truyền lúc khởi tạo (xem ADR-014)."""
    services = services or build_services()
    tools = PaymentTools(services)
    mcp = FastMCP(SERVER_NAME, instructions=INSTRUCTIONS, host=host, port=port)

    mcp.add_tool(tools.create_payment, title="Tạo thanh toán", annotations=CREATE)
    mcp.add_tool(tools.get_payment, title="Trạng thái thanh toán", annotations=READ_ONLY)
    mcp.add_tool(tools.cancel_payment, title="Hủy thanh toán", annotations=COMMIT)
    mcp.add_tool(tools.refund_payment, title="Hoàn tiền", annotations=COMMIT)
    # Cổng thật không được có đường tắt đánh dấu "đã trả"
    if services.engine.provider == "mock":
        mcp.add_tool(tools.simulate_payment_result, title="Giả lập kết quả (mock)", annotations=COMMIT)

    @mcp.custom_route("/health", methods=["GET"])
    async def health(_: Request) -> JSONResponse:
        """Healthcheck cho Docker/compose (chỉ có khi chạy streamable-http)."""
        return JSONResponse({"status": "ok", "server": SERVER_NAME, "provider": services.engine.provider})

    return mcp
