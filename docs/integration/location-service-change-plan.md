# Kế hoạch thay đổi Location service để duyệt

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Ngày: 2026-09-29. Trạng thái: **Đã được yêu cầu triển khai; code và kiểm thử local đã cập nhật**.

Xem [trạng thái triển khai và bàn giao graph](location-service-implementation-status.md)
để biết kết quả thực tế, schema và các giới hạn còn lại. Nội dung bên dưới
giữ lại kế hoạch đã duyệt; câu chữ “đề xuất/chờ duyệt” là ngữ cảnh trước khi
triển khai. Chưa chứng nhận SLA/độ phủ toàn thành phố trên VM production.

Căn cứ: code nhánh `QuangDung`, commit `86d12f909527c208f9f188985d89c83566bbdd37`, [yêu cầu tích hợp](../../location-service-requests.md) và [bản đối chiếu kỹ thuật](location-service-response.md).

Kế hoạch này cập nhật các quyết định so với bản phản hồi trước: hỗ trợ **Hà Nội, Đà Nẵng và TP.HCM**; dùng dữ liệu vị trí housing hiện có theo hướng B; phạm vi của Location là cung cấp công cụ và dữ liệu. Việc viết subagent, chọn chiến lược, xếp hạng và hội thoại thuộc phía agent. **Không bổ sung alias hoặc tự diễn giải viết tắt trong Location; graph hỏi lại người dùng để có tên đầy đủ trước khi gọi tool.** Các đề xuất một thành phố demo, geocoder hướng A và remote subagent trong bản phản hồi trước không được coi là phạm vi đã duyệt của kế hoạch này.

## 1. Phạm vi dự kiến

| Nội dung | Quyết định trong kế hoạch |
|---|---|
| Thành phố | Giữ cả `hanoi`, `danang`, `hcm`; kiểm tra dữ liệu và tuyến cho từng thành phố |
| Phương tiện | Giữ `walking`, `motorcycle`, `driving` và chín graph OSRM hiện có |
| Nhà ở | Tìm/lọc, lấy chi tiết, trả vị trí, nguồn, độ chính xác và tiền cọc nếu có |
| POI và địa giới | Tìm địa điểm/khu vực; cung cấp ứng viên và tiện ích gần một tọa độ |
| Định tuyến | Tính tuyến theo tọa độ, bổ sung thao tác định tuyến theo ID thực thể |
| Agent | Tự chọn tool, ứng viên, điểm đi/đến, phương tiện, tiêu chí xếp hạng, nới điều kiện và cách hội thoại |
| Chuyển đồ | Moving xử lý vùng phục vụ và báo giá của đối tác; phạm vi dữ liệu ba thành phố của Location không đồng nghĩa đối tác phục vụ cả ba |
| Tuyến liên tỉnh | Chưa cam kết hỗ trợ bởi chín graph theo thành phố; không tự ghép nhiều graph thành tuyến liên tỉnh |

## 2. Hiểu đúng hướng B và câu hỏi “có viết thêm tool không?”

**Có đề xuất viết thêm một tool, nhưng định tuyến từ nhà tới địa điểm đã có thể thực hiện bằng các tool hiện tại.** Tool mới giúp gọi bằng ID, gom thao tác tra tọa độ và cung cấp nguồn/độ chính xác thống nhất.

Hướng B trong tài liệu yêu cầu ban đầu là tận dụng tọa độ của `housing_anchor`: mỗi tin nhà đã publish có liên kết tới một điểm trong `catalog.places`. Đây là **nguồn tọa độ**, không phải bản thân thuật toán định tuyến. Tuyến đường vẫn do OSRM tính.

Hiện agent có thể làm:

```text
get_housing(listing_id)                 → tọa độ của nhà
resolve_location(text) / get_place(id) → ứng viên / tọa độ đích
calculate_route(origin, destination)   → đường đi, khoảng cách, thời gian
```

Nếu đã có tọa độ trong kết quả `search_housing`, agent có thể dùng ngay và không bắt buộc gọi lại `get_housing`. Nếu muốn tìm các nhà thỏa điều kiện di chuyển tới một điểm, `search_housing.commute` đã phục vụ trường hợp đó.

