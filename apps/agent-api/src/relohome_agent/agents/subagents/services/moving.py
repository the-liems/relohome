"""Subagent nền cho lĩnh vực `relocation`, bọc MCP tool đọc của service Moving / AhaMove (nhánh `khoa`).

Chỉ đọc (R3): báo giá (`estimate_move`) và tra cứu đơn. Toạ độ lấy từ `upstream` (phòng đã chọn) hoặc
geocode qua tool dùng chung `resolve_location` của service Location (R5, Q16). AhaMove bắt buộc tên +
SĐT ngay cả khi ước tính; bản nền dùng liên hệ báo giá do hệ thống cấu hình, liên hệ thật của người
dùng chỉ đưa vào lúc đặt (`transaction`, D16).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Any

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest, AgentTaskResult, failed_result, reject_unsupported
from relohome_agent.agents.models import AgentUsage, Question, Quote, SourceKind
from relohome_agent.agents.subagents.capabilities import RELOCATION
from relohome_agent.agents.subagents.services.common import BudgetExceededError, CountingClient, first, tool_failure
from relohome_agent.services.adapters.mcp import McpToolClient, ToolCallError
from relohome_contracts.moving_options import apply_draft_options, service_selection, validated_options

SOURCE = "ahamove"
VN_TZ = timezone(timedelta(hours=7))
MAX_SERVICES = 3


@dataclass(frozen=True)
class QuoteContact:
    name: str
    mobile: str


MIN_LEAD = timedelta(minutes=30)  # thời điểm chuyển phải cách hiện tại ít nhất chừng này


def order_time(move_date: str, move_time: str | None, now: datetime) -> int | None:
    """Epoch giây của ngày + giờ chuyển theo giờ Việt Nam. Không tự chọn giờ; đã qua (hoặc quá sát) thì None,
    để hỏi lại người dùng thay vì biến thành đơn gọi xe ngay."""
    try:
        day = datetime.fromisoformat(move_date).date()
        hour, minute = (int(x) for x in (move_time or "").split(":"))
        moment = datetime.combine(day, time(hour, minute), tzinfo=VN_TZ)
    except (ValueError, TypeError):
        return None
    return int(moment.timestamp()) if moment >= now.astimezone(VN_TZ) + MIN_LEAD else None


def summarize_order(order: dict) -> dict:
    """Chỉ giữ trường không phải dữ liệu cá nhân (không có tên / SĐT trong path)."""
    fee = order.get("fee") or {}
    return {
        "order_id": order.get("order_id"),
        "status": order.get("status"),
        "sub_status": order.get("sub_status"),
        "service_id": order.get("service_id"),
        "total_price": fee.get("total_price"),
        "shared_link": order.get("shared_link"),
        "supplier": (order.get("supplier") or {}).get("name"),
    }


class MovingSubagent:
    def __init__(
        self,
        client: McpToolClient,
        geocoder: McpToolClient | None,
        contact: QuoteContact | None,
        source_kind: SourceKind = "sandbox",
        clock: Callable[[], datetime] = utcnow,
    ):
        self.capability = RELOCATION
        self.client, self.geocoder, self.contact = client, geocoder, contact
        self.source_kind, self.clock = source_kind, clock

    async def run(self, req: AgentTaskRequest) -> AgentTaskResult:
        if (rejected := reject_unsupported(req, SOURCE, self.source_kind)) is not None:
            return rejected
        tools = CountingClient(self.client, req.budget.max_provider_calls)
        geo = CountingClient(self.geocoder, 4) if self.geocoder else None
        try:
            if req.inputs.get("mode") == "order_status":
                return await self._order(req, tools)
            return await self._quote(req, tools, geo)
        except (ToolCallError, BudgetExceededError) as exc:
            return tool_failure(req, exc, SOURCE, self.source_kind, tools.calls)

    def _result(self, req: AgentTaskRequest, tools: CountingClient, **kw) -> AgentTaskResult:
        return AgentTaskResult(
            task_id=req.task_id,
            plan_version=req.plan_version,
            source=SOURCE,
            source_kind=self.source_kind,
            fetched_at=self.clock(),
            usage=AgentUsage(provider_calls=tools.calls),
            **kw,
        )

    async def _order(self, req: AgentTaskRequest, tools: CountingClient) -> AgentTaskResult:
        inp = req.inputs
        if inp.get("order_id"):
            got = await tools.call("get_move_order", {"order_id": inp["order_id"], "include_tracking_link": True})
            order = (got or {}).get("order")
        else:
            got = await tools.call("find_move_orders_by_tracking_number", {"tracking_number": inp["tracking_number"]})
            order = first((got or {}).get("orders")) if isinstance(got, dict) else first(got)
        if not order:
            return self._result(req, tools, status="done", data={}, missing_fields=["order"])
        summary = summarize_order(order)
        return self._result(req, tools, status="done", data={"order": summary}, source_refs=[str(summary["order_id"])])

    async def _point(self, geo: CountingClient | None, address: str) -> dict | None:
        """Toạ độ của địa chỉ. Không lấy kết quả đầu một cách mặc định: bỏ khi chỉ khớp tới khu hành chính
        (phường / quận) hoặc khi hai kết quả đầu ngang nhau (mơ hồ) → hỏi lại người dùng."""
        if geo is None:
            return None
        resolved = (await geo.call("resolve_location", {"text": address, "limit": 3})) or {}
        results = resolved.get("results") or []
        top = first(results)
        if top is None or top.get("entity_type") == "administrative_area":
            return None
        if resolved.get("ambiguous") and len(results) > 1:
            if abs((top.get("match_score") or 0) - (results[1].get("match_score") or 0)) < 0.1:
                return None
        return {"address": address, **top["location"]}

    async def _quote(self, req: AgentTaskRequest, tools: CountingClient, geo: CountingClient | None) -> AgentTaskResult:
        inp = req.inputs
        if self.contact is None:
            return failed_result(
                req,
                "invalid_input",
                "chưa cấu hình liên hệ dùng để lấy báo giá AhaMove",
                False,
                SOURCE,
                self.source_kind,
            )
        selected = None
        if inp.get("selected_listing_id"):
            from relohome_agent.agents.subagents.services.location import to_candidate

            if geo:
                detail = await geo.call("get_housing", {"listing_id": inp["selected_listing_id"]})
                if detail and detail.get("listing_id") == inp["selected_listing_id"]:
                    selected, _ = to_candidate(detail, [])
            if selected is None:
                selected = next(
                    (
                        c
                        for r in req.upstream.values()
                        for c in r.data.get("candidates", [])
                        if c.get("id") == inp["selected_listing_id"]
                    ),
                    None,
                )

        async def endpoint(address):
            if address and address != "selected:property":
                return await self._point(geo, address)
            if selected and selected.get("location_accuracy") == "rooftop":
                if all(selected.get(k) is not None for k in ("lat", "lng", "address")):
                    return {k: selected[k] for k in ("lat", "lng", "address")}
            return None

        pickup = await endpoint(inp["from_address"])
        destination = None
        warnings: list[str] = []
        to_address = inp.get("to_address")
        destination = await endpoint(to_address)
        if destination:
            to_address = destination["address"]
        questions = []
        when = order_time(inp["move_date"], inp.get("move_time"), self.clock())
        if when is None:
            questions.append(
                Question(
                    field="move_time",
                    text="Thời điểm chuyển đồ chưa rõ hoặc đã qua. Bạn muốn xe đến ngày nào, lúc mấy giờ?",
                )
            )
        if pickup is None:
            questions.append(
                Question(field="from_address", text="Mình chưa xác định được địa chỉ lấy đồ, bạn ghi rõ hơn nhé?")
            )
        if destination is None:
            questions.append(
                Question(field="to_address", text="Mình chưa xác định được địa chỉ giao đồ, bạn ghi rõ hơn nhé?")
            )
        if questions:
            return self._result(req, tools, status="needs_input", questions=questions)

        options = validated_options(inp.get("moving_options"))
        catalog_args = {"lat": pickup["lat"], "lng": pickup["lng"]}
        if not options.get("service_id"):
            catalog_args["delivery_type"] = "TRUCK"
        listed = await tools.call("list_moving_services", catalog_args)
        catalog = {s["service_id"]: s for s in (listed or {}).get("services", [])}
        services = [s for s in catalog if not options.get("service_id") or s == options["service_id"]][:MAX_SERVICES]
        if not services:
            return self._result(req, tools, status="done", data={"quotes": []}, missing_fields=["quotes"])

        def point(p: dict) -> dict[str, Any]:
            return {
                "address": p["address"],
                "coordinate": {"lat": p["lat"], "lng": p["lng"]},
                "name": self.contact.name,
                "mobile": self.contact.mobile,
            }

        draft: dict[str, Any] = {
            "pickup": point(pickup),
            "destinations": [point(destination)],
            "payment_method": "CASH",
        }
        draft["order_time"] = when
        try:
            selections = [service_selection(catalog[s], options) for s in services]
        except ValueError as exc:
            return self._result(
                req, tools, status="needs_input", questions=[Question(field="service_id", text=str(exc))]
            )
        estimate = await tools.call(
            "estimate_move", {"draft": apply_draft_options(draft, options), "services": selections}
        )
        quote = (estimate or {}).get("quote") or {}
        quotes, items, missing = [], [], []
        for option in quote.get("options", []):
            total = (option.get("fee") or {}).get("total_price")
            option_id = f"{quote['quote_id']}:{option['service_id']}"
            items.append(
                {
                    "id": option_id,
                    "provider": "ahamove",
                    "service_id": option["service_id"],
                    "price_vnd": int(total) if total is not None else None,
                    "vehicle": option.get("service_name"),
                    "movers": None,
                    "date": inp["move_date"],
                }
            )
            missing.append(f"quotes[{len(items) - 1}].movers")
            if total is not None:
                quotes.append(
                    Quote(
                        option_id=option_id,
                        label=option.get("service_name") or option["service_id"],
                        amount_vnd=int(total),
                        recurrence="one_time",
                    )
                )
        data = {
            "quotes": items,
            "quote_id": quote.get("quote_id"),
            "expires_at": quote.get("expires_at"),
            "payment_method": "CASH",
            "moving_options": options,
            "addon_labels": [
                {"id": r.get("_id") or r.get("request_id"), "label": r.get("name_vi_vn") or r.get("name")}
                for service in catalog.values()
                for r in service.get("requests", [])
                if (r.get("_id") or r.get("request_id")) in {x["request_id"] for x in options.get("requests", [])}
            ],
            "from_address": pickup["address"],
            "to_address": to_address,
            # Toạ độ và giờ đặt (không có dữ liệu cá nhân) để transaction báo giá lại với liên hệ thật.
            "route": {"pickup": pickup, "destination": destination, "order_time": when},
            # Vị trí phòng chỉ gần đúng: giá có thể lệch khi tài xế đến đúng địa chỉ.
            "warnings": warnings,
        }
        return self._result(
            req,
            tools,
            status="done",
            data=data,
            quotes=quotes,
            missing_fields=missing,
            source_refs=[i["id"] for i in items],
        )
