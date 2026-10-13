"""Subagent nền của Location / Moving / Flight với MCP client giả (không cần mạng).

Dữ liệu trả về theo đúng schema tool của từng service (Zod của nhánh QuangDung / khoa, Pydantic của
nhánh Doan/api).
"""

from collections.abc import Callable
from datetime import datetime
from typing import Any

import pytest
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import UpstreamResult
from relohome_agent.agents.models import AgentName, Constraints, Task, TaskStatus
from relohome_agent.agents.subagents.base import AgentPolicy, AgentTransportError, run_with_policy
from relohome_agent.agents.subagents.conformance import check_conformance, sample_request
from relohome_agent.agents.subagents.fake import FakeAgent
from relohome_agent.agents.subagents.services.flight import FlightSubagent
from relohome_agent.agents.subagents.services.location import LocationSubagent
from relohome_agent.agents.subagents.services.moving import VN_TZ, MovingSubagent, QuoteContact
from relohome_agent.services.adapters.mcp import ToolCallError


class FakeToolClient:
    def __init__(self, handlers: dict[str, Any]):
        self.handlers = handlers
        self.calls: list[tuple[str, dict]] = []

    async def call(self, tool: str, arguments: dict) -> Any:
        self.calls.append((tool, arguments))
        handler = self.handlers[tool]
        return handler(arguments) if isinstance(handler, Callable) else handler


def listing(i: int, price: float | None, verified=True, amenities=("wifi",), period="month") -> dict:
    return {
        "listing_id": f"00000000-0000-0000-0000-00000000000{i}",
        "title": f"Phòng {i}",
        "price": {"amount": price, "currency": "VND", "period": period} if price is not None else {},
        "location": {"lat": 10.76 + i / 1000, "lng": 106.66},
        "address": {"street": f"{i} Lê Lợi", "city": "TP.HCM"},
        "area": {"value": 20, "unit": "m2"},
        "amenities": list(amenities),
        "verification": {"status": "source_verified" if verified else "unverified", "verified_at": None},
        "unknown_fields": [],
    }


PLACE = {
    "results": [
        {
            "name": "Bệnh viện Chợ Rẫy",
            "location": {"lat": 10.757, "lng": 106.659},
            "parent": {"area_id": "a1", "name": "TP.HCM", "level": "city"},
        }
    ]
}


@pytest.mark.asyncio
async def test_property_resolves_landmark_ranks_and_skips_unpriced():
    client = FakeToolClient(
        {
            "resolve_location": PLACE,
            "search_housing": {
                "results": [
                    listing(1, 6_000_000, verified=False),
                    listing(2, 4_500_000),
                    listing(3, None),
                    listing(4, 300, period="night"),
                ]
            },
        }
    )
    agent = LocationSubagent(client, AgentName.PROPERTY)
    result = await agent.run(sample_request(AgentName.PROPERTY, {"near": "BV Chợ Rẫy", "max_price_vnd": 6_000_000}))
    assert result.status == "done"
    assert [c["price_vnd"] for c in result.data["candidates"]] == [4_500_000, 6_000_000]  # đã xác minh trước
    assert result.data["excluded_without_price_or_address"] == 2
    search = client.calls[1][1]
    assert search["center"] == {"lat": 10.757, "lng": 106.659}
    assert search["max_price"] == {"amount": 6_000_000, "currency": "VND", "period": "month"}
    assert await check_conformance(agent, [sample_request(AgentName.PROPERTY, {"near": "BV Chợ Rẫy"})]) == []


@pytest.mark.asyncio
async def test_property_relaxes_prefilled_filters_only():
    responses = iter([{"results": []}, {"results": [listing(1, 7_000_000)]}])
    client = FakeToolClient(
        {
            "search_areas": {"results": [{"area_id": "hcm", "name": "TP.HCM"}]},
            "search_housing": lambda args: next(responses),
        }
    )
    agent = LocationSubagent(client, AgentName.PROPERTY)
    result = await agent.run(
        sample_request(AgentName.PROPERTY, {"city": "HCM", "soft_filters": {"max_price_vnd": 5_000_000}})
    )
    assert result.data["relaxed_filters"] == ["max_price_vnd"]
    assert "max_price" in client.calls[1][1] and "max_price" not in client.calls[2][1]


@pytest.mark.asyncio
async def test_property_unknown_area_needs_input():
    agent = LocationSubagent(FakeToolClient({"resolve_location": {"results": []}}), AgentName.PROPERTY)
    result = await agent.run(sample_request(AgentName.PROPERTY, {"near": "chỗ lạ"}))
    assert result.status == "needs_input" and result.questions[0].field == "near"


