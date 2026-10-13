"""ReloHome local Agent + MCP + Map demo."""

from __future__ import annotations

import os
import socket

import pydeck as pdk
import streamlit as st
from dotenv import load_dotenv

from relohome_location_demo.agent import extract_map_data, run_housing_subagent
from relohome_location_demo.mcp_client import ReloHomeMcpClient
from relohome_location_demo.runtime_paths import repository_root

RELOHOME_ROOT = repository_root()
REPOSITORY_ROOT = RELOHOME_ROOT
load_dotenv(REPOSITORY_ROOT / ".env.local")

TOOL_HELP = {
    "housing_map_subagent": (
        "Chuyển yêu cầu vào Housing/Map Sub-agent",
        "Đây là ranh giới giữa agent chính của product và sub-agent chuyên xử lý nhà ở, địa điểm và bản đồ.",
    ),
    "search_housing": (
        "Tìm danh sách nhà",
        "Lọc dữ liệu nhà thật theo khu vực, mức giá, loại hình, diện tích, số phòng và tiện ích; không tự xếp hạng.",
    ),
    "get_housing": (
        "Xem chi tiết một căn",
        "Lấy thông tin đầy đủ của một listing bằng ID chuẩn sau khi đã tìm thấy căn phù hợp.",
    ),
    "search_places": (
        "Tìm địa điểm",
        "Tìm khách sạn, bệnh viện, trường học hoặc POI khác theo tên, loại và phạm vi không gian.",
    ),
    "search_areas": (
        "Xác định khu vực hành chính",
        "Đổi tên như “Gò Vấp” thành ID và ranh giới chuẩn để những bước tìm kiếm sau không hiểu sai địa bàn.",
    ),
    "resolve_location": (
        "Biến tên địa điểm thành tọa độ",
        "Tra cứu tên người dùng nhập và trả về các vị trí có thể khớp, phục vụ tìm quanh hoặc tính đường.",
    ),
    "get_place": (
        "Xem chi tiết một địa điểm",
        "Lấy bản ghi chuẩn của một POI bằng ID, gồm tên, loại và tọa độ.",
    ),
    "find_nearby_places": (
        "Tìm tiện ích gần nhất",
        "Từ một tọa độ, tìm địa điểm gần nhất cho từng loại và giới hạn khoảng cách được yêu cầu.",
    ),
    "calculate_route": (
        "Tính đường đi",
        "Dùng OSRM để tính tuyến đường, quãng đường và thời gian theo ô tô, xe máy hoặc đi bộ.",
    ),
}

