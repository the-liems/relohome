# Payment MCP server — Thanh toán VND (mock / ZaloPay sandbox)

MCP server cho phép agent **tạo yêu cầu thanh toán, kiểm tra trạng thái, hủy và hoàn tiền**.
Cùng khuôn mẫu với [flight MCP server](../flights/README.md).

Tài liệu liên quan:
[ADR-015 — ZaloPay và bảo vệ dữ liệu cá nhân](../../docs/adr/ADR-015-zalopay-payment-and-data-privacy.md) ·
[ADR-014 — MCP server đóng gói Docker](../../docs/adr/ADR-014-containerized-mcp-servers.md) ·
[Ví dụ request/response](../../docs/api/examples/payments/README.md)

> ⚠️ **Chỉ có môi trường thử nghiệm, không có tiền thật.** ZaloPay sandbox dùng một merchant **chung cho mọi
> lập trình viên**, nên mọi thứ gửi lên coi như công khai. Server được thiết kế để **không bao giờ gửi dữ liệu
> cá nhân** (xem mục Bảo vệ dữ liệu cá nhân).

## Bắt đầu nhanh (không cần key)

```bash
source .venv/bin/activate
pip install -r requirements.txt
pytest tests/test_mcp_payments -q
export PAYMENT_MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
# Start in a separate terminal with the same token; leave it running:
PAYMENT_PROVIDER=mock python -m relohome_payments_mcp
make ui-payment            # giao diện demo tại http://localhost:8502
```

## Cấu trúc

```text
apps/payments-mcp/                    # pyproject.toml, Dockerfile, requirements.txt
└── src/relohome_payments_mcp/         # __main__, server, tools
packages/python/payment/src/relohome_payment/
├── engine.py, privacy.py, schemas.py, settings.py, storage.py, errors.py
└── gateways/                        # base, mock, zalopay
```


## Cấu hình (`.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PAYMENT_PROVIDER` | `mock` | `mock` hoặc `zalopay` |
| `PAYMENT_ZALOPAY_APP_ID`, `PAYMENT_ZALOPAY_KEY1`, `PAYMENT_ZALOPAY_KEY2` | trống | Bộ key sandbox lấy từ trang tài liệu ZaloPay |
| `PAYMENT_ORDER_PREFIX` | `P044` | Tiền tố nhóm trong mã đơn |
| `PAYMENT_ZALOPAY_ENDPOINT` | `https://sb-openapi.zalopay.vn/v2` | Endpoint sandbox |
| `PAYMENT_REDIRECT_URL` | `http://localhost:8502/` | Nơi ZaloPay đưa khách quay lại |
| `PAYMENT_PSEUDONYM_SALT` | trống | Trống = tự sinh một lần và lưu trong SQLite |
| `PAYMENT_EXPIRE_MINUTES` | `15` | Hạn thanh toán của một đơn |
| `PAYMENT_RETENTION_DAYS` | `30` | Xóa bản ghi cũ hơn số ngày này |
| `PAYMENT_DB_PATH` | `./data/payments.db` | File SQLite |
| `MCP_AUTH_TOKEN` | required | Service bearer token, at least 32 ASCII token characters; clients use `PAYMENT_MCP_AUTH_TOKEN` |
| `PAYMENT_MCP_HOST`, `PAYMENT_MCP_PORT` | `127.0.0.1`, `8766` | Khi chạy Streamable HTTP |

**Quy tắc giữ key:** chỉ điền trong `.env` (đã bị `.gitignore`), không commit, không dán vào khung chat AI
(hook ghi log AI của repo gửi nội dung prompt lên server chấm điểm mỗi lần `git push`). Có test báo lỗi nếu
`.env.example` chứa key.

## Bảo vệ dữ liệu cá nhân

| Trường gửi ZaloPay | Giá trị | Không bao giờ gửi |
|---|---|---|
| `app_trans_id` | `yymmdd_P044_<8 hex ngẫu nhiên>` | PNR, booking_id, tên, email, SĐT |
| `app_user` | Mã băm có muối của `customer_ref` | Tên, email, SĐT thật |
| `amount` | Số tiền VND | — |
| `expire_duration_seconds` | `PAYMENT_EXPIRE_MINUTES × 60` (mặc định `900`) | Dữ liệu khách hàng |
| `description` | `"P044 demo <mã đơn>"` (cố định) | Văn bản tự do |
| `item` / `embed_data` | `"[]"` / chỉ `redirecturl` | Mọi dữ liệu người dùng |

