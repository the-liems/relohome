"""Synthetic gateway -> HTTP backend -> LangGraph agent -> Node MCP request."""

import asyncio
import os
import socket

from relohome_observability import initialize, traced_node

initialize("smoke-python")


async def main():
    import httpx
    import uvicorn
    from fastapi import FastAPI
    from langgraph.graph import END, START, StateGraph
    from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient
    from relohome_observability.asgi import TelemetryMiddleware
    from relohome_observability.runtime import invoke_graph

    client = McpToolClient(McpEndpoint("smoke", frozenset({"smoke_query"}),
                          url=os.environ["SMOKE_MCP_URL"], token=os.environ["SMOKE_MCP_TOKEN"]))

    async def agent(state):
        result = await client.call("smoke_query", {"email": "private@example.com"})
        assert result == {"email": "private@example.com"}
        return {"ok": True}

    builder = StateGraph(dict)
    builder.add_node("smoke_agent", traced_node("smoke_agent", agent))
    builder.add_edge(START, "smoke_agent")
    builder.add_edge("smoke_agent", END)
    graph = builder.compile()
    backend = FastAPI(telemetry={"tracing": False})
    backend.add_middleware(TelemetryMiddleware)

    @backend.post("/chat")
    async def chat():
        return await invoke_graph(graph, {}, {"configurable": {"thread_id": "smoke-thread"}})

    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        server = uvicorn.Server(uvicorn.Config(backend, log_level="error"))
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            async with asyncio.timeout(10):
                while not server.started:
                    await asyncio.sleep(0.01)
            gateway = FastAPI(telemetry={"tracing": False})
            gateway.add_middleware(TelemetryMiddleware, trust_incoming=False)

            @gateway.post("/chat")
            async def proxy():
                async with httpx.AsyncClient() as http:
                    response = await http.post(f"http://127.0.0.1:{listener.getsockname()[1]}/chat")
                    response.raise_for_status()
                    return response.json()

            async with httpx.AsyncClient(transport=httpx.ASGITransport(gateway), base_url="http://gateway") as http:
                response = await http.post("/chat")
                assert response.json() == {"ok": True}
                print(response.headers["x-trace-id"], flush=True)
        finally:
            server.should_exit = True
            await task


if __name__ == "__main__":
    asyncio.run(main())
