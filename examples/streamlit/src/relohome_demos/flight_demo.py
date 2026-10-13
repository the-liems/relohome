"""Giao diện demo kết nối API vé máy bay: `streamlit run examples/streamlit/src/relohome_demos/flight_demo.py`.

Mọi thao tác đi qua flight MCP server (HTTP) như agent thật; công tắc ở sidebar đổi
nguồn dữ liệu giữa mock (offline) và SerpApi Google Flights (giá thật).
"""

import json
from datetime import date, datetime, timedelta
from typing import Any

import streamlit as st
from relohome_demos.flight_client import (
    CallRecord,
    Mode,
    ServerInfo,
    call_tool,
    inspect_server,
)
from relohome_flight.catalog import load_airports
from relohome_flight.schemas import FlightSearchRequest
from relohome_flight.search.serpapi import build_params
from relohome_flight.settings import now_vn

CABINS = {
    "economy": "Phổ thông",
    "premium_economy": "Phổ thông đặc biệt",
    "business": "Thương gia",
    "first": "Hạng nhất",
}
SORTS = {"price": "Giá rẻ nhất", "departure_time": "Giờ bay sớm nhất", "duration": "Bay nhanh nhất"}
STATUS_LABELS = {
    "HELD": "🟡 Đang giữ chỗ",
    "TICKETED": "🟢 Đã xuất vé",
    "CANCELLED": "⚫ Đã hủy",
    "EXPIRED": "🔴 Hết hạn giữ chỗ",
}
PAX_LABELS = {"adult": "Người lớn", "child": "Trẻ em", "infant": "Em bé"}
PAX_TITLES = {"adult": ["MR", "MRS", "MS"], "child": ["MSTR", "MISS"], "infant": ["MSTR", "MISS"]}
PAX_DEFAULT_AGE = {"adult": 30, "child": 7, "infant": 1}
SAMPLE_NAMES = [("NGUYEN", "VAN AN"), ("TRAN", "THI BINH"), ("LE", "MINH CHAU"), ("PHAM", "GIA DUNG")]

st.set_page_config(page_title="ReloHome · Demo API vé máy bay", page_icon="✈️", layout="wide")


# ---------- tiện ích ----------


def vnd(amount: int | None) -> str:
    return "—" if amount is None else f"{amount:,}".replace(",", ".") + " ₫"


def hhmm(value: str) -> str:
    return datetime.fromisoformat(value).strftime("%H:%M")


def dmy_hm(value: str | None) -> str:
    return "—" if not value else datetime.fromisoformat(value).strftime("%d/%m/%Y %H:%M")


def duration(minutes: int) -> str:
    return f"{minutes // 60}h{minutes % 60:02d}"


def offer_label(offer: dict[str, Any]) -> str:
    first, last = offer["segments"][0], offer["segments"][-1]
    flights = " + ".join(s["flight_number"] for s in offer["segments"])
    return (
        f"{first['airline_name']} {flights} · {hhmm(first['departure_time'])} → {hhmm(last['arrival_time'])}"
        f" · {vnd(offer['total_price'])}"
    )


def init_state() -> None:
    defaults: dict[str, Any] = {
        "log": [],
        "offers": [],
        "offers_mode": None,
        "search_message": "",
        "offer_detail": None,
        "booking": None,
        "server_info": {},
    }
    for key, value in defaults.items():
        st.session_state.setdefault(key, value)


def run_tool(tool: str, arguments: dict[str, Any]) -> CallRecord:
    """Gọi tool qua MCP và ghi vào nhật ký."""
    with st.spinner(f"Đang gọi MCP tool `{tool}` ({MODE_NAMES[mode]})..."):
        record = call_tool(mode, tool, arguments)
    st.session_state.log.append(record)
    return record


def show_call(record: CallRecord) -> None:
    """Hộp request/response của một lần gọi — bằng chứng dữ liệu đi qua API."""
    icon = "✅" if record.ok else "❌"
    with st.expander(f"{icon} MCP `tools/call` → `{record.tool}` · {record.tool_ms} ms (tổng {record.total_ms} ms)"):
        left, right = st.columns(2)
        left.caption("Request (arguments)")
        left.json(record.arguments)
        right.caption("Response")
        if record.ok:
            right.json(record.result, expanded=1)
        else:
            right.error(record.result)


def show_error(record: CallRecord) -> None:
    message = str(record.result).removeprefix(f"Error executing tool {record.tool}: ")
    st.error(message)


# ---------- sidebar: chế độ & kết nối ----------