@pytest.mark.asyncio
async def test_map_uses_upstream_listings():
    nearby = {"results": [{"place_id": "p1", "name": "Nhà thuốc", "category": "pharmacy", "distance_meters": 120}]}
    client = FakeToolClient({"find_nearby_places": nearby})
    upstream = {
        "t1": UpstreamResult(
            task_id="t1",
            agent=AgentName.PROPERTY,
            data={"candidates": [{"id": "l1", "lat": 10.7, "lng": 106.6}, {"id": "l2", "lat": None, "lng": None}]},
        )
    }
    agent = LocationSubagent(client, AgentName.MAP)
    result = await agent.run(sample_request(AgentName.MAP, {"categories": ["pharmacy"], "radius_m": 1000}, upstream))
    assert list(result.data["nearby"]) == ["l1"]
    assert client.calls[0][1]["constraints"] == [{"category": "pharmacy", "max_distance_m": 1000}]


def moving_client(total=250_000):
    return FakeToolClient(
        {
            "list_moving_services": {"services": [{"service_id": "SGN-TRUCK-500"}, {"service_id": "SGN-VAN"}]},
            "estimate_move": {
                "meta": {},
                "quote": {
                    "quote_id": "q1",
                    "request_fingerprint": "f",
                    "expires_at": "2026-11-14T00:00:00Z",
                    "options": [
                        {
                            "service_id": "SGN-TRUCK-500",
                            "service_name": "Xe tải 500kg",
                            "fee": {"total_price": total},
                            "requests": [],
                            "provider_data": {},
                        }
                    ],
                },
            },
            "get_move_order": {
                "meta": {},
                "order": {
                    "order_id": "O1",
                    "status": "ASSIGNING",
                    "shared_link": "https://t",
                    "path": [{"name": "Nguyen Van A", "mobile": "0901234567"}],
                },
            },
        }
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("with_upstream", [False, True])
async def test_moving_quote_to_selected_room(with_upstream):
    client = moving_client()
    home = listing(2, 5_000_000) | {
        "address": {"raw": "45 Thành Thái", "city": "TP.HCM"},
        "location": {"lat": 10.77, "lng": 106.66},
        "location_accuracy": "rooftop",
    }
    geo = FakeToolClient(
        {
            "get_housing": home,
            "resolve_location": {"results": [{"name": "12 Láng Hạ", "location": {"lat": 21.0, "lng": 105.8}}]},
        }
    )
    agent = MovingSubagent(
        client, geo, QuoteContact("ReloHome", "19001234"), clock=lambda: datetime(2026, 11, 1, tzinfo=VN_TZ)
    )
    upstream = {
        "t1": UpstreamResult(
            task_id="t1",
            agent=AgentName.PROPERTY,
            # A previous search result must not override the current selected-room detail.
            data={"candidates": [{"id": home["listing_id"], "address": "Old address", "lat": 10.7, "lng": 106.6}]},
        )
    }
    req = sample_request(
        AgentName.RELOCATION,
        {
            "mode": "quote",
            "from_address": "12 Láng Hạ",
            "move_date": "2026-11-14",
            "move_time": "09:00",
            "selected_listing_id": home["listing_id"],
        },
        upstream if with_upstream else {},
    )
    result = await agent.run(req)
    assert result.status == "done"
    assert result.quotes[0].option_id == "q1:SGN-TRUCK-500" and result.quotes[0].amount_vnd == 250_000
    assert result.data["to_address"] == "45 Thành Thái"
    assert geo.calls[0] == ("get_housing", {"listing_id": home["listing_id"]})
    draft = client.calls[1][1]["draft"]
    assert draft["payment_method"] == "CASH" and draft["pickup"]["mobile"] == "19001234"
    assert draft["destinations"][0]["coordinate"] == home["location"]
    assert await check_conformance(agent, [req]) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("accuracy", ["approximate", "unknown", None])
async def test_moving_selected_room_requires_precise_current_location(accuracy):
    home = listing(2, 5_000_000) | {"location_accuracy": accuracy}
    client = moving_client()
    geo = FakeToolClient(
        {
            "get_housing": home,
            "resolve_location": {"results": [{"location": {"lat": 21.0, "lng": 105.8}}]},
        }
    )
    agent = MovingSubagent(
        client, geo, QuoteContact("ReloHome", "19001234"), clock=lambda: datetime(2026, 11, 1, tzinfo=VN_TZ)
    )
    result = await agent.run(
        sample_request(
            AgentName.RELOCATION,
            {
                "mode": "quote",
                "from_address": "12 Láng Hạ",
                "selected_listing_id": home["listing_id"],
                "move_date": "2026-11-14",
                "move_time": "09:00",
            },
        )
    )
    assert result.status == "needs_input" and [q.field for q in result.questions] == ["to_address"]
    assert client.calls == []


@pytest.mark.asyncio
async def test_moving_without_quote_contact_fails_clearly():
    agent = MovingSubagent(moving_client(), None, None)
    req = sample_request(
        AgentName.RELOCATION,
        {"mode": "quote", "from_address": "a", "to_address": "b", "move_date": "2026-11-14", "move_time": "09:00"},
    )
    result = await agent.run(req)
    assert result.status == "failed" and result.error.code == "invalid_input"


@pytest.mark.asyncio
async def test_moving_order_status_strips_contacts():
    agent = MovingSubagent(moving_client(), None, None)
    result = await agent.run(sample_request(AgentName.RELOCATION, {"mode": "order_status", "order_id": "O1"}))
    assert result.data["order"]["status"] == "ASSIGNING"
    assert "0901234567" not in str(result.data)


FLIGHTS = {
    "source": "mock",
    "message": "",
    "offers": [
        {
            "offer_id": "off_1",
            "total_price": 1_650_000,
            "seats_left": 5,
            "stops": 0,
            "expires_at": "2026-11-15T00:00:00",
            "segments": [
                {
                    "airline_name": "Vietjet Air",
                    "airline_code": "VJ",
                    "departure_time": "2026-11-15T06:00:00+07:00",
                    "arrival_time": "2026-11-15T08:10:00+07:00",
                }
            ],
        }
    ],
}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "source,allow_simulation,source_kind",
    [("mock", True, "demo"), ("serpapi", False, "live"), ("serpapi", True, "live")],
)
async def test_flight_destination_from_room_city(source, allow_simulation, source_kind):
    client = FakeToolClient(
        {
            "search_airports": lambda a: [{"code": {"Hà Nội": "HAN", "TP.HCM": "SGN"}[a["query"]]}],
            "search_flights": {**FLIGHTS, "source": source},
        }
    )
    agent = FlightSubagent(client, allow_simulation=allow_simulation)
    upstream = {
        "t1": UpstreamResult(
            task_id="t1", agent=AgentName.PROPERTY, data={"candidates": [{"id": "x", "city": "TP.HCM"}]}
        )
    }
    req = sample_request(AgentName.FLIGHT, {"origin": "Hà Nội", "date": "2026-11-15"}, upstream)
    result = await agent.run(req)
    body = client.calls[-1][1]["request"]
    assert (body["origin"], body["destination"]) == ("HAN", "SGN")
    assert result.status == "done" and result.source_kind == source_kind
    assert result.quotes[0].amount_vnd == 1_650_000
    assert await check_conformance(agent, [req]) == []


