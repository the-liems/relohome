"""Chạy server: `python -m src.mcp_servers.flights [--transport stdio|streamable-http]`."""

import argparse

from src.mcp_servers.flights.server import create_server
from src.mcp_servers.flights.settings import get_flight_settings
from src.mcp_servers.flights.tools import build_services


def main() -> None:
    parser = argparse.ArgumentParser(description="MCP server đặt vé máy bay nội địa Việt Nam")
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    args = parser.parse_args()

    settings = get_flight_settings()
    server = create_server(build_services(settings))
    server.settings.host = settings.mcp_host
    server.settings.port = settings.mcp_port
    server.run(transport=args.transport)


if __name__ == "__main__":
    main()
