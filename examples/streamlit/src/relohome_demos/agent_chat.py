"""Local integrated chat. API credential stays server-side; not a public gateway."""

import os
import uuid

import httpx
import streamlit as st
from relohome_demos.map_picker import selected_house_pin, shared_map_picker
from relohome_demos.mvp_components import BASE, api, confirmation_controls, payment_demo, remember

st.set_page_config(page_title="ReloHome — local integration", page_icon="🏠")
st.title("ReloHome")
st.caption("Local MVP · dữ liệu thật + API sandbox · không giao dịch production")
token = os.environ.get("AGENT_API_TOKEN", "")
if not token:
    st.error("Khởi chạy bằng scripts/local-integration.py ui để nạp cấu hình riêng.")
    st.stop()
base = BASE
st.session_state.setdefault("user_id", "local_" + uuid.uuid4().hex)
st.session_state.setdefault("history", [])
st.session_state.setdefault("thread_id", None)
headers = {"Authorization": "Bearer " + token, "X-User-Id": st.session_state.user_id}
status = api(headers, "GET", "/status") or {}
page = st.sidebar.radio("Chức năng", ["Chat đa dịch vụ", "ZaloPay sandbox", "Trạng thái & kế hoạch"])
st.sidebar.caption("Flight: tìm chuyến thật; chưa có xuất vé thật. Moving: trả tiền mặt.")
if page == "ZaloPay sandbox":
    payment_demo(headers, status.get("sandbox_payments_enabled", False))
    st.stop()
if page == "Trạng thái & kế hoạch":
    st.json(status)
    if st.session_state.thread_id:
        state = api(headers, "GET", f"/chat/{st.session_state.thread_id}/state")
        if state:
            st.json(state)
            if st.button("Khôi phục phương án đang chờ"):
                st.session_state.pending = state.get("pending")
                st.info("Đã tải lại. Mở Chat đa dịch vụ để xác nhận.")
    st.stop()

if st.sidebar.button("Hội thoại mới"):
    st.session_state.history = []
    st.session_state.thread_id = None
    st.session_state.pending = None
    st.session_state.pickup_confirmed = False
    st.session_state.destination_confirmed = False
    st.session_state.housing_pin = None
    st.session_state.queued_prompt = None
    st.rerun()
st.sidebar.caption("Không nhập API key, thông tin thanh toán hay số điện thoại trong chat.")
pins = {}
selected_house_pin(headers)
shared_map_picker(headers)


def clear_pin_confirmation(endpoint):
    st.session_state[endpoint + "_confirmed"] = False


with st.sidebar.expander("Xác nhận điểm lấy/giao cho Moving"):
    st.caption("Chỉ dùng tọa độ bạn đã kiểm tra trên bản đồ, không đoán. Đổi địa chỉ thì xác nhận lại điểm.")
    for endpoint, label in (("pickup", "Điểm lấy"), ("destination", "Điểm giao")):
        address = st.text_input(
            label + " — địa chỉ",
            key=endpoint + "_address",
            on_change=clear_pin_confirmation,
            args=(endpoint,),
        )
        lat = st.number_input(
            label + " — vĩ độ",
            min_value=-90.0,
            max_value=90.0,
            value=None,
            format="%.7f",
            key=endpoint + "_lat",
            on_change=clear_pin_confirmation,
            args=(endpoint,),
        )
        lng = st.number_input(
            label + " — kinh độ",
            min_value=-180.0,
            max_value=180.0,
            value=None,
            format="%.7f",
            key=endpoint + "_lng",
            on_change=clear_pin_confirmation,
            args=(endpoint,),
        )
        confirmed = st.checkbox("Tôi xác nhận " + label.lower(), key=endpoint + "_confirmed")
        if confirmed and address and lat is not None and lng is not None:
            pins[endpoint] = {"address": address, "lat": lat, "lng": lng, "confirmed": True}


def display(payload):
    response = payload.get("response") or {}
    text = response.get("text") or response.get("message")
    if text:
        st.markdown(text)
    for question in response.get("questions", []):
        if question.get("text") not in (text or ""):
            st.info(question.get("text", "Cần thêm thông tin"))
        if question.get("options"):
            st.caption("Lựa chọn: " + " · ".join(question["options"]))
    if payload.get("status") == "pending_confirmation":
        st.warning("Phương án đang chờ xác nhận ở form bên dưới. Chưa có thao tác đặt/hủy nào được thực hiện.")
    with st.expander("Chi tiết kết quả và nguồn"):
        st.json(payload)


for role, value in st.session_state.history:
    with st.chat_message(role):
        if role == "user":
            st.write(value)
        else:
            display(value)

typed_prompt = st.chat_input("Ví dụ: Tìm phòng tại Quận 10, Thành phố Hồ Chí Minh dưới 5 triệu")
if prompt := typed_prompt or st.session_state.pop("queued_prompt", None):
    st.session_state.history.append(("user", prompt))
    with st.chat_message("user"):
        st.write(prompt)
    with st.chat_message("assistant"), st.spinner("Đang xử lý yêu cầu..."):
        try:
            reply = httpx.post(
                base + "/chat",
                headers=headers,
                json={
                    "message": prompt,
                    "thread_id": st.session_state.thread_id,
                    "moving_locations": pins or None,
                    "housing_location": st.session_state.pop("housing_pin", None),
                },
                timeout=240,
            )
            reply.raise_for_status()
            payload = reply.json()
            remember(payload)
            display(payload)
        except httpx.HTTPStatusError as exc:
            st.error(f"API trả mã {exc.response.status_code}. Kiểm tra trạng thái dịch vụ; không tự gửi lại giao dịch.")
        except httpx.RequestError:
            st.error(
                "Chưa nhận được phản hồi API. Kiểm tra tiến trình local và trạng thái hội thoại trước khi thử lại."
            )

confirmation_controls(headers, status.get("writes_enabled", False))
