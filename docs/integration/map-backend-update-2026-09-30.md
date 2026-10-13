# Backend Map/Location — cập nhật cho Graph và client

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Ngày: **30/09/2026**. Thay đổi từ nền `e407d45`, bàn giao qua nhánh `mvp`. Trạng thái triển khai: chưa deploy; cần rebuild/restart các service như mục 4. Phạm vi: backend Location, Platform API và adapter/planner/validator của graph. Không sửa frontend và không có migration dữ liệu mới.

## 1. Những gì đã sửa

| Phần | Hành vi hiện tại sau thay đổi |
| --- | --- |
| Housing search/map | Dùng chung hàm dựng điều kiện SQL cho danh sách và cluster; map nhận giá/chu kỳ, phòng, diện tích, tiện nghi, khu vực, nguồn, trạng thái xác minh, availability và POI gần đó. |
| Map kết quả chat | Có `listing_ids` để giới hạn map vào đúng các căn đang được trả về, kết hợp với bbox/zoom và các bộ lọc khác. |
| Cluster | Nhóm theo ô không gian + currency + price period; không trộn giá theo đêm/tháng. Mỗi cluster có `price_period`. |
| API route theo entity | Thêm `POST /v1/routes/entities`, dùng chung `RouteEndpointService` với MCP. Nhận housing/place/coordinate, kiểm tra entity còn hoạt động và vùng routing. |
| POI nearby | Trả thêm `location` và `distance_kind: straight_line`, giữ source/verification; không cần gọi chi tiết từng POI chỉ để lấy tọa độ. |
| Housing qua graph | Giữ price có đơn vị, thumbnail, source, verification, unknown fields; trả request đã áp dụng, cursor, diagnostics và danh sách ID cho map. |
| Pagination graph adapter | Limit trang provider bằng limit được yêu cầu, tránh lấy nhiều rồi bỏ những căn chưa hiển thị nhưng vẫn tiến cursor qua chúng. Không tự nới lọc khi đang đi tiếp một cursor. |
| Near + city | Resolve địa danh trong bbox thành phố khi có; truy vấn nhà vẫn giữ administrative area để không bỏ thành phố người dùng đã nói. |
| Nhà đã chọn → tiện ích | Map nhận `selected_listing_id`; khi chưa có tọa độ upstream thì gọi `get_housing`. Không tự chuyển sang căn đầu tiên. |
| Nhà đã chọn ↔ địa điểm | Intake/planner có quy ước tham chiếu căn đã chọn; adapter chuyển thành endpoint housing, giữ đúng chiều và phương tiện. |
| Validate graph route | `nearby|routing` được coi là dữ liệu kết quả hợp lệ. Trước đây route riêng có `nearby={}` có thể bị đánh dấu thiếu và trả PARTIAL. |
| Ràng buộc đầu vào | Map task mâu thuẫn nguồn điểm hoặc route thiếu đầu vào bị từ chối trước khi gọi tool; planner kiểm tra ID căn đúng fact đã xác nhận. |
| Metadata trả lời | `response.data.results[task_id]` giữ thêm `fetched_at`; văn bản phân biệt khoảng cách đường thẳng với tuyến đường và cảnh báo vị trí route gần đúng. |

Số tool Location MCP vẫn là **9**, không đổi tên tool. Endpoint HTTP mới là một cách sử dụng lại tool/service routing hiện có, không phải một dịch vụ định tuyến khác.

## 2. HTTP API dùng cho bản đồ

### 2.1. Map khám phá khu vực có bộ lọc

`POST /v1/housing/map` trên **Platform API**, không phải prefix `/api/v1` của Agent API:

```json
{
  "bounding_box": {"west": 106.6, "south": 10.7, "east": 106.8, "north": 10.9},
  "zoom": 12,
  "listing_type": ["rent"],
  "property_type": ["apartment"],
  "currency": "VND",
  "price_period": "month",
  "min_price": {"amount": 10000000, "currency": "VND", "period": "month"},
  "max_price": {"amount": 15000000, "currency": "VND", "period": "month"},
  "min_bedrooms": 2,
  "max_bedrooms": 2,
  "amenities": ["parking"],
  "limit": 500
}
```

Các field bổ sung được hỗ trợ: `text`, `district`, `administrative_area_ids`, `min_bathrooms`, `min_area_m2`, `max_area_m2`, `availability_from`, `availability_to`, `verification_requirement`, `source_filters`, `nearby` và `listing_ids`.

