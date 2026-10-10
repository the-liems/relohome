# Mức 1: truy vấn bản đồ và tìm nhà đọc gần hết dữ liệu ở mỗi lần kéo bản đồ

Ghi chú đo đạc ngày 10/10/2026, trên code `main` sau khi merge PR #88. Mục đích: để bạn thử sửa phía truy vấn trước
khi xử lý hạ tầng (RAM, swap, OSRM).

## 1. Tóm tắt

- Server staging đọc đĩa liên tục 0,5–1,5 GB/s, 5–15K IOPS, ghi gần như bằng 0, dù chỉ có một người dùng.
- Đo ở local với cùng code và cùng dữ liệu (38.245 tin, 190 nghìn địa điểm):
  - một người **mở bản đồ nhà ở** làm PostgreSQL đọc **3,7 GB** trang dữ liệu;
  - **kéo bản đồ 6 lần + phóng to 2 lần** (khoảng 1 phút) làm PostgreSQL đọc **14,5–16,9 GB**, tức 250–350 MB/s.
- Máy local nhiều RAM nên các lần đọc này lấy từ bộ nhớ. Trên server thiếu RAM, chúng thành đọc đĩa và cho đúng độ
  lớn như trên biểu đồ.
- Nguyên nhân: các truy vấn bản đồ và danh sách **nối 4 bảng lớn rồi mới lọc theo khung nhìn**. Mỗi request phải
  quét toàn bộ tin và sắp xếp lại toàn bộ bảng giá, dù khung nhìn chỉ có vài chục căn.
- Thử nghiệm một bảng gọn chỉ chứa thông tin cho bản đồ (6 MB, có index không gian) giảm lượng đọc
  **khoảng 100–300 lần**: lưới cụm cả TP.HCM 1,3 GB → 4,6 MB; danh sách trong khung nhìn 86 ms → 3 ms.

## 2. Số đo

### 2.1. Một người dùng thật, qua trình duyệt

| Thao tác | Thời gian | Lượng PostgreSQL phải đọc | Request phát sinh |
|---|---|---|---|
| Không ai dùng, 60 s | — | 11 MB | — |
| Mở hội thoại | 6 s | 3 MB | session, threads, saved, status |
| **Mở bản đồ nhà ở** | 8 s | **3.664 MB** | 2× `housing/map`, 1× `housing/search`, roommate |
| **Kéo 6 lần + zoom 2 lần** | 45–68 s | **14.453–16.898 MB** | 8× `housing/map`, 8× `housing/search`, 1× `places/map`, 10× `roommate/map/rooms` |
| Để yên bản đồ 60 s | — | 12 MB | roommate 30 s/lần (nhẹ) |

"Lượng PostgreSQL phải đọc" = tổng số trang 8 KB đọc từ vùng đệm và từ đĩa (`blks_hit + blks_read` trong
`pg_stat_database`).

### 2.2. Từng request gọi thẳng Platform API

| Request | Thời gian | Lượng đọc | Dòng quét tuần tự | Phản hồi |
|---|---|---|---|---|
| `housing/map` zoom 15, một khung nhìn ở Q1 | 1.737 ms | 367 MB | 114.725 | 436 KB |
| `housing/map` zoom 11, cả TP.HCM | 658 ms | **1.320 MB** | 191.215 | 18 KB |
| `housing/search` bán kính 2 km | 933 ms | 307 MB | 38.245 | 33 KB |
| `housing/search` theo chữ "phòng trọ quận 1" | 325 ms | 246 MB | **381.494** | 38 KB |
| `housing/search` commute 2 km (có OSRM) | 903 ms | 383 MB | 76.490 | 72 KB |
| `places/map` một khung nhìn | 112 ms | 81 MB | 165 | **3,7 MB** |
| `places/map` cả TP.HCM | 413 ms | 84 MB | 165 | **11,7 MB** |
| `locations/resolve` "Đại học Bách khoa" | 736 ms | 84 MB | 122.923 | 5 KB |

## 3. Nguyên nhân (EXPLAIN ANALYZE BUFFERS)

### 3.1. Lưới cụm bản đồ (`housing/map`)

Code: `Maps VN/LifeFlow/packages/housing-query/src/housing-service.ts`, hàm `mapWithinBudget` (khoảng dòng 313–380).

