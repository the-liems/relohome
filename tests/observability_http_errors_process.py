"""Actual gateway/backend failures through the production SDK and OTLP exporters."""

import asyncio
import json
import os
import socket
import tempfile
import uuid
from pathlib import Path
from types import SimpleNamespace


async def main():
    import httpx
    from pydantic import SecretStr
    from relohome_agent.main import app as backend
    from relohome_gateway.server import create_app

    results = {}

    async def gateway_probe(name, folder, transport=None):
        app = create_app(folder / (name + ".db"), transport)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture") as client,
        ):
            await client.get("/web/api/session")
            trace_id = uuid.uuid4().hex
            response = await client.get("/web/api/status", headers={"traceparent": f"00-{trace_id}-2222222222222222-01"})
            results[name] = {
                "status": response.status_code,
                "trace_id": trace_id,
                "traceresponse": response.headers.get("traceresponse"),
            }

    with tempfile.TemporaryDirectory() as temporary:
        folder = Path(temporary)
        os.environ["RELOHOME_GUEST_ENABLED"] = "true"
        os.environ.pop("AGENT_API_TOKEN", None)
        await gateway_probe("missing_token", folder)
        os.environ["AGENT_API_TOKEN"] = "SYNTHETIC_PRIVATE_TOKEN"
        await gateway_probe(
            "invalid_json", folder,
            httpx.MockTransport(lambda _: httpx.Response(200, text="SYNTHETIC_PRIVATE_RESPONSE")),
        )
        with socket.socket() as reserved:
            reserved.bind(("127.0.0.1", 0))
            os.environ["LIFEFLOW_API_BASE_URL"] = f"http://127.0.0.1:{reserved.getsockname()[1]}/api/v1"
            await gateway_probe("connection_error", folder)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=backend), base_url="http://fixture") as client:
        for name, service in (
            ("missing_runtime", None),
            ("missing_backend_token", SimpleNamespace(mode="live", settings=SimpleNamespace(agent_api_token=SecretStr("")))),
        ):
            backend.state.agent_service = service
            trace_id = uuid.uuid4().hex
            response = await client.get("/api/v1/status", headers={"traceparent": f"00-{trace_id}-2222222222222222-01"})
            results[name] = {"status": response.status_code, "trace_id": trace_id}
    print(json.dumps(results), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
