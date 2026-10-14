"""Chạy server: `python -m relohome_flights_mcp [--transport stdio|streamable-http]`."""

import argparse

from relohome_flight.settings import get_flight_settings
from relohome_flights_mcp.server import create_server
from relohome_flights_mcp.tools import build_services
from relohome_observability import initialize


def main() -> None:
    initialize("flights-mcp")
    parser = argparse.ArgumentParser(description="MCP server đặt vé máy bay nội địa Việt Nam")
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="streamable-http")
    args = parser.parse_args()

    settings = get_flight_settings()
    server = create_server(build_services(settings), host=settings.mcp_host, port=settings.mcp_port, settings=settings)
    server.run(transport=args.transport)


if __name__ == "__main__":
    main()