Kế hoạch thực thi cho cả TP.HCM, tổng **166.796 trang ≈ 1,3 GB**:

```
Parallel Seq Scan on listings l        rows=12748 loops=3   shared hit=4209 read=3750   ← quét hết 38k tin
Subquery Scan on o (current_offers)    loops=3                                          ← mỗi worker làm lại
  Sort  Sort Method: external merge  Disk: 3088kB                                       ← sắp xếp toàn bộ giá, tràn ra file tạm
    Seq Scan on offers o_1             rows=38245 loops=3
Parallel Seq Scan on properties p      rows=38235
Index Scan using places_pkey on places cp   loops=38244   shared hit=152978            ← 38k lần tra địa điểm
   Filter: st_intersects(geom, <khung nhìn>)                                            ← khung nhìn lọc SAU CÙNG
```

Ba vấn đề:

1. **Lọc theo khung nhìn đặt ở bước cuối.** Truy vấn bắt đầu từ `listings`, nối `properties` và `current_offers`, rồi
   mới tra `catalog.places` để kiểm `ST_Intersects`. Index không gian `places_geom_gix` không được dùng, nên kéo bản
   đồ ở đâu cũng phải đi qua toàn bộ 38 nghìn tin.
2. **View `housing.current_offers`** (`database/migrations/002_core_tables.sql:209`) là
   `SELECT DISTINCT ON (listing_id) … ORDER BY listing_id, valid_from DESC, …` trên toàn bảng `offers`. Mỗi request
   sắp xếp lại toàn bảng giá. Với `work_mem` mặc định 4 MB, phần sắp xếp tràn ra file tạm. Mỗi worker song song
   lại làm lại từ đầu (`loops=3`).
3. **`catalog.places` trộn chung địa điểm của nhà và 150 nghìn POI.** Mình đã thử lọc `places` theo khung nhìn trước:
   kết quả còn tệ hơn (cả thành phố chạm khoảng 100 nghìn địa điểm, 714 ms). Vì vậy cách sửa đúng là có dữ liệu bản
   đồ nhà ở riêng, không đảo thứ tự join.

### 3.2. Danh sách trong khung nhìn (`housing/search` với `bounding_box`)

Cùng kiểu join và cùng view `current_offers`:

- quét toàn bộ `listings` (5.253 + 2.706 trang);
- sắp xếp toàn bộ `offers` tràn ra file tạm (7,5 MB × 3 worker);
- tổng **khoảng 13.500 trang ≈ 106 MB**, 86 ms, chỉ để lấy 20 căn.

Code: hàm `selectCandidates` và câu SELECT ở khoảng dòng 440–470 của `housing-service.ts`.

### 3.3. Tìm theo chữ

`housing-service.ts:88`:

```
(l.title ILIKE $x OR l.description ILIKE $x OR cp.address::text ILIKE $x)
```

- Có index trigram cho `title` (`listings_title_trgm_gin`).
- Không có index cho `description`, cũng không có cho `address::text`.
- Điều kiện `OR` buộc quét tuần tự, đo được 381 nghìn dòng mỗi lần tìm.

### 3.4. Lớp POI (`places/map`)

Truy vấn nhẹ (khoảng 81 MB), nhưng **phản hồi JSON 3,7 MB cho một khung nhìn và 11,7 MB cho cả thành phố**. Nặng cho
mạng, cho CPU khi chuyển dữ liệu sang JSON và cho trình duyệt.

### 3.5. `locations/resolve`

Quét tuần tự khoảng 123 nghìn dòng (`location-service.ts`, các hàm `resolvePlaces` và tìm vùng hành chính dùng
`similarity(geo.normalize_search(name), q)`). Có index trigram trên `geo.normalize_search(name)`, nhưng điều kiện
`WHERE` hiện có thể không dùng được index. Cần EXPLAIN lại với câu thật.

## 4. Hướng xử lý (theo thứ tự lợi ích)

### 4.1. Bảng điểm bản đồ gọn cho nhà ở (lợi nhất)

Tạo dữ liệu bản đồ riêng cho các tin đang hiển thị, mỗi tin một dòng, chỉ gồm các cột cần để lọc, gom cụm và sắp xếp.

