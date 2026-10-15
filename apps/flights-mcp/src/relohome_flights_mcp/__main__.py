"""Chạy server: `python -m relohome_flights_mcp [--transport stdio|streamable-http]`."""

import argparse

import uvicorn
from relohome_flight.settings import get_flight_settings
from relohome_flights_mcp.server import create_server
from relohome_flights_mcp.tools import build_services
from relohome_mcp_http import create_http_app


def main() -> None:
    parser = argparse.ArgumentParser(description="MCP server đặt vé máy bay nội địa Việt Nam")
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="streamable-http")
    args = parser.parse_args()

    settings = get_flight_settings()
    server = create_server(build_services(settings), settings=settings)
    if args.transport == "stdio":
        server.run()
    else:
        app = create_http_app(server, settings.mcp_auth_token, host=settings.mcp_host)
        uvicorn.run(app, host=settings.mcp_host, port=settings.mcp_port)


if __name__ == "__main__":
    main()
