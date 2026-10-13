from datetime import datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl

import httpx
from relohome_payment.settings import VN_TZ

# Bộ key GIẢ chỉ dùng trong test (không phải key sandbox công khai của ZaloPay)
TEST_APP_ID = 9999
TEST_KEY1 = "test-key1-not-a-real-secret-000000"
TEST_KEY2 = "test-key2-not-a-real-secret-000000"


class FakeClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 1, 9, 0, tzinfo=VN_TZ)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, minutes: int) -> None:
        self.now += timedelta(minutes=minutes)


class FakeZaloPay:
    """Giả lập sb-openapi.zalopay.vn: ghi lại mọi form gửi đi để kiểm tra không có dữ liệu cá nhân."""

    def __init__(self, query_code: int = 3, create_code: int = 1, status: int = 200) -> None:
        self.query_code = query_code
        self.create_code = create_code
        self.status = status
        self.forms: list[tuple[str, dict[str, str]]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        form = dict(parse_qsl(request.content.decode(), keep_blank_values=True))
        path = request.url.path.rsplit("/", 1)[-1]
        self.forms.append((path, form))
        if path == "create":
            body: dict[str, Any] = {
                "return_code": self.create_code,
                "return_message": "Giao dịch thành công" if self.create_code == 1 else "Giao dịch thất bại",
                "sub_return_code": 1 if self.create_code == 1 else -401,
                "order_url": "https://qcgateway.zalopay.vn/openinapp?order=abc",
                "qr_code": "00020101021226530010vn.zalopay",
                "zp_trans_token": "TOKEN_SHOULD_NOT_LEAK",
            }
        else:
            body = {"return_code": self.query_code, "return_message": "ok", "sub_return_code": 0}
        return httpx.Response(self.status, json=body)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self))