**Bản thử đã đo** (chạy trên DB local rồi xóa). Bản thử chỉ có vài cột để đo tốc độ; bản dùng thật **phải có đủ
cột cho mọi bộ lọc và mọi kiểu sắp xếp** (danh sách cột ngay dưới bảng số đo, rủi ro ở mục 5):

```sql
CREATE MATERIALIZED VIEW housing.map_points AS
SELECT l.id AS listing_id, cp.geom, o.price_amount, o.currency, o.price_period,
       p.property_type, l.listing_type, l.updated_at
FROM housing.listings l
JOIN housing.properties p ON p.id = l.property_id AND p.deleted_at IS NULL
JOIN housing.current_offers o ON o.listing_id = l.id
JOIN catalog.places cp ON cp.id = p.place_id AND cp.deleted_at IS NULL AND cp.status = 'active'
WHERE l.status = 'active' AND l.deleted_at IS NULL;
CREATE UNIQUE INDEX ON housing.map_points (listing_id);
CREATE INDEX ON housing.map_points USING gist (geom);
-- thêm index cho các cột lọc hay dùng nếu cần: (listing_type, property_type), (price_amount)
```

| | Hiện tại | Dùng `map_points` |
|---|---|---|
| Kích thước | — | **6 MB** (38.244 dòng) |
| Lưới cụm cả TP.HCM | 166.796 trang (1,3 GB), 229 ms | **579 trang (4,6 MB)**, 48 ms (lần đầu, chưa nằm trong vùng đệm) |
| 20 căn rẻ nhất trong khung nhìn Q1 | khoảng 13.500 trang + file tạm, 86 ms | **468 trang (3,7 MB), 3 ms** |
| Tạo lần đầu | — | 0,28 s |
| `REFRESH … CONCURRENTLY` | — | 0,86 s |

**Cột cần có trong bản dùng thật**, để không mất bộ lọc nào đang có:

- **Lọc:**
  - giá (`price_amount`, `currency`, `price_period`), loại nhà, loại tin;
  - phòng ngủ, phòng tắm, diện tích, tiện ích;
  - ngày trống (`availability_from/to` của giá), `verification_status`, nguồn (`source_type`, cho `source_filters`);
  - quận và địa chỉ (cho `district`), chữ tìm kiếm (mục 4.3).
- **Sắp xếp:** `created_at`, `verified_at`, `updated_at`, `listing_id` (khóa phụ để thứ tự ổn định).
- **Hiệu lực của giá:** `valid_from`, `valid_to`, lọc lúc truy vấn chứ không lúc refresh (mục 5).

**Cách dùng:**

1. `housing/map`: gom cụm và lấy marker từ `map_points` (lọc `geom && ST_MakeEnvelope(...)` cùng các bộ lọc giá,
   loại nhà, loại tin), không nối các bảng lớn.
2. `housing/search` có `bounding_box` hoặc bán kính:
   - Bước 1: lấy `listing_id` từ `map_points` (lọc, sắp xếp, phân trang).
   - Bước 2: lấy chi tiết (tiêu đề, ảnh đại diện, tiện ích…) chỉ cho 20 id đó bằng truy vấn hiện tại với
     `WHERE l.id = ANY($ids)`.
3. Tìm theo bán kính dùng `ST_DWithin` trên `map_points`. Có thể thêm cột `geog` và index GIST, như `places` đang có.
4. Giữ nguyên contract trả về (`packages/contracts/src/housing.ts`). Chỉ đổi cách truy vấn bên trong.
5. Request có bộ lọc chưa chạy được trên `map_points` (vùng hành chính theo đa giác, `nearby` gần POI, `commute` qua
   OSRM) thì bước 1 vẫn dùng `map_points` để thu hẹp ứng viên, phần còn lại giữ nguyên logic cũ. Nếu chưa chắc, cho
   các request đó dùng truy vấn cũ.

**Giữ dữ liệu mới:**

- Bước đầu dùng materialized view và gọi `REFRESH MATERIALIZED VIEW CONCURRENTLY housing.map_points`:
  - sau mỗi lần import nhà (`platform-api/src/import-housing.ts`);
  - sau các thao tác chủ nhà làm thay đổi tin công khai: duyệt hoặc ẩn hoặc xóa tin, đổi tình trạng trống, sửa giá
    (`platform-api/src/housing-management.ts`).
