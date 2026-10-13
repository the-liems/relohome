# Phản hồi Location service ↔ LangGraph

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


> **Tài liệu khảo sát/thiết kế lịch sử — không dùng làm status hiện hành.**
>
> **Cập nhật chỉ dẫn 2026-09-29:** xem [status triển khai](location-service-implementation-status.md) và [dữ liệu/backup hiện hành](location-data-status.md). Location hiện có 9 tool, housing thật và MCP HTTP có bearer token. Các số liệu, test và kế hoạch trong ghi chép cũ bên dưới thuộc thời điểm viết, không phải thống kê DB của máy mới. ZIP cũ đã xóa; giữ dữ liệu backup riêng với source trong Git.

> Cập nhật quyết định sau phản hồi: xem [kế hoạch hiện hành](location-service-change-plan.md). Location giữ ba thành phố và không bổ sung alias/diễn giải viết tắt; graph hỏi lại người dùng rồi gửi tên đầy đủ. Các đề xuất alias, geocoder và subagent bên dưới là nội dung đối chiếu ban đầu, không phải phạm vi triển khai đã chốt.

- Ngày đối chiếu: **2026-09-29**.
- Phạm vi: bản phản hồi kỹ thuật để Dũng, Doan và Khoa thống nhất; các đề xuất bên dưới **chưa phải thay đổi đã triển khai hoặc cam kết ngày giao**.
- Code đã đọc: nhánh **`QuangDung`**, commit **`86d12f909527c208f9f188985d89c83566bbdd37`**.
- Yêu cầu đầu vào: [location-service-requests.md](../../location-service-requests.md).
- Sản phẩm của lượt đối chiếu này: một file Markdown; chưa sửa service, contract hay graph.

## 1. Kết luận để hai bên thống nhất

Phần tìm nhà và tiện ích có thể tích hợp qua tám tool MCP hiện tại sau khi DB demo được nạp và kiểm tra. Nhận định “chưa có dữ liệu nhà ở thật” trong README đã cũ. Tuy nhiên, chưa thể coi Location là geocoder địa chỉ giao hàng: chưa có `geocode_address`, chưa có dữ liệu địa chỉ chuyên biệt và chưa có tiêu chí bảo đảm điểm giao đồ.

Đề xuất thống nhất:

1. Dùng **TP.HCM làm ứng viên demo** dựa trên nguồn housing hiện có. Khoa phải xác nhận vùng AhaMove staging thực sự phục vụ trước khi chốt.
2. Graph tiếp tục dùng subagent nền. Tám tool hiện tại trả dữ liệu thực tế; graph chịu trách nhiệm xếp hạng, hỏi làm rõ và soạn câu trả lời.
3. Chuẩn hóa địa chỉ, amenities, cách đọc lỗi và xử lý kết quả mơ hồ trước khi thêm tool mới.
4. Bổ sung contract tọa độ và cọc cho housing; thiết kế `geocode_address` riêng. Điểm chuyển đồ phải được người dùng xác nhận và được Moving kiểm tra vùng phục vụ.
5. `get_manifest` / `run_task` là giai đoạn sau, dựa trên schema và bộ conformance của nhánh tích hợp; không tự tạo một contract cạnh tranh.

**Giới hạn kiểm chứng:** checkout hiện tại không có `docs/architecture/agent-graph.md`, `docs/api/agent-contract/`, `src/agents/subagents/services/location.py`, `capabilities.py` hoặc `conformance.py` được nhắc trong yêu cầu. Vì vậy, hành vi phía graph và các thay đổi ADR trên `integration/langgraph-services` được hiểu theo tài liệu yêu cầu, chưa được xác minh bằng code nhánh đó. Chưa benchmark trên VM hoặc đo lại DB demo trong lượt này.

## 2. Thành phố demo và dữ liệu

### 2.1. Số liệu có bằng chứng

Đã đọc trực tiếp file `Maps VN/Data/housing_clean_2026-09-26.jsonl`, không in địa chỉ hay thông tin cá nhân ra tài liệu.

| Chỉ số nguồn | Kết quả | Ý nghĩa |
|---|---:|---|
| Bản ghi JSON đọc được | 38.930 | Tất cả có ngày `observed_at` là 2026-09-26 |
| Bị loại theo điều kiện quarantine của importer | 708 | `likely_commercial` hoặc `quality.publishable=false` |
| Còn lại sau kiểm tra trùng ID và điều kiện quarantine | 38.222 | Đây là thống kê nguồn, chưa thay thế validation Zod và trạng thái DB đích |
| Trong nhóm trên: active + rent + VND/month | 37.166 | Cần tiếp tục kiểm tra `current_offers`, địa giới và điều kiện query trên DB demo |
| Nhãn `address_normalized.city = Hồ Chí Minh`, active + rent + VND/month | 28.924 | 28 nhãn district khác nhau trong dữ liệu nguồn; không suy ra có 28 đơn vị hành chính hợp lệ |
| Nhãn Hà Nội với cùng điều kiện | 4.885 | Thống kê theo nhãn địa chỉ nguồn |
| Nhãn Đà Nẵng với cùng điều kiện | 3.271 | Thống kê theo nhãn địa chỉ nguồn |

