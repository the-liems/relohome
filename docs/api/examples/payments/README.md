# Ví dụ request/response — payment MCP server

Ví dụ lấy từ lần chạy thật ngày 2026-09-26 (ZaloPay sandbox) và chế độ mock. Mã ngẫu nhiên sẽ khác mỗi lần.
Schema chuẩn do MCP tự sinh từ `packages/python/payment/src/relohome_payment/schemas.py`; file này chỉ minh họa.

## create_payment

Request (`tools/call`):

```json
{ "name": "create_payment", "arguments": { "order_ref": "bk_demo01", "amount": 10000, "customer_ref": "cust_demo01" } }
```

Response (ZaloPay sandbox):

```json
{
  "payment_id": "pay_d159ca7002f3",
  "order_ref": "bk_demo01",
  "gateway_ref": "260926_P044_2ad7bebc",
  "provider": "zalopay",
  "amount": 10000,
  "currency": "VND",
  "status": "PENDING",
  "pay_url": "https://qcgateway.zalopay.vn/openinapp?order=...",
  "qr_code": "00020101021226530010vn.zalopay...",
  "expires_at": "2026-09-26T13:10:00+07:00",
  "refund_amount": null,
  "created_at": "2026-09-26T12:55:00+07:00",
  "updated_at": "2026-09-26T12:55:00+07:00"
}
```

Form server thực sự gửi tới `https://sb-openapi.zalopay.vn/v2/create` (bắt từ lần chạy thật, `mac` đã che).
Không có `bk_demo01`, `cust_demo01` hay dữ liệu cá nhân nào:

```json
{
  "app_id": "2553",
  "app_trans_id": "260926_P044_2ad7bebc",
  "app_user": "60036ee5d10a9d02",
  "app_time": "1790401955851",
  "amount": "10000",
  "item": "[]",
  "embed_data": "{\"redirecturl\": \"http://localhost:8502/\"}",
  "description": "P044 demo 260926_P044_2ad7bebc",
  "bank_code": "",
  "mac": "***"
}
```

## get_payment

```json
{ "name": "get_payment", "arguments": { "payment_ref": "pay_d159ca7002f3" } }
```

Trả `Payment` như trên với `status` mới. Với đơn PENDING, server gửi `/v2/query` gồm đúng 3 trường
`app_id`, `app_trans_id`, `mac`. `return_code` 1 → `PAID`, 2 → `FAILED`, 3 → vẫn `PENDING`.

## Lỗi: truyền dữ liệu cá nhân

```json
{ "name": "create_payment", "arguments": { "order_ref": "an.nguyen@gmail.com", "amount": 20000 } }
```

```text
isError: true
Error executing tool create_payment: 'order_ref' phải là mã nội bộ vô danh (chữ, số, gạch, tối đa 30 ký tự;
không chứa email, số điện thoại hay số giấy tờ). Ví dụ: bk_1a2b3c.
```

Message không in lại giá trị đã gửi, và không có request nào tới ZaloPay.

## Chỉ ở mock: simulate_payment_result → refund_payment

```json
{ "name": "simulate_payment_result", "arguments": { "payment_ref": "pay_500c3c762fd6", "outcome": "PAID" } }
{ "name": "refund_payment", "arguments": { "payment_ref": "pay_500c3c762fd6", "confirm": false } }
```

```json
{ "payment_id": "pay_500c3c762fd6", "status": "PAID", "refunded": false, "amount": 150000, "currency": "VND",
  "message": "Sẽ hoàn 150,000 VND. Gọi lại với confirm=true để hoàn." }
```

Gọi lại với `"confirm": true` → `"status": "REFUNDED"`, `"refunded": true`.