- Mỗi lần refresh khoảng 1 s. Nếu lo nhiều lần refresh liên tiếp thì gộp: tối đa 1 lần mỗi vài giây.
- Bước sau (nếu cần cập nhật tức thì và nhẹ hơn): chuyển sang bảng thường cập nhật bằng trigger trên `listings`,
  `offers`, `properties`, `places`, `managed_listings`.
- Migration mới (ví dụ `019_housing_map_points.sql`) chỉ thêm, không sửa bảng cũ. Quyền cho app role là `SELECT`;
  `REFRESH` cần quyền owner, nên chạy bằng role ingest/admin hoặc một hàm `SECURITY DEFINER`.

**Lưu ý:**

- Tin do chủ nhà quản lý (`managed_listings`) chỉ hiện khi `publication_status='published'` và
  `availability_status='vacant'`; logic hiện tại đã đổi `listings.status` theo hai trạng thái này nên view vẫn đúng.
- Kiểm tra lại cách lọc `include_demo` hoặc nguồn dữ liệu nếu `map_points` cần thêm cột `source_type`.

### 4.2. Bỏ cách lấy giá hiện tại bằng sắp xếp toàn bảng

Cho các truy vấn vẫn cần giá (chi tiết tin, phần chi tiết của 20 căn), thay
`JOIN housing.current_offers o ON o.listing_id = l.id` bằng tra cứu theo index đã có
(`offers_listing_active_idx (listing_id, is_active, valid_from DESC)`):

```sql
JOIN LATERAL (
  SELECT o.* FROM housing.offers o
  WHERE o.listing_id = l.id AND o.is_active AND o.valid_from <= now()
    AND (o.valid_to IS NULL OR o.valid_to > now())
  ORDER BY o.valid_from DESC, o.created_at DESC, o.id DESC
  LIMIT 1
) o ON true
```

Chỉ nhanh khi số tin đã được lọc nhỏ (sau bước 4.1). Không nên dùng cách này cho 38 nghìn tin cùng lúc.
Phương án gọn hơn: lưu `current_offer_id` trên tin, hoặc để giá ngay trong `map_points`.

### 4.3. Tìm theo chữ có index

- Thêm index trigram cho `description` và địa chỉ đã chuẩn hóa:
  - `CREATE INDEX … USING gin (description gin_trgm_ops)`;
  - với địa chỉ, dùng biểu thức giống `places_address_normalized_trgm_gin`
    (`geo.normalize_search(address::text)`) và viết điều kiện đúng biểu thức đó để index được dùng.
- Hoặc chuyển sang full-text (`tsvector` không dấu) cho tiêu đề và mô tả.
- Nếu dùng `map_points`, có thể thêm cột `search_text` chuẩn hóa sẵn kèm index trigram, rồi tìm trên bảng nhỏ.

### 4.4. Cache ngắn hạn cho lưới cụm

- Dữ liệu nhà đổi chậm, trong khi lưới cụm ở zoom thấp giống nhau giữa các người dùng.
- Cache trong bộ nhớ của Platform API (LRU, TTL 30–60 s):
  - khóa = khung nhìn làm tròn theo ô (tile) + zoom + bộ lọc;
  - xóa cache khi `map_points` được refresh.
- Hoặc trả `Cache-Control: public, max-age=30` cho các truy vấn bản đồ không gắn với người dùng.

### 4.5. Lớp POI nhẹ hơn

- Giới hạn số điểm trả về theo zoom, và gom cụm phía server ở zoom thấp như `housing/map`.
- Chỉ trả các trường cần để vẽ marker (id, tọa độ, nhóm, tên ngắn); lấy chi tiết khi bấm vào.
- Lâu dài: vector tile (ví dụ `ST_AsMVT`).

### 4.6. Ít request hơn từ frontend

- Mở bản đồ đang gọi `housing/map` **2 lần** (`MapWorkspace.tsx` và `MapPanel.tsx`). Gộp còn 1.
- `roommate/map/rooms` gọi theo mỗi lần kéo bản đồ (10 lần trong 8 lần kéo). Nên chờ lâu hơn hoặc chỉ gọi khi khung
  nhìn đổi đáng kể.

### 4.7. `locations/resolve`

