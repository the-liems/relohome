# Location service — trạng thái triển khai và bàn giao cho Graph

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Ngày: **2026-09-29**. Phạm vi: code trong `Maps VN/LifeFlow`.

**Bổ sung 30/09/2026:** xem [backend Map/Graph mới](map-backend-update-2026-09-30.md) về filter viewport/cluster, HTTP entity route, POI coordinates và luồng route căn đã chọn. Các kết quả kiểm thử ngày 29/09 bên dưới giữ nguyên phạm vi lịch sử; dùng bản bổ sung cho những phần vừa thay đổi.

Đọc cùng [status dữ liệu/backup](location-data-status.md) để phân biệt số liệu nguồn,
POI, housing anchor và listing. [Mục lục tích hợp](README.md) chỉ rõ tài liệu hiện hành/lịch sử.

**Đã triển khai và kiểm thử local theo kế hoạch đã duyệt.** Graph có thể bắt đầu
tích hợp contract này. Kiểm thử trên VM production và bài hội thoại đầu cuối
của graph vẫn cần chạy trên môi trường đích trước khi release.

Tài liệu này cập nhật trạng thái sau [kế hoạch thay đổi](location-service-change-plan.md),
được ưu tiên khi nội dung khác với [phản hồi khảo sát cũ](location-service-response.md).

## 1. Đã thay đổi những gì

| Hạng mục | Trạng thái và hành vi |
|---|---|
| Thành phố | Giữ `hcm`, `hanoi`, `danang`; giữ `driving`, `walking`, `motorcycle` |
| Registry MCP | 9 tool; giữ tên/input 8 tool cũ, thêm `calculate_route_between_entities` |
| Housing search/detail | Thêm `location_accuracy`, `location_method`, `deposit` |
| Route theo ID | Tra listing/POI còn hoạt động, giữ chiều origin → destination, dùng chung OSRM |
| Kiểm tra vùng | Cả hai endpoint phải nằm trong bounds city đã chọn |
| Độ ổn định | Deadline MCP, hủy fetch OSRM, timeout SQL, mã lỗi có `retryable` |
| API hiện có | Nhận field housing mới qua service chung; có ánh xạ lỗi TIMEOUT/CANCELLED |
| Dữ liệu | Dùng DB hiện có; không cần migration mới cho các trường đã lưu |
| Tài liệu | README và spec housing/routing/MCP cập nhật; spec mobility cũ được đánh dấu chưa triển khai |

Location cung cấp công cụ và bằng chứng. Graph quyết định hỏi lại, chọn ứng viên,
xếp hạng và nới điều kiện. Không bổ sung alias, geocoder địa chỉ bất kỳ, LLM nội bộ,
`get_manifest`, `run_task`, báo giá Moving hoặc job TTL trong đợt này.

## 2. Registry chính xác

| Tool | Dùng khi |
|---|---|
| `search_areas` | Tìm tỉnh/thành/quận/phường; lấy `area_id` |
| `resolve_location` | Tìm ứng viên địa danh/POI; đọc `entity_type`, `ambiguous`, `match_type`, nguồn |
| `search_places` | Tìm POI theo tên/category/bộ lọc không gian |
| `get_place` | Lấy chi tiết bằng `place_id` |
| `find_nearby_places` | Một POI gần nhất cho mỗi category theo khoảng cách thẳng |
| `search_housing` | Lọc nhà bằng điều kiện đã truyền, có cursor và bộ lọc commute |
| `get_housing` | Lấy chi tiết bằng `listing_id` |
| `calculate_route` | Tính tuyến giữa hai tọa độ đã biết |
| `calculate_route_between_entities` | Tính tuyến giữa hai endpoint housing/place/coordinate |

Graph lấy schema bằng `tools/list`, không hardcode danh mục từ tài liệu cũ.
`reverse_location`, `check_service_area`, `estimate_delivery` không có trong registry.

## 3. Contract housing bổ sung

Áp dụng cho từng item `search_housing.results` và kết quả `get_housing`:

```json
{
  "location_accuracy": "approximate",
  "location_method": "source_api",
  "deposit": null
}
```

- Accuracy có ba giá trị: `rooftop`, `approximate`, `unknown`. Giá trị không có/
  không nhận diện trong nguồn được trả `unknown`; không tự nâng độ chính xác.