Trong phiên bàn giao trước, bản dump đã restore thử có **38.222 listing tổng**. Đây không phải số tin thuê đã publish riêng cho TP.HCM. Nhóm phải chốt D1 trên DB đích bằng truy vấn và gọi MCP thực tế, không chỉ dựa vào tên thành phố trong JSONL.

SHA-256 file housing nguồn:

```text
e09eda120367a9f40883ba306277a052497efb3db6ae3e958d021277a073125b
```

### 2.2. Nạp dữ liệu và kiểm tra D1

Với máy phát triển Windows đã cấu hình `.env`, từ `Maps VN/LifeFlow`:

```powershell
npm run db:up
npm ci
npm run build
npm run db:migrate
$env:HOUSING_SOURCE_PATH = (Resolve-Path '..\Data\housing_clean_2026-09-26.jsonl').Path
$env:HOUSING_SOURCE_VERSION = 'housing-clean-2026-09-26'
npm run db:import:housing
```

Nạp housing cần DB đã có schema và dữ liệu địa giới/POI cho các truy vấn liên quan. Đối với VM mới, dùng dump/graph được ghi ở [status dữ liệu](location-data-status.md). ZIP cũ đã xóa; bộ backup chỉ giữ data/checksum, không chứa source/hướng dẫn deploy. Migration một mình không nạp dữ liệu. Xem thêm [hướng dẫn importer](../location/HOUSING-DATA-IMPORT.md).

Lấy `area_id` đúng từ `search_areas`, đối chiếu tên và bbox, rồi kiểm tra trên DB đích:

```sql
-- Thay placeholder bằng area_id đã xác nhận, không tự tạo ID theo tên quận.
SELECT count(*) AS active_monthly_vnd_rent_with_address
FROM housing.listings l
JOIN housing.properties p ON p.id = l.property_id
JOIN housing.current_offers o ON o.listing_id = l.id
JOIN catalog.places cp ON cp.id = p.place_id
WHERE l.status = 'active' AND l.deleted_at IS NULL
  AND p.deleted_at IS NULL AND cp.deleted_at IS NULL AND cp.status = 'active'
  AND l.listing_type = 'rent' AND o.currency = 'VND' AND o.price_period = 'month'
  AND NULLIF(btrim(cp.address->>'raw'), '') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM geo.administrative_areas a
    WHERE a.id = '<confirmed_area_id>' AND ST_Covers(a.geom, cp.geom)
  );
```

Nghiệm thu D1: ít nhất 300 kết quả phù hợp trong thành phố đã chốt; thử thêm một số quận và khoảng giá thật. Chưa đánh dấu D1 hoàn tất chỉ từ thống kê nguồn.

### 2.3. Địa chỉ, độ chính xác và tiền cọc

- Khóa `address_normalized` hiện có: **`housenumber`, `street`, `ward`, `district`, `city`, `country`**. Không phải `house_number` / `province`.
- Importer thêm `address.raw` từ `address_raw`; `search_housing` và `get_housing` trả đối tượng này. Graph ưu tiên chuỗi `raw` không rỗng, sau đó ghép các thành phần không rỗng, bỏ giá trị null.
- Trong 38.222 bản ghi nguồn sau bước lọc trên, chỉ 10.046 có `housenumber` không rỗng. Có địa chỉ để hiển thị không đồng nghĩa đủ số nhà để giao đồ.
- Nguồn khai báo 22.627 tọa độ `rooftop`, 15.595 `approximate` trong nhóm đó. Đây là nhãn của nguồn, chưa phải xác minh thực địa hoặc độ chính xác tính bằng mét.
- `search_housing` chưa trả `location_accuracy` ở cấp ngoài. `get_housing` đã trả `extra_attributes.location_accuracy` và `extra_attributes.location_method` từ listing; graph có thể đọc tạm sau khi chọn một tin, với fallback `unknown`. Marker map có trường `location_accuracy` riêng.
- Importer đã lưu `deposit_amount` vào `housing.offers`; 16.774 bản ghi nguồn sau bước lọc có cọc khác null. Search/detail hiện chưa expose trường cọc chuẩn.

