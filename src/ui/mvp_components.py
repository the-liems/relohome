"""Small Streamlit controls. Credentials stay in the server-side API client."""

import io
import os
import uuid
from urllib.parse import urlparse

import httpx
import segno
import streamlit as st

BASE = os.getenv("LIFEFLOW_API_BASE_URL", "http://127.0.0.1:8000/api/v1").rstrip("/")


def api(headers, method, path, body=None):
    try:
        response = httpx.request(method, BASE + path, headers=headers, json=body, timeout=240)
        if not response.is_success:
            message = response.json().get("detail", "Yêu cầu chưa hoàn tất")
            st.error(
                f"HTTP {response.status_code}: {message if isinstance(message, str) else 'Dữ liệu gửi chưa hợp lệ'}"
            )
            return None
        return response.json()
    except (httpx.RequestError, ValueError):
        st.error("Chưa nhận được kết quả. Kiểm tra trạng thái trước khi thử lại; không tự tạo lại giao dịch.")
        return None


def remember(payload):
    if payload:
        st.session_state.thread_id = payload["thread_id"]
        st.session_state.history.append(("assistant", payload))
        st.session_state.pending = payload.get("confirmation")


def confirmation_controls(headers, enabled):
    pending = st.session_state.get("pending")
    if not pending:
        return
    st.subheader("Xác nhận thao tác sandbox")
    st.dataframe(pending["cost_summary"]["lines"], hide_index=True, use_container_width=True)
    st.caption("Báo giá hết hạn: " + pending["expires_at"])
    for note in pending.get("notes", {}).values():
        st.warning(note)
    if pending.get("last_error"):
        st.error(pending["last_error"])
    decision = {"plan_version": pending["plan_version"], "payload_hash": pending["payload_hash"]}
    thread = st.session_state.thread_id
    with st.form("confirm_" + pending["payload_hash"], clear_on_submit=True):
        forms = {}
        for action, fields in pending.get("pii_required", {}).items():
            form = {}
            for field in fields:
                if field in {"pickup_contact", "destination_contact"}:
                    label = "Liên hệ điểm lấy" if field == "pickup_contact" else "Liên hệ điểm giao"
                    st.caption(label + " — chỉ gửi tới backend/provider, không đưa vào LLM")
                    form[field] = {
                        "name": st.text_input(label + " — tên", key=action + field + "name"),
                        "mobile": st.text_input(label + " — số điện thoại", key=action + field + "phone"),
                    }
                elif field == "order_update":
                    st.caption("Cập nhật liên hệ/ghi chú; không thay đổi tuyến hoặc COD")
                    update = {
                        "path_index": st.number_input(
                            "Chỉ số điểm (0: lấy, 1: giao)", min_value=0, max_value=50, value=1, key=action + "index"
                        )
                    }
                    for key, label in (
                        ("name", "Tên mới"),
                        ("mobile", "Số điện thoại mới"),
                        ("remarks", "Ghi chú mới"),
                    ):
                        value = st.text_input(label, key=action + key)
                        if value:
                            update[key] = value
                    form[field] = update
            forms[action] = form
        agreed = st.checkbox("Tôi đồng ý thực hiện đúng thao tác, phương án và chi phí ở trên trong SANDBOX")
        submitted = st.form_submit_button("Xác nhận thực hiện sandbox", disabled=not enabled)
    if submitted:
        if not agreed:
            st.warning("Cần xác nhận rõ ràng trước khi gửi.")
        else:
            result = api(
                headers, "POST", f"/chat/{thread}/decision", {**decision, "kind": "CONFIRM", "pii_forms": forms}
            )
            if result:
                remember(result)
                st.rerun()
    left, right = st.columns(2)
    if left.button("Không thực hiện / dừng phương án"):
        result = api(headers, "POST", f"/chat/{thread}/decision", {**decision, "kind": "CANCEL"})
        if result:
            remember(result)
            st.rerun()
    change = right.text_input("Đổi phương án / chọn dịch vụ khác")
    if right.button("Gửi thay đổi") and change:
        result = api(
            headers, "POST", f"/chat/{thread}/decision", {**decision, "kind": "CHANGE", "change_request": change}
        )
        if result:
            remember(result)
            st.rerun()


def payment_demo(headers, enabled):
    st.subheader("ZaloPay sandbox")
    st.info("Đây là kiểm thử thanh toán riêng, KHÔNG thu tiền cho đơn AhaMove CASH và KHÔNG xuất vé máy bay.")
    st.caption(
        "Chỉ mở bằng ứng dụng/tài khoản sandbox. Hủy/hoàn ZaloPay chưa được adapter hiện tại hỗ trợ; không giả lập thành công."
    )
    st.session_state.setdefault("payment_request_id", str(uuid.uuid4()))
    with st.form("sandbox_payment"):
        amount = st.number_input("Số tiền thử (VND)", min_value=1000, max_value=100000, value=1000, step=1000)
        agreed = st.checkbox("Tôi xác nhận tạo yêu cầu thanh toán sandbox với số tiền này")
        create = st.form_submit_button("Tạo link/QR sandbox", disabled=not enabled)
    if create:
        if agreed:
            result = api(
                headers,
                "POST",
                "/sandbox/payments",
                {"request_id": st.session_state.payment_request_id, "amount_vnd": amount, "confirmed": True},
            )
            if result:
                st.session_state.payment = result
        else:
            st.warning("Cần xác nhận trước khi tạo yêu cầu thanh toán.")
    payment = st.session_state.get("payment")
    if not payment:
        return
    st.write("Mã:", payment["payment_id"], "— Trạng thái:", payment["status"])
    st.write("Số tiền:", payment["amount"], "VND · Hạn:", payment["expires_at"])
    link = payment.get("pay_url")
    if link and urlparse(link).scheme == "https":
        st.link_button("Mở trang thanh toán sandbox", link)
    if payment.get("qr_code"):
        buffer = io.BytesIO()
        segno.make(payment["qr_code"]).save(buffer, kind="png", scale=5)
        st.image(buffer.getvalue(), caption="QR từ ZaloPay sandbox", width=240)
    if st.button("Kiểm tra trạng thái từ ZaloPay"):
        result = api(headers, "GET", "/sandbox/payments/" + payment["payment_id"])
        if result:
            st.session_state.payment = result
            st.rerun()
    if payment["status"] in {"FAILED", "EXPIRED", "CANCELLED", "REFUNDED"} and st.button("Bắt đầu yêu cầu mới"):
        st.session_state.payment_request_id = str(uuid.uuid4())
        st.session_state.pop("payment", None)
        st.rerun()