- `location_method` là chuỗi từ nguồn hoặc `null`; không suy ra từ tọa độ.
- Nếu nguồn có cọc: `deposit: {"amount": 28000000, "currency": "VND"}`.
  Cọc dùng currency của offer hiện hành. `null` nghĩa chưa biết, không phải 0.
- `source`, `verification`, `address`, `unknown_fields` cũ vẫn tồn tại.
  Đọc các field mới trực tiếp; `unknown_fields` không được mở rộng để liệt kê cọc/accuracy.
- `contract_version` của housing search **giữ `1.0.0`**. Đây là bổ sung field;
  graph có parser cấm field lạ phải cập nhật trước khi triển khai. Giữ version
  không đồng nghĩa mọi parser cũ tự tương thích.
- Tin active không xác nhận còn trống. Thời điểm thu thập/xác minh khác thời điểm
  căn nhà được chủ nhà xác nhận còn cho thuê. Chưa có chính sách tự làm stale mới.

Schema nguồn: [housing.ts](../../Maps%20VN/LifeFlow/packages/contracts/src/housing.ts).

## 4. Tool mới: `calculate_route_between_entities`

### Input

```typescript
type Endpoint =
  | { type: 'housing'; listing_id: string } // UUID listing, không phải property ID
  | { type: 'place'; place_id: string }     // UUID POI, không phải area ID
  | { type: 'coordinate'; location: { lng: number; lat: number } };

type Input = {
  city: 'hcm' | 'hanoi' | 'danang';
  origin: Endpoint;
  destination: Endpoint;
  profile?: 'motorcycle' | 'walking' | 'driving'; // mặc định motorcycle
  snap_radius_m?: number; // > 0, <= 1000; mặc định 100
};
```

Endpoint từ chối field ID của loại khác. Tên tự do và viết tắt phải được graph
làm rõ rồi tra ID trước. Không tự lấy kết quả tìm kiếm đầu tiên.

Ví dụ gọi ngay được khi graph HCM hoạt động:

```json
{
  "city": "hcm",
  "origin": {"type": "coordinate", "location": {"lng": 106.7009, "lat": 10.7769}},
  "destination": {"type": "coordinate", "location": {"lng": 106.7218, "lat": 10.7952}},
  "profile": "motorcycle",
  "snap_radius_m": 100
}
```

Khi đã tìm được nhà, thay `origin` bằng
`{"type":"housing","listing_id":"<UUID thực từ search_housing>"}`.
Khi đã chọn POI, thay `destination` bằng
`{"type":"place","place_id":"<UUID thực từ search_places>"}`.
Các chuỗi `<...>` là placeholder, không phải input hợp lệ để gọi trực tiếp.

### Output

```typescript
type EndpointResult = {
  type: 'housing' | 'place' | 'coordinate';
  canonical_id: string | null;
  location: { lng: number; lat: number };
  address: Record<string, unknown> | null;
  location_accuracy: 'rooftop' | 'approximate' | 'unknown';
  location_method: string | null;
  source: {
    type: string;
    source_id: string;
    source_url: string | null;
    observed_at: string | null;
  } | null;
};
type Output = {
  city: 'hcm' | 'hanoi' | 'danang';
  profile: 'motorcycle' | 'walking' | 'driving';
  origin: EndpointResult;
  destination: EndpointResult;
  route: {
    code: 'Ok';
    distance_meters: number;
    duration_seconds: number;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    snap_distances_meters?: [number, number];
  };
  warnings: {
    code: 'APPROXIMATE_LOCATION' | 'UNKNOWN_LOCATION_ACCURACY';
    endpoint: 'origin' | 'destination';
  }[];
};
```

Tọa độ truyền trực tiếp có accuracy `unknown`, ID/address/source/method `null`.
Housing lấy metadata từ listing, POI lấy từ catalog và nguồn liên quan;
không có nguồn/thời điểm hợp lệ thì không tạo thông tin giả.
Listing không có offer hiệu lực, inactive/deleted hoặc ID sai loại trả `NOT_FOUND`.
POI loại `housing_anchor` không được dùng dưới `type: 'place'`; dùng listing ID.

Vị trí approximate/unknown vẫn có thể tính tuyến, kèm warning. `snap_radius_m`
chỉ giới hạn khoảng lệch điểm → đường, không sửa độ chính xác của vị trí nguồn.
Thời gian OSRM là ước tính theo graph, không phải giao thông thời gian thực.
Đảo origin/destination có thể đổi tuyến; không reuse cache hai chiều như nhau.

