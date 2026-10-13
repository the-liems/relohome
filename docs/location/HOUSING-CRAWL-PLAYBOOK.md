# LifeFlow Housing Crawl Playbook

> Historical record: paths, names, commands and measured results below describe the original checkout. For current operation use the [ReloHome location guide](README.md) and [local runbook](../runbooks/local-mvp.md).

> **Tài liệu khảo sát/thiết kế lịch sử — không dùng làm status hiện hành.**
>
> **Cập nhật chỉ dẫn 2026-09-29:** xem [status triển khai](../integration/location-service-implementation-status.md) và [dữ liệu/backup hiện hành](../integration/location-data-status.md). Location hiện có 9 tool, housing thật và MCP HTTP có bearer token. Các số liệu, test và kế hoạch trong ghi chép cũ bên dưới thuộc thời điểm viết, không phải thống kê DB của máy mới. ZIP cũ đã xóa; giữ dữ liệu backup riêng với source trong Git.

Tài liệu này dùng để chia việc cho nhiều người thu thập dữ liệu nhà thuê, phòng trọ, căn hộ và chung cư, sau đó đưa dữ liệu vào LifeFlow/PostGIS nhất quán.

## 1. Mục tiêu

Thu thập dữ liệu có thể:

- tìm kiếm theo giá, diện tích, số phòng và tiện ích;
- hiển thị đúng trên bản đồ;
- tính khoảng cách và thời gian đi lại bằng OSRM;
- truy nguyên được tin đăng gốc;
- cập nhật được giá, trạng thái và lịch sử tin;
- phát hiện tin trùng, tin cũ hoặc dữ liệu thiếu.

Không biến một tin đăng thành dữ liệu chắc chắn đúng chỉ vì tin đó xuất hiện trên trang nguồn. Dữ liệu phải giữ nguyên nguồn, thời điểm quan sát và mức độ xác minh.

## 2. Tham khảo thị trường

Các trang dưới đây chỉ dùng để quan sát cách thị trường tổ chức thông tin và các trường thường xuất hiện. Người crawl phải tuân thủ điều khoản sử dụng, robots.txt, giới hạn truy cập và quyền dữ liệu của từng nguồn.

### Nhà Tốt/Chợ Tốt

Các nhóm thông tin thường gặp:

- mua bán và cho thuê;
- căn hộ/chung cư;
- nhà ở/nhà nguyên căn;
- phòng trọ;
- căn hộ dịch vụ;
- văn phòng, mặt bằng;
- khu vực tỉnh/thành, quận/huyện;
- mã tin, hình ảnh, mô tả, giá và thông tin người đăng;
- tin đã xác minh, tin trùng, tin có dấu hiệu giá bất thường hoặc nội dung không thống nhất.

### Airbnb và nền tảng lưu trú ngắn hạn

Các trường thường có:

- loại chỗ ở;
- số khách, phòng ngủ, giường, phòng tắm;
- giá theo đêm và ngày nhận/trả phòng;
- tiện nghi;
- hình ảnh;
- vị trí có thể được làm mờ hoặc chỉ hiển thị gần đúng;
- đánh giá và trạng thái còn phòng.

### Bài học rút ra

Một bộ dữ liệu tốt không chỉ có `title`, `price`, `area`, `address`. Cần có cả:

- loại hình bất động sản;
- kỳ giá;
- tiền cọc và phí bắt buộc;
- ngày bắt đầu thuê và thời hạn tối thiểu;
- tình trạng còn phòng;
- nội thất và tiện ích;
- nguồn, mã tin, URL và thời điểm crawl;
- độ chính xác vị trí;
- dữ liệu gốc để kiểm tra lại.

## 3. Hiện trạng LifeFlow

Schema hiện tại đã có sẵn 5 lớp:

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