`expire_duration_seconds` là thời hạn cấu hình của đơn, không chứa dữ liệu cá nhân.
Server gửi cùng thời lượng dùng để tính `expires_at` cục bộ, thay vì dựa vào thời hạn mặc định của merchant.
Engine tính thời hạn cục bộ từ `now` trước khi gọi gateway. Gateway gửi `app_time` lấy trước khi gửi HTTP,
nhưng tài liệu ZaloPay không nêu rõ mốc bắt đầu thời hạn ở cổng; hai thời điểm hết hạn tuyệt đối không bảo đảm trùng nhau.
[API tạo đơn ZaloPay](https://docs.zalopay.vn/docs/specs/order-create/) hỗ trợ từ `300` đến `2592000` giây;
`PAYMENT_EXPIRE_MINUTES` cho phép từ `5` đến `1440` phút, nằm trong giới hạn này.

- `order_ref`, `customer_ref` phải là mã nội bộ vô danh (`bk_1a2b3c`); có `@` hoặc dãy từ 9 chữ số là bị từ
  chối, và **message lỗi không in lại giá trị** đã gửi.
- Chỉ tra cứu được mã đơn có trong DB của nhóm; mã lạ không bao giờ được gửi sang ZaloPay.
- DB không lưu `customer_ref`; bản ghi cũ tự xóa sau `PAYMENT_RETENTION_DAYS`.
- Giao diện demo không có ô nhập tên/email/SĐT; QR vẽ ngay trên máy (không gửi cho dịch vụ vẽ QR bên ngoài);
  nhật ký tải về đã che `mac`/`key`/`token`.

## Tool

| Tool | Việc | Ghi chú |
|---|---|---|
| `create_payment(order_ref, amount, customer_ref="guest")` | Tạo đơn PENDING, trả `pay_url`, `qr_code`, hạn | Gọi lại cùng `order_ref` + `amount` trả đơn cũ |
| `get_payment(payment_ref)` | Trạng thái | Đơn PENDING được hỏi lại cổng; quá hạn thành EXPIRED |
| `cancel_payment(payment_ref)` | Hủy đơn PENDING | ZaloPay không có API hủy: báo giờ đơn tự hết hạn |
| `refund_payment(payment_ref, confirm=false)` | Báo rồi mới hoàn | Mock đầy đủ; ZaloPay chưa hỗ trợ trong MVP |
| `simulate_payment_result(payment_ref, outcome)` | Giả lập `PAID` / `FAILED` / `EXPIRED` cho giao dịch đang PENDING | **Chỉ có khi `PAYMENT_PROVIDER=mock`**; `/health` trả `"simulation": true` |

## Chạy server

```bash
python -m relohome_payments_mcp                               # HTTP service at :8766/mcp
python -m relohome_payments_mcp --transport streamable-http   # http://127.0.0.1:8766/mcp

# Docker (image không chứa key; key truyền lúc chạy)
make mcp-up                                   # cả flights-mcp và payments-mcp
curl localhost:8766/health                    # {"status":"ok","server":"vn-payment","provider":"mock","simulation":true}
docker run --rm -p 8766:8766 --env-file .env payments-mcp
```

Agent LangGraph: the backend's `McpToolClient` (`apps/agent-api/src/relohome_agent/services/adapters/mcp.py`) connects over HTTP using `PAYMENT_MCP_URL` from `ServiceRegistry`. Provider credentials and SQLite state belong to the Payment service. Set `MCP_AUTH_TOKEN` on the service and the matching `PAYMENT_MCP_AUTH_TOKEN` on the client to authenticate internal requests.

## Giới hạn

- Chưa xác minh cách trả xong một đơn sandbox (có thể cần app ZaloPay bản sandbox). Vòng đời đầy đủ demo bằng mock.
- Chưa có callback (dùng polling), chưa hoàn tiền/hủy qua ZaloPay, chưa nối vào `confirm_booking` của flights.
