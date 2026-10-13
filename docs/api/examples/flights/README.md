# Ví dụ request/response — Flight MCP server

Ví dụ thật từ server [`apps/flights-mcp`](../../../../apps/flights-mcp/README.md),
chạy với `FLIGHT_SEARCH_PROVIDER=mock` và đồng hồ cố định ở `2026-10-01 09:00 +07:00`.
Lý do chọn thiết kế: [ADR-012](../../../adr/ADR-012-flight-data-source.md),
[ADR-013](../../../adr/ADR-013-flight-mcp-server-layout.md).

> **Nguồn chuẩn của schema** là các model Pydantic trong
> [`schemas.py`](../../../../packages/python/flight/src/relohome_flight/schemas.py). Client lấy schema đầy đủ
> qua `tools/list` (`inputSchema`, `outputSchema`). File này chỉ là ví dụ minh họa, không
> chép lại schema. `booking_id`, PNR và số vé được sinh ngẫu nhiên nên mỗi lần chạy sẽ khác.

Mỗi ví dụ gồm:

- **Request**: `arguments` gửi trong `tools/call`.
- **Response**: `structuredContent` trả về. Nếu có lỗi thì response có `isError: true`, và nội dung lỗi nằm trong `content[0].text`.

Để dễ đọc, object `offer` lặp lại trong booking được rút gọn thành `{ … }`.