EXPLAIN câu thật. Viết lại điều kiện để index trigram `geo.normalize_search(name)` được dùng: ví dụ lọc trước bằng
`normalize_search(name) % q` hoặc `ILIKE '%…%'` trên đúng biểu thức của index, rồi mới tính `similarity` để xếp hạng.

## 5. Có làm giảm trải nghiệm người dùng không

Mục tiêu là **không đổi gì người dùng thấy**: cùng bộ lọc, cùng kết quả, cùng thứ tự, cùng độ mới của dữ liệu.
Dưới đây là chỗ có thể vô tình làm giảm, và cách tránh.

| Mục | Rủi ro với người dùng | Mức | Cách giữ nguyên |
|---|---|---|---|
| 4.1 `map_points` | Mất bộ lọc nếu bảng thiếu cột | **Cao** | Đủ cột như liệt kê ở 4.1; so kết quả cũ và mới |
| 4.1 `map_points` | Dữ liệu cũ: tin vừa ẩn, vừa "Đã thuê" hoặc vừa đổi giá vẫn hiện | **Cao** | Refresh sau mọi thao tác ghi; xem 5.1 |
| 4.1 `map_points` | Giá có hạn hiệu lực đổi theo thời gian nhưng view đóng băng lúc refresh | Trung bình | Lưu `valid_from/valid_to`, lọc bằng `now()` lúc truy vấn |
| 4.1 tách 2 bước | Trang có ít hơn 20 căn, hoặc trùng hay sót căn giữa các trang | Trung bình | Bước 1 lọc và sắp xếp đủ; khóa phụ `listing_id`; cursor giữ nguyên |
| 4.2 lấy giá theo index | Không đổi kết quả nếu `ORDER BY` giống hệt view | Thấp | Giữ đúng `valid_from DESC, created_at DESC, id DESC` |
| 4.3 index tìm chữ | Index trigram giữ nguyên nghĩa `ILIKE` | Thấp | **Không đổi sang full-text** ở bước này: full-text so theo từ, sẽ khác kết quả |
| 4.4 cache lưới cụm | Số đếm và marker cũ tới 30–60 s | Trung bình | Chỉ cache truy vấn công khai; xóa cache khi refresh; TTL ngắn |
| 4.5 lớp POI | Ít điểm hơn khi zoom xa; mất thông tin trong popup nếu bỏ trường | Trung bình | Gom cụm có số đếm thay vì bỏ điểm; giữ trường UI đang hiển thị |
| 4.6 gộp `housing/map` | Mất marker ở bản đồ nhỏ trong chat (`MapPanel` trong `Results.tsx`) | Trung bình | Chỉ bỏ request của bản đồ đang bị che, không bỏ hẳn |
| 4.6 giãn `roommate/map/rooms` | Marker ghép trọ cập nhật chậm hơn khi kéo | Thấp | Chờ thêm khoảng 300–500 ms, không bỏ |
| 4.7 `locations/resolve` | Mất gợi ý khi gõ sai chính tả nếu lọc `%` quá chặt | Trung bình | Giữ ngưỡng và cách xếp hạng cũ; so danh sách gợi ý trước và sau |

### 5.1. Độ mới của `map_points`: nơi cần refresh

Hiện tại thay đổi nào cũng hiện ngay (truy vấn đọc thẳng bảng gốc). Với materialized view, mọi chỗ làm đổi tin công
khai đều phải refresh:

- import nhà (`import-housing.ts`);
- chủ nhà: duyệt tin, trả lại tin, ẩn, xóa, đổi tình trạng trống ("Đã thuê", "Tạm dừng"), sửa tin hoặc giá hoặc phí,
  đổi địa chỉ hoặc vị trí (`housing-management.ts`);
- dọn dữ liệu POI và housing (`clean-pois.ts`) nếu có đụng tới địa điểm của nhà.

Ngoài ra nên refresh định kỳ (ví dụ mỗi 15 phút) làm lưới an toàn. Cho tới khi có trigger, chấp nhận độ trễ khoảng
1 s sau mỗi thao tác. Thứ phải tránh là bỏ sót một chỗ refresh, khiến tin "Đã thuê" vẫn hiện trên bản đồ và người thuê
gửi yêu cầu thì bị 409.

### 5.2. Kiểm tra không giảm chức năng

Trước khi gửi PR:

1. Lưu kết quả của bản cũ cho khoảng 20 request: các khung nhìn, zoom, bộ lọc giá, phòng ngủ, tiện ích, tìm chữ,
   quận, vùng hành chính, `nearby`, `commute`, `listing_ids`, mọi kiểu sắp xếp, trang 1 và 2 theo cursor.
2. Chạy lại với bản mới và so: cùng `listing_id`, cùng thứ tự, cùng số đếm cụm (sai số do làm tròn tọa độ cụm chấp
   nhận được).
3. Thử độ mới: chủ nhà bấm "Đã thuê" → tin biến khỏi bản đồ trong vòng vài giây; sửa giá → giá mới hiện; duyệt tin
   mới → tin hiện.
4. Chạy test hiện có (mục 6) và Playwright bản đồ, nhà ở.

## 6. Cách đo lại (trước và sau khi sửa)

Chạy trên DB local đã migrate (ở đây là container `lifeflow-integration-postgis-1`, DB `lifeflow_verified`, user
admin). Đổi tên container, user, DB cho khớp máy bạn.

**1. Lượng đọc của từng request:** đọc `blks_hit + blks_read` trước và sau request; chờ khoảng 1 s để thống kê được
ghi.

```sh
PSQL="docker exec lifeflow-integration-postgis-1 psql -U <admin> -d lifeflow_verified -Atc"
snap() { $PSQL "select sum(blks_hit)+sum(blks_read) from pg_stat_database"; }
a=$(snap)
curl -s -o /dev/null -X POST http://127.0.0.1:4100/v1/housing/map -H 'content-type: application/json' \
  -d '{"bounding_box":{"west":106.34,"south":10.34,"east":107.05,"north":11.2},"zoom":11}'
sleep 1.2; b=$(snap); echo "$(( (b-a)*8/1024 )) MB"
```

**2. Kế hoạch thực thi:** bật log tạm để lấy đúng câu SQL, rồi chạy `EXPLAIN (ANALYZE, BUFFERS)` với câu đó.

```sh
$PSQL "ALTER SYSTEM SET log_min_duration_statement = 0"; $PSQL "select pg_reload_conf()"
# gửi request, xem câu SQL bằng: docker logs --since 10s lifeflow-integration-postgis-1
$PSQL "ALTER SYSTEM RESET log_min_duration_statement"; $PSQL "select pg_reload_conf()"
```

**3. Kịch bản một người dùng:** mở hội thoại có kết quả nhà, bấm "Mở bản đồ nhà ở", kéo bản đồ 6 lần và zoom 2 lần.
Ghi lượng đọc trước và sau mỗi bước như cách 1.

**Mục tiêu sau khi sửa:**

| Request | Hiện tại | Mục tiêu |
|---|---|---|
| `housing/map` bất kỳ zoom | 367–1.320 MB | **dưới 10 MB**, dưới 50 ms |
| `housing/search` trong khung nhìn hoặc bán kính | 307 MB | **dưới 10 MB**, dưới 50 ms |
| `housing/search` theo chữ | 246 MB | dưới 20 MB |
| Mở bản đồ + 1 phút kéo | 15–17 GB | **dưới 300 MB** |

**Không được đổi:**

- Contract trả về (`packages/contracts`), thứ tự sắp xếp, phân trang bằng cursor.
- Kết quả giống hệt bản cũ với cùng request: so danh sách `listing_id` của vài khung nhìn và bộ lọc trước và sau khi
  sửa.
- Các test phải pass:
  - `npm test` của `packages/housing-query` (có 21 test tích hợp tìm nhà; 3 test đếm theo tọa độ TP.HCM sẽ fail nếu
    DB local còn tin `[Thử]`, nên xóa dữ liệu thử trước);
  - `platform-api/tests/*.integration.test.ts`;
  - Playwright các file `housing-*` của frontend.

## 7. Ngoài phạm vi mức 1 (để sau)

RAM của server, swap, số lượng OSRM (9 tiến trình, 1,33 GB), cấu hình PostgreSQL (`shared_buffers`, `work_mem`),
payment MCP chạy kiểu stdio sinh tiến trình mỗi lần gọi, tần suất healthcheck. Các mục này đã ghi trong phần trả lời
trước. Mức 1 giảm lượng đọc tận gốc, nên dù server còn thiếu RAM thì áp lực lên đĩa cũng nhỏ đi rất nhiều.
