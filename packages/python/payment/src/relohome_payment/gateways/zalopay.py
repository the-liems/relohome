import hashlib
import hmac
import json
import logging
import time
from typing import Any

import httpx

from relohome_payment.errors import GatewayUnavailableError
from relohome_payment.gateways.base import GatewayOrder, GatewayStatus
from relohome_payment.settings import PaymentSettings

REQUEST_TIMEOUT_SECONDS = 20.0
EMPTY_ITEMS = "[]"
# return_code của API query: 1 = thành công, 2 = thất bại, 3 = chưa thanh toán / đang xử lý
QUERY_STATUS: dict[int, GatewayStatus] = {1: "PAID", 2: "FAILED", 3: "PENDING"}

# Tránh log mức INFO của httpx; message lỗi cũng không bao giờ chứa key hay chữ ký.
logging.getLogger("httpx").setLevel(logging.WARNING)


def sign(key: str, *parts: object) -> str:
    """Chữ ký `mac` của ZaloPay: HMAC-SHA256(key, các trường nối bằng '|')."""
    return hmac.new(key.encode(), "|".join(str(p) for p in parts).encode(), hashlib.sha256).hexdigest()


class ZaloPayGateway:
    """ZaloPay Gateway API v2 (mặc định môi trường sandbox). Chỉ gửi các trường vô danh trong danh sách cho phép."""

    name = "zalopay"
    supports_cancel_refund = False

    def __init__(self, settings: PaymentSettings, client: httpx.AsyncClient | None = None) -> None:
        self._app_id = settings.zalopay_app_id
        self._key1 = settings.zalopay_key1
        self._endpoint = settings.zalopay_endpoint.rstrip("/")
        self._redirect_url = settings.redirect_url
        self._client = client

    async def create(
        self, gateway_ref: str, amount: int, app_user: str, description: str, expire_seconds: int
    ) -> GatewayOrder:
        app_time = int(time.time() * 1000)
        embed_data = json.dumps({"redirecturl": self._redirect_url})
        form = {
            "app_id": self._app_id,
            "app_trans_id": gateway_ref,
            "app_user": app_user,
            "app_time": app_time,
            # Cùng thời lượng vô danh với engine; tài liệu cổng không nêu rõ mốc bắt đầu.
            "expire_duration_seconds": expire_seconds,
            "amount": amount,
            "item": EMPTY_ITEMS,
            "embed_data": embed_data,
            "description": description,
            "bank_code": "",
        }
        form["mac"] = sign(self._key1, self._app_id, gateway_ref, app_user, amount, app_time, embed_data, EMPTY_ITEMS)
        data = await self._post("/create", form)
        if data.get("return_code") != 1:
            raise GatewayUnavailableError(f"ZaloPay từ chối tạo đơn: {_reason(data)}")
        return GatewayOrder(pay_url=data.get("order_url"), qr_code=data.get("qr_code"))

    async def query(self, gateway_ref: str) -> GatewayStatus:
        form = {
            "app_id": self._app_id,
            "app_trans_id": gateway_ref,
            "mac": sign(self._key1, self._app_id, gateway_ref, self._key1),
        }
        data = await self._post("/query", form)
        status = QUERY_STATUS.get(data.get("return_code"))  # type: ignore[arg-type]
        if status is None:
            raise GatewayUnavailableError(f"ZaloPay trả trạng thái không xác định: {_reason(data)}")
        return status

    async def _post(self, path: str, form: dict[str, Any]) -> dict[str, Any]:
        url = self._endpoint + path
        try:
            if self._client is not None:
                response = await self._client.post(url, data=form)
            else:
                async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                    response = await client.post(url, data=form)
        except httpx.TimeoutException as exc:
            raise GatewayUnavailableError("ZaloPay phản hồi quá chậm, hãy thử lại sau.") from exc
        except httpx.HTTPError as exc:
            raise GatewayUnavailableError("Không kết nối được ZaloPay.") from exc
        if response.status_code >= 400:
            raise GatewayUnavailableError(f"ZaloPay trả về HTTP {response.status_code}.")
        try:
            data = response.json()
        except ValueError as exc:
            raise GatewayUnavailableError("ZaloPay trả về dữ liệu không đọc được.") from exc
        if not isinstance(data, dict):
            raise GatewayUnavailableError("ZaloPay trả về dữ liệu không đọc được.")
        return data


def _reason(data: dict[str, Any]) -> str:
    """Lý do lỗi đọc được, chỉ lấy message và mã (không lấy token hay dữ liệu khác)."""
    message = data.get("sub_return_message") or data.get("return_message") or "không rõ"
    return f"{message} (return_code={data.get('return_code')}, sub_return_code={data.get('sub_return_code')})"
