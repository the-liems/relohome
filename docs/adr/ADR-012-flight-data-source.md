# ADR-012: Nguồn dữ liệu chuyến bay nội địa — SerpApi để tìm chuyến, đặt vé giả lập

**Ngày:** 2026-09-25
**Trạng thái:** Proposed (chờ nhóm review trong PR; chuyển thành Accepted khi merge)
**Liên quan:** [ADR-013](ADR-013-flight-mcp-server-layout.md) ·
[README flight MCP server](../../src/mcp_servers/flights/README.md) ·
[Ví dụ request/response](../api/examples/flights/README.md)

## Bối cảnh (Context)

Agent cần tìm và đặt vé máy bay **nội địa Việt Nam**: HAN, SGN, DAD, PQC… với Vietnam
Airlines, Vietjet, Bamboo Airways, Vietravel Airlines, Sun PhuQuoc Airways. Nhóm cần một nguồn dữ liệu có
chi phí 0 để phát triển và demo, dùng được từ Việt Nam, và không tạo vé thật khi agent thao tác.
`docs/project-organization.md` cũng yêu cầu giữ service execution ở dạng mock cho đến khi có
đủ cơ chế kiểm soát side effect (milestone M2).

## Các lựa chọn (Alternatives)

### Lựa chọn 1: Duffel API (test mode)
- Ưu điểm: API đặt vé hoàn chỉnh (offer → order → cancel), có sandbox miễn phí, có nội dung Vietnam Airlines qua Travelport.
- Nhược điểm: theo tìm hiểu của nhóm, **Duffel chưa hỗ trợ doanh nghiệp/tài khoản tại Việt Nam** (Việt Nam không có trong danh sách quốc gia hỗ trợ). Sandbox chỉ trả về hãng giả "Duffel Airways", nên dữ liệu không phản ánh các chặng nội địa.

### Lựa chọn 2: Amadeus Self-Service API
- Ưu điểm: Trước đây là lựa chọn phổ biến nhất cho sinh viên, có flight search, pricing và booking.
- Nhược điểm: **Amadeus đã đóng cổng Self-Service ngày 17/07/2026** và ngừng nhận đăng ký từ 03/2026. API key cũ không còn dùng được.

### Lựa chọn 3: API trực tiếp của hãng hoặc đại lý B2B Việt Nam
- Ưu điểm: Dữ liệu và giá chính xác nhất, đặt được vé thật.
- Nhược điểm: Vietnam Airlines, Vietjet, Bamboo, Vietravel không có API công khai. Muốn dùng phải ký hợp đồng đại lý (có ký quỹ, có pháp nhân), không khả thi với đội sinh viên.

### Lựa chọn 4: SerpApi Google Flights + đặt vé giả lập
- Ưu điểm: Giá và giờ bay **thật** của các chặng nội địa VN, có hỗ trợ `currency=VND` và `hl=vi`. Gói miễn phí 100 lượt/tháng, đăng ký chỉ cần email.
- Nhược điểm: Chỉ **đọc** dữ liệu, không đặt vé được. Giới hạn 100 lượt/tháng. Không có số ghế còn trống.

### Lựa chọn 5: Hoàn toàn mock
- Ưu điểm: Không phụ thuộc mạng hay key, test ổn định.
- Nhược điểm: Không có dữ liệu thật để demo thuyết phục.

## Quyết định (Decision)

Kết hợp **Lựa chọn 4 và 5**, chọn qua biến `FLIGHT_SEARCH_PROVIDER`:

- **Tìm chuyến:** `mock` là mặc định (offline, deterministic). Đặt `serpapi` khi cần dữ liệu thật.
- **Giữ chỗ / xuất vé / hủy:** luôn là engine giả lập lưu trong SQLite, không có thanh toán thật.

## Lý do (Rationale)

1. Lựa chọn 1–3 đều không dùng được với nhóm tại thời điểm này, vì bị chặn theo quốc gia, đã đóng cửa, hoặc cần hợp đồng.
2. SerpApi là nguồn miễn phí duy nhất đã kiểm tra có giá thật của các chặng nội địa VN.
3. Mock làm mặc định nên CI và test không tốn lượt SerpApi và không cần secret. Kết quả deterministic nên test không bị flaky.
4. Đặt vé giả lập khớp yêu cầu "keep service execution mocked" của dự án, mà vẫn đủ để demo luồng duyệt trước khi đặt (xem ADR-013).
5. Provider nằm sau interface `FlightSearchProvider`, nên sau này có API đại lý thì chỉ cần thêm một class, không phải sửa tool.

## Hệ quả (Consequences)

- Vé "đã đặt" chỉ tồn tại trong SQLite của server. README và instructions của server đều ghi rõ điều này.
- Điều kiện hành lý và phí hủy trong `catalog_data/airlines.json` là số liệu mẫu, không phải quy định chính thức của hãng.
- Khi dùng SerpApi:
  - Phải quản lý `FLIGHT_SERPAPI_API_KEY` trong `.env`, không commit.
  - Kết quả được cache (`FLIGHT_SEARCH_CACHE_TTL`) để tiết kiệm lượt. Hết lượt thì server báo lỗi và gợi ý chuyển về `mock`.
  - Offer thật cũng chỉ đặt giả lập, nên giá trên booking có thể lệch với giá hiện tại của hãng.
- Nếu SerpApi đổi định dạng response, chỉ cần sửa `search/serpapi.py` và fixture test `tests/test_mcp_flights/fixtures/serpapi_han_sgn.json`.
