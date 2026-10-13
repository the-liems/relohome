"""Chạy server: `python -m relohome_payments_mcp [--transport stdio|streamable-http]`."""

import argparse

from relohome_observability import initialize
from relohome_payment.settings import get_payment_settings
from relohome_payments_mcp.server import create_server
from relohome_payments_mcp.tools import build_services


def main() -> None:
    initialize("payments-mcp")
    parser = argparse.ArgumentParser(description="MCP server thanh toán (mock / ZaloPay sandbox)")
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="streamable-http")
    args = parser.parse_args()

    settings = get_payment_settings()
    server = create_server(build_services(settings), host=settings.mcp_host, port=settings.mcp_port, token=settings.mcp_auth_token)
    server.run(transport=args.transport)


if __name__ == "__main__":
    main()