| Lớp | Ý nghĩa | Ví dụ |
|---|---|---|
| `catalog.places` | Địa điểm chuẩn có geometry PostGIS | Chung cư ABC, nhà số 12, tòa nhà X |
| `housing.properties` | Bất động sản ổn định | Tòa nhà, nhà nguyên căn, khu chung cư |
| `housing.units` | Căn/phòng cụ thể | Căn A1205, phòng trọ số 3 |
| `housing.listings` | Tin đăng của một nguồn | Tin `bds-46139006` |
| `housing.offers` | Giá và điều khoản theo thời gian | 4.700.000 VND/tháng, cọc 1 tháng |

Hiện workspace đã có:

- PostgreSQL 16 và PostGIS 3.5;
- POI OSM và địa giới thành phố;
- dữ liệu `catalog.places` cho POI lưu trú;
- Housing Query API/MCP chỉ đọc;
- bộ lọc giá, diện tích, phòng ngủ, tiện ích, bán kính, khu hành chính và commute;
- importer POI có checksum, staging, duplicate và provenance;
- **chưa có dữ liệu listing nhà thuê thực tế**.

Vì vậy, dữ liệu nhà thuê mới phải đi vào `housing.*`, không đưa thẳng vào GeoJSON POI hoặc coi mọi POI `hotel/hostel/apartment` là một tin thuê.

Tham khảo source of truth:

- [Database schema](../../deploy/database/migrations/002_core_tables.sql)
- [Housing contract](../../packages/contracts/src/housing.ts)
- [Housing implementation](HOUSING-QUERY-IMPLEMENTATION.md)
- [POI v2 importer](../../apps/platform-api/src/import-pois-v2.ts)

## 4. Phạm vi dữ liệu cần crawl

### Nhóm bắt buộc

Chỉ nhận bản ghi nếu có tối thiểu:

- `source_type`;
- `source_listing_id` hoặc mã tin ổn định;
- `source_url` nếu nguồn có URL;
- `title`;
- `listing_type`;
- `property_type`;
- giá và kỳ giá;
- địa chỉ hoặc vị trí đủ để geocode;
- thời điểm quan sát.

### Nhóm ưu tiên cao

**Quy ước phòng thuê cập nhật 04/10/2026:** loại `room` cho thuê nguyên phòng
có giá trị nguồn 0 có thể chuẩn hóa thành 1, kèm original_value và quy tắc trong
`unit.attributes.bedroom_normalization`. Không đồng nghĩa một phòng ngủ tách biệt
đã xác minh. Studio = 0 vẫn hợp lệ. Tin giường/ở ghép hoặc số phòng mâu thuẫn
phải review; null không tự điền thành 1. Xem
[báo cáo và script xử lý](../integration/map-housing-osrm-audit-2026-10-04.md).

- diện tích `area_m2`;
- số phòng ngủ `bedrooms`;
- số phòng tắm `bathrooms`;
- nội thất;
- tiện ích;
- tiền cọc;
- phí quản lý, điện, nước, gửi xe;
- ngày có thể vào ở;
- tình trạng còn phòng;
- hình ảnh;
- người đăng là chủ nhà hay môi giới, nếu nguồn công khai thông tin này;
- vị trí chính xác hay gần đúng.

### Không thu thập mặc định

- mật khẩu, token, thông tin đăng nhập;
- dữ liệu cá nhân không cần cho việc tìm nhà;
- số điện thoại/email nếu điều khoản nguồn không cho phép lưu;
- nội dung sau tường đăng nhập hoặc CAPTCHA;
- dữ liệu bị giới hạn bởi robots.txt hoặc điều khoản nguồn.

## 5. Chuẩn loại hình

LifeFlow hiện dùng các giá trị sau:

```text
apartment
house
room
studio
serviced_apartment
homestay
other
```

Quy tắc gợi ý:

| Nhãn nguồn | `property_type` |
|---|---|
| Phòng trọ, phòng cho thuê | `room` |
| Nhà nguyên căn, nhà phố | `house` |
| Căn hộ, chung cư | `apartment` |
| Studio | `studio` |
| Căn hộ dịch vụ | `serviced_apartment` |
| Homestay thuê dài/ngắn hạn | `homestay` |
| Không đủ thông tin | `other` |

`listing_type`:

