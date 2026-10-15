"""Test-owned HTTP service lifecycle; application clients never launch servers."""

import asyncio
import socket
from contextlib import asynccontextmanager

import uvicorn
from relohome_mcp_http import create_http_app

TEST_MCP_TOKEN = "test-mcp-token-01234567890123456789"


@asynccontextmanager
async def running_mcp(server, token=TEST_MCP_TOKEN):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        port = listener.getsockname()[1]
        http = uvicorn.Server(uvicorn.Config(create_http_app(server, token), log_level="error", lifespan="on"))
        task = asyncio.create_task(http.serve(sockets=[listener]))
        try:
            async with asyncio.timeout(10):
                while not http.started:
                    if task.done():
                        await task
                        raise RuntimeError("Test HTTP service exited before startup")
                    await asyncio.sleep(0.01)
            yield f"http://127.0.0.1:{port}/mcp"
        finally:
            http.should_exit = True
            await asyncio.wait_for(task, timeout=10)