Đề xuất bổ sung **cả search và detail**, có kiểm tra tương thích client:

```typescript
location_accuracy: 'rooftop' | 'approximate' | 'unknown'
location_method: string | null
deposit: { amount: number; currency: 'VND' | 'USD' } | null
```

Tiền cọc không phải tiền thuê theo tháng: không ép vào `MoneySchema` hiện có vốn bắt buộc `period`. Chưa biết cọc phải là `null`, không phải `0`. Chốt version contract cùng graph trước khi đổi literal `contract_version: '1.0.0'`; parser Python có thể đang kiểm tra literal hoặc cấm field mới.

### 2.4. Slug amenities thực sự có trong nguồn

Importer chép nguyên `unit.amenities` vào `housing.units.amenities`; bộ lọc dùng toán tử chứa mảng, tức tất cả slug yêu cầu đều phải có. Chưa có taxonomy bắt buộc ở schema; danh sách dưới đây là từ vựng quan sát được ở snapshot hiện tại.

| Slug | Diễn giải cho graph |
|---|---|
| `air_conditioning` | Máy lạnh / điều hòa |
| `internet` | Internet; không tự suy ra miễn phí hoặc Wi-Fi riêng |
| `refrigerator` | Tủ lạnh |
| `washing_machine` | Máy giặt |
| `hot_water` | Nước nóng |
| `kitchen` | Có bếp |
| `allow_cooking` | Cho phép nấu ăn; khác với có sẵn bếp |
| `bed` | Giường |
| `wardrobe` | Tủ quần áo |
| `desk` | Bàn làm việc / học |
| `elevator` | Thang máy |
| `security` | An ninh/bảo vệ theo nguồn |
| `parking` | Chỗ đỗ xe; chưa xác định loại xe hoặc phí |
| `balcony` | Ban công |
| `natural_light` | Ánh sáng tự nhiên |
| `private_bathroom` | Phòng tắm/WC riêng |
| `shared_bathroom` | Phòng tắm/WC chung |
| `pet_friendly` | Cho phép thú cưng theo nguồn |
| `gym` | Tiện ích gym của chỗ ở |
| `swimming_pool` | Hồ bơi |

Không tự gửi `wifi`, `aircon` hoặc `full_furniture` vào filter: không thấy những slug đó trong snapshot. Không có slug trong mảng có thể là chưa được khai báo. Với sở thích mềm, tránh biến thành điều kiện SQL bắt buộc; ghi rõ nếu đã nới. Gym của chỗ ở (`amenities`) và gym gần nhà (`nearby`) là hai điều kiện khác nhau.

### 2.5. Độ mới và thời hạn tin

Hiện query chỉ lấy listing/place active và offer trong `housing.current_offers` còn hiệu lực. Importer bảo vệ bản ghi `lifeflow_verified` và giữ lịch sử offer, nhưng **chưa có job tự đánh stale theo tuổi tin** hoặc tin vắng mặt trong snapshot mới. `active` không bảo đảm căn còn trống thực tế.

Đề xuất Location bổ sung chính sách freshness theo từng nguồn: chu kỳ kiểm tra, `last_seen_at`, loại snapshot toàn phần/một phần và thời điểm hết hạn. Ngưỡng TTL phải do nhóm chốt theo nguồn; chưa có căn cứ ấn định 7/30 ngày. Trong MVP graph hiển thị ngày nguồn `source.observed_at`, nhắc cần xác nhận tình trạng phòng trước khi giao dịch. Không tự đánh mất tin chỉ vì chúng vắng trong một lần crawl một phần.

## 3. Tìm tọa độ địa chỉ và các giới hạn không được suy diễn

`resolve_location` hiện tìm **POI và đơn vị hành chính**, có tìm trong JSON address của POI. Nó loại `housing_anchor`; không phải geocoder số nhà và không có tool `geocode_address` trong registry.

Đề xuất **A làm khả năng nội bộ dài hạn**, **B chỉ dùng trong ngữ cảnh một listing đã chọn**. C là adapter tùy chọn khi nhóm cấp provider/key và đo chất lượng tại thành phố demo; chưa chốt nhà cung cấp hoặc hứa độ phủ.

| Hướng | Công việc Location | Giới hạn cần graph hiểu |
|---|---|---|
| A: địa chỉ/đường OSM | Import `addr:*`, đường có tên vào bảng riêng; index số nhà/tên đường; normalize và alias; trả nguồn và mức khớp | Độ phủ số nhà chưa được đo. Điểm đại diện đường chỉ là `street`; không nâng thành `rooftop` |
| B: listing đã biết | Dùng vị trí, địa chỉ và accuracy của `get_housing` cho đúng `listing_id` | Không tra tên gần giống rồi coi tọa độ housing bất kỳ là địa chỉ người dùng |
| C: adapter geocoder | Cấu hình provider riêng, timeout, nguồn kết quả, ngân sách và điều kiện sử dụng | Chỉ kích hoạt khi được nhóm lựa chọn và thử dữ liệu; không tự gửi địa chỉ người dùng ra ngoài |

