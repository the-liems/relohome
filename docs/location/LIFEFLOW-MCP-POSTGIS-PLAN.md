# Kế hoạch LifeFlow MCP, PostGIS và bản đồ tùy chỉnh

> Historical record: paths, names, commands and measured results below describe the original checkout. For current operation use the [ReloHome location guide](README.md) and [local runbook](../runbooks/local-mvp.md).

> **Tài liệu khảo sát/thiết kế lịch sử — không dùng làm status hiện hành.**
>
> **Cập nhật chỉ dẫn 2026-09-29:** xem [status triển khai](../integration/location-service-implementation-status.md) và [dữ liệu/backup hiện hành](../integration/location-data-status.md). Location hiện có 9 tool, housing thật và MCP HTTP có bearer token. Các số liệu, test và kế hoạch trong ghi chép cũ bên dưới thuộc thời điểm viết, không phải thống kê DB của máy mới. ZIP cũ đã xóa; giữ dữ liệu backup riêng với source trong Git.

## Trạng thái tài liệu

- Trạng thái: nền tảng factual đã được duyệt và triển khai
- Ngày: 2026-09-24
- Phạm vi: kế hoạch kiến trúc và mốc triển khai hiện tại
- Tiến độ: đã hoàn thành Giai đoạn 1-6 cho môi trường phát triển cục bộ
- Nguyên tắc an toàn: bảo toàn toàn bộ dữ liệu OSM, OSRM, POI và PostgreSQL hiện có

Bằng chứng triển khai và các phần chưa làm cho production được ghi trong
`HOUSING-QUERY-IMPLEMENTATION.md`. Recommendation, đặt dịch vụ, thanh toán,
triển khai công khai và basemap tùy chỉnh vẫn nằm ngoài phạm vi hiện tại.

## 1. Mục tiêu

LifeFlow là agent đa dịch vụ hỗ trợ các công việc hằng ngày. Bản đồ chỉ là một
khả năng trong hệ thống lớn hơn, có thể phối hợp:

- Tìm nhà và chuyển nơi ở
- Dịch vụ chuyển nhà và vận chuyển
- Cơ sở y tế gần đó
- Chuyến bay và du lịch
- Lịch, nhắc việc và phê duyệt
- Ước tính chi phí và quy trình thanh toán
- Tích hợp với module AI Recommendation do thành phần khác sở hữu

Mục tiêu không phải sao chép mọi tính năng của Google Maps. Mục tiêu là sở hữu
một nền tảng bản đồ và vị trí LifeFlow có thể tùy chỉnh, kết hợp dữ liệu
OpenStreetMap, dữ liệu riêng của LifeFlow, dữ liệu đối tác và các workflow của
agent.

## 2. Nền tảng hiện có

Các thành phần sau đang hoạt động và phải tiếp tục được bảo toàn.

### 2.1 Dữ liệu địa lý nguồn

```text
D:\Demo AI thực chiến\Maps VN\Raw\vietnam-260922.osm.pbf
D:\Demo AI thực chiến\Maps VN\Cities\boundaries\hcm.geojson
D:\Demo AI thực chiến\Maps VN\Cities\boundaries\hanoi.geojson
D:\Demo AI thực chiến\Maps VN\Cities\boundaries\danang.geojson
D:\Demo AI thực chiến\Maps VN\Cities\pbf\hcm.osm.pbf
D:\Demo AI thực chiến\Maps VN\Cities\pbf\hanoi.osm.pbf
D:\Demo AI thực chiến\Maps VN\Cities\pbf\danang.osm.pbf
```

### 2.2 Dữ liệu POI

```text
D:\Demo AI thực chiến\Maps VN\Extracts\accommodations.osm.pbf
D:\Demo AI thực chiến\Maps VN\Extracts\hotels.osm.pbf
D:\Demo AI thực chiến\Maps VN\Extracts\accommodations.geojson
```

Nguồn `accommodations.geojson` có 13.120 địa điểm lưu trú thật. Đây chưa phải
bộ dữ liệu đầy đủ về nhà hàng, bệnh viện, siêu thị hoặc mọi loại hình kinh doanh.

### 2.3 Định tuyến

| Khu vực | Container | Cổng | Thư mục graph |
|---|---|---:|---|
| TP.HCM | `lifeflow-osrm-hcm-driving` | 5000 | `Routing/hcm/driving` |
| Hà Nội | `lifeflow-osrm-hanoi-driving` | 5001 | `Routing/hanoi/driving` |
| Đà Nẵng | `lifeflow-osrm-danang-driving` | 5002 | `Routing/danang/driving` |

Mỗi thư mục routing chứa một graph OSRM MLD hoàn chỉnh. Các file có chung tiền
tố `.osrm.*` tạo thành một graph và không được chỉnh sửa hoặc thay riêng lẻ.

### 2.4 Frontend

```text
D:\Demo AI thực chiến\Maps VN\LifeFlow\map-app
```

Frontend hiện hỗ trợ:

- Hiển thị bản đồ bằng MapLibre
- Basemap OpenFreeMap
- Kéo, thu phóng và điều khiển điều hướng
- Chuyển giữa TP.HCM, Hà Nội và Đà Nẵng
- Gom cụm POI và popup chi tiết
- Tìm kiếm trên dữ liệu POI hiện tại
- Chọn điểm A/B và định tuyến qua OSRM
- Hiển thị hình học tuyến, khoảng cách và thời gian dự kiến
- Giao diện desktop và mobile
- Tải POI theo thành phố từ Platform API, có GeoJSON fallback

Script khởi động:

```text
D:\Demo AI thực chiến\Maps VN\LifeFlow\Start-LifeFlow.ps1
```

## 3. Nguyên tắc thiết kế cốt lõi

1. MCP là giao diện dành cho agent, không phải database.
2. PostgreSQL với PostGIS là nguồn dữ liệu chuẩn cho dữ liệu nghiệp vụ và không gian.
3. OSRM tiếp tục là routing engine; không tự viết lại thuật toán định tuyến.
4. MapLibre tiếp tục là bộ hiển thị bản đồ.
5. Basemap, routing và POI nghiệp vụ là các lớp độc lập.
6. File OSM thô và graph OSRM là đầu vào/artifact bất biến.
7. Dữ liệu tùy chỉnh của LifeFlow phải tồn tại qua mọi lần cập nhật OSM.
8. LLM không bao giờ được quyền chạy SQL tùy ý.
9. Tool làm phát sinh chi phí hoặc thay đổi trạng thái phải có phê duyệt rõ ràng.
10. Mọi thao tác ghi phải audit được và có tính idempotent.
11. Housing Query chỉ lọc factual, xác định và lặp lại được; Recommendation là trách nhiệm riêng ở phía sau.

## 4. Kiến trúc mục tiêu

```text
Người dùng
  |
  v
LifeFlow Web / Mobile
  |-- Dashboard, chat và giao diện workflow
  |-- Bản đồ MapLibre
  |
  v
LifeFlow Platform API
  |-- Dịch vụ địa điểm và nhà ở
  |-- Dịch vụ workflow và phê duyệt
  |-- Adapter tích hợp
  |
  +------------------+------------------+
  |                  |                  |
  v                  v                  v
PostgreSQL/PostGIS   OSRM               Nhà cung cấp bên ngoài
                    routing            vận chuyển, y tế, chuyến bay
  ^
  |
LifeFlow MCP Server
  ^
  |
LifeFlow Agent / LLM
```

### 4.1 Trách nhiệm khi chạy

| Thành phần | Trách nhiệm |
|---|---|
| Frontend MapLibre | Hiển thị bản đồ, POI, tuyến đường, lựa chọn và kết quả workflow |
| Platform API | Xác thực, kiểm tra dữ liệu và cung cấp dịch vụ nghiệp vụ dùng chung |
| MCP server | Cung cấp tool, resource và prompt an toàn cho agent |
| PostgreSQL/PostGIS | Lưu địa điểm chuẩn, nhà ở, workflow và dữ liệu không gian |
| OSRM | Tính tuyến đường, khoảng cách và thời gian |
| Object storage | Lưu ảnh và media dung lượng lớn |
| Worker | Nhập OSM, đồng bộ đối tác và chạy job nền |

Frontend gọi Platform API, không truy cập trực tiếp PostgreSQL hoặc MCP. MCP
server tái sử dụng cùng lớp dịch vụ với Platform API để tránh lặp logic.

## 5. Cấu trúc repository