City được ràng buộc bằng `administrative_area_ids` lấy từ `search_areas`; không tự thêm field `city` vào map request. `district` có semantics giống search: ưu tiên polygon, fallback địa chỉ khớp tên chính xác khi không có polygon tên đó (cập nhật 01/10: so tên bỏ tiền tố loại đơn vị Quận/Huyện/Thị xã/Thành phố ở cả hai vế, xem [map workspace](map-workspace-2026-10-01.md) §3).

`nearby` là điều kiện có POI thuộc category trong khoảng cách đường thẳng. `commute` chưa được tính cho mọi marker viewport và bị trả **400**, thay vì âm thầm bỏ điều kiện. Bbox bắt buộc; map request không nhận `center/radius_m`, `pagination`, `sort` hoặc khóa không hỗ trợ. Nếu cần kết quả commute đã đánh giá, dùng các ID từ housing search làm lớp map kết quả.

### 2.2. Map đúng các căn chat đã trả

Thêm `listing_ids` là mảng UUID thật vào request bbox/zoom. Tối đa 2.000 ID; `[]` không hợp lệ. Khi chat không có căn nào, client xóa lớp kết quả hoặc không gọi map; không bỏ `listing_ids` rồi vô tình hiển thị tất cả nhà trong vùng.

Response vẫn có `features` và `meta.mode/returned_count/truncated`. Zoom < 13 trả cluster; zoom ≥ 13 trả listing. Đọc `cluster.count` là số tin trong cụm; `returned_count` là số feature được trả, không phải tổng số nhà toàn thị trường. Khi có nhiều chu kỳ giá, mỗi cluster có `currency` và `price_period` riêng.

### 2.3. Route bằng ID nhà/POI

`POST /v1/routes/entities`:

```json
{
  "city": "hcm",
  "origin": {"type": "housing", "listing_id": "30000000-0000-4000-8000-000000000010"},
  "destination": {"type": "place", "place_id": "00000000-0000-4000-8000-000000000001"},
  "profile": "walking",
  "snap_radius_m": 100
}
```

ID trên chỉ minh họa, cần thay bằng kết quả query thực. Hỗ trợ đảo chiều place→housing và endpoint `{"type":"coordinate","location":{"lat":...,"lng":...}}`. Response giữ `origin`, `destination`, `route.geometry`, distance/duration, source/accuracy và warnings. Endpoint sai shape → 400, entity không còn hoạt động → 404, lỗi route được ánh xạ theo mã lỗi hiện có. `/v1/routes` theo tọa độ vẫn dùng được như trước.

## 3. Hợp đồng sử dụng từ Graph

### 3.1. Route từ căn đã chọn

Fact `selected:property` phải được xác nhận từ lựa chọn của người dùng. Intake dùng chuỗi tham chiếu `selected:property` tại đúng đầu route; planner lấy ID từ fact, không tạo ID bằng suy đoán:

```json
{
  "map_mode": "route",
  "city": "Hồ Chí Minh",
  "route_from": "selected:property",
  "route_to": "Bệnh viện Chợ Rẫy",
  "route_profile": "motorcycle",
  "selected_listing_id": "30000000-0000-4000-8000-000000000010"
}
```

Đặt tham chiếu tại `route_to` để đi từ địa điểm về căn nhà. Nếu chưa chọn căn, `missing_for` hỏi chọn căn trước. Planner/validator kiểm tra `selected_listing_id` trùng fact; route dùng ID thật qua service, không resolve tên nhà lần nữa. Địa điểm còn lại vẫn resolve trong bbox thành phố; mơ hồ thì hỏi lại.

Đây là đầu vào task của graph, **không phải một field mới của `ChatRequest`**. Đợt này chưa tạo endpoint UI action để bấm card rồi lưu selection; lựa chọn hiện dùng luồng chat/facts đã có. Client map độc lập có thể gọi HTTP entity route bằng ID mà không cần LLM.

### 3.2. Nearby căn đã chọn hoặc một số ID cụ thể

Map task có `categories` và một trong `near`, `selected_listing_id`, `listing_ids`. Không gửi đồng thời các cách chọn điểm này. `listing_ids` tối đa 3 ID không trùng để giữ giới hạn provider calls. Nếu không có lựa chọn rõ, adapter vẫn có thể dùng tối đa 3 căn từ upstream property như trước; không có origin hợp lệ thì hỏi lại.

Kết quả chứa `origins`, `nearby`, `coverage: nearest_per_category` và `approximate_origins` khi cần. POI có `id`, `location`, `distance_m`, `distance_kind`, `source`, `verification`. Đây là POI gần nhất theo category, không phải danh sách mọi POI trong vùng. Trường accuracy thiếu/unknown của nhà cũng được cảnh báo.

### 3.3. Kết quả housing có thể dùng cho map