| Tình huống | Công cụ phục vụ | Có cần thêm tool? |
|---|---|---|
| Nhà đã biết → POI đã biết | Các tool hiện tại ghép được | Tool mới là thao tác tiện dụng theo ID |
| POI → nhà, nhà → nhà, nhà → tọa độ người dùng cung cấp | Tra vị trí rồi dùng OSRM | Dùng chung tool mới, không viết một tool riêng cho mỗi chiều |
| Nhà → tiện ích gần đó | `find_nearby_places`, sau đó tính tuyến nếu cần | Không cần một tool tìm tiện ích riêng cho housing |
| Tìm nhà gần nơi làm việc trong 20 phút | `search_housing` với `commute` | Đã có; bổ sung kiểm tra lỗi/deadline |
| “25 Nguyễn Trãi” nhưng địa chỉ này không có listing hoặc POI đã xác định | Chưa có nguồn tọa độ bảo đảm | Hướng B không giải quyết được địa chỉ bất kỳ |
| Tra địa chỉ chữ trong các tin nhà đã có | Có thể dùng `search_housing.text`, agent chọn listing trả về | Không gọi kết quả này là geocode địa chỉ chính xác; hiện đây là tìm chuỗi trong title/description/address |

**Không thêm `geocode_address` trong đợt này.** Nếu sau này cần API tìm riêng địa chỉ housing theo số nhà/đường, phải duyệt một hạng mục khác: thiết kế cách so khớp và trả ứng viên, đo độ phủ, không tự chọn listing đầu tiên. Đây không phải điều kiện để tính tuyến từ một nhà đã có ID.

## 3. Tool chỉ cung cấp công cụ: ranh giới cụ thể

| Location phải làm | Vì sao thuộc trách nhiệm công cụ |
|---|---|
| Kiểm tra schema, ID tồn tại, trạng thái bản ghi và tọa độ hợp lệ | Đầu vào sai phải được phát hiện trước khi query hoặc gọi OSRM |
| Trả ứng viên, nguồn, độ chính xác, trường thiếu, lỗi rõ ràng | Agent cần biết bằng chứng và giới hạn của kết quả để tự quyết định |
| Áp đúng filter/sort mà caller truyền vào | Đây là thực thi yêu cầu, không tự đặt sở thích thay agent |
| Tính tuyến đúng chiều, profile và graph đã yêu cầu | Tránh kết quả từ sai dữ liệu định tuyến |
| Có timeout, giới hạn tải và không âm thầm đổi cách tính | Một tool ổn định phải có giới hạn vận hành rõ ràng |

Agent quyết định hỏi lại người dùng hay chọn ứng viên nào, xếp hạng theo tiêu chí gì, có nới filter hay không, và có dùng tọa độ gần đúng cho bước sau hay không. Tool trả `approximate` hoặc cảnh báo dữ liệu; không tự dừng để hỏi người dùng và không trả trạng thái hội thoại `needs_input` thay cho dữ liệu/lỗi tool.

Không triển khai `get_manifest`, `run_task`, LLM nội bộ hoặc bộ xếp hạng sở thích trong phạm vi này. `tools/list` tiếp tục là danh mục công cụ MCP. `search_housing` giữ các khả năng lọc/sort hiện có; không tự nới ngân sách, bán kính, thành phố hay amenities khi không có kết quả.

## 4. Tool mới đề xuất: `calculate_route_between_entities`

### 4.1. Input

Tên và schema dưới đây là đề xuất để duyệt; chưa có trong registry hiện tại.

```typescript
type RouteEndpoint =
  | { type: 'housing'; listing_id: string } // UUID của listing
  | { type: 'place'; place_id: string }     // UUID của POI
  | { type: 'coordinate'; location: { lng: number; lat: number } };

type Request = {
  city: 'hanoi' | 'danang' | 'hcm';
  origin: RouteEndpoint;
  destination: RouteEndpoint;
  profile?: 'walking' | 'motorcycle' | 'driving'; // mặc định motorcycle
  snap_radius_m?: number; // đề xuất mặc định 100 m cho tool mới, tối đa 1000 m
};
```

Mỗi endpoint chỉ nhận đúng các field của loại được chọn. Không nhận tên địa điểm tự do ở tool định tuyến: agent dùng tool tìm kiếm để lấy ứng viên/ID trước. Nhờ vậy, tool không phải âm thầm chọn giữa nhiều bệnh viện, trường học hoặc địa chỉ trùng tên.

`city` bắt buộc để lựa chọn graph rõ ràng. Không tự suy ra thành phố từ nhãn địa chỉ chưa chuẩn hóa. `origin` và `destination` thể hiện chiều đi; không tự đảo chiều vì đường một chiều có thể làm hai chiều cho kết quả khác nhau.

