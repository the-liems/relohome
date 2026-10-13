"""Read-only local service audit. No LLM calls and no booking/payment writes.

Run from repo root: .venv/Scripts/python.exe apps/web/scripts/check-services.py
Prints counts/statuses only; never prints credentials or provider payloads.
"""

import asyncio
import importlib.util
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402

from relohome_agent.services.adapters.mcp import McpEndpoint, McpToolClient, ToolCallError  # noqa: E402
from relohome_agent.services.adapters.registry import LOCATION_READ_TOOLS  # noqa: E402


async def main():
    logging.getLogger("httpx").setLevel(logging.WARNING)
    spec = importlib.util.spec_from_file_location("local_runner", ROOT / "scripts/local-integration.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    env = runner.environment("api")
    report = {"llm_called": False, "transactions_created": False, "checks": {}}
    checks = report["checks"]
    location = McpToolClient(
        McpEndpoint(
            service="location",
            allowed_tools=LOCATION_READ_TOOLS,
            url=env.get("LOCATION_MCP_URL"),
            token=env.get("LOCATION_MCP_AUTH_TOKEN"),
            timeout_s=20,
        )
    )

    async def call(name, args):
        try:
            result = await location.call(name, args)
            checks[name] = {"ok": True}
            if isinstance(result, dict) and isinstance(result.get("results"), list):
                checks[name]["returned"] = len(result["results"])
            return result
        except ToolCallError as exc:
            checks[name] = {"ok": False, "code": exc.code}
            return {}

    await call("search_areas", {"text": "Ho Chi Minh", "limit": 2})
    await call("resolve_location", {"text": "Takashimaya", "limit": 2})
    houses = await call("search_housing", {"pagination": {"limit": 2}})
    if houses.get("results"):
        await call("get_housing", {"listing_id": houses["results"][0]["listing_id"]})
    places = await call("search_places", {"text": "Takashimaya", "pagination": {"limit": 2}})
    if places.get("results"):
        await call("get_place", {"place_id": places["results"][0]["place_id"]})
    a, b = {"lat": 10.7769, "lng": 106.7009}, {"lat": 10.773, "lng": 106.6995}
    await call("find_nearby_places", {"origin": a, "constraints": [{"category": "pharmacy", "max_distance_m": 2000}]})
    await call("calculate_route", {"city": "hcm", "origin": a, "destination": b, "profile": "walking"})
    await call(
        "calculate_route_between_entities",
        {
            "city": "hcm",
            "origin": {"type": "coordinate", "location": a},
            "destination": {"type": "coordinate", "location": b},
            "profile": "motorcycle",
        },
    )
    async with httpx.AsyncClient(timeout=15) as client:
        for name, url in {
            "frontend": "http://127.0.0.1:8503/",
            "platform_database": "http://127.0.0.1:4100/health",
            "moving_health": "http://127.0.0.1:4200/health",
            "moving_ready": "http://127.0.0.1:4200/ready",
        }.items():
            try:
                response = await client.get(url)
                checks[name] = {"ok": response.is_success, "status": response.status_code}
            except httpx.RequestError:
                checks[name] = {"ok": False, "code": "unreachable"}
        for city, (lng, lat), suffix in [
            ("hcm", (106.7009, 10.7769), 0),
            ("hanoi", (105.852, 21.028), 1),
            ("danang", (108.22, 16.067), 2),
        ]:
            for profile, base in [("driving", 5000), ("walking", 5010), ("motorcycle", 5020)]:
                try:
                    r = await client.get(f"http://127.0.0.1:{base + suffix}/nearest/v1/driving/{lng},{lat}")
                    checks[f"osrm_{city}_{profile}"] = {"ok": r.is_success and r.json().get("code") == "Ok"}
                except (httpx.RequestError, ValueError):
                    checks[f"osrm_{city}_{profile}"] = {"ok": False}
    report["configuration_present"] = {
        key: bool(env.get(key))
        for key in [
            "AHAMOVE_USER_TOKEN",
            "AHAMOVE_API_KEY",
            "AHAMOVE_MOBILE",
            "AHAMOVE_WEBHOOK_SECRET",
            "MOVING_QUOTE_CONTACT_NAME",
            "MOVING_QUOTE_CONTACT_MOBILE",
            "FLIGHT_SERPAPI_API_KEY",
            "PAYMENT_ZALOPAY_APP_ID",
            "PAYMENT_ZALOPAY_KEY1",
            "PAYMENT_ZALOPAY_KEY2",
        ]
    }
    encoded = json.dumps(report, indent=2)
    target = ROOT / "data/frontend-service-audit.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(encoded, encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    asyncio.run(main())
