# Payment MCP server — Thanh toán VND (mock / ZaloPay sandbox)

MCP server cho phép agent **tạo yêu cầu thanh toán, kiểm tra trạng thái, hủy và hoàn tiền**.
Cùng khuôn mẫu với [flight MCP server](../flights/README.md).

Tài liệu liên quan:
[ADR-007 — ZaloPay và bảo vệ dữ liệu cá nhân](../../../docs/adr/ADR-007-zalopay-payment-and-data-privacy.md) ·
[ADR-006 — MCP server đóng gói Docker](../../../docs/adr/ADR-006-containerized-mcp-servers.md) ·
[Ví dụ request/response](../../../docs/api/examples/payments/README.md)

> ⚠️ **Chỉ có môi trường thử nghiệm, không có tiền thật.** ZaloPay sandbox dùng một merchant **chung cho mọi
> lập trình viên**, nên mọi thứ gửi lên coi như công khai. Server được thiết kế để **không bao giờ gửi dữ liệu
> cá nhân** (xem mục Bảo vệ dữ liệu cá nhân).

## Bắt đầu nhanh (không cần key)

```bash
source .venv/bin/activate
pip install -r requirements.txt
pytest tests/test_mcp_payments -q
make ui-payment            # giao diện demo tại http://localhost:8502
```

## Cấu trúc

```text
src/mcp_servers/payments/
├── __main__.py        # python -m src.mcp_servers.payments
├── server.py          # create_server(): đăng ký tool, /health
├── tools.py           # PaymentTools (docstring = mô tả cho LLM)
├── engine.py          # vòng đời giao dịch + nơi DUY NHẤT tạo dữ liệu gửi cho cổng
├── privacy.py         # chặn dữ liệu cá nhân, mã đơn có tiền tố nhóm, mã giả danh, che bí mật
├── schemas.py         # Payment, RefundResult
├── settings.py        # PaymentSettings: biến môi trường PAYMENT_*
├── storage.py         # SQLite: giao dịch + muối giả danh
├── errors.py
├── gateways/
│   ├── base.py        # Protocol PaymentGateway
│   ├── mock.py        # offline
│   └── zalopay.py     # ZaloPay API v2 (create, query), ký HMAC-SHA256
├── Dockerfile  requirements.txt
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
| `description` | `"P044 demo <mã đơn>"` (cố định) | Văn bản tự do |
| `item` / `embed_data` | `"[]"` / chỉ `redirecturl` | Mọi dữ liệu người dùng |

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
| `simulate_payment_result(payment_ref, outcome)` | Giả lập PAID/FAILED | **Chỉ có khi `PAYMENT_PROVIDER=mock`** |

## Chạy server

```bash
python -m src.mcp_servers.payments                               # stdio
python -m src.mcp_servers.payments --transport streamable-http   # http://127.0.0.1:8766/mcp

# Docker (image không chứa key; key truyền lúc chạy)
make mcp-up                                   # cả flights-mcp và payments-mcp
curl localhost:8766/health                    # {"status":"ok","server":"vn-payment","provider":"mock"}
docker run --rm -p 8766:8766 --env-file .env payments-mcp
```

Agent LangGraph: `src/agents/tools/payment_mcp.py` (stdio mặc định, đặt `PAYMENT_MCP_URL` để gọi container).

## Giới hạn

- Chưa xác minh cách trả xong một đơn sandbox (có thể cần app ZaloPay bản sandbox). Vòng đời đầy đủ demo bằng mock.
- Chưa có callback (dùng polling), chưa hoàn tiền/hủy qua ZaloPay, chưa nối vào `confirm_booking` của flights.