### 4.2. Output

```typescript
type EndpointResult = {
  type: 'housing' | 'place' | 'coordinate';
  canonical_id: string | null; // listing_id hoặc place_id; null cho tọa độ truyền trực tiếp
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

type Response = {
  city: 'hanoi' | 'danang' | 'hcm';
  profile: 'walking' | 'motorcycle' | 'driving';
  origin: EndpointResult;
  destination: EndpointResult;
  route: RouteResult; // dùng lại contract OSRM hiện tại
  warnings: Array<{
    code: 'APPROXIMATE_LOCATION' | 'UNKNOWN_LOCATION_ACCURACY';
    endpoint: 'origin' | 'destination';
  }>;
};
```

`source` của endpoint housing/place lấy từ dữ liệu có sẵn; cần chốt tái sử dụng schema nguồn hiện tại khi triển khai để không tạo hai định nghĩa lệch nhau. Tọa độ caller truyền trực tiếp có `source: null`, accuracy `unknown`; không tự gắn là vị trí GPS đã xác minh. POI chưa có metadata accuracy cũng trả `unknown`.

### 4.3. Logic và lý do

1. **Validate request.** UUID, tọa độ, profile, loại endpoint và snap radius sai thì trả lỗi validation. Không đổi đầu vào để cố tạo kết quả.
2. **Tra endpoint theo đúng loại.** Housing dùng `listing_id` → property → place; POI dùng `place_id` và loại trừ housing anchor ở nhánh POI. Với coordinate dùng tọa độ truyền vào. Dùng chung quy tắc active/deleted với service hiện tại.
3. **Chỉ đọc dữ liệu cần cho endpoint.** Tránh tải media hoặc toàn bộ chi tiết nhà chỉ để lấy tọa độ. Tách helper/repository nội bộ dùng chung, không để tool mới gọi vòng qua HTTP tới chính server.
4. **Kiểm tra hai điểm với vùng graph đã chọn.** Code hiện tại chọn URL bằng city và `inferCity` chỉ kiểm tra một tọa độ khi được gọi. Bổ sung kiểm tra cả hai đầu, cùng cấu hình vùng graph; điểm ngoài vùng trả `OUTSIDE_ROUTING_AREA`. Bbox chỉ là kiểm tra sơ bộ, OSRM mới xác định có tuyến. Đây không phải kiểm tra vùng AhaMove.
5. **Gọi lại `RouteService.calculate`, không viết engine tuyến thứ hai.** Giữ đúng thứ tự hai điểm, profile và snap radius. Khoảng cách snap cho biết OSRM kéo điểm tới mạng đường bao xa; mặc định 100 m của tool mới nhằm giới hạn việc bám sang đường xa mà caller không biết. Caller có thể chọn giá trị khác trong giới hạn đã công bố.
6. **Trả route và metadata hai điểm.** Tọa độ gần đúng vẫn có thể tính tuyến và trả warning. Quyết định tiếp tục sử dụng, xin xác nhận hoặc chọn điểm khác thuộc agent.
7. **Giữ nguyên ý nghĩa lỗi.** OSRM lỗi không được thay bằng khoảng cách thẳng rồi gọi là tuyến đường. ID không tồn tại/không còn được phép truy vấn phải được báo rõ, không tra nhà khác thay thế.

Giới hạn: thời gian OSRM là ước tính từ graph/profile; không gọi đó là ETA giao hàng trực tiếp hay báo giá đối tác. Nhãn `rooftop` của nguồn housing chưa phải xác minh thực địa.

### 4.4. Có trùng tool cũ không?

`calculate_route` vẫn là primitive cho hai tọa độ. Tool mới là thao tác có thêm tra cứu thực thể và provenance. Cả hai dùng cùng service định tuyến. Agent được chọn cách gọi phù hợp, không bắt buộc chuyển sang tool mới.

Nếu duyệt chỉ giữ tool primitive, có thể bỏ riêng hạng mục tool mới mà vẫn thực hiện được nhà → địa điểm bằng các tool sẵn có. **Phương án đề xuất để duyệt ở đây là thêm đúng một tool**, nâng registry từ 8 lên 9, vì giảm việc client tự nối ID với tọa độ và metadata ở mỗi ứng dụng.

## 5. Các sửa đổi cần đi cùng

