"""Giao diện demo thanh toán: `make ui-payment` (cổng 8502).

Mọi thao tác đi qua payment MCP server (HTTP) như agent thật; công tắc ở sidebar đổi
giữa cổng mock (offline) và ZaloPay sandbox. Giao diện không có ô nhập dữ liệu cá nhân:
mã đơn và mã khách tự sinh, key ZaloPay chỉ nằm trong .env (xem ADR-015).
"""

import io
import json
import secrets
from datetime import datetime
from typing import Any

import segno
import streamlit as st
from relohome_demos.payment_client import CallRecord, Mode, ServerInfo, call_tool, inspect_server
from relohome_payment.privacy import redact_secrets
from relohome_payment.schemas import MAX_AMOUNT, MIN_AMOUNT
from relohome_payment.settings import PaymentSettings, now_vn

MODE_NAMES: dict[Mode, str] = {"mock": "Mock (giả lập)", "zalopay": "ZaloPay sandbox"}
STATUS_LABELS = {
    "PENDING": "🟡 Chờ thanh toán",
    "PAID": "🟢 Đã thanh toán",
    "FAILED": "🔴 Thất bại",
    "EXPIRED": "⚫ Hết hạn",
    "CANCELLED": "⚫ Đã hủy",
    "REFUNDED": "🔵 Đã hoàn tiền",
}
SENT_FIELDS = [
    ("app_trans_id", "Mã đơn ngẫu nhiên có tiền tố nhóm", "PNR, booking_id, tên, email, SĐT"),
    ("app_user", "Mã băm có muối của mã khách nội bộ", "Tên, email, SĐT thật"),
    ("amount", "Số tiền (VND)", "—"),
    ("description", "Mẫu cố định: '<tiền tố> demo <mã đơn>'", "Văn bản tự do, tên khách, tuyến bay"),
    ("item / embed_data", "'[]' / chỉ redirecturl về localhost", "Mọi dữ liệu người dùng"),
]

st.set_page_config(page_title="ReloHome · Demo API thanh toán", page_icon="💳", layout="wide")


# ---------- tiện ích ----------


def vnd(amount: int | None) -> str:
    return "—" if amount is None else f"{amount:,}".replace(",", ".") + " ₫"


def dmy_hm(value: str | None) -> str:
    return "—" if not value else datetime.fromisoformat(value).strftime("%H:%M %d/%m/%Y")


def new_ref(prefix: str) -> str:
    """Mã nội bộ vô danh, ví dụ bk_3f9a1c2e (không chứa thông tin cá nhân)."""
    return f"{prefix}_{secrets.token_hex(4)}"


def qr_png(payload: str) -> bytes:
    """Vẽ QR ngay trên máy (không gửi chuỗi QR cho dịch vụ bên ngoài)."""
    buffer = io.BytesIO()
    segno.make(payload, error="m").save(buffer, kind="png", scale=6, border=2)
    return buffer.getvalue()


def init_state() -> None:
    defaults: dict[str, Any] = {
        "log": [],
        "payments": {},
        "current": None,
        "server_info": {},
        "order_ref": new_ref("bk"),
        "customer_ref": new_ref("cust"),
    }
    for key, value in defaults.items():
        st.session_state.setdefault(key, value)


def run_tool(tool: str, arguments: dict[str, Any]) -> CallRecord:
    """Gọi tool qua MCP, ghi nhật ký và cập nhật giao dịch vừa nhận được."""
    with st.spinner(f"Đang gọi MCP tool `{tool}` ({MODE_NAMES[mode]})..."):
        record = call_tool(mode, tool, arguments)
    st.session_state.log.append(record)
    result = record.result
    if record.ok and isinstance(result, dict) and "gateway_ref" in result:
        st.session_state.payments[result["payment_id"]] = result
        st.session_state.current = result["payment_id"]
    return record


