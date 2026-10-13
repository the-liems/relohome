"""Temporary launch compatibility; removal gate #115, see docs/integration/agent-app-relocation.md."""

if __name__ == "relohome_flights_mcp":
    raise ImportError(
        "Stale editable install maps relohome_flights_mcp to src/mcp_servers/flights/; "
        "run `npm run setup:python` from the repository root "
        "to reinstall from apps/flights-mcp."
    )

from relohome_flights_mcp import FlightServices, build_services, create_server  # noqa: E402, F401