MODE_NAMES: dict[Mode, str] = {"mock": "Mock (giả lập)", "serpapi": "API thật – SerpApi"}

init_state()
with st.sidebar:
    st.header("⚙️ Chế độ dữ liệu")
    real = st.toggle("🌐 Dùng API thật (Google Flights qua SerpApi)", value=False)
    mode: Mode = "serpapi" if real else "mock"
    if real:
        st.success("**Đang dùng API THẬT** — giá & giờ bay lấy trực tiếp từ Google Flights.")
        st.caption("Configure the SerpApi key on the Flight service. This UI uses its HTTP endpoint.")
        st.info("Mỗi lần tìm **mới** tốn 1 lượt SerpApi; tìm lại cùng tham số trong 1 giờ sẽ dùng cache.")
    else:
        st.warning("**Đang dùng MOCK** — dữ liệu giả lập offline, không tốn lượt API.")

    st.divider()
    st.subheader("🔌 Kiểm tra kết nối")
    if st.button("Kiểm tra ngay", width="stretch"):
        with st.spinner("Đang handshake với MCP server..."):
            try:
                st.session_state.server_info[mode] = inspect_server(mode)
            except Exception as exc:
                st.session_state.server_info.pop(mode, None)
                st.error(f"MCP server lỗi: {type(exc).__name__}: {exc}")
    info: ServerInfo | None = st.session_state.server_info.get(mode)
    st.markdown(f"MCP server: {'🟢 đã kết nối' if info else '⚪ chưa kiểm tra'}")
    st.divider()
    ok_calls = sum(r.ok for r in st.session_state.log)
    st.caption(f"Đã gọi API {len(st.session_state.log)} lần · thành công {ok_calls}")

# Offer của nguồn này không dùng được khi đã đổi sang nguồn kia
if st.session_state.offers_mode not in (None, mode):
    st.session_state.offers = []
    st.session_state.offer_detail = None
    st.session_state.offers_mode = None


# ---------- header ----------

st.title("✈️ ReloHome · Demo kết nối API vé máy bay nội địa Việt Nam")
st.markdown(
    f"Chế độ hiện tại: **{'🌐 API THẬT (SerpApi – Google Flights)' if real else '🧪 MOCK (giả lập)'}** · "
    "Mọi thao tác bên dưới đều gọi qua **MCP server `vn-flight-booking`** giống hệt agent LangGraph."
)

tab_conn, tab_search, tab_book, tab_manage, tab_log = st.tabs(
    ["🔌 Kết nối", "🔎 Tìm chuyến", "🎫 Đặt vé", "📋 Tra cứu / Hủy", "📜 Nhật ký API"]
)


# ---------- tab: kết nối ----------

with tab_conn:
    active, idle = ("#2e7d32", "#9e9e9e")
    mock_color, serp_color = (idle, active) if real else (active, idle)
    st.graphviz_chart(
        f"""
        digraph {{
          rankdir=LR; bgcolor="transparent";
          node [shape=box, style="rounded,filled", fontname="Helvetica", fontcolor="white", color="white"];
          edge [color="#607d8b", fontname="Helvetica", fontsize=10, fontcolor="#607d8b"];
          ui [label="Streamlit UI", fillcolor="#1565c0"];
          client [label="MCP client\\n(HTTP, JSON-RPC)", fillcolor="#1565c0"];
          server [label="MCP server\\nvn-flight-booking\\n7 tools", fillcolor="#6a1b9a"];
          mock [label="Mock provider\\n(offline)", fillcolor="{mock_color}"];
          serp [label="SerpApi\\nGoogle Flights API\\n(giá thật)", fillcolor="{serp_color}"];
          db [label="SQLite\\noffer + booking\\n(giả lập đặt vé)", fillcolor="#455a64"];
          ui -> client -> server;
          server -> mock [label="search", penwidth={3 if not real else 1}, style={"solid" if not real else "dashed"}];
          server -> serp [label="search (HTTPS)", penwidth={3 if real else 1}, style={"solid" if real else "dashed"}];
          server -> db [label="hold / confirm / cancel"];
        }}
        """,
        width="stretch",
    )
    st.caption(
        "Tìm chuyến lấy từ nguồn đang bật (đường nét liền). Giữ chỗ / xuất vé / hủy là giả lập "
        "vì các hãng Việt Nam không mở API đặt vé công khai (xem ADR-012)."
    )

    if info is None:
        st.info("Bấm **Kiểm tra ngay** ở sidebar để handshake với MCP server và liệt kê các tool.")
    else:
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Server", info.name)
        c2.metric("MCP protocol", info.protocol_version)
        c3.metric("Số tool", len(info.tools))
        c4.metric("Handshake", f"{info.total_ms} ms")
        st.markdown("**Tool server công bố (`tools/list`)**")
        st.dataframe(
            [
                {
                    "Tool": t["name"],
                    "Tên": t["title"],
                    "Loại": "Chỉ đọc" if t["read_only"] else "Ghi dữ liệu",
                    "Mô tả": t["description"],
                }
                for t in info.tools
            ],
            hide_index=True,
            width="stretch",
        )
        st.markdown("**Resource:** " + " · ".join(f"`{r}`" for r in info.resources))