```text
D:\Demo AI thực chiến\Maps VN\LifeFlow\
|-- map-app\
|-- platform-api\
|-- mcp-server\
|-- packages\
|   |-- contracts\
|   `-- housing-query\
|-- database\
|   |-- migrations\
|   |-- seeds\
|   `-- importers\
|-- workers\
|   |-- osm-import\
|   `-- provider-sync\
|-- infra\
|   `-- compose.yaml
|-- docs\
|-- Start-LifeFlow.ps1
`-- Stop-LifeFlow.ps1
```

Khởi đầu bằng modular monolith. Chỉ tách microservice khi tải, quyền sở hữu của
đội hoặc yêu cầu triển khai thật sự cần.

## 6. Thiết kế PostgreSQL và PostGIS

### 6.1 Các schema

| Schema | Mục đích |
|---|---|
| `geo` | Ranh giới, địa chỉ, lần nhập và hình học địa lý |
| `catalog` | Địa điểm chuẩn, danh mục, media và giờ mở cửa |
| `housing` | Bất động sản, căn/phòng, tin đăng, báo giá và tiện ích |
| `mobility` | Nhà vận chuyển, vùng phục vụ, báo giá và chuyến đi |
| `identity` | Người dùng, sở thích, địa điểm đã lưu và consent |
| `workflow` | Kế hoạch, bước xử lý, trạng thái và phê duyệt |
| `integration` | Nhà cung cấp ngoài, mã nguồn và trạng thái đồng bộ |
| `audit` | Lần gọi tool, thay đổi dữ liệu, phê duyệt và sự kiện bảo mật |

### 6.2 Mô hình địa điểm chuẩn

Bản ghi trung tâm `catalog.places` tối thiểu gồm:

```text
id
name
category_id
geom
address
phone
website
status
verification_status
attributes
created_at
updated_at
deleted_at
```

Các bảng liên quan:

- `catalog.place_categories`
- `catalog.place_sources`
- `catalog.place_media`
- `catalog.place_opening_hours`
- `catalog.place_revisions`
- `geo.import_runs`
- `integration.source_records`

Lưu trữ không gian:

- `geometry(Point, 4326)` cho bản đồ và quan hệ không gian.
- `geography(Point, 4326)` cho khoảng cách tính bằng mét.
- GiST index trên các cột không gian.
- B-tree index cho mã nguồn, danh mục và khóa ngoại workflow.
- Trigram hoặc full-text index cho tên địa điểm và địa chỉ.

### 6.3 Nguồn dữ liệu và độ ưu tiên

Mọi bản ghi phải giữ nguồn:

```text
source=osm
source=partner
source=user
source=lifeflow_admin
```

Độ ưu tiên mặc định:

```text
Dữ liệu LifeFlow đã xác minh
  > dữ liệu đối tác đã xác minh
  > dữ liệu người dùng đã duyệt
  > dữ liệu OSM được nhập
```

Cập nhật OSM không được ghi đè field LifeFlow đã xác minh hoặc xóa địa điểm
riêng. Bản ghi không còn trong lần nhập mới phải được đánh dấu stale/inactive
trước, không hard-delete ngay.

### 6.4 Lưu media

PostgreSQL chỉ lưu metadata và URL. File ảnh nên nằm trong S3, MinIO hoặc object
storage tương đương.

## 7. Housing Query và hợp đồng dữ liệu

### 7.1 Phạm vi Housing Query

Mục tiêu:

> Nhận các điều kiện rõ ràng của người dùng và trả về toàn bộ ứng viên nhà ở
> thỏa các điều kiện đó, kèm thuộc tính factual có cấu trúc cho dịch vụ phía sau.

Phân hệ này sở hữu:

- Hợp đồng dữ liệu nhà ở
- Mô hình nhà ở trong PostgreSQL/PostGIS
- Nhập dữ liệu và truy nguồn
- Lọc chính xác theo số, danh mục, chữ và không gian
- Điều kiện địa điểm gần
- Điều kiện tuyến đường/thời gian đi lại qua OSRM
- API truy vấn và MCP tool chỉ đọc
- Test tính đúng và tính xác định của truy vấn

Phân hệ này không quyết định:

- Tin đăng nào tốt nhất
- Người dùng nên chọn tin nào
- Xếp hạng cá nhân hóa
- Điểm Recommendation
- Giải thích gợi ý do LLM tạo

Recommendation thuộc MCP hoặc module riêng và chỉ tiêu thụ dữ liệu factual.

### 7.2 Thuật ngữ và quyền sở hữu điều kiện

```text
search     = lấy và lọc dữ liệu factual
compare    = đặt các thuộc tính factual cạnh nhau
recommend  = áp dụng sở thích, xếp hạng hoặc đưa lời khuyên
```

Kế hoạch này chịu trách nhiệm cho **search**. So sánh factual có thể thêm sau
nhưng không được tuyên bố người thắng, chấm điểm hoặc đưa lời khuyên cá nhân.

Điều kiện cứng là bắt buộc. Mọi kết quả phải thỏa toàn bộ điều kiện áp dụng:

```text
district = District 7
bedrooms >= 2
price_amount <= 15000000
price_period = month
area_m2 >= 60
hospital_distance_m <= 3000
```

Soft preference có thể được phân tích và giữ trong metadata. Housing Query không
được tự chuyển câu như `near a park would be nice` thành điểm số nếu chưa có
quy tắc xác định trong hợp đồng có version.

### 7.3 Tách các thực thể nhà ở

```text
catalog.places
       |
housing.properties
       |
housing.units
       |
housing.listings
       |
