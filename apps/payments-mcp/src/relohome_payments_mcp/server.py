from mcp.server import MCPServer
from mcp.types import ToolAnnotations
from relohome_mcp_http import tool_errors
from relohome_payment.errors import PaymentError
from relohome_payments_mcp.tools import PaymentServices, PaymentTools, build_services
from starlette.requests import Request
from starlette.responses import JSONResponse

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

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=True)
CREATE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=True)
COMMIT = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True, open_world_hint=True)


def create_server(services: PaymentServices | None = None) -> MCPServer:
    """Tạo MCP server; truyền `services` để test với cổng/DB riêng."""
    services = services or build_services()
    tools = PaymentTools(services)
    mcp = MCPServer(SERVER_NAME, instructions=INSTRUCTIONS)

    mcp.add_tool(tool_errors(tools.create_payment, PaymentError), title="Tạo thanh toán", annotations=CREATE)
    mcp.add_tool(tool_errors(tools.get_payment, PaymentError), title="Trạng thái thanh toán", annotations=READ_ONLY)
    mcp.add_tool(tool_errors(tools.cancel_payment, PaymentError), title="Hủy thanh toán", annotations=COMMIT)
    mcp.add_tool(tool_errors(tools.refund_payment, PaymentError), title="Hoàn tiền", annotations=COMMIT)
    # Cổng thật không được có đường tắt đánh dấu "đã trả"
    if services.engine.provider == "mock":
        mcp.add_tool(tool_errors(tools.simulate_payment_result, PaymentError), title="Giả lập kết quả (mock)", annotations=COMMIT)

    @mcp.custom_route("/health", methods=["GET"])
    async def health(_: Request) -> JSONResponse:
        """Healthcheck cho Docker/compose (chỉ có khi chạy streamable-http)."""
        return JSONResponse(
            {
                "status": "ok",
                "server": SERVER_NAME,
                "provider": services.engine.provider,
                # Client (graph / UI demo) biết có dùng được `simulate_payment_result` hay không
                "simulation": services.engine.provider == "mock",
                "environment": services.engine.environment,
            }
        )

    return mcp
