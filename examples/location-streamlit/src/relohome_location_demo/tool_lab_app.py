"""Direct MCP tool lab: no LLM and no agent orchestration."""

from __future__ import annotations

import json
import time
from typing import Any

import pydeck as pdk
import streamlit as st
from streamlit_searchbox import st_searchbox

from relohome_location_demo.agent import extract_map_data
from relohome_location_demo.mcp_client import ReloHomeMcpClient
from relohome_location_demo.runtime_paths import repository_root

RELOHOME_ROOT = repository_root()

TOOL_PRESETS: dict[str, dict[str, Any]] = {
    "search_areas": {"text": "Gò Vấp", "limit": 5},
    "resolve_location": {"text": "Hồ Gươm", "limit": 5},
    "search_places": {
        "categories": ["hotel"],
        "center": {"lng": 105.852, "lat": 21.028},
        "radius_m": 2000,
        "pagination": {"limit": 10, "cursor": None},
    },
    "search_housing": {
        "listing_type": "rent",
        "max_price": {"amount": 15000000, "currency": "VND", "period": "month"},
        "min_bedrooms": 2,
        "pagination": {"limit": 10, "cursor": None},
    },
    "find_nearby_places": {
        "origin": {"lng": 106.7009, "lat": 10.7769},
        "constraints": [{"category": "hospital", "max_distance_m": 5000}],
    },
    "calculate_route": {
        "city": "hcm",
        "origin": {"lng": 106.6983, "lat": 10.7725},
        "destination": {"lng": 106.6683, "lat": 10.8188},
        "profile": "motorcycle",
    },
    "get_place": {"place_id": "<dán place_id từ search_places>"},
    "get_housing": {"listing_id": "<dán listing_id từ search_housing>"},
}


@st.cache_resource
def get_mcp() -> ReloHomeMcpClient:
    return ReloHomeMcpClient(RELOHOME_ROOT)