housing.offers
```

| Thực thể | Ý nghĩa |
|---|---|
| `catalog.places` | Địa điểm và địa chỉ địa lý chuẩn |
| `housing.properties` | Tòa nhà, nhà hoặc bất động sản tồn tại lâu dài |
| `housing.units` | Căn hộ, phòng hoặc đơn vị có thể thuê cụ thể |
| `housing.listings` | Tin đăng theo từng nguồn |
| `housing.offers` | Giá, cọc, thời gian còn trống và điều khoản thay đổi theo thời gian |

Dù nguồn ban đầu chưa điền đủ mọi thực thể, hợp đồng và ID không được gộp
property, unit, listing và current offer thành một bản ghi mơ hồ.

### 7.4 Bản ghi nhà ở cơ sở

Hợp đồng phải đọc được bằng máy và dùng chung cho API, MCP, agent, frontend và
Recommendation MCP bên ngoài.

Các field factual tối thiểu:

```text
property_id
unit_id
listing_id
offer_id
place_id
title
property_type
listing_type
price_amount
currency
price_period
deposit_amount
bedrooms
bathrooms
area_value
area_unit
address
location
amenities
availability
images
source
source_url
verified_at
extra_attributes
```

Quy tắc kiểm tra:

- Tiền tệ và chu kỳ giá phải rõ ràng.
- Đơn vị diện tích phải rõ; đơn vị chuẩn ưu tiên là mét vuông.
- Giá trị thiếu được biểu diễn bằng `null`, không dịch vụ nào được tự đoán.
- Giá trị không hợp lệ tạo lỗi có cấu trúc.
- `extra_attributes` giữ dữ liệu nguồn chưa được mô hình hóa.
- Schema phải có ví dụ đúng và sai.
- Hợp đồng có version và ghi rõ tương thích ngược.

### 7.5 Hợp đồng `HousingSearchRequest`

| Nhóm điều kiện | Field |
|---|---|
| Chữ | `text` |
| Loại nhà/tin | `property_type`, `listing_type` |
| Khu hành chính | `district`, `administrative_area_ids` |
| Khung bản đồ | `bounding_box` |
| Bán kính | `center`, `radius_m` |
| Giá | `min_price`, `max_price`, `currency`, `price_period` |
| Phòng | `min_bedrooms`, `max_bedrooms`, `min_bathrooms` |
| Diện tích | `min_area_m2`, `max_area_m2` |
| Tiện ích | `amenities` |
| Còn trống | `availability_from`, `availability_to` |
| Độ tin cậy | `verification_requirement`, `source_filters` |
| Gần địa điểm | `nearby` |
| Đi lại | `commute` |
| Điều khiển kết quả | `pagination`, `sort` |
| Metadata không chấm điểm | `soft_preferences` |

Ví dụ request hợp lệ:

```json
{
  "administrative_area_ids": ["district_7"],
  "listing_type": "rent",
  "max_price": {
    "amount": 15000000,
    "currency": "VND",
    "period": "month"
  },
  "min_bedrooms": 2,
  "min_area_m2": 60,
  "nearby": [
    {
      "category": "hospital",
      "max_distance_m": 3000
    }
  ],
  "commute": {
    "destination": {
      "lng": 106.7009,
      "lat": 10.7769
    },
    "max_duration_seconds": 1800,
    "profile": "driving"
  },
  "pagination": {
    "limit": 50,
    "cursor": null
  },
  "sort": [
    { "field": "price_amount", "direction": "asc" }
  ]
}
```

Giá trị không biết mặc định không thỏa điều kiện cứng. Ví dụ
`bedrooms = null` không được vượt qua `min_bedrooms = 2`.

### 7.6 Hợp đồng `HousingSearchResponse`

Response chỉ chứa dữ liệu factual:

```json
{
  "query_id": "...",
  "contract_version": "1.0.0",
  "results": [
    {
      "listing_id": "...",
      "property_id": "...",
      "unit_id": "...",
      "offer_id": "...",
      "place_id": "...",
      "title": "...",
      "location": { "lng": 106.7, "lat": 10.77 },
      "price": {
        "amount": 14000000,
        "currency": "VND",
        "period": "month"
      },
      "bedrooms": 2,
      "bathrooms": 2,
      "area": { "value": 78, "unit": "m2" },
      "amenities": [],
      "verification": {},
      "source": {},
      "matched_constraints": [],
      "unknown_fields": [],
      "nearby": [],
      "commute": null
    }
  ],
  "page": {
    "next_cursor": null,
    "returned_count": 1
  }
}
```

Response không được có `recommendation_score`, `recommended`, `best_choice`,
`best_listing` hoặc suy luận của LLM.

Thứ tự hợp lệ phải factual và xác định, ví dụ:

- Giá tăng hoặc giảm
- Khoảng cách tăng
- Diện tích tăng hoặc giảm
- Thời điểm tạo hoặc xác minh
- ID ổn định để phân xử khi bằng nhau

Đây là thứ tự kết quả tìm kiếm, không phải Recommendation.

### 7.7 Khả năng truy vấn PostgreSQL/PostGIS

`search_housing` phải lọc chính xác trong PostgreSQL/PostGIS, không nhờ LLM lọc:

- Giá, phòng ngủ, phòng tắm và diện tích
- Loại bất động sản, loại tin, tiện ích, nguồn và xác minh
- Tìm chữ trên tiêu đề và địa chỉ đã chuẩn hóa
- Bao chứa trong khu hành chính
- Bounding box
- Tâm và bán kính
- `ST_DWithin` hoặc truy vấn nearby tương đương có index
- Spatial index
- Phân trang bằng cursor
- Thứ tự xác định với ID phân xử ổn định
- Xác minh tuyến/thời gian đi lại khi được yêu cầu

`price <= 15000000`, `bedrooms >= 2` và `within District 7` là điều kiện
database, không phải nhận định của LLM.

### 7.8 Lọc theo địa điểm gần

Điều kiện nearby dùng địa điểm chuẩn trong PostGIS, không dùng GeoJSON frontend:

```text
ứng viên nhà ở
       |
       | ST_DWithin / spatial join có index
       v