# ---------- tab: tìm chuyến ----------

airports = load_airports()
codes = list(airports)

with tab_search:
    with st.form("search"):
        c1, c2, c3 = st.columns(3)
        origin = c1.selectbox(
            "Điểm đi", codes, index=codes.index("HAN"), format_func=lambda c: f"{c} – {airports[c].city}"
        )
        destination = c2.selectbox(
            "Điểm đến", codes, index=codes.index("SGN"), format_func=lambda c: f"{c} – {airports[c].city}"
        )
        today = now_vn().date()
        departure = c3.date_input(
            "Ngày bay", value=today + timedelta(days=30), min_value=today, max_value=today + timedelta(days=330)
        )
        c1, c2, c3, c4 = st.columns(4)
        adults = c1.number_input("Người lớn", 1, 9, 1)
        children = c2.number_input("Trẻ em (2–11)", 0, 8, 0)
        infants = c3.number_input("Em bé (<2)", 0, 9, 0)
        cabin = c4.selectbox("Hạng ghế", list(CABINS), format_func=CABINS.get)
        c1, c2, c3 = st.columns(3)
        sort_by = c1.selectbox("Sắp xếp", list(SORTS), format_func=SORTS.get)
        max_results = c2.slider("Số kết quả tối đa", 1, 20, 8)
        nonstop = c3.checkbox("Chỉ bay thẳng", value=False)
        submitted = st.form_submit_button(f"🔎 Tìm chuyến ({MODE_NAMES[mode]})", type="primary")

    if submitted:
        request = {
            "origin": origin,
            "destination": destination,
            "departure_date": departure.isoformat(),
            "passengers": {"adults": adults, "children": children, "infants": infants},
            "cabin_class": cabin,
            "nonstop_only": nonstop,
            "sort_by": sort_by,
            "max_results": max_results,
        }
        record = run_tool("search_flights", {"request": request})
        st.session_state.search_record = record
        st.session_state.offer_detail = None
        if record.ok:
            st.session_state.offers = record.result["offers"]
            st.session_state.offers_mode = mode
            st.session_state.search_message = record.result["message"]
        else:
            st.session_state.offers = []

    record = st.session_state.get("search_record")
    if record is not None and record.mode == mode:
        if not record.ok:
            show_error(record)
        else:
            source = record.result["source"]
            badge = "🌐 SerpApi – Google Flights (giá thật)" if source == "serpapi" else "🧪 Mock (giả lập)"
            st.success(f"{st.session_state.search_message} · Nguồn trả về: **{badge}** · {record.tool_ms} ms")
            offers = st.session_state.offers
            if offers:
                st.dataframe(
                    [
                        {
                            "Hãng": o["segments"][0]["airline_name"],
                            "Chuyến": " + ".join(s["flight_number"] for s in o["segments"]),
                            "Đi": hhmm(o["segments"][0]["departure_time"]),
                            "Đến": hhmm(o["segments"][-1]["arrival_time"]),
                            "Thời gian": duration(o["total_duration_minutes"]),
                            "Điểm dừng": "Bay thẳng" if o["stops"] == 0 else f"{o['stops']} điểm dừng",
                            "Tổng giá": vnd(o["total_price"]),
                            "Ghế còn": o["seats_left"] if o["seats_left"] is not None else "—",
                            "Nguồn": o["source"],
                            "offer_id": o["offer_id"],
                        }
                        for o in offers
                    ],
                    hide_index=True,
                    width="stretch",
                )
                st.caption("Chọn chuyến và đặt vé ở tab **🎫 Đặt vé**.")
        show_call(record)
        if record.mode == "serpapi":
            with st.expander("🌐 Tham số HTTP server gửi tới SerpApi (đã ẩn api_key)"):
                params = build_params(FlightSearchRequest.model_validate(record.arguments["request"]))
                st.code(
                    "GET https://serpapi.com/search?"
                    + "&".join(f"{k}={v}" for k, v in params.items())
                    + "&api_key=***",
                    language="http",
                )