Schema chuẩn: [route.ts](../../Maps%20VN/LifeFlow/packages/contracts/src/route.ts).
Service: [route-endpoint-service.ts](../../Maps%20VN/LifeFlow/packages/housing-query/src/route-endpoint-service.ts).
Tool mới có ở MCP; chưa thêm REST endpoint riêng.

## 5. Lỗi và ngân sách thời gian

Thành công: MCP trả `structuredContent` và JSON trong text content.
Lỗi trong handler trả `isError: true`, JSON trong text content, ví dụ:

```json
{"code":"OUTSIDE_ROUTING_AREA","retryable":false,"message":"origin is outside the hcm routing bounds."}
```

| Code | Retryable | Ý nghĩa |
|---|---|---|
| `VALIDATION_ERROR`, `QUERY_VALIDATION_ERROR` | false | Input/filter sai; sửa request |
| `NOT_FOUND` | false | Không có thực thể hoạt động đúng loại ID |
| `OUTSIDE_ROUTING_AREA` | false | Có endpoint ngoài bounds city được chọn |
| `NO_ROUTE` | false | OSRM không có route/segment phù hợp |
| `INVALID_RESPONSE` | false | Payload OSRM sai cấu trúc/bằng chứng snap sai |
| `OSRM_OFFLINE` | true | Không kết nối được hoặc HTTP upstream lỗi |
| `TIMEOUT` | true | Hết budget tool, OSRM hoặc SQL |
| `CANCELLED` | false | Caller hủy request |
| `UNAVAILABLE` | true | Nhóm lỗi DB/network đã ánh xạ |
| `INTERNAL_ERROR` | false | Lỗi chưa phân loại; ghi nhận để điều tra |

Validation do SDK chặn trước handler có thể trả lỗi MCP theo SDK, không có cùng
JSON envelope. Graph cần xử lý cả lỗi giao thức/transport và `isError`.
HTTP thiếu/sai bearer token bị từ chối trước tool. `retryable: true` chỉ cho biết
có thể thử lại, graph vẫn phải giới hạn số lần và tổng budget.

- Deadline **15 giây/mỗi MCP tool**. Housing search gọi trực tiếp cũng có budget 15 giây.
- Mỗi fetch OSRM tối đa **10 giây**, chịu deadline tổng còn lại và tín hiệu hủy của MCP.
- Query ứng dụng có PostgreSQL `statement_timeout` tối đa **8 giây**, giảm theo
  budget còn lại; chờ lấy connection tối đa **5 giây** theo pool hiện có.
- SQL đang chạy chưa có cơ chế gửi cancel tức thì khi caller hủy; statement timeout
  giới hạn thời gian còn chiếm connection. Rollback/release khi query kết thúc.
- Timeout SQL dùng `SET LOCAL` trong transaction từng query, không lưu vào session
  và không áp vào raw pool của pipeline ingestion/migration.
- Dừng phát thêm batch commute sau hủy/hết hạn; tối đa 4 route đồng thời mỗi batch.
  Audit là best effort ngoài đường trả response; lỗi ghi audit không đổi kết quả tool.
- API REST không có deadline tổng/cancellation đồng nhất trên tất cả endpoint;
  không suy rộng cam kết MCP sang mọi request API.

Commute vẫn loại ứng viên `NO_ROUTE`/`OUTSIDE_ROUTING_AREA`, phản ánh qua diagnostics.
OSRM offline/timeout/response lỗi không bị đổi thành trang rỗng thành công.
Trang rỗng có `next_cursor` chưa phải kết luận hết nhà phù hợp.

## 6. Phạm vi vùng và số liệu DB local

Bounds đang dùng để chọn/kiểm tra graph, không phải địa giới hành chính hay vùng phục vụ Moving:

| City | West | South | East | North | Active rent VND/month trong bbox |
|---|---:|---:|---:|---:|---:|
| hcm | 106.34 | 10.34 | 107.05 | 11.20 | 28.947 |
| hanoi | 105.28 | 20.55 | 106.04 | 21.40 | 4.910 |
| danang | 107.78 | 15.88 | 108.42 | 16.30 | 3.284 |

Đếm trên DB local ngày 2026-09-29 bằng join listing/property/place/current_offers,
cùng điều kiện active/deleted và lọc rent/VND/month. Đây là thống kê theo tọa độ
trong bbox; khác thống kê theo nhãn địa chỉ nguồn ở tài liệu trước, không được so
trực tiếp như cùng một định nghĩa thành phố. Không đảm bảo DB của leader đã có cùng snapshot.

