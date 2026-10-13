"""Subprocess fixture: real SDK bootstrap and a mock Flight/Payment stdio child."""

import asyncio
import os
import sys

from relohome_observability import current_context, initialize, operation

initialize("python-fixture")


async def main():
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    # Explicit allowlist: no application/provider secrets forwarded to the child.
    child_env = {key: os.environ[key] for key in (
        "PATH", "LD_LIBRARY_PATH", "OBSERVABILITY_ENABLED", "OBSERVABILITY_CONTENT_MODE",
        "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "OTEL_DEPLOYMENT_ENVIRONMENT",
        "PAYMENT_DB_PATH", "FLIGHT_DB_PATH",
    ) if key in os.environ}
    child_env["PAYMENT_PROVIDER"] = "mock"
    child_env["FLIGHT_SEARCH_PROVIDER"] = "mock"
    child_env["FLIGHT_SIMULATION_ENABLED"] = "true"
    domain = os.environ.get("OBSERVABILITY_FIXTURE_MCP", "payments")
    if domain not in {"flights", "payments"}:
        raise ValueError("Unsupported fixture MCP")
    tool, argument = ("get_booking", "booking_ref") if domain == "flights" else ("get_payment", "payment_ref")
    with operation("gateway"):
        params = StdioServerParameters(command=sys.executable,
            args=["-m", f"relohome_{domain}_mcp", "--transport", "stdio"], env=child_env)
        async with stdio_client(params) as (read, write), ClientSession(read, write) as client:
            await client.initialize()
            with operation("mcp.client", "tool"):
                result = await client.call_tool(tool, {argument: "missing-fixture"}, meta=current_context())
                assert result.isError
            # Let the child's asynchronous SDK flush before the stdio launcher terminates it.
            await asyncio.sleep(6)


if __name__ == "__main__":
    asyncio.run(main())