```text
rent       thuê dài hạn hoặc thuê thông thường
short_stay thuê ngày/tuần/ngắn hạn
sale       mua bán, chỉ dùng khi thật sự là tin bán
```

Không suy đoán `apartment` chỉ từ từ khóa chung cư nếu tin thực tế là phòng trong chung cư. Khi có thể, tạo `property` là tòa nhà và `unit` là căn/phòng.

## 6. Canonical JSONL

Mỗi dòng là một listing độc lập. Không dùng một file tổng hợp làm mất mã tin nguồn.

```json
{
  "source_type": "nhatot",
  "source_listing_id": "bds-46139006",
  "source_url": "https://example.invalid/listing/bds-46139006",
  "observed_at": "2026-09-26T10:30:00Z",
  "title": "Phòng trọ 25 m2 gần Cầu Giấy",
  "description": "Phòng có máy lạnh, tủ lạnh, máy giặt...",
  "listing_type": "rent",
  "property_type": "room",
  "status": "active",
  "address_raw": "Ngõ 148 Trần Duy Hưng, Cầu Giấy, Hà Nội",
  "address_normalized": {
    "housenumber": "148",
    "street": "Trần Duy Hưng",
    "ward": "Trung Hòa",
    "district": "Cầu Giấy",
    "city": "Hà Nội",
    "country": "VN"
  },
  "location": {
    "longitude": 105.801,
    "latitude": 21.014,
    "accuracy": "approximate",
    "method": "source_map"
  },
  "unit": {
    "unit_code": null,
    "bedrooms": 1,
    "bathrooms": 1,
    "area_m2": 25,
    "amenities": [
      "air_conditioning",
      "refrigerator",
      "washing_machine",
      "parking",
      "elevator"
    ],
    "attributes": {
      "furnished": "partial",
      "floor": 3,
      "balcony": false
    }
  },
  "offer": {
    "price_amount": 4700000,
    "currency": "VND",
    "price_period": "month",
    "deposit_amount": null,
    "availability_from": null,
    "availability_to": null,
    "valid_from": "2026-09-26T10:30:00Z",
    "attributes": {
      "electricity_amount": 4000,
      "electricity_unit": "kWh",
      "water_amount": 120000,
      "water_unit": "person_month",
      "service_fee_amount": null,
      "parking_fee_amount": null,
      "minimum_lease_months": null
    }
  },
  "media": [
    { "url": "https://example.invalid/image-1.jpg", "alt": "Phòng khách" }
  ],
  "verification": {
    "status": "unverified",
    "checked_by": null,
    "checked_at": null
  },
  "raw_payload": {}
}
```

## 7. Mapping vào database

| JSONL | Database |
|---|---|
| `location`, `address_normalized` | `catalog.places.geom`, `catalog.places.address` |
| `property_type`, tên tòa nhà | `housing.properties` |
| `unit_code`, phòng ngủ, phòng tắm, diện tích, tiện ích | `housing.units` |
| title, mô tả, mã tin, URL, trạng thái | `housing.listings` |
| giá, kỳ giá, cọc, ngày trống, phí | `housing.offers` |
| raw JSON, checksum, lỗi, thời điểm crawl | `integration.source_records` |

Quy tắc geometry:

- tọa độ luôn là WGS84, SRID 4326;
- thứ tự GeoJSON là `[longitude, latitude]`;
- không đảo thành `[latitude, longitude]`;
- nếu nguồn chỉ cho vị trí gần đúng, ghi `accuracy = approximate`;
- không tự tạo tọa độ giả ở giữa quận nếu không ghi rõ độ chính xác;
- `place_id` là liên kết ổn định để map và commute dùng lại.

## 8. Giá và chi phí thực tế

Không gộp mọi chi phí vào `price_amount`. Tách rõ:

- tiền thuê;
- tiền cọc;
- điện;
- nước;
- phí dịch vụ/quản lý;
- internet;
- gửi xe;
- phí thú cưng hoặc phí khác;
- kỳ thanh toán;
- thời hạn thuê tối thiểu.