| Hạng mục | Hiện trạng | Thay đổi đề xuất | Vì sao cần |
|---|---|---|---|
| Accuracy của nhà | Map có field chuẩn; detail có extra_attributes; search chưa có field chuẩn | Expose `location_accuracy` và `location_method` đồng nhất trong search/detail | Mọi caller đọc được giới hạn vị trí mà không phụ thuộc cấu trúc attributes nội bộ |
| Tiền cọc | DB có deposit_amount, response chưa có | `deposit: {amount, currency} \| null` cho search/detail | Trả dữ liệu đã có; không ép cọc thành tiền thuê theo tháng hoặc mặc định bằng 0 |
| Địa chỉ | Dữ liệu có housenumber/street/ward/district/city/country và raw | Ghi rõ contract, giữ field thiếu là null/không có theo schema đã chốt | Client không nhầm `city` với `province` hoặc `housenumber` với `house_number` |
| Vocabulary amenities | Importer lưu slug nguồn, filter khớp chính xác | Công bố/version danh sách slug và mô tả; graph chịu trách nhiệm gửi slug chuẩn | Không chuyển yêu cầu thành slug không tồn tại hoặc đồng nhất “có bếp” với “cho nấu ăn” |
| Tên địa danh | Có normalize bỏ dấu/chữ hoa và tìm ứng viên; chưa có bảng alias | Giữ xử lý tìm kiếm hiện tại; nhận tên đầy đủ do graph cung cấp, không thêm alias cho Q10/BV/ĐH/HCM… | Việc hiểu viết tắt và hỏi lại người dùng thuộc graph; Location chỉ truy vấn theo đầu vào và trả ứng viên thực tế |
| Filter không gian | Bbox và center/radius có quy tắc khác nhau; area là polygon | Tài liệu hóa, kiểm tra schema và test ba thành phố; không âm thầm đổi filter | Agent được biết chính xác công cụ đã lọc điều gì |
| Vùng định tuyến | inferCity dùng bbox; calculate chưa kiểm tra tường minh cả hai đầu | Dùng chung cấu hình vùng graph và kiểm tra cả origin/destination; kiểm tra hồi quy tool cũ/commute | Tránh chọn graph thành phố này cho điểm ở thành phố khác |
| Lỗi | Timeout OSRM đang gộp OSRM_OFFLINE; lỗi handler có JSON trong text | Tách timeout và unavailable theo contract đã thống nhất; bổ sung ngữ cảnh endpoint lỗi | Caller phân biệt input sai, thiếu dữ liệu và sự cố để tự quyết định retry |
| Deadline | Timeout từng OSRM có; deadline toàn search/SQL chưa đầy đủ | Giới hạn thời gian toàn thao tác, truyền cancellation xuống phụ thuộc, giới hạn concurrency | Tool không tiếp tục gây tải lâu sau khi caller đã hết thời gian; không tự quản chiến lược retry của agent |
| Độ mới dữ liệu | Có observed_at/status và lịch sử offer; chưa có TTL tự động | Công bố observed_at, trạng thái và chính sách nguồn; thiết kế TTL sau khi chốt quy tắc nghiệp vụ | Không coi tin cũ còn active là xác nhận căn vẫn trống |

Không tự áp một TTL mới trong đợt sửa tool. Nếu nhóm muốn chạy job stale, cần duyệt riêng ngưỡng, phân biệt snapshot đầy đủ/một phần, bảo vệ bản ghi đã xác minh và cách khôi phục. Import thêm dữ liệu hiện tại vẫn dùng importer/version nguồn sẵn có.

## 6. Ba thành phố: kiểm tra theo từng vùng

Từ thống kê nguồn đã đối chiếu, số bản ghi active/rent/VND/month sau bước lọc quarantine/trùng ID là HCM **28.924**, Hà Nội **4.885**, Đà Nẵng **3.271**. Đây là phân nhóm theo nhãn địa chỉ nguồn, chưa thay cho thống kê query trên DB đích.

Cho từng thành phố cần:

1. Xác nhận dữ liệu nhà, giá, địa chỉ, POI và địa giới trên DB triển khai; dùng cùng điều kiện truy vấn của service.
2. Thử tên đầy đủ của địa danh cùng tên ở nhiều thành phố, không dấu và quận/phường cũ; trả rỗng hoặc nhiều ứng viên đúng bản chất dữ liệu. Viết tắt là ca kiểm tra hội thoại phía graph: hỏi lại để có tên đầy đủ. Không yêu cầu Location mở rộng viết tắt hoặc cố tình từ chối chuỗi mà tìm kiếm hiện tại đã khớp.
3. Kiểm tra walking/motorcycle/driving với các điểm bên trong, gần biên và ngoài graph. Vùng graph không mặc nhiên bằng địa giới hành chính mới.
4. Đo latency riêng cho từng thành phố với search thường, nearby và commute. Chưa đặt SLA dựa trên số liệu thành phố khác.