Luồng đầy đủ: [search_airports](#1-search_airports) →
[search_flights](#2-search_flights) → [get_offer](#3-get_offer) →
[hold_booking](#4-hold_booking) → *người dùng xác nhận* →
[confirm_booking](#5-confirm_booking) → [cancel_booking](#6-cancel_booking) ·
[Lỗi thường gặp](#7-lỗi-thường-gặp)

---

## 1. `search_airports`

Request:

```json
{ "query": "đà nẵng", "limit": 3 }
```

Response:

```json
{
  "result": [
    {
      "code": "DAD",
      "name": "Sân bay quốc tế Đà Nẵng",
      "city": "Đà Nẵng",
      "province": "Đà Nẵng",
      "aliases": ["Da Nang", "Danang"],
      "lat": 16.044,
      "lon": 108.199
    }
  ]
}
```

## 2. `search_flights`

Tìm chuyến một chiều HAN → DAD cho 1 người lớn và 1 trẻ em, lấy 2 kết quả rẻ nhất.
Mã sân bay viết thường vẫn được chấp nhận và tự đổi thành chữ in hoa.

Request:

```json
{
  "request": {
    "origin": "HAN",
    "destination": "DAD",
    "departure_date": "2026-10-10",
    "passengers": { "adults": 1, "children": 1 },
    "max_results": 2
  }
}
```

Các trường tùy chọn khác: `cabin_class` (`economy` | `premium_economy` | `business` | `first`),
`nonstop_only`, `sort_by` (`price` | `departure_time` | `duration`), `passengers.infants`.

Response:

```json
{
  "source": "mock",
  "offers": [
    {
      "offer_id": "off_mock_476998fd6730",
      "source": "mock",
      "segments": [
        {
          "flight_number": "VU126",
          "airline_code": "VU",
          "airline_name": "Vietravel Airlines",
          "origin": "HAN",
          "destination": "DAD",
          "departure_time": "2026-10-10T21:30:00+07:00",
          "arrival_time": "2026-10-10T22:50:00+07:00",
          "duration_minutes": 80,
          "aircraft": "Airbus A321"
        }
      ],
      "stops": 0,
      "total_duration_minutes": 80,
      "cabin_class": "economy",
      "passengers": { "adults": 1, "children": 1, "infants": 0 },
      "total_price": 1892000,
      "price_per_adult": 1081000,
      "currency": "VND",
      "seats_left": 9,
      "expires_at": "2026-10-01T09:30:00+07:00"
    },
    {
      "offer_id": "off_mock_fa2700c4ede2",
      "source": "mock",
      "segments": [
        {
          "flight_number": "VU481",
          "airline_code": "VU",
          "airline_name": "Vietravel Airlines",
          "origin": "HAN",
          "destination": "DAD",
          "departure_time": "2026-10-10T09:00:00+07:00",
          "arrival_time": "2026-10-10T10:20:00+07:00",
          "duration_minutes": 80,
          "aircraft": "Airbus A321"
        }
      ],
      "stops": 0,
      "total_duration_minutes": 80,
      "cabin_class": "economy",
      "passengers": { "adults": 1, "children": 1, "infants": 0 },
      "total_price": 1894000,
      "price_per_adult": 1082000,
      "currency": "VND",
      "seats_left": 9,
      "expires_at": "2026-10-01T09:30:00+07:00"
    }
  ],
  "message": "Tìm thấy 2 chuyến (nguồn: mock)."
}
```

`total_price` là tổng cho mọi hành khách: trẻ em 75%, em bé 10% giá người lớn
(1.081.000 + 0,75 × 1.081.000 ≈ 1.892.000). Với `serpapi`, trường `source` là `"serpapi"`,
`price_per_adult` và `seats_left` là `null`, và một offer có thể có nhiều `segments`
(`stops` > 0).

## 3. `get_offer`

Request:

```json
{ "offer_id": "off_mock_476998fd6730" }
```

Response:

```json
{
  "offer": { … },
  "fare_rules": {
    "checked_baggage_kg": 20,
    "carry_on_kg": 7,
    "changeable": true,
    "change_fee": 350000,
    "refundable": false,
    "cancel_fee": null
  }
}
```

## 4. `hold_booking`

Bước 1/2: giữ chỗ, **chưa xuất vé**. Tên được chuẩn hóa về dạng viết hoa, không dấu. Số khách
từng loại phải khớp với offer, và tuổi tính tại ngày bay phải đúng loại khách.

Request:

```json
{
  "request": {
    "offer_id": "off_mock_476998fd6730",
    "passengers": [
      {
        "type": "adult",
        "title": "MR",
        "first_name": "Văn An",
        "last_name": "Nguyễn",
        "date_of_birth": "1990-01-01",
        "id_number": "001090000001"
      },
      {
        "type": "child",
        "title": "MSTR",
        "first_name": "Minh",
        "last_name": "Nguyễn",
        "date_of_birth": "2019-05-05"
      }
    ],
    "contact": { "email": "an.nguyen@example.com", "phone": "0901234567" }
  }
}
```

Response:

```json
{
  "booking_id": "bk_e8dec598ce1c",
  "pnr": "P5BR3A",
  "status": "HELD",
  "offer": { … },
  "passengers": [
    {
      "type": "adult",
      "title": "MR",
      "first_name": "VAN AN",
      "last_name": "NGUYEN",
      "date_of_birth": "1990-01-01",
      "id_number": "001090000001"
    },
    {
      "type": "child",
      "title": "MSTR",
      "first_name": "MINH",
      "last_name": "NGUYEN",
      "date_of_birth": "2019-05-05",
      "id_number": null
    }
  ],
  "contact": { "email": "an.nguyen@example.com", "phone": "0901234567" },
  "total_price": 1892000,
  "currency": "VND",
  "hold_expires_at": "2026-10-01T09:15:00+07:00",
  "ticket_numbers": [],
  "cancel_fee": null,
  "refund_amount": null,
  "created_at": "2026-10-01T09:00:00+07:00",
  "updated_at": "2026-10-01T09:00:00+07:00"
}
```

Agent phải trình bày tóm tắt cho người dùng (chuyến, giờ bay, hành khách, tổng tiền, hạn giữ
chỗ), rồi **chờ người dùng xác nhận** trước khi sang bước 5. Gọi lại với cùng offer và cùng
hành khách sẽ trả về đúng booking này, không tạo thêm booking giữ chỗ mới.

## 5. `confirm_booking`

Bước 2/2: xuất vé (giả lập). `booking_ref` nhận `booking_id` hoặc PNR, không phân biệt hoa thường.

Request:

```json
{ "booking_ref": "P5BR3A" }
```

Response (chỉ liệt kê các trường thay đổi so với bước 4):

```json
{
  "booking_id": "bk_e8dec598ce1c",
  "pnr": "P5BR3A",
  "status": "TICKETED",
  "hold_expires_at": null,
  "ticket_numbers": ["891-4641079196", "891-4933260069"],
  "…": "các trường khác giữ nguyên"
}
```

Gọi lại lần nữa sẽ trả về cùng các `ticket_numbers`, không xuất trùng vé.
`get_booking` trả về cùng dạng dữ liệu này.

## 6. `cancel_booking`

Luôn gọi `confirm=false` trước để báo phí hủy cho người dùng.

Request:

```json
{ "booking_ref": "P5BR3A" }
```

Response:

```json
{
  "booking_id": "bk_e8dec598ce1c",
  "pnr": "P5BR3A",
  "status": "TICKETED",
  "cancelled": false,
  "cancel_fee": 1892000,
  "refund_amount": 0,
  "currency": "VND",
  "message": "Hạng vé không hoàn tiền. Gọi lại với confirm=true để hủy."
}
```

Khi người dùng đồng ý thì gọi lại với `confirm=true`.

Request:

```json
{ "booking_ref": "P5BR3A", "confirm": true }
```

Response:

```json
{
  "booking_id": "bk_e8dec598ce1c",
  "pnr": "P5BR3A",
  "status": "CANCELLED",
  "cancelled": true,
  "cancel_fee": 1892000,
  "refund_amount": 0,
  "currency": "VND",
  "message": "Đã hủy. Hạng vé không hoàn tiền."
}
```

Booking còn ở trạng thái `HELD` (chưa xuất vé) thì hủy miễn phí. Vé hoàn được (ví dụ Vietnam
Airlines hạng phổ thông) bị trừ `cancel_fee` × số khách, phần còn lại trả vào `refund_amount`.

## 7. Lỗi thường gặp

Lỗi được trả về dưới dạng `isError: true`, nội dung nằm trong `content[0].text`. Message viết
sẵn để LLM đọc được và biết bước tiếp theo.

| Tình huống | Tool | `content[0].text` |
|---|---|---|
| Sân bay ngoài danh sách nội địa | `search_flights` | `Error executing tool search_flights: Sân bay 'BKK' không nằm trong danh sách nội địa Việt Nam được hỗ trợ. Dùng search_airports để tra mã IATA.` |
| Số khách không khớp offer | `hold_booking` | `Error executing tool hold_booking: Offer dành cho 1 người lớn, 1 trẻ em, 0 em bé nhưng nhận 1/0/0. Hãy tìm lại với đúng số khách.` |
| Offer quá `FLIGHT_OFFER_TTL_MINUTES` | `get_offer`, `hold_booking` | `… Offer 'off_mock_…' đã hết hạn. Hãy gọi search_flights để lấy giá mới.` |
| Giữ chỗ quá `FLIGHT_HOLD_MINUTES` | `confirm_booking` | `Error executing tool confirm_booking: Booking WRRHSN đang ở trạng thái EXPIRED, không thể xuất vé. Hãy tìm chuyến và giữ chỗ lại.` |
| Sai `booking_ref` | `get_booking`, `confirm_booking`, `cancel_booking` | `… Không tìm thấy booking 'NOPE00'.` |
| Ngày bay đã qua | `search_flights` | `… Ngày bay 2026-09-30 đã qua (hôm nay là 2026-10-01).` |
| SerpApi hết lượt | `search_flights` | `… Đã hết lượt gọi SerpApi. Chuyển FLIGHT_SEARCH_PROVIDER=mock để tiếp tục demo.` |

Nếu dữ liệu đầu vào sai kiểu (sai định dạng ngày, email, số điện thoại, tên có chữ số…),
Pydantic sẽ trả lỗi validation kèm tên trường bị sai.