catalog.places
category = hospital
```

Kết quả nearby trả `place_id`, tên, loại, khoảng cách, trạng thái xác minh và
nguồn. Với điều kiện cứng `max_distance_m = 3000`, ứng viên phải có ít nhất
một địa điểm hợp lệ trong 3.000 mét. Thiếu dữ liệu không được tính là đạt.

### 7.9 Lọc theo thời gian đi lại

Không dùng khoảng cách đường thẳng để khẳng định thời gian đi lại. Pipeline:

```text
Bộ lọc cứng PostGIS
  -> lọc thô theo không gian
  -> giới hạn số ứng viên có thể cấu hình
  -> kiểm tra route OSRM
  -> lọc cứng duration_seconds
  -> trả dữ liệu route factual
```

Với `max_duration_seconds = 1800`, chỉ ứng viên có route OSRM thành công và
không quá 1.800 giây mới đạt. Lỗi route, `NoRoute` và timeout không được xem là
thỏa điều kiện. Dịch vụ phải giới hạn ứng viên, không bắn hàng nghìn request OSRM
không kiểm soát.

## 8. Thiết kế MCP server

MCP server cung cấp khả năng có kiểm soát cho LifeFlow Agent. Mọi đầu vào và đầu
ra đều phải được kiểm tra bằng schema.

### 8.1 Tool chỉ đọc của phiên bản đầu

```text
search_places
get_place
find_nearby_places
calculate_route
search_housing
get_housing
```

`evaluate_housing_constraints` có thể được thêm sau để báo ứng viên có thỏa bộ
điều kiện có version hay không. Tool này không được xếp hạng hoặc gợi ý.

`compare_housing` không thuộc phiên bản đầu. Nếu thêm sau, nó chỉ được trả bảng
factual như giá, diện tích, số phòng, khoảng cách nearby và thời gian đi lại;
không được chọn người thắng.

### 8.2 Ranh giới với Recommendation MCP

```text
Housing Query API / MCP
          |
          | HousingSearchRequest
          | HousingSearchResponse
          | canonical ID và dữ liệu route/nearby factual
          v
Recommendation MCP bên ngoài
```

Recommendation MCP chỉ tiêu thụ hợp đồng dùng chung, API response hoặc kết quả
MCP tool. Nó không được phụ thuộc trực tiếp vào bảng housing nội bộ và không
được triển khai trong phần repository hiện tại.

### 8.3 Tool ghi cho phiên bản sau

```text
save_place
save_housing_shortlist
create_move_plan
request_transport_quote
submit_for_approval
confirm_booking
cancel_booking
```

Các tool này thuộc nền tảng LifeFlow rộng hơn, ngoài phạm vi Housing Query hiện tại.

### 8.4 MCP resource đề xuất

```text
lifeflow://schemas/place
lifeflow://schemas/housing
lifeflow://catalog/categories
lifeflow://providers/capabilities
lifeflow://workflows/moving
```

Resource chứa dữ liệu người dùng phải yêu cầu xác thực và phân quyền.

### 8.5 An toàn tool

- Không có `execute_sql` hoặc HTTP tool tùy ý.
- Tách tool đọc khỏi tool thay đổi trạng thái.
- Kiểm tra schema của mọi input và output.
- Tool production cần `user_id`, ngữ cảnh phân quyền và tenant.
- Tool ghi cần `idempotency_key`.
- Đặt dịch vụ và thanh toán cần approval token.
- Ghi tên tool, thời gian, trạng thái và actor vào `audit.tool_calls`.
- Che secret và dữ liệu cá nhân nhạy cảm trong log.

### 8.6 Giao thức vận chuyển

- Dùng `stdio` khi phát triển cục bộ và kiểm tra với MCP Inspector.
- Dùng Streamable HTTP có xác thực trong môi trường ứng dụng.
- Server phát triển chỉ bind `127.0.0.1`, trừ khi có yêu cầu truy cập từ xa.
- Cố định phiên bản MCP SDK và ghi lại khả năng tương thích giao thức.

## 9. Luồng agent từ đầu đến cuối

Ví dụ yêu cầu:

```text
Tìm căn hộ hai phòng ngủ ở Quận 7 dưới 15 triệu đồng,
cách bệnh viện không quá 3 km,
và thời gian đi làm dưới 30 phút.
```

Luồng xử lý:

```text
1. Chuyển yêu cầu thành HousingSearchRequest có cấu trúc.
2. search_housing truy vấn các tin đăng ứng viên.
3. PostgreSQL lọc cứng giá, phòng ngủ, diện tích và vị trí.
4. PostGIS xác minh khoảng cách đến bệnh viện.
5. OSRM xác minh thời gian đi lại.
6. Chỉ trả ứng viên thỏa mọi điều kiện cứng đã biết.
7. Kèm nguồn, xác minh, điều kiện đã khớp và field chưa biết.
8. Frontend hoặc Recommendation MCP bên ngoài tiêu thụ kết quả factual.
```

Housing Query dừng tại đây. Nó không xếp hạng, gợi ý hoặc chọn người thắng. Map,
API, MCP và consumer bên ngoài phải dùng cùng canonical ID.

## 10. Kế hoạch tích hợp bản đồ

### 10.1 Trạng thái ban đầu

```text
MapLibre -> public/data/accommodations.geojson
```

### 10.2 Trạng thái chuyển tiếp đã triển khai

```text
MapLibre -> POST /v1/places/search với bounding_box
                    |
                    v
                 PostGIS

