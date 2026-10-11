"""Subprocess fixture: real SDK bootstrap and a mock Payment stdio child."""

import asyncio
import os
import sys

from src.observability import current_context, initialize, operation

initialize("python-fixture")


async def main():
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    # Explicit allowlist: no application/provider secrets forwarded to the child.
    child_env = {key: os.environ[key] for key in (
        "PATH", "PYTHONPATH", "OBSERVABILITY_ENABLED", "OBSERVABILITY_CONTENT_MODE",
        "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "OTEL_DEPLOYMENT_ENVIRONMENT",
        "PAYMENT_DB_PATH",
    ) if key in os.environ}
    child_env["PAYMENT_PROVIDER"] = "mock"
    with operation("gateway"):
        params = StdioServerParameters(command=sys.executable,
            args=["-m", "src.mcp_servers.payments", "--transport", "stdio"], env=child_env)
        async with stdio_client(params) as (read, write), ClientSession(read, write) as client:
            await client.initialize()
            with operation("payment.client", "tool"):
                result = await client.call_tool("get_payment", {"payment_ref": "missing-fixture"}, meta=current_context())
                assert result.isError
            # Let the child's asynchronous SDK flush before the stdio launcher terminates it.
            await asyncio.sleep(6)


if __name__ == "__main__":
    asyncio.run(main())