Contract đề xuất bám §3 của request: `geocode_address({text, city?, bounding_box?, limit?})`, trả `{query, results:[{location, precision, matched_text, components, source}]}`. Chuẩn hóa enum `precision` chung trước triển khai; đề xuất bổ sung `unknown` khi nguồn chỉ ghi `approximate` mà không biết là street/ward/district. Không suy ra độ chính xác từ `match_score`: điểm đó hiện chỉ đo tương đồng tên.

Quy tắc MVP:

- Địa chỉ không rõ hoặc nhiều ứng viên: graph hỏi lại, không tự dùng ứng viên đầu.
- Chỉ tới ward/district/unknown: hỏi số nhà/đường hoặc xin người dùng xác nhận pin.
- Street: chỉ dùng khi người dùng xác nhận địa chỉ chữ/pin và Moving chấp nhận mức chính xác đó; không coi đây là bảo đảm báo giá đúng.
- Khi chưa có geocoder: vẫn tìm phòng/tiện ích; tác vụ chuyển đồ nhận tọa độ đã xác nhận hoặc trả `needs_input`, không bịa điểm đi.
- Chưa thể công bố phần trăm độ phủ. Nghiệm thu bằng tập địa chỉ thực đã kiểm duyệt ở thành phố demo, đo mức khớp và sai lệch trước khi bật cho Moving.

## 4. Các điều chỉnh graph có thể làm ngay

| Điểm | Code hiện tại | Cách đồng bộ |
|---|---|---|
| Giá tháng | Filter hỗ trợ `currency` và `price_period` độc lập với `max_price` | Luôn gửi `listing_type: rent`, `currency: VND`, `price_period: month`, kể cả người dùng không nêu ngân sách |
| Tìm địa danh | `resolve_location` có `ambiguous = results.length > 1` | Giữ nhiều ứng viên và hỏi làm rõ; cờ này hiện khá bảo thủ, không phải confidence đã hiệu chỉnh |
| Tìm khu vực | `search_areas` không có `ambiguous`; `limit:1` che khuất các lựa chọn khác | Dùng limit 3–5 khi phân giải tên người dùng; kiểm tra name, level, parent, bbox trước khi chọn |
| Bbox và radius | Housing/resolve cấm `bounding_box` cùng `center`; có thể dùng `administrative_area_ids` cùng `center/radius_m` khi tìm housing | Graph truyền bbox cho bước resolve, sau đó chọn một cách lọc không gian hợp lệ; không thêm bbox vô điều kiện vào mọi request |
| Phạm vi bbox | Areas dùng polygon `ST_Intersects`, places dùng điểm `ST_Intersects` | Khu hành chính lớn có thể giao bbox dù tâm nằm ngoài; kiểm tra cấp và tên. Bbox không chứng minh thuộc vùng AhaMove |
| Radius | `center/radius_m` và nearby là khoảng cách địa lý trực tiếp | Hiển thị “bán kính/khoảng cách thẳng”; dùng `commute`/`calculate_route` khi hỏi quãng đường hoặc thời gian đi đường |
| Resolve bằng radius | Radius hiện lọc nhánh places; nhánh areas nhận bbox nhưng không nhận radius | Nếu chỉ tìm POI quanh pin, gửi `entity_types: [place]`; không giả định cả hai loại đều đã lọc radius |
| Nearby | Tối đa 10 constraints/lần; chỉ trả một POI gần nhất cho mỗi category tìm được | Danh sách L3 có 12 loại: chọn tối đa 10 hoặc chia request trong budget. Thiếu kết quả nghĩa là chưa tìm thấy trong dữ liệu/bán kính, không chứng minh tiện ích không tồn tại |
| Pagination và ranking | Query mặc định theo giá rồi listing ID; graph đang rank trên trang lấy được | Ghi đúng “xếp trong tập kết quả đã lấy”, không khẳng định tốt nhất toàn DB. Dùng cursor trong budget; không bỏ cursor rồi kết luận hết dữ liệu |
| Unknown fields | `unknown_fields` của search hiện chỉ liệt kê bedrooms/bathrooms/area bị null | Wrapper của graph bổ sung thiếu địa chỉ/cọc/accuracy theo contract của wrapper; không coi mảng này là danh sách đầy đủ mọi thiếu sót |
| Provider/source | Housing lưu `source.type = partner`, `source_id` có khóa provider | Không gửi `source_filters: [nhatot]`; bộ lọc này khớp `l.source_type`, hiện dùng `partner` |