def show_call(record: CallRecord) -> None:
    """Hộp request/response của một lần gọi (đã che mac/key/token)."""
    icon = "✅" if record.ok else "❌"
    with st.expander(f"{icon} MCP `tools/call` → `{record.tool}` · {record.tool_ms} ms (tổng {record.total_ms} ms)"):
        left, right = st.columns(2)
        left.caption("Request (arguments)")
        left.json(redact_secrets(record.arguments))
        right.caption("Response")
        if record.ok:
            right.json(redact_secrets(record.result), expanded=1)
        else:
            right.error(record.result)


def show_error(record: CallRecord) -> None:
    st.error(str(record.result).removeprefix(f"Error executing tool {record.tool}: "))


# ---------- sidebar ----------

init_state()
settings = PaymentSettings()
zalopay_ready = bool(settings.zalopay_app_id and settings.zalopay_key1)

with st.sidebar:
    st.header("⚙️ Cổng thanh toán")
    real = st.toggle("🌐 Dùng ZaloPay sandbox (API thật)", value=False)
    mode: Mode = "zalopay" if real else "mock"
    if real:
        if zalopay_ready:
            st.success("**Đang dùng ZaloPay sandbox** — đơn được tạo thật trên hệ thống ZaloPay (không có tiền thật).")
            st.caption("Key: đã cấu hình trong `.env` (không hiển thị)")
        else:
            st.error(
                "Chưa có key. Điền `PAYMENT_ZALOPAY_APP_ID`, `PAYMENT_ZALOPAY_KEY1`, `PAYMENT_ZALOPAY_KEY2` trong `.env`."
            )
    else:
        st.warning("**Đang dùng MOCK** — giả lập offline, có nút giả lập kết quả thanh toán.")

    st.divider()
    st.subheader("🛡️ Dữ liệu cá nhân")
    st.caption(
        f"Mã đơn gửi cổng có tiền tố nhóm **`{settings.order_prefix}`** và phần ngẫu nhiên. "
        "Cổng chỉ nhận mã đơn, số tiền và mã khách đã băm. Giao diện không có ô nhập tên, email hay SĐT."
    )

    st.divider()
    st.subheader("🔌 Kiểm tra kết nối")
    if st.button("Kiểm tra ngay", width="stretch", disabled=real and not zalopay_ready):
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


# ---------- header ----------

st.title("💳 ReloHome · Demo kết nối API thanh toán")
st.markdown(
    f"Cổng hiện tại: **{'🌐 ZaloPay sandbox' if real else '🧪 MOCK (giả lập)'}** · "
    "Mọi thao tác đều gọi qua **MCP server `vn-payment`** giống hệt agent LangGraph."
)

tab_conn, tab_create, tab_manage, tab_log = st.tabs(
    ["🔌 Kết nối", "💳 Tạo thanh toán", "🔎 Trạng thái / Hoàn tiền", "📜 Nhật ký API"]
)


# ---------- tab: kết nối ----------