@pytest.mark.asyncio
async def test_first_call_transport_error_is_retryable_by_wrapper():
    def down(args):
        raise ToolCallError("unavailable", "down", retryable=True, transport=True)

    client = FakeToolClient({"search_airports": down, "search_flights": FLIGHTS})
    agent = FlightSubagent(client)
    inputs = {"origin": "HAN", "destination": "SGN", "date": "2026-11-15"}
    with pytest.raises(AgentTransportError):
        await agent.run(sample_request(AgentName.FLIGHT, inputs))
    client.calls.clear()
    out = await run_with_policy(
        agent,
        {
            "task": Task(id="t1", agent=AgentName.FLIGHT, inputs=inputs),
            "plan_version": 1,
            "attempt": 1,
            "request_id": "r1",
            "thread_id": "th1",
            "constraints": Constraints(),
            "hints": {},
            "upstream": {},
        },
        policy=AgentPolicy(transport_retries=1),
        clock=utcnow,
    )
    assert [tool for tool, _ in client.calls] == ["search_airports", "search_airports"]
    assert out["task_status"]["t1"] == TaskStatus.FAILED
    assert out["task_results"]["t1"].error_code == "provider_unavailable"
    assert out["task_results"]["t1"].retryable is True


@pytest.mark.asyncio
@pytest.mark.parametrize("source,allow_simulation", [("mock", False), ("unknown", True)])
async def test_flight_rejects_unapproved_simulated_or_unknown_source(source, allow_simulation):
    client = FakeToolClient(
        {
            "search_airports": lambda a: [{"code": a["query"]}],
            "search_flights": {**FLIGHTS, "source": source},
        }
    )
    result = await FlightSubagent(client, allow_simulation=allow_simulation).run(
        sample_request(AgentName.FLIGHT, {"origin": "HAN", "destination": "SGN", "date": "2026-11-15"})
    )
    assert result.status == "failed" and result.error.code == "provider_unavailable"
    assert result.quotes == []


@pytest.mark.asyncio
async def test_fake_agents_conform():
    for name, inputs in [
        (AgentName.PROPERTY, {"city": "HCM"}),
        (AgentName.MAP, {"categories": ["hospital"]}),
        (AgentName.FLIGHT, {"origin": "HAN", "date": "2026-11-15"}),
        (AgentName.RELOCATION, {"mode": "order_status", "order_id": "x"}),
    ]:
        assert await check_conformance(FakeAgent(name), [sample_request(name, inputs)]) == []