Ví dụ `search_housing` hợp lệ trước khi thêm contract mới; thay ID bằng kết quả đã xác nhận từ `search_areas`:

```json
{
  "listing_type": "rent",
  "currency": "VND",
  "price_period": "month",
  "administrative_area_ids": ["<confirmed_area_id>"],
  "max_price": {"amount": 5000000, "currency": "VND", "period": "month"},
  "amenities": ["air_conditioning"],
  "pagination": {"limit": 25, "cursor": null}
}
```

Chỉ gửi `amenities` trong ví dụ nếu máy lạnh là yêu cầu bắt buộc đã xác nhận. Không âm thầm nới ngân sách, thành phố hoặc `must_have`.

## 5. Kết nối, thời gian và lỗi

### 5.1. Streamable HTTP và Bearer

Server đã có `/mcp`, `/healthz`, `/readyz`, kiểm tra Host/Origin và Bearer bắt buộc bằng `MCP_AUTH_TOKEN` (ít nhất 32 ký tự ASCII). `/readyz` chỉ thử DB bằng `SELECT 1`, chưa kiểm tra dữ liệu hoặc OSRM.

Ví dụ hai container **cùng Docker network**, MCP được gọi bằng service name `location-mcp`:

```dotenv
# Phía Location
MCP_HOST=0.0.0.0
MCP_PORT=3000
MCP_AUTH_TOKEN=<shared-random-secret>
MCP_ALLOWED_HOSTS=location-mcp,lifeflow-location-mcp,localhost,127.0.0.1

# Phía AI/graph: truyền đúng cùng token ở header Authorization: Bearer ...
LOCATION_MCP_URL=http://location-mcp:3000/mcp
LOCATION_MCP_AUTH_TOKEN=<shared-random-secret>
```

**Sửa L4:** allowlist Host là hostname đích trong request tới MCP, không tự động là tên container AI gọi đi. Nếu dùng reverse proxy, thêm hostname proxy; Origin là cơ chế riêng. Hai Compose project riêng phải có network chung hoặc endpoint VM truy cập được; loopback `127.0.0.1` trong container AI không trỏ tới container Location. Compose gốc chỉ bind cổng host lên loopback mặc định. Graph tái sử dụng client/connection trong một lượt và tuân theo session handshake mà server thực tế trả về; không giả định server luôn có session ID.

### 5.2. Hiệu năng và deadline

Chưa có số p50/p95 đo trong lượt đối chiếu này, vì vậy chưa nhận cam kết subagent hoàn thành trong 20 giây. Những giới hạn đọc được từ code:

- Mỗi request OSRM có timeout 10 giây; housing xử lý theo nhóm tối đa bốn candidate, giới hạn candidate mặc định 100 khi có commute.
- Pool DB có connect timeout 5 giây; chưa thấy statement timeout hoặc deadline toàn search trong lớp query.
- `findNearby` truy vấn tuần tự theo category; enrich ba phòng có thể tăng số query đáng kể.
- Một lượt resolve + search + nearby cho ba phòng đã là **5 lần gọi MCP**; thêm search_areas có thể thành 6. Không mặc định mọi lượt chỉ có 2–4 lời gọi.

Đề xuất graph áp deadline chung, giới hạn enrich và chỉ retry khi còn budget. Location thêm deadline/cancellation đi xuyên SQL/OSRM rồi benchmark ba nhóm: search thường, search + nearby, search + commute. Đo cold/warm và p50/p95 trên VM demo với truy vấn cố định; chốt ngưỡng sau khi có số đo. `diagnostics.candidate_limit_reached` và `page.next_cursor` cần được xử lý trước khi kết luận không còn phòng phù hợp.

### 5.3. Lỗi đã có và phần cần thêm

Wrapper tool hiện trả thành công ở cả `structuredContent` và JSON trong `content[].text`. Khi handler lỗi, trả `isError: true`, JSON `{code,message}` trong text; không có `structuredContent` lỗi. Graph nên đọc structuredContent khi thành công và parse text JSON khi lỗi, đồng thời xử lý lỗi protocol/transport của SDK riêng.