Fallback -> accommodations.geojson hiện có
```

Frontend hiện tải POI theo bounding box của thành phố, dùng canonical
`place_id`, và chỉ fallback khi API không hoạt động.

### 10.3 Trạng thái mục tiêu tiếp theo

Frontend yêu cầu dữ liệu theo vùng bản đồ đang nhìn thấy. API hỗ trợ loại, chữ,
xác minh, nguồn và khoảng cách. Khi người dùng kéo/zoom, client cần debounce,
hủy request cũ và cache theo viewport.

## 11. Pipeline cập nhật OSM

Không bao giờ ghi đè trực tiếp dataset đang hoạt động.

```text
PBF Việt Nam mới, có version
  |-- kiểm tra file và checksum
  |-- cắt TP.HCM, Hà Nội và Đà Nẵng
  |-- build OSRM trong thư mục version mới
  |-- test graph mới trên cổng tạm
  |-- nhập POI vào bảng staging
  |-- chuẩn hóa danh mục và loại trùng
  |-- so sánh số lượng và báo cáo kiểm tra
  |-- công bố thay đổi database trong transaction
  |-- chuyển container routing sau nghiệm thu
  `-- giữ phiên bản trước để rollback
```

Tên file/thư mục đề xuất:

```text
Raw\vietnam-YYYYMMDD.osm.pbf
Routing\hcm\versions\YYYYMMDD\
Routing\hanoi\versions\YYYYMMDD\
Routing\danang\versions\YYYYMMDD\
```

OSM và dữ liệu tùy chỉnh LifeFlow phải được hợp nhất theo quy tắc nguồn, không
thay toàn bộ bảng.

## 12. Kế hoạch basemap tùy chỉnh

Chỉ bắt đầu khi PostGIS, API và MCP tool đọc đã ổn định:

```text
OSM PBF
  -> Planetiler
  -> PMTiles hoặc vector tile tương thích
  -> MapLibre style.json
  -> Maputnik
  -> phong cách hình ảnh LifeFlow
```

Basemap chứa đường, nước, công viên, tòa nhà và nhãn hành chính. Khách sạn, nhà
cho thuê, bệnh viện, đối tác và Recommendation vẫn là lớp nghiệp vụ động.

Phong cách mong muốn:

- Sạch và tối giản
- Đường chính rõ ràng
- Đường phụ và tòa nhà nhẹ hơn
- Nước và công viên dễ phân biệt
- Nhãn thành phố/quận rõ
- Icon và màu tùy chỉnh theo danh mục
- Không hiển thị quá nhiều POI mặc định

## 13. Yêu cầu bảo mật và vận hành

- Tách role database cho migration, ingestion, API và job chỉ đọc.
- Ứng dụng không dùng tài khoản superuser.
- API/MCP production phải xác thực và phân quyền tenant.
- Mã hóa secret và dữ liệu cá nhân nhạy cảm.
- Hành động tài chính hoặc đặt dịch vụ phải qua phê duyệt.
- Audit lần gọi tool và thay đổi trạng thái.
- Có backup database và quy trình restore đã kiểm tra.
- Có health check cho PostgreSQL, MCP, API và OSRM.
- Theo dõi độ trễ, lỗi, lỗi route và mức sử dụng tool.
- Rate limit endpoint công khai hoặc bên ngoài.
- Có timeout và circuit breaker cho API đối tác.

## 14. Các giai đoạn triển khai

### Giai đoạn 0: Bảo toàn baseline

- Kiểm kê file, phiên bản, cổng và cấu hình container.
- Ghi checksum file PBF nguồn.
- Backup database có thể truy cập.
- Giữ frontend và GeoJSON fallback.
- Giữ browser acceptance test hiện có.

Điều kiện hoàn tất: bản đồ, POI và routing có thể tái tạo và khôi phục.

### Giai đoạn 1: Hợp đồng dùng chung

- Định nghĩa schema Place, Housing và Route.
- Định nghĩa `HousingSearchRequest` và `HousingSearchResponse`.
- Thêm ví dụ đúng/sai.
- Quy định null, đơn vị, tiền tệ và metadata bổ sung.
- Đặt version và ghi tương thích.