`search_areas` đã thử không dấu `Go Vap`, `Hoan Kiem`, `Hai Chau`, có và không có
bbox. Có trả Phường Gò Vấp, Phường Hoàn Kiếm, Phường Hải Châu; không có bbox,
“Hai Chau” còn khớp Xã Hải Châu ở nơi khác. Có thể có fuzzy match và đơn vị cấp
nhỏ hơn trong cùng vùng. Graph đọc level/parent/match, dùng bbox khi có ngữ cảnh;
không coi mọi kết quả là cùng địa danh. Không thêm quy tắc hiểu viết tắt.

## 7. Bằng chứng kiểm thử

- `npm run build`: pass contracts, housing-query, platform-api, mcp-server.
- `npm test`: **93 passed, 9 skipped**. Các ca bỏ qua thuộc
  `platform-api/tests/poi-v2.integration.test.ts`, cần `RUN_POI_V2_INTEGRATION=1`;
  không được tính là đã kiểm chứng pipeline POI trong đợt này.
- Frontend: `npm exec -- tsc -b` trong `map-app`: pass.
- Test mới: endpoint union/UUID/field sai loại; housing cọc có/null, accuracy;
  housing→POI, POI→housing, housing→housing, housing→coordinate; ID không tồn tại,
  listing stale; direction; payload OSRM sai; outside; cancellation; deadline;
  rollback/release SQL. Test MCP stdio/HTTP xác nhận registry 9 tool và bearer auth.
- SQL thật `pg_sleep(1)` dưới budget 100 ms: `TIMEOUT`; query kế tiếp dùng cùng
  pool thành công, `SHOW statement_timeout` trở về 0 (không rò cấu hình session).
- Docker build image `lifeflow-location-mcp:0.1.0`: pass. Container kiểm thử HTTP
  trả đủ 9 tool, lấy nhà thật có accuracy `approximate`, method `source_api`, cọc
  null; tool mới trả tuyến 1.651,2 m cùng hai warning và lỗi ngoài vùng đúng envelope.

### OSRM thật: 3 thành phố × 3 profile

Tọa độ thử (lng, lat), snap 100 m:

| City | Origin | Destination | Driving (m) | Walking (m) | Motorcycle (m) |
|---|---|---|---:|---:|---:|
| hcm | 106.7009, 10.7769 | 106.7218, 10.7952 | 4.648,2 | 3.800,9 | 4.748,7 |
| hanoi | 105.8432, 21.0278 | 105.8542, 21.0350 | 2.537,5 | 1.591,8 | 1.695,5 |
| danang | 108.2208, 16.0678 | 108.2350, 16.0600 | 2.813,3 | 2.360,0 | 2.696,6 |

Mỗi city còn thử từ origin trên đến `(west + 0.001, south + 0.001)`:
cả ba profile trả `NO_ROUTE`. Điểm trong bbox có thể không có đường gần đủ
hoặc không có graph phủ tới. **Chưa chứng nhận phủ kín bbox/địa giới**, chưa rebuild graph.

### Đo sơ bộ local, không phải SLA

Máy local Intel Core i7-10850H (12 logical CPU), RAM 16 GiB, Node 24.19.0,
Windows + Docker Desktop, PostGIS 16/3.5, graph OSRM hiện có; request tuần tự,
5 mẫu/loại/city, không có tải đồng thời. p50 là mẫu thứ 3, p95 theo nearest rank
là mẫu lớn nhất trong 5 mẫu; số mẫu nhỏ chỉ dùng phát hiện bất thường ban đầu.

| City | Housing search p50/p95 (ms) | Nearby p50/p95 (ms) | Commute p50/p95 (ms) |
|---|---:|---:|---:|
| hcm | 164 / 553 | 17 / 110 | 208 / 236 |
| hanoi | 76 / 211 | 14 / 49 | 156 / 173 |
| danang | 64 / 126 | 12 / 40 | 124 / 152 |

Search: tâm origin của bảng OSRM, radius 5 km, limit 5. Nearby:
`find_nearby_places`, hospital + school, mỗi category max 3 km (2 SQL, 0 OSRM).
Commute: tâm origin, radius 3 km, destination=origin, city tương ứng,
max_distance_m=5000, profile mặc định motorcycle, limit 5, candidate limit 100;
các trang đo trả 5 nhà và đánh giá 8 route (batch 4). Search thường dùng 1 SQL,
commute các mẫu này 1 SQL + 8 OSRM. Đo tại service, không gồm LLM/graph/network cloud.

