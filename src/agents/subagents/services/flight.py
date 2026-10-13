"""Subagent nền cho lĩnh vực `flight`, bọc MCP tool đọc của service Flight (nhánh `Doan/api`).

Chỉ đọc (R3): tìm chuyến, xem offer, tra booking. Điểm đến có thể suy ra từ kết quả tìm phòng
(`upstream`). Booking trả về có thông tin hành khách: subagent bỏ các trường đó trước khi trả.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import datetime

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest, AgentTaskResult, failed_result, reject_unsupported
from relohome_agent.agents.models import AgentName, AgentUsage, Question, Quote, SourceKind
from relohome_agent.agents.subagents.capabilities import FLIGHT
from relohome_agent.agents.subagents.services.common import BudgetExceededError, CountingClient, first, tool_failure
from relohome_agent.services.adapters.mcp import McpToolClient, ToolCallError

SOURCE = "lifeflow-flights"
IATA = re.compile(r"^[A-Z]{3}$")


def booking_view(booking: dict) -> dict:
    """Bỏ hành khách / liên hệ (dữ liệu cá nhân) khỏi booking."""
    offer = booking.get("offer") or {}
    segments = offer.get("segments") or [{}]
    return {
        "booking_id": booking.get("booking_id"),
        "pnr": booking.get("pnr"),
        "status": booking.get("status"),
        "total_price": booking.get("total_price"),
        "hold_expires_at": booking.get("hold_expires_at"),
        "ticket_count": len(booking.get("ticket_numbers") or []),
        "flight": f"{segments[0].get('flight_number', '')} {segments[0].get('origin', '')}→{segments[-1].get('destination', '')}",
    }


class FlightSubagent:
    def __init__(
        self, client: McpToolClient, clock: Callable[[], datetime] = utcnow, *, allow_simulation: bool = False
    ):
        self.capability = FLIGHT
        self.client, self.clock = client, clock
        # Local graph demos opt in; the application runtime remains real-search only.
        self.allow_simulation = allow_simulation

    async def run(self, req: AgentTaskRequest) -> AgentTaskResult:
        if (rejected := reject_unsupported(req, SOURCE, "live")) is not None:
            return rejected
        tools = CountingClient(self.client, req.budget.max_provider_calls)
        try:
            if req.inputs.get("booking_ref"):
                return failed_result(
                    req,
                    "provider_unavailable",
                    "Real flight booking lookup is not connected.",
                    retryable=False,
                    source=SOURCE,
                    source_kind="live",
                )
            return await self._search(req, tools)
        except (ToolCallError, BudgetExceededError) as exc:
            return tool_failure(req, exc, SOURCE, "live", tools.calls)

    def _result(self, req: AgentTaskRequest, tools: CountingClient, source_kind: SourceKind, **kw) -> AgentTaskResult:
        return AgentTaskResult(
            task_id=req.task_id,
            plan_version=req.plan_version,
            source=SOURCE,
            source_kind=source_kind,
            fetched_at=self.clock(),
            usage=AgentUsage(provider_calls=tools.calls),
            **kw,
        )

    async def _airport(self, tools: CountingClient, text: str | None) -> str | None:
        if not text:
            return None
        found = await tools.call("search_airports", {"query": text, "limit": 5})
        codes = {r.get("code") for r in found or [] if isinstance(r, dict) and r.get("code")}
        if IATA.match(text.strip()) and text.strip() in codes:
            return text.strip()
        return next(iter(codes)) if len(codes) == 1 else None

    async def _search(self, req: AgentTaskRequest, tools: CountingClient) -> AgentTaskResult:
        inp = req.inputs
        destination_text = inp.get("destination")
        if not destination_text:
            for upstream in req.upstream.values():
                if upstream.agent == AgentName.PROPERTY:
                    candidate = first(upstream.data.get("candidates"))
                    destination_text = (candidate or {}).get("city") or upstream.data.get("area_name")
        origin = await self._airport(tools, inp.get("origin"))
        destination = await self._airport(tools, destination_text)
        questions = []
        if origin is None:
            questions.append(
                Question(field="origin", text=f'Mình chưa tìm thấy sân bay cho "{inp.get("origin")}"; bạn bay từ đâu?')
            )
        if destination is None:
            questions.append(Question(field="destination", text="Bạn bay tới thành phố nào?"))
        if questions:
            return self._result(req, tools, "live", status="needs_input", questions=questions)
        passengers = inp.get("passengers") or {"adults": 1}
        round_trip = inp.get("trip_type") == "round_trip"
        if round_trip and not inp.get("return_date"):
            return self._result(
                req,
                tools,
                "live",
                status="needs_input",
                questions=[Question(field="return_date", text="Bạn muốn bay về ngày nào?")],
            )
        request = {
            "origin": origin,
            "destination": destination,
            "departure_date": inp["date"],
            "passengers": passengers,
            "sort_by": "price",
            "max_results": 8 if round_trip else 5,
        }
        if round_trip:
            request.update(trip_type="round_trip", return_date=inp["return_date"])
        found = await tools.call("search_flights", {"request": request})
        found = found or {}
        source = found.get("source")
        if source != "serpapi" and not (self.allow_simulation and source == "mock"):
            return failed_result(
                req,
                "provider_unavailable",
                "Flight returned an unsupported or simulated source.",
                retryable=False,
                source=SOURCE,
                source_kind="live",
            )
        offers, quotes = [], []
        for offer in found.get("offers", []):
            segments = offer.get("segments") or [{}]
            carrier = segments[0].get("airline_name") or segments[0].get("airline_code") or "?"
            item = {
                "id": offer["offer_id"],
                "carrier": carrier,
                "fare_vnd": offer.get("total_price"),
                "baggage_kg": None,  # điều kiện hành lý xem qua get_offer; không suy đoán
                "depart_at": segments[0].get("departure_time"),
                "arrive_at": segments[-1].get("arrival_time"),
                "seats_left": offer.get("seats_left"),
                "stops": offer.get("stops"),
                "expires_at": offer.get("expires_at"),
                # round_trip_outbound: giá khứ hồi thấp nhất có chuyến đi này, chưa phải giá để thanh toán.
                "kind": offer.get("kind") or "one_way",
                "price_scope": offer.get("price_scope") or "one_way",
                "flight_numbers": [s.get("flight_number") for s in segments],
            }
            offers.append(item)
            if item["fare_vnd"] is not None and item["kind"] == "one_way":
                label = f"{carrier} {str(item['depart_at'])[11:16]} {origin}→{destination}"
                quotes.append(
                    Quote(option_id=item["id"], label=label, amount_vnd=int(item["fare_vnd"]), recurrence="one_time")
                )
        missing = [f"offers[{i}].baggage_kg" for i in range(len(offers))]
        # Giá từ SerpApi là dữ liệu thật; mock là giả lập. Phần đặt vé luôn là giả lập (ADR-012).
        source_kind: SourceKind = "live" if found.get("source") == "serpapi" else "demo"
        return self._result(
            req,
            tools,
            source_kind,
            status="done",
            data={
                "offers": offers,
                "origin": origin,
                "destination": destination,
                "trip_type": "round_trip" if round_trip else "one_way",
                "return_date": inp.get("return_date") if round_trip else None,
                "flight_date": inp["date"],
                "passengers": passengers,
            },
            quotes=quotes,
            missing_fields=missing,
            source_refs=[o["id"] for o in offers],
        )