Trong `response.data.results[task_id].data`:

- `candidates`: giữ ID, tọa độ, thông tin căn và thêm metadata giá/ảnh/nguồn.
- `map_context.scope = returned_candidates`, `map_context.listing_ids`: các ID đúng những căn được trả cho client.
- `search_request`: request thực tế đã gọi Location, sau khi áp dụng lọc hoặc nới soft filter nếu được phép.
- `next_cursor`, `has_more`, `query_id`, `diagnostics`: giữ thông tin phân trang và mức độ đầy đủ.

Để lấy trang sau, giữ nguyên điều kiện tìm và dùng `next_cursor` qua search API/MCP hoặc input `cursor` của property adapter. Không copy nguyên `search_request` sang map endpoint: search có field khác như pagination, center/radius và có thể dùng scalar cho loại nhà; map dùng bbox và các loại dạng mảng. Map kết quả theo `listing_ids` là cách giữ đúng phạm vi các căn đã có.

Cursor hiện dựa trên vị trí trong truy vấn; **chưa phải snapshot có khóa phiên bản**. Không có result-set storage hoặc API history/structured UI action mới trong đợt này. LLM planner chưa được bổ sung luồng “xem trang tiếp” tự động; metadata/cursor đã sẵn cho phía tích hợp sử dụng.

## 4. Tương thích và triển khai

- Không sửa file trong `map-app/src/` hoặc UI Streamlit. Muốn giao diện dùng các filter/metadata mới cần nối tiếp ở frontend sau này.
- Client cũ gửi bbox/zoom/loại nhà/limit vẫn hợp lệ. Map contract nay strict: field chưa hỗ trợ trả lỗi thay vì bị bỏ qua.
- Field response mới mang tính bổ sung. Graph chấp nhận backend cũ chưa có thumbnail/POI location bằng null, nhưng client sẽ chưa vẽ được POI thiếu tọa độ.
- Cần rebuild/restart Platform API, Location MCP và Agent API để sử dụng toàn bộ thay đổi. Không yêu cầu restore DB hay chạy migration mới.
- PostGIS local đã được khởi động để chạy kiểm thử; dữ liệu fixture của bộ housing integration nằm trong transaction và rollback.
- Năng lực routing vẫn giới hạn HCM/Hà Nội/Đà Nẵng và ba profile đã cấu hình. Không có live traffic hoặc alias mới.

## 5. Kiểm chứng

- Python: **58 passed** cho map backend mới, Location feedback, planning, intake, validator, graph E2E và executor. Có test hai lượt đi qua graph với Location adapter, xác nhận chọn nhà→route giữ ID, không tìm nhà lại. MCP/LLM/provider được giả lập trong nhóm test Python này.
- TypeScript contracts: **32 passed**; có kiểm tra range giá/phòng/diện tích, currency/period xung đột và từ chối commute không hỗ trợ trên viewport.
- Housing-query: **37 passed**, gồm PostGIS local với fixture/rollback; kiểm tra search/map/cluster dùng cùng bộ lọc, map theo ID, cluster khác chu kỳ giá, nearby có tọa độ. Routing trong test dùng phản hồi OSRM giả lập.
- Platform API: **25 passed, 9 skipped** ở lần chạy bộ API; bao gồm route entity validation/404 và dữ liệu DB local. Số bài bỏ qua phụ thuộc cấu hình suite, không phải các bài đã đạt.
- Ruff trên các module Python sửa đổi: đạt.
- MCP stdio/HTTP: **7 passed**, xác nhận registry 9 tool, bearer authentication và structured content qua server local.
- Build toàn bộ workspace backend `Maps VN/LifeFlow`: đạt sau khi đồng bộ dependencies/workspace links. Không thay package manifest/lockfile.

Tổng các nhóm kiểm thử liên quan nêu trên: **159 passed, 9 skipped**. Số này không bao gồm lượt thử bộ subagent rộng hơn được ghi ở đoạn dưới.

Không coi đây là chứng nhận hội thoại với LLM live hoặc routing live trên cả chín graph OSRM. Không tạo đơn Moving, vé hoặc thanh toán trong lượt này. Khi chạy bộ subagent rộng hơn có một assertion Flight ngoài phạm vi map (`source_kind` mong `demo`, fixture trả `fake`); không sửa logic Flight để làm xanh test đó.

Các file kiểm thử chính: [map graph tests](../../tests/test_agents/test_map_backend.py), [housing integration](../../Maps%20VN/LifeFlow/packages/housing-query/tests/housing-query.integration.test.ts), [HTTP entity route](../../Maps%20VN/LifeFlow/platform-api/tests/entity-route-api.test.ts).