## 8. Phía Graph cần cập nhật

1. Refresh `tools/list`, thêm tool mới vào allowlist nếu đang có allowlist.
2. Parser housing đọc thêm ba field, giữ nguyên nullable và không dùng 0 cho cọc thiếu.
3. Giữ rõ namespace `listing_id`, `place_id`, `area_id`. Truyền city/profile đúng
   nhu cầu, không tự chuyển phương tiện hoặc đổi thành phố khi lỗi.
4. Hỏi lại viết tắt/mơ hồ theo logic của graph; Location không mở rộng alias.
5. Truyền tên đầy đủ/ID/tọa độ đã xác định. Search area không thay cho POI;
   ID hành chính đưa vào `administrative_area_ids` của tool tìm kiếm.
6. Đọc accuracy/source/warnings khi trình bày route; thông báo vị trí gần đúng
   theo trải nghiệm hội thoại của graph. Không khẳng định khoảng cách từ đúng cửa nhà.
7. Xử lý cursor kể cả trang rỗng; giới hạn số trang theo budget. Không tự nới filter
   trong adapter Location. Amenities dùng slug thực, xem
   [từ vựng snapshot](location-service-response.md#24-slug-amenities-thực-sự-có-trong-nguồn).
8. Phân biệt `isError`, lỗi MCP, lỗi HTTP/transport; retry hữu hạn. Hủy request
   phụ thuộc khi graph hết budget. Chuỗi nhiều tool không được hứa hoàn tất trong 20 giây
   chỉ vì từng tool có deadline 15 giây.
9. Viết bài tích hợp phía graph với: tên trùng nhiều thành phố; viết tắt; ID stale;
   cọc null; accuracy approximate; trang rỗng còn cursor; route ngoài vùng;
   OSRM offline; token sai; parser field bổ sung; caller cancellation.

Graph có thể ghép công cụ theo nhu cầu: tìm nhà → lấy ID/metadata → chọn POI →
tính route; hoặc dùng `search_housing.commute` để lọc ngay. Đây là khả năng của
công cụ, không phải workflow bắt buộc cài bên trong Location.

## 9. Lấy code mới và triển khai lại

Từ thư mục `Maps VN/LifeFlow` sau khi lấy code:

```powershell
npm ci
npm run build
# Sau khi database/OSRM đã chạy và .env trỏ đúng môi trường kiểm thử:
npm test
docker compose --env-file .env -f infra/compose.yaml build location-mcp
docker compose --env-file .env -f infra/compose.yaml up -d location-mcp
```

Tag package/image vẫn là `0.1.0`; cần rebuild, không chỉ restart container dùng
image cũ. Khi release, leader nên đặt `MCP_IMAGE_TAG` theo commit/release để truy vết.
Không có migration mới trong đợt này và không sửa checksum migration đã apply.
Restore backup đúng bộ dữ liệu nếu triển khai máy mới; cấu hình DB, chín OSRM URL,
MCP token và reverse proxy/TLS theo môi trường. Các lệnh trên không tự chuyển dữ liệu
từ máy cá nhân lên cloud. Không đưa `.env`/token lên Git.

Không tạo ZIP hoặc bản sao data trong đợt này. Container kiểm thử tạm được xóa;
PostGIS/chín OSRM được trả về trạng thái dừng như trước khi kiểm thử. Image build
mới được giữ để dùng lại. Bản bàn giao source được đưa lên nhánh `QuangDung`
theo yêu cầu; leader cần pull và rebuild image để nhận thay đổi.

### Còn phải nghiệm thu trước production

- Graph cập nhật parser và chạy bài hội thoại đầu cuối của chính mình.
- Kiểm tra data snapshot/độ mới, độ phủ vùng ngoại vi và nhu cầu thực tế của người dùng.
- Đo tải đồng thời/p50/p95/timeout trên VM đích; kiểm tra DB/OSRM/token từ container thật.
- Xác minh cancellation xuyên client/proxy khi mất kết nối; SQL đang chạy vẫn dựa
  vào statement timeout, không tuyên bố cancel tức thì toàn hệ thống.

Các mục trên là giới hạn nghiệm thu môi trường/product; agent thông minh không thể
bù cho dữ liệu thiếu, vị trí sai hoặc đường chưa có trong graph.