Tiền thuê chính đưa vào `housing.offers`. Các khoản phụ đưa vào `offers.attributes` cho đến khi có migration riêng.

Nếu giá là khoảng, không chọn tùy ý một số:

```json
{
  "price_amount": 4700000,
  "attributes": {
    "price_max_amount": 5200000,
    "price_is_range": true,
    "price_raw": "4,7-5,2 triệu/tháng"
  }
}
```

## 9. Địa chỉ và matching bản đồ

Mỗi người crawl cần giữ cả hai dạng:

- `address_raw`: nguyên văn từ nguồn;
- `address_normalized`: tách trường để tìm kiếm.

Không tự ý sửa mất thông tin như `ngõ`, `hẻm`, `khu`, `lô`, `tòa`, `block`, `căn`, `phòng`.

Độ tin cậy vị trí:

| Giá trị | Ý nghĩa |
|---|---|
| `rooftop` | vị trí đến tòa/nhà cụ thể |
| `parcel` | vị trí đến thửa/khu cụ thể |
| `street` | chỉ xác định được đoạn đường |
| `district` | chỉ xác định được quận/huyện |
| `approximate` | vị trí làm mờ hoặc suy ra |
| `missing` | chưa geocode được |

Tin `missing` vẫn có thể lưu ở staging nhưng không nên publish để tìm theo bán kính/commute.

## 10. Tiện ích chuẩn hóa

Dùng slug ASCII, không dùng mỗi câu mô tả tự do:

```text
air_conditioning
hot_water
refrigerator
washing_machine
bed
wardrobe
desk
kitchen
private_bathroom
shared_bathroom
balcony
parking
elevator
security
gym
swimming_pool
internet
pet_friendly
allow_cooking
natural_light
```

Nếu chưa biết mapping, giữ nguyên giá trị nguồn trong `attributes` và thêm vào `unknown_fields`, không tự đoán.

## 11. Tin tương tự và chi phí hiển thị

Giao diện mẫu cho thấy nên lưu thêm dữ liệu để hỗ trợ:

- danh sách tin tương tự;
- tổng chi phí cố định ước tính mỗi tháng;
- tiện ích trong phòng và tiện ích tòa nhà;
- vị trí gần đúng;
- cảnh báo dữ liệu tham khảo, không phải bảo đảm pháp lý;
- mã tin để mở lại nguồn;
- lịch sử giá.

Tin tương tự không cần lưu thành bảng riêng ở giai đoạn đầu. Có thể tính từ:

```text
cùng property_type
giá gần nhau
diện tích gần nhau
cùng khu vực
không quá xa về địa lý
```

Không gọi là gợi ý tốt nhất nếu chưa có module recommendation. Chỉ gọi là `similar listings` hoặc `matched listings`.

## 12. Chia việc cho nhóm crawl

### Nhóm A: thu thập listing

Thu thập title, mô tả, mã tin, URL, giá, loại hình, diện tích, phòng ngủ, phòng tắm, hình ảnh và thời điểm quan sát.

### Nhóm B: chuẩn hóa địa chỉ

Tách địa chỉ, chuẩn hóa tỉnh/thành, quận/huyện, phường/xã, đường, số nhà và ghi độ chính xác geocode.

### Nhóm C: tiện ích và chi phí

Chuẩn hóa amenities, điện, nước, phí dịch vụ, gửi xe, cọc, kỳ thanh toán và thời hạn thuê.

### Nhóm D: kiểm tra chất lượng

Kiểm tra tin trùng, giá sai đơn vị, tọa độ đảo lat/lng, giá không khớp mô tả, ảnh không liên quan và tin đã hết hạn.

### Nhóm E: đối soát nguồn

Kiểm tra URL, mã tin, thời điểm crawl, checksum/raw payload và điều khoản sử dụng nguồn.

Mỗi nhóm chỉ sửa phần mình phụ trách, không xóa dữ liệu gốc của nhóm khác.

## 13. Quy tắc chống lỗi

Trước khi nộp một bản ghi:

- giá là số nguyên theo đơn vị tiền tệ, không ghi `4.7tr` vào cột số;
- `price_period` đúng với nội dung tin;
- diện tích là m2, không nhầm với diện tích đất;
- phòng ngủ và phòng tắm không lấy từ số phòng của cả tòa;
- tọa độ là `[lng, lat]`;
- mã tin không bị tự sinh lại nếu nguồn đã có mã;
- URL được giữ nguyên;
- không coi giá "liên hệ" là 0;
- không coi "đã cho thuê" là active;
- không đoán cọc, phí hoặc tiện ích còn thiếu;
- dữ liệu không chắc chắn phải để `null` và ghi lý do trong `unknown_fields` hoặc `attributes`.

## 14. Trạng thái và cập nhật

Mỗi lần crawl lại cùng một tin:

1. tìm theo `source_type + source_listing_id`;
2. tạo bản ghi quan sát mới hoặc cập nhật offer hiện tại;
3. đóng offer cũ bằng `valid_to` nếu giá/điều khoản thay đổi;
4. chuyển listing thành `inactive` nếu nguồn báo hết tin;
5. chuyển thành `stale` nếu quá thời gian quy định không quan sát lại;
6. không xóa payload cũ.

Khuyến nghị TTL ban đầu:

```text
listing thuê tháng: stale sau 7 ngày
listing thuê ngày/tuần: stale sau 2 ngày
tin đã kiểm tra thủ công: vẫn cần observed_at mới
```

## 15. Bộ kiểm tra trước khi import

Một batch chỉ được import khi có báo cáo:

```text
source_type
source_url hoặc source_path
source_checksum
input_count
accepted_count
rejected_count
duplicate_count
missing_price_count
missing_address_count
missing_location_count
invalid_coordinate_count
stale_count
```

Các chỉ số cần kiểm tra tối thiểu:

- không có kinh độ ngoài `[-180, 180]`;
- không có vĩ độ ngoài `[-90, 90]`;
- không có giá âm;
- không có diện tích âm hoặc bằng 0;
- không có `currency` ngoài `VND`, `USD`;
- không có `price_period` không hỗ trợ;
- không có mã tin trùng trong cùng nguồn;
- không publish listing thiếu `place_id` nếu cần map;
- không publish listing không có offer hợp lệ.

## 16. Quy trình đề xuất

```text
crawl hợp pháp
  -> lưu raw JSONL và checksum
  -> chuẩn hóa thành canonical JSONL
  -> validate schema
  -> staging/source_records
  -> geocode và match catalog.places
  -> phát hiện duplicate
  -> publish property/unit/listing/offer
  -> chạy housing query test
  -> kiểm tra map/API
```

Không sửa trực tiếp dữ liệu OSM/PBF hoặc file GeoJSON fallback để đưa listing thuê vào.

## 17. Tiêu chuẩn hoàn thành một nguồn

Một nguồn chỉ được coi là hoàn thành khi nhóm đã có:

- mapping field của nguồn sang canonical JSONL;
- ít nhất một file mẫu đã được kiểm tra thủ công;
- quy tắc phân loại `property_type`;
- quy tắc parse giá và phí;
- quy tắc nhận diện mã tin;
- quy tắc xác định listing hết hạn;
- quy tắc geocode và độ chính xác vị trí;
- báo cáo accepted/rejected/duplicate;
- bằng chứng nguồn và thời điểm crawl;
- xác nhận quyền truy cập dữ liệu phù hợp.

## 18. Không làm

- Không crawl vượt CAPTCHA, đăng nhập hoặc cơ chế hạn chế truy cập.
- Không chia sẻ số điện thoại/email cá nhân trong phần chat của ứng dụng.
- Không biến dữ liệu tham khảo thành xác nhận pháp lý.
- Không khẳng định tin còn phòng nếu chưa quan sát lại.
- Không gộp nhiều nguồn thành một listing duy nhất nếu chưa có quy tắc entity resolution.
- Không xóa tin cũ để che lịch sử giá hoặc thay đổi trạng thái.