| Mã/trạng thái hiện tại | Xử lý phía graph |
|---|---|
| `VALIDATION_ERROR`, `QUERY_VALIDATION_ERROR` | Sửa input; không retry y nguyên |
| `NOT_FOUND` | Không retry mù; đối chiếu ID và trạng thái listing |
| `NO_ROUTE`, `OUTSIDE_ROUTING_AREA` | Không thay bằng khoảng cách thẳng rồi gọi đó là tuyến đường |
| `OSRM_OFFLINE` | Retry có giới hạn khi còn budget; hiện lỗi timeout OSRM cũng bị gom vào mã này |
| `INVALID_RESPONSE` | Lỗi payload provider; ghi nhận, không tạo dữ liệu thay thế |
| `INTERNAL_ERROR` | Chưa có phân loại lỗi DB ổn định; không mặc định coi mọi lỗi này là tạm thời |
| HTTP 401 / Host hoặc Origin bị từ chối | Sửa cấu hình kết nối; không retry cùng cấu hình |

Đề xuất thêm phân biệt `TIMEOUT` / `UNAVAILABLE` và thuộc tính retryable có schema, giữ khả năng đọc mã cũ trong lúc chuyển đổi. Lỗi validation do SDK xảy ra trước wrapper có thể là protocol error. Trong search có commute, `NO_ROUTE`/`OUTSIDE_ROUTING_AREA` của từng candidate bị loại khỏi kết quả; các lỗi OSRM khác vẫn làm search thất bại.

## 6. Đối chiếu từng yêu cầu và trách nhiệm

Các mốc P0/P1/P2 dưới đây là **thứ tự và điều kiện hoàn tất**, không phải ngày giao đã được người phụ trách xác nhận.

### D1–D7: dữ liệu

| Mục | Phản hồi | Việc cần làm / người phụ trách đề xuất |
|---|---|---|
| D1 | Đồng ý; dữ liệu nguồn có, câu README “chưa có” đã cũ | P0 Location nạp/restore DB demo và cung cấp thống kê query; Khoa xác nhận vùng staging, cả nhóm chốt thành phố |
| D2 | Đã có contract và dữ liệu VND/month | P0 graph gửi currency/price_period ngay cả khi không có trần giá; Location kiểm tra DB đích |
| D3 | Đã có address; tên khóa khác ví dụ đề xuất | P0 graph dùng housenumber/city/raw như §2.3, phân biệt địa chỉ hiển thị với điểm giao |
| D4 | Đúng với search và field chuẩn ở cấp ngoài; detail có workaround extra_attributes | P0 graph xử lý unknown; P1 Location bổ sung accuracy/method đồng nhất, kiểm tra tương thích cả hai client |
| D5 | Có 20 slug quan sát được; chưa khóa taxonomy | P0 dùng bảng §2.4; Location/graph cùng version alias/taxonomy khi có nguồn mới |
| D6 | Có cọc trong nguồn và DB, chưa có field response | P1 expose deposit nullable với amount/currency; graph không suy ra cọc bằng một tháng thuê |
| D7 | Import cập nhật và lịch sử có; TTL/job stale chưa có | P1 chốt freshness theo nguồn; graph hiện ngày quan sát, không khẳng định còn trống |

### L1–L7: hành vi và vận hành

| Mục | Phản hồi | Việc cần làm / người phụ trách đề xuất |
|---|---|---|
| L1 | Có lower/unaccent/gộp whitespace; chưa thấy alias Q10/BV/ĐH/HCM/Sài Gòn | P1 Location thêm alias có phạm vi thành phố và test; không cam kết fuzzy hiện tại giải đúng viết tắt. Housing text search hiện dùng ILIKE, không tự áp normalize_search |
| L2 | Có lọc bbox nhưng areas dùng giao polygon; chưa phải lọc chứa toàn bộ khu vực | P0 graph xử lý mơ hồ/cấp hành chính; Location kiểm tra ca tên trùng và legacy quận theo snapshot |
| L3 | Đúng slug; báo cáo snapshot có đủ 12 loại ở bbox TP.HCM | P0 xem số liệu §7; query lại vùng demo, không gọi hơn 10 constraints/lần |
| L4 | HTTP + Bearer đã có; cần sửa diễn giải allowlist | P0 hai bên cấu hình URL/network/token theo §5.1 và kiểm tra thiếu token bị 401 |
| L5 | Chưa có benchmark đủ để chốt 20 s | P1 Location đo hiệu năng và thêm deadline; graph tính cả enrich/retry vào budget |
| L6 | Đã có JSON code/message trong MCP tool error | P0 graph parse đúng envelope; P1 Location tách timeout/unavailable và test protocol error |
| L7 | demo/agent.py có workflow hữu ích nhưng còn prompt tóm tắt/hỏi trực tiếp | P2 tái sử dụng logic chọn tool; adapter phải trả structured result/needs_input theo graph, không dùng nguyên agent demo |

### A1–A8: subagent Location