Không ràng buộc khả năng tìm nhà của Location vào thành phố demo của chatbot hoặc vùng phục vụ của Moving. Nếu Moving chỉ phục vụ một phần trong ba thành phố, service đó trả khả năng phục vụ theo dữ liệu của họ.

## 7. File dự kiến thay đổi

Các đường dẫn bên dưới tính từ `Maps VN/LifeFlow/`. Đây là danh sách dự kiến, không phải các file đã sửa.

| Nhóm | File/module | Nội dung |
|---|---|---|
| Contract | `packages/contracts/src/housing.ts` | Accuracy, location_method, deposit nullable |
| Contract | `packages/contracts/src/route.ts`, `src/index.ts` | Endpoint union, request/response cho tool mới, exports; tái sử dụng schema nguồn |
| Query housing | `packages/housing-query/src/housing-service.ts` | Select/map trường mới; tách helper endpoint nếu cần |
| Query endpoint | Module mới đề xuất `packages/housing-query/src/route-endpoint-service.ts` | Tra housing/place/coordinate, source/accuracy, gọi RouteService |
| Query routing | `packages/housing-query/src/route-service.ts`, `errors.ts` | Validation vùng hai đầu, deadline và phân loại lỗi |
| Search địa danh | `packages/housing-query/src/location-service.ts` | Rà filter/ứng viên theo ba thành phố; không thêm bảng alias hoặc logic hiểu viết tắt |
| MCP | `mcp-server/src/tools/routing-tools.ts`, `tools/types.ts`, `runtime.ts`, `tools/audit.ts` | Đăng ký/wire tool mới, error envelope và deadline |
| API hiện có | `platform-api/src/app.ts` khi cần đồng bộ lỗi | Housing API tự nhận trường mới qua service; chưa bắt buộc thêm REST endpoint cho tool mới |
| Test | Contracts, housing-query, MCP tests | Tương thích tool cũ, field mới, endpoint union, lỗi, route ba thành phố |
| Tài liệu | README, spec MCP/routing/housing và tài liệu tích hợp | Registry 9 tool, input/output, ví dụ và phạm vi thật |

Accuracy và deposit đã có nơi lưu nên **không cần migration thêm cột chỉ để expose hai field này**. Không tạo migration alias. Nếu đo hiệu năng cho thấy cần index mới thì tạo migration riêng; không sửa byte/checksum của migration đã apply. Kiểm tra cả `common.ts`, exports, lockfile và CI với chủ phần Moving khi có thay đổi chung.

## 8. Tương thích và cách nghiệm thu

### Tương thích

- Giữ tên và input của tám tool hiện có; tool mới là bổ sung.
- Thêm field housing phải được kiểm tra với parser graph: client cấm field lạ hoặc kiểm tra literal version có thể vẫn hỏng dù thay đổi mang tính bổ sung.
- Chốt version/schema với graph trước release; không tự đổi `contract_version: 1.0.0` rồi coi mọi client đã tương thích.
- Validation vùng graph ở service dùng chung có thể thay đổi lỗi của request cũ; phải thử lại `calculate_route` và `search_housing.commute`, công bố thay đổi lỗi.
- Tool mới dùng cùng DB, source và engine; không sao chép dữ liệu nhà sang một cơ sở dữ liệu độc lập.

### Nghiệm thu chức năng

| Nhóm ca | Kết quả yêu cầu |
|---|---|
| Housing → POI; POI → housing; housing → housing; housing → coordinate | Tra đúng từng loại ID, đúng chiều tuyến, có metadata nguồn |
| UUID sai, ID không có, listing inactive/deleted, place không đúng loại | Lỗi rõ ràng, không chọn thực thể khác thay thế |
| Accuracy approximate/unknown | Vẫn trả route nếu tính được, kèm metadata/warning; không tự nâng accuracy |
| Đảo chiều và đổi profile | Truyền đúng tới OSRM, không reuse sai route cache nếu có |
| Điểm khác thành phố hoặc ngoài graph; OSRM NoSegment/NoRoute | Phân biệt ngoài vùng với không có tuyến; không tự tính đường liên tỉnh |
| OSRM offline, timeout, DB lỗi, caller hủy request | Mã lỗi phù hợp và giới hạn thời gian; không trả results rỗng giả thành công |
| Cọc có/không có, accuracy có/không có | Search/detail nhất quán; cọc không có là null |
| Amenities không khớp, kết quả rỗng, địa danh mơ hồ | Không tự đổi filter, chọn nhà khác, xếp hạng theo sở thích hoặc hỏi người dùng |
| Tám tool cũ | Test hồi quy pass; primitive calculate_route vẫn dùng được |
| Ba thành phố × ba profile | Chạy kiểm tra graph thực tế, ghi lại điểm thử và kết quả; không coi test mock là chứng minh độ phủ |

