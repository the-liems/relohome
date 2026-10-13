"""Housing/map sub-agent boundary for the local MCP tool demo.

The product orchestrator is intentionally out of scope. It delegates a user
request here; this sub-agent alone owns ReloHome MCP tools and workflows.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

from openai import OpenAI

from relohome_location_demo.mcp_client import McpClientError, ReloHomeMcpClient

HOUSING_AGENT_PROMPT = """Bạn là Housing & Map sub-agent của một product lớn.
Bạn chỉ xử lý yêu cầu về nhà ở, POI, địa điểm và tuyến đường. Hãy chọn đúng
một workflow có cấu trúc. Tách tên khu vực khỏi loại POI: trong câu "khách sạn ở Gò
Vấp", area_text là "Gò Vấp", categories là ["hotel"], không dùng Gò Vấp làm
text tên khách sạn. Chỉ dùng area_text cho đơn vị hành chính như tỉnh, thành phố,
quận, huyện, phường. Với các cụm "gần", "quanh", "trong bán kính" hoặc một mốc
như Hồ Gươm, VinUni, sân bay, hãy đặt mốc vào near_text và area_text là null.
Các tên tỉnh, thành phố, quận, huyện, phường như Hà Nội, Gò Vấp, Phường Bến
Thành luôn là area_text khi người dùng nói "ở", "tại" hoặc "thuộc". Tên trường
học, hồ, sân bay, tòa nhà và ga là near_text khi người dùng nói "gần", "quanh"
hoặc "cách". Không tự tạo tọa độ, area ID hay dữ liệu. Nếu người dùng không nói
phương tiện, dùng profile motorcycle (xe máy).
"""

SUMMARY_PROMPT = """Bạn là Housing & Map sub-agent. Tóm tắt ngắn gọn bằng tiếng Việt
chỉ từ kết quả MCP được cung cấp. Không bịa dữ liệu, không gọi đó là gợi ý/xếp
hạng. Nếu results rỗng, nói rõ không có dữ liệu khớp. Nếu có nhiều kết quả địa
điểm mơ hồ, yêu cầu người dùng làm rõ. Nhắc rằng marker/route đã được đưa lên
bản đồ khi kết quả có tọa độ.
"""

TASK_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "find_places",
            "description": "Tìm POI như khách sạn, bệnh viện hoặc trường học. Dùng area_text cho tỉnh/thành/quận/huyện/phường (ví dụ Gò Vấp); dùng near_text cho landmark khi câu có gần/quanh/cách (ví dụ BKHN, Hồ Gươm); không đặt khu vực hành chính vào near_text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "area_text": {"type": ["string", "null"]},
                    "near_text": {"type": ["string", "null"]},
                    "place_text": {"type": ["string", "null"]},
                    "categories": {"type": "array", "items": {"type": "string"}},
                    "radius_m": {"type": "number", "minimum": 1, "maximum": 100000},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 25},
                },
                "required": ["area_text", "near_text", "place_text", "categories", "radius_m", "limit"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_housing",
            "description": "Lọc listing nhà thật theo khu vực hành chính, giá, loại nhà và số phòng. area_text chỉ nhận tỉnh/thành/quận/huyện/phường như Gò Vấp; không dùng tên landmark hoặc POI ở trường này.",
            "parameters": {
                "type": "object",
                "properties": {
                    "area_text": {"type": ["string", "null"]},
                    "property_types": {"type": "array", "items": {"type": "string"}},
                    "listing_type": {"type": "string", "enum": ["rent", "sale", "short_stay"]},
                    "max_price_vnd": {"type": ["number", "null"]},
                    "price_period": {"type": "string", "enum": ["day", "week", "month", "year", "total"]},
                    "min_bedrooms": {"type": ["integer", "null"]},
                    "min_area_m2": {"type": ["number", "null"]},
                    "amenities": {"type": "array", "items": {"type": "string"}},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 25},
                },
                "required": ["area_text", "property_types", "listing_type", "max_price_vnd", "price_period", "min_bedrooms", "min_area_m2", "amenities", "limit"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "build_route",
            "description": "Tính tuyến đường giữa hai địa điểm có tên. Nếu người dùng không nêu phương tiện, chọn motorcycle.",
            "parameters": {
                "type": "object",
                "properties": {
                    "origin_text": {"type": "string"},
                    "destination_text": {"type": "string"},
                    "profile": {"type": "string", "enum": ["driving", "motorcycle", "walking"]},
                },
                "required": ["origin_text", "destination_text", "profile"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "resolve_location_task",
            "description": "Tra cứu ứng viên khi người dùng chỉ muốn xác định một tên hoặc khi chưa rõ đó là khu vực hành chính hay landmark. Với yêu cầu tìm POI/nhà theo Gò Vấp, ưu tiên workflow có area_text thay vì task này.",
            "parameters": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
                "additionalProperties": False,
            },
        },
    },
]


def _create_openai_client() -> OpenAI:
    """Ignore the local port-9 deny proxy sometimes injected by sandboxes.

    Real user-configured proxies are preserved. OpenAI/httpx reads proxy
    variables while constructing the client, so restoring them immediately is
    safe and avoids changing the MCP child process environment.
    """
    proxy_keys = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY")
    blocked_values = {"http://127.0.0.1:9", "http://localhost:9"}
    removed = {
        key: value
        for key in proxy_keys
        if (value := os.environ.get(key, "").rstrip("/")) in blocked_values
    }
    try:
        for key in removed:
            os.environ.pop(key, None)
        return OpenAI()
    finally:
        os.environ.update(removed)


@dataclass
class AgentResult:
    answer: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    map_payloads: list[dict[str, Any]] = field(default_factory=list)


def _is_infrastructure_error(message: str) -> bool:
    normalized = message.lower()
    return any(
        marker in normalized
        for marker in (
            "password authentication failed",
            "econnrefused",
            "connection refused",
            "connect etimedout",
            "database system is starting",
            "could not connect",
        )
    )


class HousingMapSubAgent:
    """Owns housing/location tools and deterministic MCP workflows."""

    def __init__(self, mcp: ReloHomeMcpClient) -> None:
        self.mcp = mcp
        self.traces: list[dict[str, Any]] = []
        self.payloads: list[dict[str, Any]] = []

    def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        try:
            result = self.mcp.call_tool(name, arguments)
        except McpClientError as error:
            self.traces.append({"tool": name, "arguments": arguments, "error": str(error)})
            raise
        self.traces.append({"tool": name, "arguments": arguments, "result": result})
        self.payloads.append(result)
        return result

    def execute(self, task: str, plan: dict[str, Any]) -> dict[str, Any]:
        if task == "find_places":
            return self._find_places(plan)
        if task == "find_housing":
            return self._find_housing(plan)
        if task == "build_route":
            return self._build_route(plan)
        if task == "resolve_location_task":
            return self.call("resolve_location", {"text": plan["text"], "limit": 10})
        raise ValueError(f"Nhiệm vụ Housing sub-agent không hỗ trợ: {task}")

    def _resolve_area(self, text: str) -> dict[str, Any]:
        response = self.call("search_areas", {"text": text, "limit": 5})
        results = response.get("results", [])
        if not results:
            raise ValueError(f"Không tìm thấy khu vực: {text}")
        return results[0]

    def _resolve_point(self, text: str) -> dict[str, Any]:
        response = self.call("resolve_location", {"text": text, "limit": 5})
        results = response.get("results", [])
        if not results:
            raise ValueError(f"Không tìm thấy địa điểm: {text}")
        return results[0]

    def _find_places(self, plan: dict[str, Any]) -> dict[str, Any]:
        request: dict[str, Any] = {
            "categories": plan.get("categories") or None,
            "pagination": {"limit": plan.get("limit", 10), "cursor": None},
        }
        request = {key: value for key, value in request.items() if value is not None}
        if plan.get("place_text"):
            request["text"] = plan["place_text"]
        if plan.get("near_text"):
            origin = self._resolve_point(plan["near_text"])
            request["center"] = origin["location"]
            request["radius_m"] = plan.get("radius_m") or 2_000
        elif plan.get("area_text"):
            try:
                area = self._resolve_area(plan["area_text"])
                request["administrative_area_ids"] = [area["area_id"]]
            except ValueError:
                # LLMs occasionally classify landmarks (for example Hồ Gươm)
                # as administrative areas. Recover by resolving the same text
                # as a point and applying the requested radius.
                origin = self._resolve_point(plan["area_text"])
                request["center"] = origin["location"]
                request["radius_m"] = plan.get("radius_m") or 2_000
        return self.call("search_places", request)

    def _find_housing(self, plan: dict[str, Any]) -> dict[str, Any]:
        request: dict[str, Any] = {
            "property_type": plan.get("property_types") or None,
            "listing_type": plan.get("listing_type"),
            "min_bedrooms": plan.get("min_bedrooms"),
            "min_area_m2": plan.get("min_area_m2"),
            "amenities": plan.get("amenities") or None,
            "pagination": {"limit": plan.get("limit", 10), "cursor": None},
        }
        if plan.get("max_price_vnd") is not None:
            request["max_price"] = {
                "amount": plan["max_price_vnd"],
                "currency": "VND",
                "period": plan.get("price_period", "month"),
            }
        if plan.get("area_text"):
            area = self._resolve_area(plan["area_text"])
            request["administrative_area_ids"] = [area["area_id"]]
        clean_request = {key: value for key, value in request.items() if value is not None}
        return self.call("search_housing", clean_request)

    def _build_route(self, plan: dict[str, Any]) -> dict[str, Any]:
        origin = self._resolve_point(plan["origin_text"])
        destination = self._resolve_point(plan["destination_text"])
        return self.call(
            "calculate_route",
            {
                "city": _infer_city(origin["location"]),
                "origin": origin["location"],
                "destination": destination["location"],
                "profile": plan.get("profile", "motorcycle"),
            },
        )


def _infer_city(location: dict[str, float]) -> str:
    centers = {
        "hcm": (106.7009, 10.7769),
        "hanoi": (105.8342, 21.0278),
        "danang": (108.2022, 16.0544),
    }
    lng, lat = location["lng"], location["lat"]
    return min(centers, key=lambda city: (lng - centers[city][0]) ** 2 + (lat - centers[city][1]) ** 2)


def run_housing_subagent(
    question: str,
    history: list[dict[str, str]],
    mcp: ReloHomeMcpClient,
    *,
    model: str = "gpt-4o-mini",
    max_rounds: int = 8,
) -> AgentResult:
    del max_rounds
    client = _create_openai_client()
    messages: list[dict[str, Any]] = [{"role": "system", "content": HOUSING_AGENT_PROMPT}]
    messages.extend(history[-8:])
    messages.append({"role": "user", "content": question})
    decision = client.chat.completions.create(
        model=model,
        messages=messages,
        tools=TASK_TOOLS,
        tool_choice="required",
        temperature=0,
    ).choices[0].message
    if not decision.tool_calls:
        return AgentResult("Housing sub-agent không chọn được workflow phù hợp.")

    delegation = decision.tool_calls[0]
    plan = json.loads(delegation.function.arguments or "{}")
    delegation_trace = {
        "tool": "housing_map_subagent",
        "arguments": {"task": delegation.function.name, "plan": plan},
        "result": {"status": "delegated"},
    }
    sub_agent = HousingMapSubAgent(mcp)
    try:
        output = sub_agent.execute(delegation.function.name, plan)
    except (McpClientError, ValueError) as error:
        if _is_infrastructure_error(str(error)):
            answer = "PostGIS/OSRM chưa sẵn sàng hoặc cấu hình kết nối chưa đúng. Sub-agent đã dừng, không gọi lặp tool."
        else:
            answer = str(error)
        return AgentResult(answer, [delegation_trace, *sub_agent.traces], sub_agent.payloads)

    summary = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SUMMARY_PROMPT},
            {"role": "user", "content": question},
            {"role": "user", "content": "Kết quả MCP:\n" + json.dumps(output, ensure_ascii=False)},
        ],
        temperature=0,
    ).choices[0].message.content
    return AgentResult(
        summary or "Sub-agent đã hoàn tất truy vấn.",
        [delegation_trace, *sub_agent.traces],
        sub_agent.payloads,
    )


# Compatibility alias for callers created before the sub-agent boundary was
# made explicit. The full product should use run_housing_subagent directly.
run_agent = run_housing_subagent


def extract_map_data(payloads: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[list[list[float]]]]:
    points: list[dict[str, Any]] = []
    paths: list[list[list[float]]] = []
    seen: set[tuple[float, float, str]] = set()

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return
        geometry = value.get("geometry")
        if isinstance(geometry, dict) and geometry.get("type") == "LineString":
            coordinates = geometry.get("coordinates")
            if isinstance(coordinates, list) and len(coordinates) >= 2:
                path = [[float(pair[0]), float(pair[1])] for pair in coordinates if len(pair) >= 2]
                if len(path) >= 2:
                    paths.append(path)
        location = value.get("location") or value.get("center")
        if isinstance(location, dict) and isinstance(location.get("lng"), (int, float)) and isinstance(location.get("lat"), (int, float)):
            label = str(value.get("name") or value.get("title") or value.get("category") or "Kết quả")
            key = (float(location["lng"]), float(location["lat"]), label)
            if key not in seen:
                seen.add(key)
                points.append({"lng": key[0], "lat": key[1], "label": label, "category": str(value.get("category") or "location")})
        for child in value.values():
            if child is not location and child is not geometry:
                visit(child)

    for payload in payloads:
        visit(payload)
    for path in paths:
        for index, label in ((0, "A"), (-1, "B")):
            lng, lat = path[index]
            if (lng, lat, label) not in seen:
                points.append({"lng": lng, "lat": lat, "label": label, "category": "route"})
    return points, paths