def call(mcp: ReloHomeMcpClient, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    result = mcp.call_tool(name, arguments)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    st.session_state.lab_traces.append(
        {"tool": name, "arguments": arguments, "result": result, "elapsed_ms": elapsed_ms}
    )
    st.session_state.lab_payloads.append(result)
    return result


def first_result(response: dict[str, Any], label: str) -> dict[str, Any]:
    results = response.get("results", [])
    if not results:
        raise ValueError(f"{label}: không có kết quả.")
    return results[0]


def location_label(candidate: dict[str, Any]) -> str:
    kind = candidate.get("category") or candidate.get("administrative_level") or candidate.get("entity_type")
    parent = candidate.get("parent") or {}
    parent_name = f" · {parent['name']}" if parent.get("name") else ""
    location = candidate.get("location") or {}
    coordinates = f" · {location.get('lat', 0):.5f}, {location.get('lng', 0):.5f}"
    return f"{candidate.get('name', 'Không tên')} · {kind}{parent_name}{coordinates}"


def location_searchbox(
    mcp: ReloHomeMcpClient,
    *,
    label: str,
    key: str,
    placeholder: str,
) -> dict[str, Any] | None:
    def suggestions(searchterm: str) -> list[tuple[str, dict[str, Any]]]:
        if len(searchterm.strip()) < 2:
            return []
        response = mcp.call_tool("resolve_location", {"text": searchterm, "limit": 10})
        return [(location_label(item), item) for item in response.get("results", [])]

    selected = st_searchbox(
        suggestions,
        key=key,
        label=label,
        placeholder=placeholder,
        debounce=300,
        edit_after_submit="option",
        clear_on_submit=False,
    )
    return selected if isinstance(selected, dict) else None


def infer_city(location: dict[str, float]) -> str:
    centers = {
        "hcm": (106.7009, 10.7769),
        "hanoi": (105.8342, 21.0278),
        "danang": (108.2022, 16.0544),
    }
    lng, lat = location["lng"], location["lat"]
    return min(centers, key=lambda city: (lng - centers[city][0]) ** 2 + (lat - centers[city][1]) ** 2)


def render_map(payloads: list[dict[str, Any]]) -> None:
    points, paths = extract_map_data(payloads)
    coordinates = [[point["lng"], point["lat"]] for point in points]
    for path in paths:
        coordinates.extend(path)
    if coordinates:
        lng_values = [point[0] for point in coordinates]
        lat_values = [point[1] for point in coordinates]
        lng = (min(lng_values) + max(lng_values)) / 2
        lat = (min(lat_values) + max(lat_values)) / 2
        span = max(max(lng_values) - min(lng_values), max(lat_values) - min(lat_values))
        zoom = 13 if span < 0.03 else 11 if span < 0.1 else 9 if span < 0.5 else 7 if span < 2 else 5
    else:
        lng, lat, zoom = 106.7009, 10.7769, 10
    layers: list[pdk.Layer] = []
    if paths:
        layers.append(
            pdk.Layer(
                "PathLayer",
                [{"path": path} for path in paths],
                get_path="path",
                get_color=[37, 99, 235, 220],
                get_width=6,
                width_min_pixels=5,
            )
        )
    if points:
        layers.append(
            pdk.Layer(
                "ScatterplotLayer",
                points,
                get_position="[lng, lat]",
                get_fill_color=[239, 68, 68, 220],
                get_radius=90,
                radius_min_pixels=6,
                radius_max_pixels=14,
                pickable=True,
            )
        )
    st.pydeck_chart(
        pdk.Deck(
            map_style="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
            initial_view_state=pdk.ViewState(latitude=lat, longitude=lng, zoom=zoom),
            layers=layers,
            tooltip={"text": "{label}\n{category}"},
        ),
        width="stretch",
    )
    st.caption(f"Map nhận được {len(points)} marker và {len(paths)} tuyến đường.")


def run_scenario(mcp: ReloHomeMcpClient, scenario: str, values: dict[str, Any]) -> None:
    if scenario == "Tìm khu vực hành chính":
        call(mcp, "search_areas", {"text": values["text"], "limit": 10})
    elif scenario == "Phân giải tên địa điểm":
        call(mcp, "resolve_location", {"text": values["text"], "limit": 10})
    elif scenario == "Tìm POI quanh một mốc":
        origin = values.get("selected_location")
        if origin is None:
            raise ValueError("Hãy gõ tên và chọn một địa điểm trong danh sách gợi ý.")
        st.session_state.lab_note = (
            f"Mốc được MCP chọn: **{origin['name']}** "
            f"({origin['location']['lat']:.6f}, {origin['location']['lng']:.6f})."
        )
        call(
            mcp,
            "search_places",
            {
                "categories": [values["category"]],
                "center": origin["location"],
                "radius_m": values["radius_m"],
                "pagination": {"limit": 20, "cursor": None},
            },
        )
    elif scenario == "Tìm POI trong khu vực":
        area = first_result(
            call(mcp, "search_areas", {"text": values["text"], "limit": 5}),
            "search_areas",
        )
        call(
            mcp,
            "search_places",
            {
                "categories": [values["category"]],
                "administrative_area_ids": [area["area_id"]],
                "pagination": {"limit": 20, "cursor": None},
            },
        )
    elif scenario == "Tính tuyến đường":
        origin = values.get("origin_location")
        destination = values.get("destination_location")
        if origin is None or destination is None:
            raise ValueError("Hãy chọn cả điểm đi và điểm đến trong danh sách gợi ý.")
        st.session_state.lab_note = (
            f"MCP chọn điểm đầu **{origin['name']}** và điểm cuối **{destination['name']}**."
        )
        call(
            mcp,
            "calculate_route",
            {
                "city": infer_city(origin["location"]),
                "origin": origin["location"],
                "destination": destination["location"],
                "profile": values["profile"],
            },
        )
    elif scenario == "Tìm nhà theo khu vực":
        area = first_result(
            call(mcp, "search_areas", {"text": values["text"], "limit": 5}),
            "search_areas",
        )
        call(
            mcp,
            "search_housing",
            {
                "administrative_area_ids": [area["area_id"]],
                "listing_type": "rent",
                "max_price": {
                    "amount": values["max_price"],
                    "currency": "VND",
                    "period": "month",
                },
                "min_bedrooms": values["bedrooms"],
                "pagination": {"limit": 20, "cursor": None},
            },
        )


def scenario_inputs(scenario: str, mcp: ReloHomeMcpClient) -> dict[str, Any]:
    values: dict[str, Any] = {}
    if scenario in {"Tìm khu vực hành chính", "Phân giải tên địa điểm"}:
        default = "Gò Vấp" if scenario == "Tìm khu vực hành chính" else "Hồ Gươm"
        values["text"] = st.text_input("Tên cần tra", default)
    elif scenario == "Tìm POI quanh một mốc":
        values["selected_location"] = location_searchbox(
            mcp,
            label="Mốc trung tâm",
            key="poi_landmark_autocomplete",
            placeholder="Gõ ít nhất 2 ký tự, ví dụ: Đại học Khoa học…",
        )
        values["text"] = (
            values["selected_location"].get("name", "") if values["selected_location"] else ""
        )
        if values["selected_location"] is None:
            st.caption("Gõ tên và chọn một gợi ý trong danh sách trước khi chạy.")
        values["category"] = st.text_input("Category", "hotel")
        values["radius_m"] = st.number_input("Bán kính (m)", 100, 100000, 2000, 100)
    elif scenario == "Tìm POI trong khu vực":
        values["text"] = st.text_input("Khu vực hành chính", "Gò Vấp")
        values["category"] = st.text_input("Category", "hotel")
    elif scenario == "Tính tuyến đường":
        values["origin_location"] = location_searchbox(
            mcp,
            label="Điểm đi",
            key="route_origin_autocomplete",
            placeholder="Gõ và chọn điểm đi…",
        )
        values["destination_location"] = location_searchbox(
            mcp,
            label="Điểm đến",
            key="route_destination_autocomplete",
            placeholder="Gõ và chọn điểm đến…",
        )
        values["profile"] = st.selectbox("Phương tiện", ["motorcycle", "driving", "walking"])
    else:
        values["text"] = st.text_input("Khu vực hành chính", "Gò Vấp")
        values["max_price"] = st.number_input("Giá thuê tối đa/tháng", 0, 1_000_000_000, 15_000_000, 500_000)
        values["bedrooms"] = st.number_input("Số phòng ngủ tối thiểu", 0, 20, 2)
    return values


def show_trace() -> None:
    traces = st.session_state.lab_traces
    if not traces:
        st.info("Chọn một kịch bản hoặc tool rồi bấm chạy.")
        return
    total_ms = round(sum(item["elapsed_ms"] for item in traces), 1)
    st.success(f"Hoàn tất {len(traces)} tool call trong {total_ms} ms")
    for index, trace in enumerate(traces, 1):
        result = trace["result"]
        count = len(result.get("results", [])) if isinstance(result, dict) else 0
        with st.expander(
            f"{index}. {trace['tool']} · {trace['elapsed_ms']} ms · {count} kết quả",
            expanded=index == len(traces),
        ):
            st.caption("Input")
            st.json(trace["arguments"], expanded=False)
            st.caption("Output")
            st.json(result, expanded=True)


st.set_page_config(page_title="ReloHome MCP Tool Lab", page_icon="🧰", layout="wide")
st.title("🧰 ReloHome MCP Tool Lab")
st.caption("Test trực tiếp MCP tools và dữ liệu — không OpenAI, không agent.")

if "lab_traces" not in st.session_state:
    st.session_state.lab_traces = []
if "lab_payloads" not in st.session_state:
    st.session_state.lab_payloads = []
if "lab_note" not in st.session_state:
    st.session_state.lab_note = ""

try:
    mcp = get_mcp()
    tools = mcp.list_tools()
except Exception as error:
    st.error(f"MCP chưa sẵn sàng: {error}")
    st.stop()

control_col, map_col = st.columns([1, 1.15], gap="large")
with control_col:
    scenario_tab, raw_tab = st.tabs(["Kịch bản nhanh", "Gọi một tool"])
    with scenario_tab:
        scenario = st.selectbox(
            "Kịch bản",
            [
                "Tìm khu vực hành chính",
                "Phân giải tên địa điểm",
                "Tìm POI quanh một mốc",
                "Tìm POI trong khu vực",
                "Tính tuyến đường",
                "Tìm nhà theo khu vực",
            ],
        )
        values = scenario_inputs(scenario, mcp)
        if st.button("▶ Chạy kịch bản", type="primary", width="stretch"):
            st.session_state.lab_traces = []
            st.session_state.lab_payloads = []
            st.session_state.lab_note = ""
            try:
                run_scenario(mcp, scenario, values)
            except Exception as error:
                st.error(str(error))
    with raw_tab:
        tool_names = [tool["name"] for tool in tools]
        selected_tool = st.selectbox("MCP tool", tool_names)
        selected_metadata = next(tool for tool in tools if tool["name"] == selected_tool)
        st.caption(selected_metadata.get("description", ""))
        raw_arguments = st.text_area(
            "Arguments JSON",
            json.dumps(TOOL_PRESETS.get(selected_tool, {}), ensure_ascii=False, indent=2),
            height=220,
            key=f"raw_{selected_tool}",
        )
        if st.button("▶ Gọi tool", width="stretch"):
            st.session_state.lab_traces = []
            st.session_state.lab_payloads = []
            st.session_state.lab_note = ""
            try:
                call(mcp, selected_tool, json.loads(raw_arguments))
            except Exception as error:
                st.error(str(error))
    st.subheader("Kết quả và thời gian")
    if st.session_state.lab_note:
        st.warning(st.session_state.lab_note)
    show_trace()

with map_col:
    st.subheader("Dữ liệu tool trên bản đồ")
    # A scenario may use resolver outputs only as intermediate inputs. Mapping
    # all payloads together mixes unrelated candidates with the final result.
    render_map(st.session_state.lab_payloads[-1:])