Đo hiệu năng với request và cấu hình VM cụ thể, công bố p50/p95, timeout và số lời gọi phụ thuộc. Con số 20 giây của subagent là budget của phía graph; Location cung cấp đặc tính thực tế của từng tool để agent phân bổ, không tự hứa mọi chuỗi tool hoàn tất trong 20 giây.

## 9. Thứ tự triển khai đề xuất

| Bước | Kết quả giao được | Điều kiện bắt đầu bước sau |
|---|---|---|
| 1. Chốt contract | Endpoint union, output metadata, field housing, mã lỗi và version được review | Dũng duyệt kế hoạch; graph xác nhận cách parse |
| 2. Hoàn thiện dữ liệu trả về | Search/detail có accuracy/method/deposit; từ vựng và nguồn được tài liệu hóa | Tests contract và query pass |
| 3. Tool định tuyến theo thực thể | Đăng ký tool thứ 9, dùng chung RouteService, validation hai đầu và lỗi | Tests ID/direction/profile/accuracy và hồi quy pass |
| 4. Search và độ ổn định | Kiểm tra tìm kiếm với tên đầy đủ ở ba thành phố, deadline/cancellation, benchmark | Dữ liệu và graph của ba thành phố được kiểm tra |
| 5. Bàn giao tích hợp | Schema, ví dụ, lỗi, kết quả test và Docker artifact cập nhật | Graph tự chọn cách dùng tool và chạy bài test tích hợp của mình |

Trạng thái bàn giao: giữ source/tài liệu trong Git, dữ liệu trong backup riêng; không tạo lại ZIP. Xem [status dữ liệu](location-data-status.md). Backup không chứa thay đổi code/contract; cần rebuild image từ source mới.

## 10. Nội dung xin duyệt

Đề nghị duyệt phạm vi: **ba thành phố + tám tool hiện tại được hoàn thiện + một tool `calculate_route_between_entities`**, không triển khai logic agent, alias/diễn giải viết tắt hoặc geocoder địa chỉ bất kỳ trong đợt này. Graph hỏi lại người dùng khi cần làm rõ viết tắt rồi truyền tên đầy đủ hoặc ID đã xác định cho Location.

Các lựa chọn cụ thể của bản kế hoạch: tool mới nhận hai endpoint bằng ID/tọa độ, city bắt buộc, profile mặc định motorcycle, snap radius mặc định 100 m; tọa độ approximate vẫn tính tuyến với warning; accuracy/method/deposit được expose thống nhất trong search/detail.

Sau khi duyệt mới triển khai code. Những điểm cần đồng thuận liên nhóm trước release gồm version schema/error, phạm vi vùng graph, và cách graph đọc field mới. Hạng mục tự động làm stale dữ liệu chỉ triển khai khi có chính sách nguồn được duyệt riêng.

## 11. Code tham chiếu

- [Route contract](../../Maps%20VN/LifeFlow/packages/contracts/src/route.ts), [calculate_route tool](../../Maps%20VN/LifeFlow/mcp-server/src/tools/routing-tools.ts), [RouteService](../../Maps%20VN/LifeFlow/packages/housing-query/src/route-service.ts).
- [Housing contract](../../Maps%20VN/LifeFlow/packages/contracts/src/housing.ts), [HousingQueryService](../../Maps%20VN/LifeFlow/packages/housing-query/src/housing-service.ts), [housing importer](../../Maps%20VN/LifeFlow/platform-api/src/import-housing.ts).
- [Location tools](../../Maps%20VN/LifeFlow/mcp-server/src/tools/location-tools.ts), [LocationService](../../Maps%20VN/LifeFlow/packages/housing-query/src/location-service.ts), [nearby/place tools](../../Maps%20VN/LifeFlow/mcp-server/src/tools/place-tools.ts).