st.set_page_config(page_title="Housing/Map Sub-agent Lab", page_icon="🗺️", layout="wide")
st.markdown(
    """
    <style>
    /* Keep the result map visible while the chat/tool trace grows. */
    div[data-testid="stHorizontalBlock"] > div:nth-child(2) > div[data-testid="stVerticalBlock"] {
        position: sticky;
        top: 3.75rem;
        align-self: flex-start;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_resource
def get_mcp_client() -> ReloHomeMcpClient:
    return ReloHomeMcpClient(RELOHOME_ROOT)


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.15):
            return True
    except OSError:
        return False


def tool_help(name: str) -> tuple[str, str]:
    return TOOL_HELP.get(name, (name, "Công cụ nội bộ của Housing/Map Sub-agent."))


def render_map(payloads: list[dict]) -> None:
    points, paths = extract_map_data(payloads)
    all_coordinates = [[point["lng"], point["lat"]] for point in points]
    for path in paths:
        all_coordinates.extend(path)
    if all_coordinates:
        center_lng = sum(item[0] for item in all_coordinates) / len(all_coordinates)
        center_lat = sum(item[1] for item in all_coordinates) / len(all_coordinates)
        zoom = 11
    else:
        center_lng, center_lat, zoom = 106.7009, 10.7769, 10

    layers: list[pdk.Layer] = []
    if paths:
        layers.append(
            pdk.Layer(
                "PathLayer",
                [{"path": path} for path in paths],
                get_path="path",
                get_color=[37, 99, 235, 220],
                width_min_pixels=5,
                get_width=6,
            )
        )
    if points:
        layers.append(
            pdk.Layer(
                "ScatterplotLayer",
                points,
                get_position="[lng, lat]",
                get_fill_color=[239, 68, 68, 220],
                get_line_color=[255, 255, 255],
                get_radius=90,
                radius_min_pixels=6,
                radius_max_pixels=14,
                line_width_min_pixels=2,
                pickable=True,
                stroked=True,
            )
        )

    st.pydeck_chart(
        pdk.Deck(
            map_style="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
            initial_view_state=pdk.ViewState(latitude=center_lat, longitude=center_lng, zoom=zoom),
            layers=layers,
            tooltip={"text": "{label}\n{category}"},
        ),
        width="stretch",
    )
    if not points and not paths:
        st.caption("Bản đồ đang chờ kết quả có tọa độ từ MCP tool.")


if "messages" not in st.session_state:
    st.session_state.messages = []
if "last_payloads" not in st.session_state:
    st.session_state.last_payloads = []

with st.sidebar:
    st.header("Housing/Map Sub-agent")
    st.caption("Product Orchestrator → Housing Sub-agent → MCP → Map")
    services = {
        "PostGIS": port_open(5433),
        "Platform API": port_open(4100),
        "OSRM HCM": port_open(5000),
    }
    for name, ready in services.items():
        st.write(f"{'🟢' if ready else '🔴'} {name}")

    try:
        mcp = get_mcp_client()
        tools = mcp.list_tools()
        st.success(f"MCP: {len(tools)} tools")
        with st.expander("Các tool làm được gì?"):
            st.caption("Đây là tool nội bộ; Product Orchestrator chỉ gọi sub-agent, không gọi trực tiếp các tool này.")
            for tool in tools:
                name = tool["name"]
                title, description = tool_help(name)
                st.markdown(f"**{title}** · `{name}`")
                st.caption(description)
    except Exception as error:
        mcp = None
        st.error(f"MCP chưa sẵn sàng: {error}")

    model = st.text_input("OpenAI model", value=os.getenv("MODEL_NAME", "gpt-4o-mini"))
    if st.button("Xóa hội thoại", width="stretch"):
        st.session_state.messages = []
        st.session_state.last_payloads = []
        st.rerun()

    st.markdown("**Câu demo**")
    st.caption("Tìm khách sạn trong bán kính 2 km quanh Hồ Gươm và hiển thị trên bản đồ.")
    st.caption("Tìm bệnh viện gần Đại học VinUni.")
    st.caption("Tính đường đi xe máy từ Chợ Bến Thành tới sân bay Tân Sơn Nhất.")

st.title("🗺️ Housing/Map Sub-agent Lab")
st.caption("Sandbox test sub-agent và MCP tools; không phải agent chính của product")

chat_col, map_col = st.columns([0.95, 1.25], gap="large")

with chat_col:
    for item in st.session_state.messages:
        with st.chat_message(item["role"]):
            st.markdown(item["content"])

    question = st.chat_input("Ví dụ: Tìm khách sạn ở Gò Vấp và hiện lên bản đồ")
    if question:
        st.session_state.messages.append({"role": "user", "content": question})
        with st.chat_message("user"):
            st.markdown(question)

        if mcp is None:
            answer = "MCP server chưa sẵn sàng. Hãy build ReloHome và kiểm tra cấu hình `.env`."
            traces = []
            payloads = []
        elif not os.getenv("OPENAI_API_KEY"):
            answer = "Thiếu `OPENAI_API_KEY` trong `.env`."
            traces = []
            payloads = []
        else:
            previous = [
                message
                for message in st.session_state.messages[:-1]
                if message["role"] in {"user", "assistant"}
            ]
            try:
                with st.spinner("Agent đang chọn và gọi MCP tool…"):
                    result = run_housing_subagent(question, previous, mcp, model=model)
                answer = result.answer
                traces = result.tool_calls
                payloads = result.map_payloads
            except Exception as error:
                answer = f"Không thể hoàn tất yêu cầu: `{error}`"
                traces = []
                payloads = []

        st.session_state.messages.append({"role": "assistant", "content": answer})
        st.session_state.last_payloads = payloads
        with st.chat_message("assistant"):
            st.markdown(answer)
            if traces:
                with st.expander(f"Luồng xử lý của sub-agent ({len(traces)} bước)", expanded=False):
                    for index, trace in enumerate(traces, 1):
                        tool_name = trace["tool"]
                        title, description = tool_help(tool_name)
                        st.markdown(f"**{index}. {title}** · `{tool_name}`")
                        st.caption(description)
                        st.caption("Dữ liệu đầu vào")
                        st.json(trace.get("arguments", {}), expanded=False)
                        if trace.get("error"):
                            st.error(trace["error"])
                        else:
                            result = trace.get("result", {})
                            count = len(result.get("results", [])) if isinstance(result, dict) else 0
                            st.caption(f"Kết quả: {count} bản ghi" if count else "Tool hoàn tất")
                            st.json(result, expanded=False)

with map_col:
    st.subheader("Kết quả trên bản đồ")
    render_map(st.session_state.last_payloads)