with tab_conn:
    active, idle = ("#2e7d32", "#9e9e9e")
    mock_color, zp_color = (idle, active) if real else (active, idle)
    st.graphviz_chart(
        f"""
        digraph {{
          rankdir=LR; bgcolor="transparent";
          node [shape=box, style="rounded,filled", fontname="Helvetica", fontcolor="white", color="white"];
          edge [color="#607d8b", fontname="Helvetica", fontsize=10, fontcolor="#607d8b"];
          ui [label="Streamlit UI", fillcolor="#1565c0"];
          client [label="MCP client\\n(HTTP, JSON-RPC)", fillcolor="#1565c0"];
          server [label="MCP server\\nvn-payment", fillcolor="#6a1b9a"];
          guard [label="Lớp bảo vệ\\ndữ liệu cá nhân", fillcolor="#c62828"];
          mock [label="Mock gateway\\n(offline)", fillcolor="{mock_color}"];
          zp [label="ZaloPay sandbox\\nsb-openapi.zalopay.vn", fillcolor="{zp_color}"];
          db [label="SQLite\\n(chỉ mã, tiền, trạng thái)", fillcolor="#455a64"];
          ui -> client -> server -> guard;
          guard -> mock [penwidth={1 if real else 3}, style={"dashed" if real else "solid"}];
          guard -> zp [label="HTTPS, HMAC-SHA256", penwidth={3 if real else 1}, style={"solid" if real else "dashed"}];
          server -> db;
        }}
        """,
        width="stretch",
    )
    st.markdown("**Dữ liệu gửi cho cổng thanh toán** (danh sách cho phép, còn lại bị chặn)")
    st.dataframe(
        [{"Trường": f, "Giá trị gửi": sent, "Không bao giờ gửi": never} for f, sent, never in SENT_FIELDS],
        hide_index=True,
        width="stretch",
    )
    if info is None:
        st.info("Bấm **Kiểm tra ngay** ở sidebar để handshake với MCP server và liệt kê các tool.")
    else:
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Server", info.name)
        c2.metric("MCP protocol", info.protocol_version)
        c3.metric("Số tool", len(info.tools))
        c4.metric("Handshake", f"{info.total_ms} ms")
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
        if real:
            st.caption("Ở chế độ ZaloPay, server không công bố tool giả lập: chỉ cổng thật mới xác nhận được đã trả.")


# ---------- tab: tạo thanh toán ----------

with tab_create:
    c1, c2, c3 = st.columns([2, 2, 1])
    amount = c1.number_input("Số tiền (VND)", MIN_AMOUNT, MAX_AMOUNT, 150_000, step=10_000)
    c2.text_input("Mã đơn nội bộ (tự sinh, vô danh)", st.session_state.order_ref, disabled=True)
    c3.write("")
    c3.write("")
    if c3.button("🔁 Mã mới"):
        st.session_state.order_ref = new_ref("bk")
        st.rerun()
    st.caption(
        f"Mã khách nội bộ của phiên: `{st.session_state.customer_ref}` → server chỉ gửi bản băm cho cổng. "
        "Tạo lại với cùng mã đơn và số tiền sẽ nhận lại giao dịch cũ."
    )
    if st.button(f"💳 Tạo thanh toán ({MODE_NAMES[mode]})", type="primary", disabled=real and not zalopay_ready):
        args = {
            "order_ref": st.session_state.order_ref,
            "amount": int(amount),
            "customer_ref": st.session_state.customer_ref,
        }
        st.session_state.create_record = run_tool("create_payment", args)

    record: CallRecord | None = st.session_state.get("create_record")
    if record is not None and record.mode == mode:
        if not record.ok:
            show_error(record)
        else:
            p = st.session_state.payments.get(record.result["payment_id"], record.result)
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Trạng thái", STATUS_LABELS[p["status"]])
            c2.metric("Số tiền", vnd(p["amount"]))
            c3.metric("Cổng", MODE_NAMES[p["provider"]])
            c4.metric("Hết hạn", dmy_hm(p["expires_at"])[:5])
            st.markdown(f"Mã đơn gửi cổng: `{p['gateway_ref']}` · payment_id: `{p['payment_id']}`")
            left, right = st.columns([1, 2])
            if p.get("qr_code"):
                left.image(qr_png(p["qr_code"]), caption="Quét để thanh toán", width=220)
            with right:
                if p.get("pay_url") and p["provider"] == "zalopay":
                    st.link_button("🔗 Mở trang thanh toán ZaloPay", p["pay_url"])
                    st.caption(
                        "Đây là đơn thật trên ZaloPay sandbox. Sau khi trả thử, vào tab "
                        "**Trạng thái** bấm Làm mới để hỏi lại ZaloPay."
                    )
                elif p["status"] == "PENDING":
                    st.markdown("**Giả lập kết quả (chỉ có ở mock):**")
                    b1, b2, b3 = st.columns(3)
                    for column, outcome, label in (
                        (b1, "PAID", "✅ Khách đã trả"),
                        (b2, "FAILED", "❌ Thất bại"),
                        (b3, "EXPIRED", "⌛ Hết hạn"),
                    ):
                        if column.button(label, width="stretch"):
                            run_tool("simulate_payment_result", {"payment_ref": p["payment_id"], "outcome": outcome})
                            st.rerun()
        show_call(record)