Điều kiện hoàn tất: API, MCP, agent, frontend và Recommendation MCP có thể dùng
cùng schema mà không tự tạo field hoặc phụ thuộc bảng nội bộ.

### Giai đoạn 2: Nền PostGIS

- Bật PostGIS mà không thay database cũ.
- Thêm migration có version.
- Tạo schema, role, constraint và index.
- Tạo bảng ingestion và audit.

Điều kiện hoàn tất: truy vấn không gian dùng index; migration có cách rollback
hoặc quy trình khôi phục được ghi lại.

### Giai đoạn 3: Nhập POI và nhà ở

- Nhập dữ liệu lưu trú hiện có.
- Chuẩn hóa, loại trùng và công bố địa điểm chuẩn.
- Giữ mọi thuộc tính và ID nguồn.
- So sánh số lượng nguồn, staging và dữ liệu công bố.
- Tách property, unit, listing và offer.
- Ghi field thiếu, lỗi kiểm tra và nguồn gốc.

Điều kiện hoàn tất: toàn bộ 13.120 POI được giải trình, gồm accepted, duplicate
hoặc rejected; dữ liệu nhà ở có thể truy vấn mà không gộp sai thực thể.

### Giai đoạn 4: Platform API

- Cài `search_housing` và `get_housing`.
- Lọc số, danh mục, chữ, bounding box và bán kính.
- Lọc nearby qua địa điểm chuẩn PostGIS.
- Adapter route cho ba OSRM.
- Lỗi có cấu trúc; xác thực production làm ở giai đoạn triển khai.

Điều kiện hoàn tất: test API chứng minh bộ lọc cứng, phân trang xác định, cách xử
lý giá trị thiếu, nearby, commute, offline và `NoRoute`.

### Giai đoạn 5: MCP chỉ đọc

- MCP dùng chung service và contract.
- Thêm các tool housing, place, nearby và route.
- Test bằng MCP client/Inspector.
- Audit và kiểm tra input/output.

Điều kiện hoàn tất: agent truy vấn được mà không truy cập database trực tiếp.

### Giai đoạn 6: Chuyển frontend sang API

- Tải POI từ Platform API.
- Giữ GeoJSON làm fallback tạm thời.
- Dùng canonical place ID.
- Giữ UX chuyển thành phố và routing.

Điều kiện hoàn tất: browser test đạt và map không phải tải toàn bộ POI quốc gia.

Recommendation không thuộc Giai đoạn 0-6. Module do thành phần khác sở hữu sẽ
tiêu thụ contract và kết quả factual sau khi nền Housing Query đạt nghiệm thu.

### Giai đoạn 7: Workflow và tool phê duyệt

- Workflow kế hoạch chuyển nhà.
- Báo giá, phê duyệt và trạng thái thực thi.
- Tool ghi idempotent.
- Adapter cho nhà cung cấp vận chuyển.

Điều kiện hoàn tất: không đặt dịch vụ, thanh toán hoặc cam kết bên ngoài nếu
chưa có phê duyệt và audit.

### Giai đoạn 8: Basemap tùy chỉnh

- Build PMTiles theo version.
- Tạo và kiểm tra style LifeFlow.
- Host tile có rollback.
- Giữ dữ liệu nghiệp vụ ngoài basemap.

Điều kiện hoàn tất: map chạy với basemap LifeFlow mà POI/routing không bị regress.

### Giai đoạn 9: Hoàn thiện production

- Backup, monitoring và cảnh báo.
- Security review và load test.
- Cập nhật OSM/đối tác theo lịch.
- Diễn tập disaster recovery và rollback.

Điều kiện hoàn tất: quy trình vận hành và khôi phục được ghi lại và kiểm thử.

## 15. Tiêu chí nghiệm thu nền tảng

- MapLibre và OSRM hiện có không bị regress.
- File nguồn và graph hiện có không bị sửa.
- POI truy ngược đầy đủ về nguồn.
- Dữ liệu tùy chỉnh tồn tại sau khi cập nhật OSM.
- Nearby và bounding box dùng spatial index.
- MCP trả kết quả có cấu trúc và được kiểm tra.
- Agent không có SQL tùy ý.
- Cùng một place ID dùng xuyên suốt map, API, MCP và workflow.
- Tài chính/đặt dịch vụ cần phê duyệt.
- Mọi thao tác ghi idempotent và audit được.
- Database và routing hỗ trợ rollback.
- Basemap tùy chỉnh không chứa dữ liệu nghiệp vụ riêng tư.

### 15.1 Tiêu chí Housing Query