# ---------- tab: đặt vé ----------

with tab_book:
    offers = st.session_state.offers
    if not offers:
        st.info("Hãy tìm chuyến ở tab **🔎 Tìm chuyến** trước.")
    else:
        by_id = {o["offer_id"]: o for o in offers}
        offer_id = st.selectbox("Chuyến bay đã chọn", list(by_id), format_func=lambda i: offer_label(by_id[i]))
        offer = by_id[offer_id]

        st.markdown("#### Bước 1 · Xem điều kiện vé")
        if st.button("📄 Xem hành lý & điều kiện hoàn/hủy (`get_offer`)"):
            st.session_state.offer_detail = run_tool("get_offer", {"offer_id": offer_id})
        detail: CallRecord | None = st.session_state.offer_detail
        if detail is not None and detail.arguments["offer_id"] == offer_id:
            if detail.ok:
                rules = detail.result["fare_rules"]
                c1, c2, c3, c4 = st.columns(4)
                c1.metric("Ký gửi", f"{rules['checked_baggage_kg']} kg" if rules["checked_baggage_kg"] else "Không")
                c2.metric("Xách tay", f"{rules['carry_on_kg']} kg")
                c3.metric("Đổi vé", vnd(rules["change_fee"]) if rules["changeable"] else "Không được")
                c4.metric("Hoàn/hủy", vnd(rules["cancel_fee"]) if rules["refundable"] else "Không hoàn")
            else:
                show_error(detail)
            show_call(detail)

        st.markdown("#### Bước 2 · Giữ chỗ")
        pax = offer["passengers"]
        pax_types = ["adult"] * pax["adults"] + ["child"] * pax["children"] + ["infant"] * pax["infants"]
        flight_day = datetime.fromisoformat(offer["segments"][0]["departure_time"]).date()
        with st.form(f"hold_{offer_id}"):
            passengers = []
            for i, pax_type in enumerate(pax_types):
                last, first = SAMPLE_NAMES[i % len(SAMPLE_NAMES)]
                st.markdown(f"**Hành khách {i + 1} – {PAX_LABELS[pax_type]}**")
                c1, c2, c3, c4 = st.columns([1, 2, 2, 2])
                title = c1.selectbox("Danh xưng", PAX_TITLES[pax_type], key=f"title_{i}")
                last_name = c2.text_input("Họ", last, key=f"last_{i}")
                first_name = c3.text_input("Tên đệm và tên", first, key=f"first_{i}")
                dob = c4.date_input(
                    "Ngày sinh",
                    value=flight_day.replace(year=flight_day.year - PAX_DEFAULT_AGE[pax_type], day=1),
                    min_value=date(1920, 1, 1),
                    max_value=flight_day,
                    key=f"dob_{i}",
                )
                passengers.append(
                    {
                        "type": pax_type,
                        "title": title,
                        "last_name": last_name,
                        "first_name": first_name,
                        "date_of_birth": dob.isoformat(),
                    }
                )
            c1, c2 = st.columns(2)
            email = c1.text_input("Email liên hệ", "demo@example.com")
            phone = c2.text_input("Số điện thoại", "0901234567")
            hold = st.form_submit_button("🟡 Giữ chỗ (`hold_booking`)", type="primary")
        if hold:
            args = {
                "request": {"offer_id": offer_id, "passengers": passengers, "contact": {"email": email, "phone": phone}}
            }
            st.session_state.hold_record = run_tool("hold_booking", args)
            if st.session_state.hold_record.ok:
                st.session_state.booking = st.session_state.hold_record.result
        hold_record: CallRecord | None = st.session_state.get("hold_record")
        if hold_record is not None and not hold_record.ok:
            show_error(hold_record)

        booking = st.session_state.booking
        if booking and booking["offer"]["offer_id"] == offer_id:
            st.markdown("#### Bước 3 · Xác nhận xuất vé")
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("PNR", booking["pnr"])
            c2.metric("Trạng thái", STATUS_LABELS[booking["status"]])
            c3.metric("Tổng tiền", vnd(booking["total_price"]))
            c4.metric("Giữ chỗ đến", dmy_hm(booking["hold_expires_at"])[-5:] if booking["hold_expires_at"] else "—")
            if booking["status"] == "HELD":
                st.warning("Kiểm tra lại thông tin. Xuất vé là bước cuối (thanh toán giả lập).")
                if st.button("✅ Đồng ý & xuất vé (`confirm_booking`)", type="primary"):
                    record = run_tool("confirm_booking", {"booking_ref": booking["booking_id"]})
                    if record.ok:
                        st.session_state.booking = record.result
                        st.session_state.just_ticketed = True
                        st.rerun()
                    show_error(record)
            elif booking["status"] == "TICKETED":
                if st.session_state.pop("just_ticketed", False):
                    st.balloons()
                st.success("Đã xuất vé: " + ", ".join(f"`{t}`" for t in booking["ticket_numbers"]))
            if hold_record is not None:
                show_call(hold_record)


