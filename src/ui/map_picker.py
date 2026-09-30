"""Shared Location MCP picker for local Housing and Moving workflows."""

import streamlit as st

from src.ui.mvp_components import api


def shared_map_picker(headers):
    with st.expander("Bản đồ dùng chung — tìm nhà / điểm lấy, giao", expanded=False):
        with st.form("map_search"):
            query = st.text_input("Tên địa điểm", placeholder="Bách khoa Hà Nội")
            submitted = st.form_submit_button("Tìm trên bản đồ")
        if submitted and len(query.strip()) >= 2:
            from urllib.parse import urlencode

            found = api(headers, "GET", "/map/search?" + urlencode({"text": query.strip()}))
            st.session_state.map_results = (found or {}).get("results", [])
            st.session_state.map_selected_id = None
        results = st.session_state.get("map_results", [])
        if not results:
            if submitted:
                st.info(
                    "Chưa có địa điểm phù hợp trong dữ liệu hiện tại. Thử tên đầy đủ hoặc địa chỉ cụ thể; hệ thống không tự đoán tọa độ."
                )
            return
        by_id = {r["canonical_id"]: r for r in results}
        selected = st.selectbox(
            "Chọn đúng địa điểm (không tự chọn kết quả đầu tiên)",
            list(by_id),
            index=None,
            key="map_selected_id",
            format_func=lambda key: (
                f"{by_id[key]['name']} — {(by_id[key].get('parent') or {}).get('name', '')} [{key}]"
            ),
        )
        shown = [by_id[selected]] if selected else results
        st.map(
            [{"lat": r["location"]["lat"], "lon": r["location"]["lng"]} for r in shown], zoom=15 if selected else None
        )
        st.caption(
            "Tọa độ từ dữ liệu Location/OSM, có thể là tâm khuôn viên/khu vực, không phải cổng đón. Bản đồ nền cần kết nối mạng."
        )
        if not selected:
            return
        place = by_id[selected]
        point = place["location"]
        label = place["name"]
        parent = (place.get("parent") or {}).get("name")
        if parent:
            label += ", " + parent
        st.caption(f"{label} · {point['lat']}, {point['lng']} · nguồn: {place['source']['type']}")
        if st.button("Tìm nhà gần điểm này"):
            st.session_state.housing_pin = {"address": label, **point, "confirmed": True}
            st.session_state.queued_prompt = "Tìm phòng gần " + label
        if place["entity_type"] == "place":
            for endpoint, text in (("pickup", "Dùng làm điểm lấy"), ("destination", "Dùng làm điểm giao")):
                if st.button(text):
                    st.session_state[endpoint + "_address"] = label
                    st.session_state[endpoint + "_lat"] = point["lat"]
                    st.session_state[endpoint + "_lng"] = point["lng"]
                    st.session_state[endpoint + "_confirmed"] = False
                    st.info("Đã điền vào form bên trái. Kiểm tra đúng cổng/điểm dừng rồi xác nhận; chưa đặt xe.")
        else:
            st.info("Đây là tâm khu vực hành chính: dùng để tìm nhà, không dùng làm điểm đón/giao.")
