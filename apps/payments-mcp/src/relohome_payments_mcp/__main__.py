"""Chạy server: `python -m relohome_payments_mcp [--transport stdio|streamable-http]`."""

import argparse

import uvicorn
from relohome_mcp_http import create_http_app
from relohome_payment.settings import get_payment_settings
from relohome_payments_mcp.server import create_server
from relohome_payments_mcp.tools import build_services


def main() -> None:
    parser = argparse.ArgumentParser(description="MCP server thanh toán (mock / ZaloPay sandbox)")
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="streamable-http")
    args = parser.parse_args()

    settings = get_payment_settings()
    server = create_server(build_services(settings))
    if args.transport == "stdio":
        server.run()
    else:
        app = create_http_app(server, settings.mcp_auth_token, host=settings.mcp_host)
        uvicorn.run(app, host=settings.mcp_host, port=settings.mcp_port)


if __name__ == "__main__":
    main()