# ---------- tab: tra cứu / hủy ----------

with tab_manage:
    current = st.session_state.booking
    ref = st.text_input("Mã PNR hoặc booking_id", value=current["pnr"] if current else "")
    c1, c2, c3 = st.columns(3)
    lookup = c1.button("🔍 Tra cứu (`get_booking`)", disabled=not ref, width="stretch")
    quote = c2.button("💬 Báo phí hủy (`cancel_booking` confirm=false)", disabled=not ref, width="stretch")
    cancel = c3.button("🗑️ Hủy thật (`cancel_booking` confirm=true)", disabled=not ref, width="stretch")
    if lookup:
        st.session_state.manage_record = run_tool("get_booking", {"booking_ref": ref.strip()})
    if quote or cancel:
        st.session_state.manage_record = run_tool("cancel_booking", {"booking_ref": ref.strip(), "confirm": cancel})

    record = st.session_state.get("manage_record")
    if record is not None:
        if not record.ok:
            show_error(record)
        elif record.tool == "get_booking":
            b = record.result
            seg = b["offer"]["segments"]
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("PNR", b["pnr"])
            c2.metric("Trạng thái", STATUS_LABELS[b["status"]])
            c3.metric("Hành trình", f"{seg[0]['origin']} → {seg[-1]['destination']}")
            c4.metric("Tổng tiền", vnd(b["total_price"]))
            st.markdown(
                f"**Chuyến:** {offer_label(b['offer'])} · ngày {dmy_hm(seg[0]['departure_time'])[:10]}  \n"
                "**Hành khách:** "
                + ", ".join(f"{p['title']} {p['last_name']} {p['first_name']}" for p in b["passengers"])
                + ("  \n**Số vé:** " + ", ".join(b["ticket_numbers"]) if b["ticket_numbers"] else "")
            )
        else:
            r = record.result
            (st.success if r["cancelled"] else st.info)(
                f"{r['message']} · Phí hủy: **{vnd(r['cancel_fee'])}** · Hoàn lại: **{vnd(r['refund_amount'])}**"
            )
            if r["cancelled"] and current and current["booking_id"] == r["booking_id"]:
                st.session_state.booking = {**current, "status": r["status"]}
        show_call(record)


# ---------- tab: nhật ký ----------

with tab_log:
    log: list[CallRecord] = st.session_state.log
    if not log:
        st.info("Chưa có lần gọi API nào.")
    else:
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Tổng số lần gọi", len(log))
        c2.metric("Thành công", sum(r.ok for r in log))
        c3.metric("Gọi API thật", sum(r.mode == "serpapi" for r in log))
        c4.metric("Độ trễ tool TB", f"{sum(r.tool_ms for r in log) // len(log)} ms")
        st.dataframe(
            [
                {
                    "Thời điểm": r.at.strftime("%H:%M:%S"),
                    "Chế độ": "🌐 thật" if r.mode == "serpapi" else "🧪 mock",
                    "Tool": r.tool,
                    "Kết quả": "✅" if r.ok else "❌",
                    "Tool (ms)": r.tool_ms,
                    "Tổng (ms)": r.total_ms,
                }
                for r in reversed(log)
            ],
            hide_index=True,
            width="stretch",
        )
        for r in reversed(log):
            show_call(r)
        export = [
            {
                "at": r.at.isoformat(),
                "mode": r.mode,
                "tool": r.tool,
                "ok": r.ok,
                "tool_ms": r.tool_ms,
                "total_ms": r.total_ms,
                "arguments": r.arguments,
                "result": r.result,
            }
            for r in log
        ]
        c1, c2 = st.columns(2)
        c1.download_button(
            "⬇️ Tải nhật ký (JSON)",
            json.dumps(export, ensure_ascii=False, indent=2),
            file_name=f"flight_api_log_{now_vn():%Y%m%d_%H%M%S}.json",
            mime="application/json",
        )
        if c2.button("🧹 Xóa nhật ký"):
            st.session_state.log = []
            st.rerun()
