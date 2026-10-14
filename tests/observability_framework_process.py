"""Actual FastAPI -> HTTPX -> Starlette chain through the production SDK."""

import asyncio
import json
import socket

from relohome_observability import initialize

initialize("framework-fixture")


async def main():
    import httpx
    import uvicorn
    from fastapi import FastAPI
    from relohome_observability.asgi import instrument_fastapi, instrument_starlette
    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def record(request):
        assert "baggage" not in request.headers
        return JSONResponse({"value": "SYNTHETIC_PRIVATE_RESPONSE"})

    backend = Starlette(routes=[Route("/records/{record_id}", record)])
    instrument_starlette(backend)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        server = uvicorn.Server(uvicorn.Config(backend, log_level="error"))
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            async with asyncio.timeout(10):
                while not server.started:
                    await asyncio.sleep(0.01)
            app = FastAPI(telemetry={"tracing": False})
            instrument_fastapi(app, trust_incoming=False)

            @app.get("/forward")
            async def forward():
                async with httpx.AsyncClient() as client:
                    result = await client.get(
                        f"http://127.0.0.1:{listener.getsockname()[1]}/records/SYNTHETIC_PRIVATE_ID"
                        "?token=SYNTHETIC_PRIVATE_TOKEN",
                    )
                    return result.json()

            @app.get("/fail/{item_id}")
            async def failure(item_id: str):
                raise ValueError("SYNTHETIC_PRIVATE_EXCEPTION")

            @app.get("/health")
            async def health():
                return {"ok": True}

            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                         base_url="http://fixture") as client:
                responses = {}
                for name, path in (
                    ("forward", "/forward?token=SYNTHETIC_PRIVATE_TOKEN"),
                    ("failure", "/fail/SYNTHETIC_PRIVATE_ID?token=SYNTHETIC_PRIVATE_TOKEN"),
                    ("unknown", "/SYNTHETIC_PRIVATE_UNKNOWN"),
                ):
                    result = await client.get(path, headers={
                        "traceparent": "00-11111111111111111111111111111111-2222222222222222-00",
                        "baggage": "user=SYNTHETIC_PRIVATE_USER", "cookie": "session=SYNTHETIC_PRIVATE_COOKIE",
                        "authorization": "Bearer SYNTHETIC_PRIVATE_SECRET",
                    })
                    responses[name] = {"status": result.status_code, "trace_id": result.headers["x-trace-id"]}
                assert "x-trace-id" not in (await client.get("/health")).headers
                print(json.dumps(responses), flush=True)
        finally:
            server.should_exit = True
            await task


if __name__ == "__main__":
    asyncio.run(main())
