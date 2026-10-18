"""Actual FastAPI -> HTTPX -> Starlette chain through the production SDK."""

import asyncio
import json
import socket
import sqlite3
import uuid


async def main():
    import httpx
    import uvicorn
    from fastapi import FastAPI
    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def record(request):
        assert "baggage" not in request.headers
        return JSONResponse({"value": "SYNTHETIC_PRIVATE_RESPONSE"})

    async def broken(request):
        raise ValueError("SYNTHETIC_PRIVATE_EXCEPTION")

    backend = Starlette(routes=[Route("/records/{record_id}", record), Route("/broken", broken)])
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

            @app.get("/forward")
            async def forward():
                with sqlite3.connect(":memory:") as connection:
                    assert connection.cursor().execute("SELECT 1").fetchone() == (1,)
                connection.close()
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

            @app.get("/starlette-failure")
            async def starlette_failure():
                async with httpx.AsyncClient() as client:
                    result = await client.get(f"http://127.0.0.1:{listener.getsockname()[1]}/broken")
                    return JSONResponse({"ok": False}, status_code=result.status_code)

            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                         base_url="http://fixture") as client:
                responses = {}
                for name, path in (
                    ("forward", "/forward?token=SYNTHETIC_PRIVATE_TOKEN"),
                    ("failure", "/fail/SYNTHETIC_PRIVATE_ID?token=SYNTHETIC_PRIVATE_TOKEN"),
                    ("unknown", "/SYNTHETIC_PRIVATE_UNKNOWN"),
                    ("starlette_failure", "/starlette-failure"),
                ):
                    trace_id = uuid.uuid4().hex
                    result = await client.get(path, headers={
                        "traceparent": f"00-{trace_id}-2222222222222222-01",
                        "baggage": "user=SYNTHETIC_PRIVATE_USER", "cookie": "session=SYNTHETIC_PRIVATE_COOKIE",
                        "authorization": "Bearer SYNTHETIC_PRIVATE_SECRET",
                    })
                    responses[name] = {"status": result.status_code, "trace_id": trace_id}
                assert "x-trace-id" not in (await client.get("/health")).headers
                for path in ("/assets/SYNTHETIC_PRIVATE_ASSET", "/images/SYNTHETIC_PRIVATE_IMAGE"):
                    assert "x-trace-id" not in (await client.get(path)).headers

                print(json.dumps(responses), flush=True)
        finally:
            server.should_exit = True
            await task


if __name__ == "__main__":
    asyncio.run(main())