| Mục | Phản hồi | Việc cần làm / người phụ trách đề xuất |
|---|---|---|
| A1 | Đồng ý hướng TypeScript cạnh MCP; hiện chưa có hai tool | P2 Doan cung cấp JSON Schema/version của nhánh tích hợp; Location triển khai get_manifest/run_task sau khi schema được chốt |
| A2 | Đồng ý ở tầng subagent | Giữ search_housing lọc dữ liệu; subagent rank và chỉ nới soft_filters, trả relaxed_filters, không nới must_have |
| A3 | Đồng ý | Nhận upstream listing/POI ID và tọa độ thật; giới hạn enrich theo budget, giữ source_refs |
| A4 | Đồng ý mục tiêu; unknown_fields hiện chưa đủ | Adapter phân biệt thiếu dữ liệu với false/0, dùng null nơi schema cho phép; source_refs trỏ đúng canonical ID và nguồn |
| A5 | Đồng ý | Trả needs_input/questions cho graph; subagent không tự gửi câu hỏi tới người dùng |
| A6 | Chưa có hỗ trợ budget đầu-cuối | P2 thêm counter thực tế cho tool/provider/LLM, deadline/cancellation. Hai bên phải định nghĩa provider_calls tính MCP call hay HTTP OSRM nội bộ |
| A7 | Cần thống nhất nghĩa chỉ đọc | Tool không ghi dữ liệu nghiệp vụ của người dùng, nhưng đang INSERT audit.tool_calls với tên khóa input/thời gian/kết quả. Không lưu giá trị input trong audit này; nếu cấm mọi ghi DB thì cần đổi telemetry |
| A8 | Đồng ý điều kiện nghiệm thu; chưa thể chạy conformance tại checkout này | Doan cung cấp đúng module/schema và request fixtures; đăng ký remote chỉ sau khi pass và fallback được thử |

Đề xuất bản đầu subagent TypeScript dùng luật xác định, **chưa cần LLM riêng**: graph đã phân tích ý định và sở thích. Nếu sau này thêm LLM, báo usage và lỗi deadline đúng contract. Ngày có `get_manifest`/`run_task` cần người phụ trách xác nhận sau khi nhận schema và hoàn tất P0/P1; tài liệu này không tự đặt deadline thay nhóm.

### X1–X6: tài liệu và nhánh