# ---------- tab: trạng thái / hoàn tiền ----------

with tab_manage:
    payments = st.session_state.payments
    if not payments:
        st.info("Chưa có giao dịch nào trong phiên này. Tạo ở tab **💳 Tạo thanh toán**.")
    else:
        ids = list(payments)
        current = st.session_state.current if st.session_state.current in payments else ids[-1]
        payment_id = st.selectbox(
            "Giao dịch",
            ids,
            index=ids.index(current),
            format_func=lambda i: (
                f"{payments[i]['gateway_ref']} · {vnd(payments[i]['amount'])} · {STATUS_LABELS[payments[i]['status']]}"
            ),
        )
        p = payments[payment_id]
        if p["provider"] != mode:
            st.warning(f"Giao dịch này tạo bằng {MODE_NAMES[p['provider']]}; hãy chuyển công tắc về đúng cổng.")
        c1, c2, c3, c4 = st.columns(4)
        refresh = c1.button("🔄 Làm mới (`get_payment`)", width="stretch", disabled=p["provider"] != mode)
        cancel = c2.button("🚫 Hủy (`cancel_payment`)", width="stretch", disabled=p["provider"] != mode)
        quote = c3.button("💬 Báo hoàn tiền", width="stretch", disabled=p["provider"] != mode)
        refund = c4.button("↩️ Hoàn tiền thật", width="stretch", disabled=p["provider"] != mode)
        if refresh:
            st.session_state.manage_record = run_tool("get_payment", {"payment_ref": payment_id})
        if cancel:
            st.session_state.manage_record = run_tool("cancel_payment", {"payment_ref": payment_id})
        if quote or refund:
            st.session_state.manage_record = run_tool(
                "refund_payment", {"payment_ref": payment_id, "confirm": bool(refund)}
            )
            record = st.session_state.manage_record
            if record.ok and record.result["refunded"]:
                payments[payment_id] = {
                    **p,
                    "status": record.result["status"],
                    "refund_amount": record.result["amount"],
                }

        p = payments[payment_id]
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Trạng thái", STATUS_LABELS[p["status"]])
        c2.metric("Số tiền", vnd(p["amount"]))
        c3.metric("Hoàn lại", vnd(p.get("refund_amount")))
        c4.metric("Cập nhật", dmy_hm(p["updated_at"])[:5])

        record = st.session_state.get("manage_record")
        if record is not None and record.arguments.get("payment_ref") == payment_id:
            if not record.ok:
                show_error(record)
            elif record.tool == "refund_payment":
                (st.success if record.result["refunded"] else st.info)(record.result["message"])
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
        c3.metric("Gọi ZaloPay", sum(r.mode == "zalopay" for r in log))
        c4.metric("Độ trễ tool TB", f"{sum(r.tool_ms for r in log) // len(log)} ms")
        st.dataframe(
            [
                {
                    "Thời điểm": r.at.strftime("%H:%M:%S"),
                    "Cổng": "🌐 ZaloPay" if r.mode == "zalopay" else "🧪 mock",
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
            redact_secrets(
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
            )
            for r in log
        ]
        c1, c2 = st.columns(2)
        c1.download_button(
            "⬇️ Tải nhật ký (JSON, đã che bí mật)",
            json.dumps(export, ensure_ascii=False, indent=2),
            file_name=f"payment_api_log_{now_vn():%Y%m%d_%H%M%S}.json",
            mime="application/json",
        )
        if c2.button("🧹 Xóa nhật ký"):
            st.session_state.log = []
            st.rerun()