| Trường hợp | Dữ liệu vào | Kết quả bắt buộc |
|---|---|---|
| Giá | `max_price = 15.000.000 VND/month` | Không kết quả nào vượt 15 triệu/tháng |
| Phòng ngủ | `min_bedrooms = 2` | Không kết quả nào dưới hai phòng ngủ |
| Thiếu số phòng | `bedrooms = null` | Không đạt điều kiện `min_bedrooms = 2` |
| Diện tích | `min_area_m2 = 60` | Mọi kết quả có diện tích chuẩn ít nhất 60 m2 |
| Bán kính | `radius_m = 5000` | Mọi kết quả nằm trong bán kính có spatial index |
| Gần bệnh viện | `max_distance_m = 3000` | Có bệnh viện hợp lệ trong 3.000 mét |
| Đi lại | `max_duration_seconds = 1800` | Route OSRM thành công và không quá 1.800 giây |
| Truy nguồn | Kết quả bất kỳ | ID và field factual truy được về nguồn |
| Field chưa biết | Nguồn bị thiếu | Trả `null`/unknown, không tự tạo giá trị |
| Tính xác định | Cùng database và request | Cùng tập kết quả và thứ tự ổn định |
| Tách Recommendation | Truy vấn bất kỳ | Không có cờ, điểm, người thắng hay lời khuyên |

Nếu không thể đánh giá điều kiện cứng do thiếu dữ liệu, ứng viên mặc định không
đạt. Diagnostics cần làm việc loại này quan sát được khi phù hợp.

### 15.2 Contract test bắt buộc

Ví dụ hợp lệ chính là request tại mục 7.5. Các trường hợp phải bị từ chối:

- Giá âm
- Tiền tệ không hỗ trợ
- Có số tiền nhưng thiếu chu kỳ giá khi hợp đồng yêu cầu
- Kinh độ ngoài `[-180, 180]`
- Vĩ độ ngoài `[-90, 90]`
- Bán kính bằng 0 hoặc âm
- Số phòng ngủ/phòng tắm âm
- Đơn vị diện tích không hỗ trợ
- Bounding box sai hoặc đảo ngược
- Commute profile không hỗ trợ
- Giới hạn phân trang ngoài khoảng cho phép

## 16. Ngoài phạm vi bản triển khai đầu

- Gợi ý nhà ở
- Xếp hạng bằng LLM hoặc giải thích Recommendation
- Điểm Recommendation hoặc chọn người thắng cá nhân hóa
- Cài Recommendation MCP do thành phần khác sở hữu
- Thanh toán và tự động đặt dịch vụ
- Triển khai production
- MCP công khai từ xa
- Giao thông thời gian thực
- Ảnh vệ tinh và street view
- Định tuyến giao thông công cộng
- Basemap PMTiles tùy chỉnh
- Thay graph OSRM hiện tại
- Xóa GeoJSON fallback
- Tách mọi dịch vụ LifeFlow thành microservice

## 17. Các quyết định đã duyệt

- [x] Modular monolith cho nền tảng ban đầu
- [x] TypeScript cho Platform API và MCP server
- [x] PostgreSQL/PostGIS là nguồn dữ liệu chuẩn
- [x] Metadata media trong PostgreSQL; object storage để sau
- [x] Bắt đầu bằng MCP tool chỉ đọc
- [x] Dùng `stdio` cục bộ; Streamable HTTP có xác thực để sau
- [x] Giữ OSRM và UX MapLibre trong Giai đoạn 1-5
- [x] Nhập dữ liệu theo version và giữ đầu vào rollback
- [x] Mọi đặt dịch vụ/thanh toán/cam kết sau này đều cần phê duyệt
- [x] Hoãn basemap tùy chỉnh đến khi nền dữ liệu ổn định
- [x] Repository hiện tại chỉ thực hiện Housing Query factual
- [x] Recommendation MCP là consumer bên ngoài

## 18. Phạm vi triển khai đầu tiên

1. Hợp đồng Place dùng chung
2. Hợp đồng Housing dùng chung
3. `HousingSearchRequest` và `HousingSearchResponse`
4. Hợp đồng Route
5. Migration PostgreSQL/PostGIS và role giới hạn quyền
6. Nhập Housing/POI có truy nguồn
7. Platform API `search_housing`
8. Platform API `get_housing`
9. Truy vấn nearby qua PostGIS
10. Adapter OSRM và commute filtering có giới hạn
11. MCP tool housing, place, nearby và route
12. Contract test, query test và integration test
13. Frontend đọc POI từ API với GeoJSON fallback
14. Script khởi động/dừng và tài liệu vận hành

Không triển khai `recommend_housing`, xếp hạng LLM, điểm Recommendation, đặt
dịch vụ, thanh toán hoặc basemap tùy chỉnh trong phạm vi này.

## 19. Tài liệu tham khảo

- MCP TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/v2/
- Khái niệm MCP server: https://modelcontextprotocol.io/specification/draft/server/index
- Giới thiệu PostGIS: https://postgis.net/docs/manual-3.7/en/postgis_introduction.html
- Spatial index PostGIS: https://postgis.net/documentation/faq/spatial-indexes/
- OpenFreeMap quick start: https://openfreemap.org/quick_start/
- Tài liệu MapLibre GL JS: https://maplibre.org/maplibre-gl-js/docs/