| Mục | Phản hồi | Cách xử lý đề xuất |
|---|---|---|
| X1 | Chưa xác minh ADR-007/ADR-001 của nhánh tích hợp | Chấp nhận hướng một ADR workspace hiện hành; Dũng/Doan kiểm tra nội dung giữ lại trước khi xác nhận superseded |
| X2 | SPEC-012 hiện giới hạn phạm vi Location; không thể dùng để kết luận Moving chưa có AhaMove | P0 sửa SPEC trên nhánh tích hợp: Moving sở hữu báo giá/đặt xe và tích hợp AhaMove; Location chỉ cung cấp dữ liệu địa điểm/tuyến, khả năng mobility nội bộ ghi rõ trạng thái |
| X3 | Xác nhận: SPEC dẫn file mobility.ts, mobility-service.ts và test không tồn tại; app.ts cũng không đăng ký /v1/mobility/* | P0 sửa SPEC thành thiết kế chưa triển khai hoặc bỏ liên kết hỏng. Không thêm service rỗng chỉ để khớp tài liệu; migration 009 không chứng minh endpoint đã chạy |
| X4 | Đồng ý cần phân quyền file, nhưng “mọi phần còn lại của Dũng” quá rộng cho workspace dùng chung | Location sở hữu housing/place/location/route; Moving sở hữu moving.ts; common.ts, exports index.ts, manifest/lockfile, root scripts và CI cần review liên nhóm |
| X5 | Chưa đối chiếu lịch sử merge nhánh tích hợp trong lượt này | PR tích hợp nhắm integration/langgraph-services hoặc đồng bộ nhánh đó trước; npm install tạo lại lockfile sau khi hòa giải manifest, không chọn nguyên một phía |
| X6 | Đồng ý nguyên tắc số ADR duy nhất trên nhánh tích hợp | Giữ bảng ánh xạ 001–005 → 007–011 khi merge, cập nhật liên kết; không đổi số riêng ở QuangDung rồi gây trùng lần nữa |

## 7. Bằng chứng coverage POI cho L3

Nguồn: [reports/poi-coverage-v2.json](../../eval/location/poi-coverage-v2.json), `generated_at = 2026-09-24T15:53:09.652Z`. Đây là số liệu **bbox bản đồ TP.HCM của báo cáo**, không phải live DB, ranh giới hành chính hay vùng AhaMove.

| Category | Số POI trong báo cáo bbox HCM |
|---|---:|
| hospital | 412 |
| clinic | 386 |
| pharmacy | 490 |
| school | 2.991 |
| university | 290 |
| marketplace | 577 |
| supermarket | 423 |
| convenience_store | 1.634 |
| gym | 94 |
| park | 2.146 |
| bus_stop | 6.245 |
| bus_station | 129 |

## 8. Thứ tự bàn giao và tiêu chí đồng bộ

| Mốc | Phần Location | Phần graph/Moving | Điều kiện qua mốc |
|---|---|---|---|
| P0: tìm phòng chạy thật | Restore/import DB, thống kê vùng demo, cung cấp 8 tool HTTP, xác nhận vocabulary | Token/network, filter VND/month, địa chỉ/slug đúng, xử lý ambiguity và lỗi | MCP tools/list; thiếu token 401; query giá/quận có kết quả; cùng listing_id mở được detail; không lấy nhầm thành phố |
| P1: tọa độ và chất lượng | Accuracy/deposit, thiết kế và triển khai geocoder, alias, freshness, đo latency | Xác nhận điểm chuyển đồ, Moving xác nhận vùng phục vụ; dùng deadline, không suy diễn giá/độ chính xác | Test địa chỉ rõ/mơ hồ/không tìm thấy; cọc null; timeout/OSRM offline phân biệt rỗng; budget 20 s có số đo |
| P2: remote subagent | get_manifest/run_task và usage/source_refs/needs_input | Cấu hình remote + fallback; cấp conformance fixtures | Conformance pass; lỗi remote fallback có giới hạn; không chạy hai chiến lược xếp hạng/nới filter trái nhau |

Các ca cần có trong bài kiểm tích hợp chung: không dấu/viết tắt; tên trùng khác thành phố; quận cũ không còn polygon; không nêu giá; amenities không có trong vocabulary; địa chỉ chỉ tới phường; source_accuracy approximate; trường cọc null; nguồn cũ; 0 kết quả có next_cursor; 12 category; OSRM mất kết nối; token sai; remote subagent quá deadline.

## 9. Việc cần phía graph/Moving cung cấp hoặc chốt

1. Commit của `integration/langgraph-services` kèm các file agent contract, location.py, capabilities và conformance; hiện chúng chưa có trong checkout đang đối chiếu.
2. Thành phố/vùng demo được AhaMove staging của Khoa xác nhận; không dùng bbox routing làm vùng báo giá.
3. Ý nghĩa budget: mỗi loại lời gọi được tính ra sao, có tính lời gọi con OSRM không; deadline và retry policy cho toàn task.
4. Quy tắc version contract: parser có nhận field mới/version mới không, cách đọc MCP structuredContent/isError và HTTP lỗi.
5. Schema `upstream`, source_refs/source_kind, missing_fields, needs_input/questions và fixtures mẫu cho property/map; Location sẽ map vào đúng schema đó.
6. Ngày giao theo từng mốc do người phụ trách xác nhận. Không đổi code graph dựa trên field/tool mới cho tới khi manifest/schema và integration test cùng được cập nhật.

## 10. Điểm tựa trong code đã đối chiếu

- [Contract housing](../../Maps%20VN/LifeFlow/packages/contracts/src/housing.ts), [query housing](../../Maps%20VN/LifeFlow/packages/housing-query/src/housing-service.ts), [importer housing](../../Maps%20VN/LifeFlow/platform-api/src/import-housing.ts).
- [Contract location](../../Maps%20VN/LifeFlow/packages/contracts/src/location.ts), [location service](../../Maps%20VN/LifeFlow/packages/housing-query/src/location-service.ts), [normalize_search](../../deploy/database/migrations/005_administrative_area_search.sql).
- [Nearby tool](../../Maps%20VN/LifeFlow/mcp-server/src/tools/place-tools.ts), [place service](../../Maps%20VN/LifeFlow/packages/housing-query/src/place-service.ts).
- [HTTP MCP](../../Maps%20VN/LifeFlow/mcp-server/src/http-server.ts), [tool audit và error envelope](../../Maps%20VN/LifeFlow/mcp-server/src/tools/audit.ts), [routing và timeout](../../Maps%20VN/LifeFlow/packages/housing-query/src/route-service.ts).
- [API route registry](../../Maps%20VN/LifeFlow/platform-api/src/app.ts), [SPEC-012 hiện tại](../specs/SPEC-012-vung-dich-vu-va-gia.md), [ADR ownership hiện tại](../adr/ADR-008-contract-ownership.md), [agent demo](../../examples/location-streamlit/src/relohome_location_demo/agent.py).
