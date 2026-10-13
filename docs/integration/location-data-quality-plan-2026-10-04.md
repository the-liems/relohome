# Kế hoạch xử lý chất lượng địa điểm, tiện ích và phòng trọ

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


> Ngày 2026-10-05 đã áp dụng lô đầu: chuẩn hóa 590 địa chỉ, đổi 347 tọa độ
> source / 340 tọa độ PostGIS; giữ đủ 38.930 tin. 7.311 khóa còn chờ API/quota.
> Kết quả hiện tại, kiểm chứng và hướng dẫn chạy tiếp ở
> [báo cáo geocode housing](housing-geocode-batch-2026-10-05.md).

Ngày khảo sát: **04/10/2026**. Code: **`b7cd0c7`**, sau khi nhận nhánh `khoa`.

## 0. Phạm vi triển khai đã chốt với người dùng

Lần triển khai này chỉ thực hiện gộp **biểu diễn địa điểm/tiện ích OSM**:
chuẩn hóa danh tính nguồn, canonical search, nhãn phân biệt địa điểm, giữ ID cũ
và xác nhận pin. Các đề xuất housing/quality/freshness trong P3/P4 bên dưới là
kết quả khảo sát và **được hoãn**, không áp dụng lên dữ liệu nhà.

Không gộp phòng/tin đăng dù trùng tên, địa chỉ hoặc tọa độ. Không thay đổi `.env`,
độ chính xác pin nhà, giá/cọc, TTL, Planner hoặc Flight/Payment.
Chi tiết triển khai và rollback:
[POI-CANONICALIZATION.md](../location/POI-CANONICALIZATION.md).

Phần 1–8 ghi lại khảo sát và đánh giá trước triển khai. Trạng thái áp dụng thực tế
được ghi ở phần 9.

## 1. Phạm vi và kết luận

Đã đọc importer, schema, service truy vấn Location/Housing, bộ chọn địa điểm của
frontend, các adapter agent và tài liệu bàn giao. Đã đọc toàn bộ nguồn housing và
đếm dữ liệu trên database local đang được ứng dụng sử dụng bằng transaction chỉ đọc.
Đã gọi hai truy vấn tìm địa điểm qua API agent để tái hiện vấn đề trong ảnh.
Không gọi LLM/provider trả phí, không import/migrate hoặc sửa code, `.env`, dữ liệu
nghiệp vụ. Lượt này bổ sung tài liệu kế hoạch và các báo cáo khảo sát trong `data/`.

**Vấn đề có ở cả dữ liệu nhập, cách chọn kết quả tìm kiếm và cách hiển thị.**
Không thể xử lý đầy đủ chỉ bằng cách ẩn các dòng giống tên trên frontend.

- Có trùng xác định được bằng danh tính OSM: cùng một `way` được xuất/nhập ở hai
  dạng, nhưng trở thành hai `place_id`.
- Có các địa điểm khác nhau dùng cùng tên: trường, cơ sở, trạm xe buýt, cổng và
  hai chiều đường. Cần phân biệt chúng trước khi gộp.
- Dữ liệu phòng trọ có nguồn/giá và đã qua một số bước làm sạch, nhưng chưa đủ
  bằng chứng để khẳng định vị trí cửa nhà hay còn phòng.

## 2. Bằng chứng trên máy hiện tại

### 2.1. Tiện ích và địa điểm OSM

Phạm vi: toàn bộ catalog local, không phải riêng Hà Nội hay TP.HCM. Số tiện ích
loại các hàng `attributes.entity_role='housing_anchor'`.

| Chỉ số | Kết quả | Diễn giải |
|---|---:|---|
| Tổng catalog | 190.266 | Bao gồm POI và điểm định vị tin nhà |
| POI active | 152.044 | Chưa loại các biểu diễn trùng |
| Housing anchor | 38.222 | Không cộng vào tiện ích |
| POI thiếu tên | 41.051 (27,0%) | Không phải tất cả đều vô dụng: bãi xe/công viên có thể không có tên |
| POI có address JSON rỗng | 113.113 (74,4%) | Không đồng nghĩa không xác định được khu vực bằng tọa độ |
| POI thiếu giờ mở cửa | 143.392 (94,3%) | Không khẳng định đang mở |
| POI `unverified` | 152.044 | Không có xác minh trong hệ thống; không có nghĩa toàn bộ là sai |
| Nhóm cùng tên chuẩn hóa, category và tọa độ y hệt | 56 nhóm / 114 hàng | Chỉ bắt được một phần rất nhỏ của vấn đề |
| Cùng danh tính OSM `way` nhưng khác `place_id` | **30.683 nhóm / 61.366 POI** | Mỗi nhóm có hai place; 30.683 biểu diễn thừa theo khóa OSM |
| POI có cờ `possible_duplicate=true` | 0 | Cờ hiện tại không phản ánh đầy đủ các trùng đã xác định |

Cách đếm danh tính: chuyển `area/N` về `way/(N/2)` khi N chẵn, hoặc
`relation/floor(N/2)` khi N lẻ; giữ `node/way/relation` gốc. Đây là quy tắc của
Area trong Osmium, không phải suy đoán dựa vào tên hoặc khoảng cách.
[Tài liệu Pyosmium về Area](https://docs.osmcode.org/pyosmium/latest/user_manual/03-Working-with-Geometries/).

Ví dụ cụ thể trong DB:

- **Bể bơi Bách Khoa**: `area/73464664` và `way/36732332` đang thuộc hai place.
- **Điểm trạm Y tế Bách Khoa**: `area/2903175568` và `way/1451587784` tương tự.
- Hai điểm đại diện có thể lệch nhau vài chục mét do cách chuyển đường/polygon
  thành point; so tọa độ bằng nhau hoặc ngưỡng 3 m sẽ bỏ sót.

Số 30.683 không phải số tất cả địa điểm trùng trong đời thực. Chưa rà toàn bộ
node và polygon khác ID cùng mô tả một cơ sở, hoặc quan hệ cơ sở–cổng–trạm.

### 2.2. Tái hiện danh sách trong ảnh

`GET /api/v1/map/search?text=Đại học Bách Khoa` trả 8 ứng viên:

- **7 `bus_stop`**, ở cả miền Bắc và miền Nam.
- **1 `university`**, Đại học Bách khoa Hà Nội.
- Các trạm khớp tên `exact` đứng trước trường có tên đầy đủ khớp `prefix`.
- Nhãn frontend chỉ có tên và một parent nhỏ như “Khu phố 12”, nên các trạm
  khác nhau trông như cùng một địa chỉ, không thấy thành phố hoặc loại POI.

Khi tìm tên đầy đủ **“Đại học Bách Khoa Hà Nội”**, trường đúng lên đầu, nhưng API
vẫn trả thêm ứng viên fuzzy ở miền Nam và một trường khác. Việc đã có chữ Hà Nội
trong truy vấn chưa tương đương với một điều kiện không gian.

Các trạm xe buýt tên Bách Khoa trong ảnh không phải tất cả là lỗi trùng nguồn.
OSM mô tả university và bus stop là các đối tượng khác nhau.
[University](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Duniversity),
[Bus stop](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dbus_stop).

### 2.3. Nguồn nhà và phòng trọ

Đã đọc hết `Maps VN/Data/housing_clean_2026-09-26.jsonl`:

- **38.930 record**, đọc được toàn bộ; không gặp lỗi JSON khi dùng parser cho phép
  newline trong string. Đây không phải kiểm thử mọi ràng buộc schema importer.
- Nguồn: Nhà Tốt 35.612; Mogi 1.445; iVIVU 1.053; Homedy 820.
- Không có khóa `(source_type, source_listing_id)` lặp trong file này. Điều đó
  chưa loại được cùng căn đăng nhiều mã hoặc nhiều website.
- 708 record có cờ `likely_commercial`. Importer có quy tắc quarantine cờ này;
  tổng listing DB ít hơn file 708. Không đọc được staging bằng role ứng dụng
  (`42501`), nên đây chưa phải đối chiếu trực tiếp từng bản ghi quarantine.
- Thời điểm quan sát nguồn: 26/09/2026; không có bằng chứng chủ nhà xác nhận
  còn trống vào 04/10.
- SHA256 file: `e09eda120367a9f40883ba306277a052497efb3db6ae3e958d021277a073125b`.

Phạm vi bảng dưới: **38.222 listing active** trong DB, gồm nhiều loại hình.

| Chỉ số | Kết quả | Diễn giải |
|---|---:|---|
| Phòng trọ rent / `property_type=room` | 10.763 | Không gọi toàn bộ 38.222 là phòng trọ |
| Listing `unverified` | 38.222 | Chưa có xác minh trong hệ thống |
| Vị trí `approximate` | 15.595 (40,8%) | Không dùng như cửa nhà chính xác |
| Cờ `shared_pin_centroid` | 8.730 | Dữ liệu đã nhận diện pin tâm khu vực |
| Tin dùng tọa độ y hệt ít nhất một tin khác | 33.761 (88,3%) | Có thể là cùng tòa nhà hoặc pin thô; không đủ để gộp tin |
| Nhãn `rooftop` nhưng pin dùng chung với tin ở đường khác | **1.218 tin / 104 nhóm tọa độ** | Dấu hiệu cần kiểm tra nhãn độ chính xác, chưa xác định tin nào sai |
| Thiếu diện tích | 3.286 | Không tự điền từ suy luận của LLM |
| Mảng amenities rỗng | 8.137 | Chưa khai báo, không tự suy ra không có tiện nghi |
| Thiếu cọc | 21.448 (56,1%) | Không hiển thị cọc bằng 0 |
| Thiếu ảnh | 22 | Có ảnh không chứng minh ảnh còn đúng hoặc căn còn trống |
| Nhóm trùng tên chuẩn hóa + pin + giá + kỳ giá | 25 nhóm / 52 tin | Ứng viên rà soát, chưa đủ kết luận cùng phòng |
| Giá bằng 0 / thiếu current offer | 0 / 0 | Giá và offer đã có, không phải lỗi chưa nhập dữ liệu |

Riêng **10.763 phòng trọ rent**: 3.796 vị trí approximate, 3.003 có cờ centroid,
1.180 thiếu diện tích, 1.199 amenities rỗng, 4.413 thiếu cọc. Các nhóm này có thể
giao nhau, không cộng lại thành số phòng lỗi.

Theo nhãn city nguồn, Hà Nội có **1.829 phòng trọ**, trong đó **1.333** có giá
dưới 5 triệu VND/tháng. Đây là số tin; chưa kiểm chứng khả dụng, gần Bách Khoa
hay vị trí chính xác. Không dùng làm cam kết số phòng đáp ứng ngoài đời.

Offer hiện tại: 37.166 rent VND/month, 1.052 short_stay VND/night và 4
short_stay VND/day. Toàn bộ current offer không có `valid_to` và thiếu cả hai
mốc availability. Code hiện giữ offer hiệu lực khi `valid_to` rỗng; đây không
phải bằng chứng phòng luôn còn trống.

## 3. Nguyên nhân trong code

| Lớp | Hiện trạng | Hệ quả |
|---|---|---|
| Import POI | `parseOsmIdentity` đã biết osm_type/osm_id, nhưng `sourceId` vẫn giữ `area/...`; UUID tạo từ sourceId | Cùng way có thể thành hai place |
| Matching import | Gộp theo cùng category + tên + khoảng cách tối đa 3 m khi có tên | Bỏ sót cùng đối tượng có điểm đại diện khác; không thay thế khóa OSM |
| Location resolve | Xếp exact/prefix/contains/fuzzy theo tên; giới hạn trước khi trả; không gộp theo thực thể | Trạm đúng tên có thể lấn trường; duplicate chiếm số gợi ý |
| API picker | Chỉ truyền `text` và `limit=8` | Không nhận scope thành phố/đầu lấy–giao hoặc loại thực thể |
| UI Moving | Ghép housePoint + choices từ agent + found, chỉ lọc tọa độ/type | Cùng ID xuất hiện hai nguồn có thể được render hai lần |
| UI nhãn | Tên + parent nhỏ nhất; bỏ category ở kết quả tìm kiếm Moving | Trạm và trường khó phân biệt, thiếu tỉnh/thành |
| Housing import | ID property/unit/listing tạo theo khóa tin nguồn | Tránh nhập lặp cùng mã; chưa nhận diện cùng bất động sản qua các mã/nguồn khác |
| Housing quality | Chặn `likely_commercial`/publishable=false; giữ nhiều cờ bất thường để trả cho agent | Cần quy trình xem xét cờ và độ tin cậy theo mục đích sử dụng |
| Freshness | Chưa có TTL nguồn/kiểm tra khả dụng, current offer có thể không hết hạn | active không đồng nghĩa đang có thể thuê |

Các file trọng tâm:

- `Maps VN/LifeFlow/platform-api/src/poi-normalization.ts`
- `Maps VN/LifeFlow/platform-api/src/import-pois-v2.ts`
- `Maps VN/LifeFlow/platform-api/src/import-housing.ts`
- `Maps VN/LifeFlow/packages/housing-query/src/location-service.ts`
- `Maps VN/LifeFlow/packages/housing-query/src/place-service.ts`
- `Maps VN/LifeFlow/packages/housing-query/src/housing-service.ts`
- `src/api/routes.py`, `src/agents/subagents/services/location.py`, `moving_llm.py`
- `Frontend/src/components/ServiceWorkspaces.tsx`

## 4. Kế hoạch triển khai theo thứ tự

### P0 — Chốt báo cáo và bộ ca kiểm tra

1. Giữ checksum nguồn, phiên bản code, ngày đo và định nghĩa phạm vi như trên.
2. Tạo bộ mẫu có nhãn bằng rà soát thủ công: đề xuất 50 ca địa điểm và 50 tin
   housing, lấy cả Hà Nội/TP.HCM/Đà Nẵng và trường hợp tên chung/khác cơ sở.
3. Ghi riêng các nhãn `same_osm_object`, `same_real_place`, `related_place`,
   `different_place`, `needs_review`; phòng trọ có nhãn pin/loại/kỳ giá/khả dụng.
4. Đo baseline: trùng trong top kết quả, gợi ý sai thành phố/loại, tỷ lệ thiếu
   dữ kiện, thời gian truy vấn. Không dùng kết luận của LLM làm ground truth.

Đầu ra: báo cáo chất lượng có thể chạy lại và bộ mẫu review. Đã có thống kê
khởi đầu ở mục 2; bộ mẫu có nhãn và script audit lâu dài chưa được triển khai.

### P1 — Chuẩn hóa danh tính OSM và gộp có thể hoàn tác

1. Tách **ID bản ghi xuất** (`area/...`) khỏi **danh tính OSM gốc**
   `(source, osm_type, osm_id)`. Giữ cả payload/geometry nguyên thủy.
2. Cùng danh tính OSM dùng một canonical place. Lưu alias cho mọi place_id cũ,
   source_id cũ và lý do gộp. Tên/category/address xung đột cần review; không chọn
   ngẫu nhiên một dòng hoặc mất provenance.
3. Xuất manifest dry-run cho 30.683 nhóm trước khi cập nhật: place sống sót,
   alias, nguồn/geometry, xung đột và những tham chiếu cần xử lý.
4. Kiểm tra ID trong saved items, chat/checkpoint, lựa chọn của user, tham chiếu
   nguồn và dữ liệu giao dịch. ID cũ phải tiếp tục resolve về ID mới. Những pin
   đã được user xác nhận vẫn giữ tọa độ xác nhận; không âm thầm đổi điểm dừng xe.
5. Sau chuẩn hóa danh tính mới rà node/polygon khác ID: dùng tên/alias + geometry
   chứa nhau/gần nhau + category + địa chỉ/brand/operator. Ngưỡng khoảng cách
   phải hiệu chỉnh theo loại POI và bộ mẫu, không áp chung 100 m cho mọi loại.
6. Cơ sở/cổng/trạm là các thực thể liên quan; chỉ tạo quan hệ khi có bằng chứng.
   Trạm hai chiều, cơ sở khác thành phố và chi nhánh phải giữ riêng.
7. Backup DB và manifest trước đợt sửa; chạy thử trên bản sao, publish theo batch
   có rollback. Sửa importer để snapshot tiếp theo không tạo lại các trùng.

**Nghiệm thu:** mỗi danh tính OSM trong phạm vi sửa có một canonical place;
import lại cùng snapshot không tăng số entity; ID cũ vẫn truy vấn được; không
gộp sai các ca khác cơ sở/cổng/trạm trong bộ mẫu.

### P2 — Gợi ý đúng mục đích và địa bàn, nhất quán cho agent và UI

1. Cho picker nhận scope đã xác định và mục đích tìm kiếm: địa danh, tiện ích,
   điểm lấy hoặc giao. Tái sử dụng bbox/center/radius đã có trong contract.
2. **Scope riêng từng đầu lấy/giao.** Một cuộc chuyển đồ có thể đi khác thành
   phố. Chỉ dùng địa bàn như hard constraint khi user đã xác định cho đầu đó;
   viewport chưa xác nhận không tự biến thành giới hạn cứng.
3. Tìm “Đại học Bách Khoa” cho địa danh trường phải ưu tiên cơ sở university phù
   hợp ngữ cảnh; bus_stop vẫn tìm được khi user muốn trạm. Giữ alias có nguồn
   như `name:vi`, `short_name`, `alt_name`; không tự bịa tên/địa chỉ.
4. Canonical hóa/gộp kết quả trước LIMIT để trùng không chiếm chỗ gợi ý. Dùng
   cùng cách xử lý trong resolve, search_places, nearby và layer bản đồ.
5. Trả tên, loại POI, tỉnh/thành, địa chỉ có sẵn, cơ sở và mức khớp. Tỉnh/thành
   suy ra từ geometry phải được phân biệt với địa chỉ khai báo của nguồn.
6. UI loại ID lặp giữa agent choices và found, giữ lựa chọn đang ghim; không
   dedup chỉ theo label. Hiển thị ví dụ “Đại học Bách khoa Hà Nội · Trường đại học
   · Hà Nội” và “Đại học Bách Khoa · Trạm xe buýt · TP.HCM”.
7. Nếu thiếu scope hoặc còn nhiều cơ sở hợp lệ, agent hỏi lại với một số lựa
   chọn phân biệt được. Không coi `match_type=exact` là bằng chứng đúng loại POI
   hay đúng cổng cho xe đến. Với Moving vẫn cần xác nhận điểm dừng phù hợp.

**Nghiệm thu:** tên đầy đủ trường ở Hà Nội không trộn trường/trạm miền Nam trong
scope Hà Nội đã xác định; tên chung vẫn cho chọn cơ sở; trường và trạm có nhãn
phân biệt; cùng ID từ hai nguồn UI chỉ hiện một dòng; hai đầu chuyển đồ khác
thành phố không bị mất scope riêng. Không làm mất ngày giờ/user selections.

### P3 — Rà lại phòng trọ theo độ tin cậy và nhu cầu thuê

1. Tách quality theo trường: vị trí, giá/kỳ giá, diện tích, amenities, nguồn và
   freshness. Một tin có ảnh/giá đầy đủ vẫn có thể có pin yếu.
2. Kiểm tra 104 nhóm `rooftop` nhiều đường và các cờ centroid. Giữ
   `source_accuracy` riêng với mức độ tin cậy hệ thống; chỉ nâng độ chính xác
   khi có bằng chứng. Lưu lý do và mức bất định để agent/UI sử dụng.
3. Tin dùng pin khu vực phải hiển thị vị trí gần đúng. Khoảng cách/nearby/OSRM
   từ pin đó chỉ là ước tính từ pin. Nếu bất định đủ làm thay đổi điều kiện
   “gần dưới X mét”, trả chưa đủ dữ kiện, không khẳng định đạt điều kiện cứng.
4. Chuẩn hóa từ vựng tiện nghi (máy lạnh, chỗ để xe), có nguồn cho từng giá trị.
   `internet` không tự động chứng minh có Wi-Fi: giữ sự khác nhau khi nguồn chỉ
   nói có kết nối Internet. Thiếu = chưa biết; phân biệt tiện nghi trong phòng
   với POI ngoài nhà. LLM không được tự điền tiện nghi hoặc tiền cọc.
5. Giữ riêng thuê tháng/ngày/đêm, room/studio/house/apartment, đúng currency và
   kỳ giá. Chỉ đổi đơn vị khi quy tắc và dữ kiện nguồn cho phép.
6. Rà các cờ area_implausible, rooms_inconsistent, sale_keyword, deposit và
   outlier theo mẫu thủ công. Bất thường rõ ràng đưa vào review/quarantine;
   giá rẻ/đắt đơn lẻ chưa đủ để loại tin. Thiếu cọc không biến thành miễn cọc.
7. Phát hiện cùng căn nhiều tin dựa trên nguồn, địa chỉ/unit, mô tả, ảnh và giá
   lịch sử. Chỉ tọa độ chung không đủ. Giữ property–unit–listing–offer riêng;
   có thể nhóm tin tương đương trên UI trong khi giữ toàn bộ lịch sử nguồn.
8. Agent giải thích giới hạn nguồn khi dữ kiện thiếu; yêu cầu xác nhận pin
   trước dùng địa chỉ nhà cho Moving. Không nới ngân sách/điều kiện thuê để
   che dữ liệu thiếu.

**Nghiệm thu:** bộ mẫu không còn pin yếu được giới thiệu như cửa nhà xác minh;
không dùng short_stay thay room rent/month; cọc thiếu hiển thị chưa rõ; lọc
amenity không tự suy ra giá trị; không gộp hai phòng khác nhau chỉ vì chung pin.

### P4 — Cập nhật dữ liệu và theo dõi chất lượng định kỳ

1. Thêm mốc `source_observed_at`, `last_checked_at`, trạng thái kiểm tra nguồn
   và availability. Ngày import không thay ngày chủ nhà/nguồn xác nhận.
2. Chọn TTL theo nguồn và loại listing sau khi đo thực tế; hết thời gian kiểm
   tra hiển thị cần xác nhận. Không tự xóa tin vì vắng trong snapshot một phần.
3. Với nguồn OSM giữ version/timestamp và tải snapshot/diff theo lịch đã chọn.
   Test nhập idempotent và thay đổi geometry/name trước chuyển snapshot live.
4. Báo cáo theo thành phố/loại POI/nguồn housing: thiếu trường, trùng danh tính,
   pin yếu, dữ kiện cũ, các ca review và độ trễ truy vấn. Cùng phạm vi/định nghĩa
   mới so sánh trước–sau; không cộng housing anchor vào số tiện ích.
5. Bổ sung nguồn chỉ sau khi biết lỗ hổng coverage cụ thể và cách kiểm chứng;
   không tải thêm số lượng lớn để bù lỗi canonical hoặc pin hiện tại.

**Nghiệm thu:** snapshot mới không tái sinh duplicate; tin cũ có nhãn freshness
đúng; có báo cáo tái lập và quy trình rollback khi chất lượng giảm.

## 5. Các ca kiểm tra bắt buộc

| Ca | Kết quả cần đạt |
|---|---|
| `way/36732332` và `area/73464664` | Một POI canonical, hai bản ghi nguồn vẫn truy nguyên được |
| University/cổng/trạm cùng tên ở gần nhau | Giữ thực thể riêng, nhãn rõ, không gộp theo khoảng cách đơn thuần |
| Bách Khoa chưa nói thành phố | Gợi ý cơ sở phân biệt được hoặc hỏi thành phố |
| Bách Khoa Hà Nội với scope Hà Nội | Ưu tiên trường phù hợp, không để trạm TP.HCM lấn kết quả |
| Lấy Hà Nội, giao TP.HCM do user chỉ định | Scope độc lập từng đầu; không tự ép cùng thành phố |
| Một ID có trong choices và found | Chỉ render một ứng viên; pin/lựa chọn không mất |
| Lựa chọn POI trong checkpoint mang place_id cũ | Resolve qua alias, không hỏng lịch sử hoặc đổi pin xác nhận |
| Housing saved/checkpoint mang listing_id cũ | Giữ listing_id; không thay bằng ID POI hay ID nhóm tin |
| Room/month và short_stay/night cùng địa bàn | Đúng loại/kỳ giá theo yêu cầu |
| Hai phòng/tòa nhà dùng chung pin | Không tự gộp cùng unit/listing |
| `rooftop` chung pin khác đường / centroid | Được rà và trả mức bất định đúng, không khẳng định cửa nhà |
| Thiếu cọc, Wi-Fi, availability | Trả chưa rõ; không suy ra 0/có/còn trống |
| Pin gần đúng sát ngưỡng “cách dưới X m” | Không xác nhận đạt hard filter khi sai số chưa được làm rõ |
| Import lại snapshot, đổi nguồn/giá/geometry | Không nhân bản; giữ lịch sử/alias và có rollback |

Chạy ca offline/database/API và browser trước. Các ca agent dùng LLM/provider
thật là một đợt riêng có ngân sách được chốt; lượt khảo sát này chưa chạy.

## 6. Thứ tự làm và ranh giới triển khai

Ưu tiên **P0 → P1 → P2**, vì lỗi danh tính OSM và picker ảnh hưởng cả Housing,
Map và Moving. Sau đó **P3 → P4** để kết quả tìm phòng có giá trị sử dụng hơn.
UI dedup ID có thể làm sớm, nhưng không thay thế canonical ở dữ liệu/service.

Không cần viết lại planner hoặc đổi LLM để xử lý lỗi gốc đã xác định.
Khi triển khai sẽ cần sửa ingestion/database/query, contract/API nếu bổ sung
scope và frontend hiển thị. Đây là phạm vi rộng hơn chỉnh giao diện đơn thuần.
Chưa thực hiện các thay đổi đó trong lượt lập kế hoạch này.

Readiness Moving thiếu schema `moving.*` đã báo ở lượt khởi động là một việc
vận hành riêng; dedup OSM không tự giải quyết vấn đề đó.

## 7. Báo cáo local và giới hạn khảo sát

Các báo cáo trong `data/` bị Git ignore, không chứa credential:

- `location-quality-audit-20261004.json`: catalog, chất lượng POI/listing,
  danh mục, mẫu Bách Khoa và import runs.
- `location-quality-additional-20261004.json`: trùng khóa OSM, cờ housing,
  tọa độ dùng chung và coverage room theo nhãn city.
- `housing-source-quality-audit-20261004.json`: đọc toàn bộ file nguồn,
  checksum, phân bố nguồn và thiếu trường.
- `housing-room-quality-20261004.json`: riêng room, pin rooftop nhiều đường,
  kỳ giá/expiry/availability; truy vấn staging báo thiếu quyền `42501`.

Không có kiểm tra ngoài thực địa/chủ nhà, chưa rà thủ công tất cả ứng viên
trùng theo tên, chưa đối chiếu toàn bộ nội dung PBF gốc và chưa đo latency/p95.
Nhãn `rooftop`, `active`, `unverified` ở trên là giá trị lưu trong DB, không phải
kết luận xác minh thực địa. Bằng chứng API là hai truy vấn local ngày khảo sát;
không phải kiểm thử end-to-end mọi hội thoại với LLM.

## 8. Rà lại tác động lên hệ thống trước khi thực hiện

Bổ sung sau lượt review kế hoạch ngày 04/10. Đây là phân tích code và các rủi ro
triển khai; chưa chạy migration hoặc kiểm thử phiên bản sửa vì chưa có bản sửa.

### 8.1. Những tác động cụ thể đã thấy trong code

| Thay đổi dự kiến | Chỗ bị tác động | Rủi ro và điều kiện để thực hiện |
|---|---|---|
| Alias place_id cũ sang ID canonical | `src/api/routes.py::_verified_place` | API so `get_place.place_id` với ID client gửi. Nếu service trả ID mới cho ID cũ, API hiện chặn 422. Phải thiết kế/triển khai tương thích ở cả service và API trước khi chuyển ID |
| Chuyển POI sang canonical mới | `RouteEndpointService.resolve`, `PlaceService.get`, các `near_place_id` và endpoint route trong checkpoint | Các đường đọc dùng ID trực tiếp; sửa riêng picker không làm route/checkpoint hiểu alias. Cần kiểm tra mọi đường đọc, không chỉ lookup chi tiết |
| Gộp các kết quả giống nhau | `moving_llm.py::point`, `location.py::pick_clear/pick_place` | Số kết quả exact giảm có thể đổi từ hỏi lại sang tự chọn. Một kết quả exact còn lại chưa chứng minh đúng cơ sở hoặc cổng xe đến; cơ chế xác nhận phải được kiểm tra trước khi bật gộp |
| Chọn lại point đại diện từ polygon | Nearby SQL, Housing hard filter, OSRM, AhaMove quote | Khoảng cách, đường đi và giá có thể đổi. Phải tách point đại diện phục vụ tìm kiếm khỏi điểm dừng user đã xác nhận; không thay payload của báo giá/đơn cũ |
| Sửa nhãn rooftop/approximate | Moving endpoint dùng nhà đã chọn; route warnings; UI pin nhà | Code Moving có nhánh dùng thẳng tọa độ nhà nếu rooftop. Hạ độ tin cậy có thể phát sinh bước hỏi xác nhận pin; đây là thay đổi hành vi có chủ đích, cần giữ ngày/giờ và nhà đã chọn |
| Lọc chỉ dữ liệu verified hoặc xóa POI không tên | Housing/POI search, nearby, map | Toàn bộ listing và POI đang unverified. Bật verified_only mặc định có thể làm kết quả rỗng; bỏ 41.051 POI không tên làm giảm coverage, nhất là công viên/bãi xe |
| Thêm TTL/quarantine hàng loạt | Current offers, get_housing, route từ listing, bước chọn nhà cho Moving | Nhiều tin có cùng ngày quan sát và không có expiry. Áp ngay TTL ngắn có thể loại phần lớn nguồn. Phải đo trên bản sao, xem tác động trước và phân biệt lịch sử với khả dụng hiện tại |
| Gộp các tin nhà thành một property/unit | Housing selection, saved items, cost summary, upstream Moving | POI, property, unit, listing và offer là các danh tính khác nhau. Không đổi listing_id hiện hữu chỉ để nhóm hiển thị; chọn tin nào vẫn phải giữ giá/cọc/nguồn của tin đó |
| Đổi xếp hạng, số hàng và scope truy vấn | Cursor offset, cache/context và phân trang | Cursor hiện chỉ giữ offset, không có version dataset/query. Dùng cursor cũ sau đổi ordering hoặc gộp có thể bỏ sót/lặp. Truy vấn mới phải reset cursor, không viết lại snapshot chat cũ |
| Thêm group/alias/admin hierarchy lúc query | Query deadline và ngân sách tool của agent | Service có operation deadline mặc định 15 giây. Không chạy fuzzy/spatial self-join toàn catalog mỗi lần user tìm; chuẩn bị mapping/index, đo plan truy vấn và độ trễ trước bật |

Saved housing của frontend lưu theo listing_id. Vì vậy sửa trùng OSM thuần túy
không trực tiếp yêu cầu đổi ID saved housing. Tác động này chỉ phát sinh nếu mở
rộng sang gộp tin nhà hoặc thay các tham chiếu downstream.

### 8.2. Điều chỉnh thứ tự triển khai

Thứ tự P0–P4 vẫn là thứ tự mục tiêu. Bên trong P1/P2 phải chia nhỏ như sau:

1. **Đo và lập dry-run manifest trên bản sao.** Kiểm tra cùng khóa OSM có xung
   đột category/tên/nguồn không; giữ chức năng đa loại nếu một đối tượng có
   nhiều công dụng. Chưa đổi catalog live.
2. **Chốt cơ chế tương thích ID và xác nhận điểm.** Tất cả API/service đọc ID cũ
   phải hoạt động với mapping. Xác nhận mapping đến entity không thay thế kiểm
   tra sở hữu, trạng thái, provenance hoặc việc user xác nhận điểm xe đến.
3. **Cải thiện UI trước với ID hiện hành.** Loại đúng ID lặp và bổ sung nhãn
   loại/tỉnh/thành. Dữ liệu không đổi; việc này không xử lý trùng khác ID.
4. **Bật canonical search thử nghiệm sau các kiểm tra tương thích.** Có thể dùng
   projection/mapping riêng để so trước–sau, chưa cần xóa hoặc chuyển hàng cũ.
   Theo dõi cả số lần hỏi lại, lựa chọn sai và pin dùng cho Moving.
5. **Chuyển dữ liệu theo batch sau nghiệm thu.** Backup, alias, manifest và
   rollback phải đủ; tạm ngừng importer/publish trong lúc chuyển. Không chuyển
   toàn bộ 30.683 nhóm ngay trong một lượt chưa được đối chiếu.
6. **Quality/freshness theo hai bước.** Đầu tiên thêm nhãn và review, sau đó mới
   thay eligibility của các truy vấn mới. Lịch sử giữ nguyên snapshot; hành
   động mới vẫn kiểm tra khả dụng và báo giá mới khi cần.

Không nên triển khai đồng thời gộp OSM, gộp housing, hạ nhãn pin, thay ranking và
TTL trong một release đầu tiên: khi kết quả đổi sẽ khó xác định nguyên nhân.

### 8.3. Những giới hạn phải giữ

- Housing/Map/Moving chịu tác động trực tiếp. Flight/Payment không phụ thuộc
  trực tiếp vào ID OSM, nhưng tổng chi phí và phương án nhiều dịch vụ có thể
  thay đổi gián tiếp nếu chọn nhà/điểm chuyển hoặc báo giá khác.
- Search gộp không được sửa order/provider quote/approval cũ. Nếu user đổi điểm
  dừng sau báo giá, phải đi qua luồng thay đổi, báo giá lại và xác nhận lại của
  hệ thống; giữ nguyên kiểm tra payload_hash/plan_version.
- Dữ liệu còn nghi vấn vẫn có thể được khám phá với nhãn giới hạn. Không biến
  tất cả tìm nhà thành bắt user nhập tọa độ trước, cũng không khẳng định đạt
  điều kiện khoảng cách khi pin không đủ chính xác.
- Những trường hợp “ít kết quả hơn” cần phân biệt: loại biểu diễn trùng là kỳ
  vọng; loại cả cơ sở khác/cổng/trạm/phòng khác là lỗi; lọc tin không đủ điều
  kiện có thể đúng nhưng phải giải thích dữ kiện còn thiếu.
- Cùng danh tính OSM chỉ chứng minh cùng đối tượng trong nguồn, không chứng
  minh đối tượng đó có dữ liệu chính xác ngoài đời hoặc là điểm dừng thích hợp.

**Kết luận review:** kế hoạch có thể cải thiện chất lượng, nhưng có tác động
đến logic query và hành vi hỏi/xác nhận của agent. Lưu alias đơn thuần chưa đủ
để bảo toàn luồng hiện tại. Cần triển khai tương thích đọc ID, kiểm tra điểm
xác nhận và thử nghiệm từng lớp trước khi chuyển dữ liệu thật.

## 9. Kết quả đợt lọc alias ban đầu — đã được thay bằng mục 10

Mục này ghi lại đợt triển khai đầu tiên. Số lượng, cơ chế lọc alias và rollback
dưới đây **không còn là trạng thái hiện tại** sau khi chuyển sang xóa vật lý.
Xem mục 10 và runbook mới để vận hành.

### 9.1. Đã áp dụng trên database local

| Chỉ số | Kết quả |
|---|---:|
| Nhóm trùng danh tính OSM được xét | 30.683 |
| Alias an toàn đã tạo | **30.562** |
| Nhóm giữ nguyên để review | **121** |
| POI active hiển thị sau loại alias | **121.482**, từ 152.044 |
| Tổng hàng catalog gốc | **190.266**, không đổi |
| Hàng place_sources | **203.546**, không đổi |
| Housing anchors / properties / units / listings / offers | **38.222 mỗi loại**, không đổi |
| Housing media | **247.527**, không đổi |

121 nhóm review đều có ít nhất một place liên kết nhiều đối tượng OSM gốc.
Không tự gộp những nhóm này. Các trạm/cơ sở/cổng cùng tên nhưng khác đối tượng OSM
vẫn được giữ riêng, nên tìm “Đại học Bách Khoa” vẫn có nhiều lựa chọn hợp lệ;
nhãn mới phân biệt trường đại học, trạm xe buýt và thành phố.

Manifest SHA256:
`613b6442fd9d4c30247a8446c1fad5705f031aa2a34613296cf5a9199de342d2`.
Run local: `ff85f6fa-e231-4eaf-88a5-a5b78669ce9c`.
Chạy dry-run sau apply: **0 alias mới**, 30.562 đã mapped, 121 review.

Backup local trước thay đổi được kiểm tra bằng `pg_restore --list` và SHA256:
`data/poi-backup-20261004/lifeflow-before-poi-aliases.dump` (537.641.775 byte).
Đã restore vào database riêng, xác nhận manifest giống local, apply và kiểm thử
trên bản sao; lệnh rollback trên bản sao xóa đúng 30.562 alias.

Fingerprint toàn bộ `catalog.places` và `catalog.place_sources` sau apply khớp
chính xác với bản backup. Fingerprint/count của năm bảng housing và housing
anchors trước/sau cũng khớp. Không import lại toàn bộ nguồn hoặc thay `.env`.

### 9.2. Code và kiểm thử

- Migration 011 thêm mapping/index; resolve, search, map, nearby lọc alias.
- Get/route bằng ID cũ trả nguyên ID/tọa độ cũ; API `_verified_place` không gặp
  lỗi 422 do chuyển ID. Picker giữ pin đã chọn và ngày/giờ Moving.
- Importer chuẩn hóa danh tính OSM gốc và giữ provenance của alias cũ khi import lại.
- Agent không gộp các node khác nhau chỉ vì cùng tên/gần nhau. Moving vẫn yêu cầu
  user xác nhận pin POI ngay cả khi chỉ có một kết quả exact.
- **45/45** test Location/Housing/route đạt, gồm 7 test canonical/import mới.
- **25/25** test Platform API đạt trên bản sao dữ liệu thật; 9 test import toàn bộ
  PBF bỏ qua. Assertion map được đổi từ số hàng cứng sang đối chiếu tập ID visible.
- **10/10** test UI desktop/mobile đạt; có kiểm tra không còn React key trùng.
- **21** test Python liên quan đạt, Ruff đạt; **3 test cũ deselect sau khi xác minh
  cũng lỗi trên HEAD `b7cd0c7` chưa sửa**: Planner binding endpoint, partial ranking,
  housing amenity filter. Đây là lỗi nền ngoài phạm vi gộp POI, chưa được sửa.

Kiểm tra runtime sau restart: UI 8503, Agent API 8000, Platform 4100 và Location
4300 đều trả 200; Agent giữ `writes_enabled=false`. Resolve mẫu mất khoảng
**1,0–1,1 giây** trên máy này, không phải số đo tải lớn.

“Bể bơi Bách Khoa” và “Điểm trạm Y tế Bách Khoa” đều chỉ còn một kết quả exact.
Đã xác minh ID alias cũ qua Platform get, Location MCP, `_verified_place` và
OSRM route local, tọa độ cũ được giữ nguyên. Không chạy LLM/provider trả phí,
đặt xe hoặc thanh toán trong lần kiểm tra này.

Moving `/ready` vẫn có giới hạn đã tồn tại: database local thiếu các bảng `moving.*`.
Test UI/pin dùng fixture; chưa nghiệm thu báo giá AhaMove live. Không chạy migration
Moving trong thay đổi chỉ xử lý POI này.

### 9.3. Báo cáo và cách thử

Các artifact local nằm trong `data/` và không commit nguồn dữ liệu vào Git:

- `poi-dedup-dry-run-20261004.json`, `poi-dedup-applied-20261004.json`,
  `poi-dedup-post-apply-20261004.json`: manifest, review và fingerprint housing.
- `poi-source-preservation-20261004.json`: đối chiếu catalog/sources với backup.
- `poi-runtime-verification-20261004.json`: nhãn, độ trễ, health và kiểm tra ID cũ.
- `poi-canonical-tests.txt`, `poi-platform-snapshot-tests.txt`: log kiểm thử service.
- `startup-poi-20261004-153612/`: log các process vừa khởi động lại.

Mở **http://127.0.0.1:8503**, dùng **Ctrl + F5**. Thử tìm địa điểm Bách Khoa và
chọn điểm lấy/giao trên bản đồ; trạm xe buýt/cơ sở khác nhau vẫn có pin riêng.
Hướng dẫn migration, dry-run/apply và rollback nằm trong
[runbook POI](../location/POI-CANONICALIZATION.md).

## 10. Bộ dữ liệu sạch vật lý — 04/10/2026

Trạng thái bàn giao hiện hành: [file thay đổi, code và dữ liệu QuangDung](quangdung-changes-and-data-handoff-2026-10-04.md).
Lỗi thiếu bảng Moving đã được sửa bằng migration 008 ở lượt khởi động sau mục
này; [map Việt Nam và Moving A/B](vietnam-map-moving-update-2026-10-04.md) là UI hiện tại.

**Cập nhật tiếp theo cùng ngày:** dữ liệu housing được chuẩn hóa riêng theo yêu
cầu mới (room 0 → 1), ngoài scope gộp POI của mục này. Xem
[báo cáo Map/Housing/OSRM](map-housing-osrm-audit-2026-10-04.md).
Các fingerprint housing “giữ nguyên” bên dưới ghi nhận thời điểm làm sạch POI,
trước lượt chuẩn hóa phòng thuê này.

### 10.1. Yêu cầu được áp dụng

Chỉ xóa **POI có tên lặp** khi tên không rỗng giống nhau (trim/lower, giữ dấu),
chung danh tính OSM gốc và tương thích category/tầng/phòng/chi nhánh. Không
gộp chỉ vì cùng tên hay cùng tọa độ. Cùng tòa nhà nhưng khác tầng hoặc khác
loại tiện ích vẫn giữ riêng. Không gộp dữ liệu nhà.

Nhóm thiếu tên hoặc metadata không nhất quán được giữ, không tự đoán.
Nhóm liên thông nhiều nguồn chỉ nối qua danh tính OSM chung; không dựa vào
khoảng cách để xóa vật lý.

### 10.2. Kết quả hiện tại

| Chỉ số | Trước xóa | Sau xóa |
|---|---:|---:|
| POI active | 152.044 | **131.191** |
| Tổng catalog.places | 190.266 | **169.413** |
| Housing anchors | 38.222 | **38.222** |
| catalog.place_sources | 203.546 | **203.546** |
| Mapping ID đã xóa | — | **20.853** |

Đã xóa vật lý **20.853** hàng. Dry-run sau xóa: **0 hàng đủ điều kiện cần xóa**.
Còn **9.830 nhóm giữ nguyên**: **9.824 thiếu tên**, **6 có metadata tên/tầng/cơ sở
mâu thuẫn**. Các hàng này vẫn hiển thị; số nhóm không phải số POI.
Đây là làm sạch trùng theo phạm vi đã thống nhất, chưa xác minh mọi POI ngoài đời.

Fingerprint/count housing (properties, units, listings, offers, listing_media),
housing anchors và housing staging giữ nguyên. Source/media và payload
integration.source_records không mất dữ liệu; chỉ chuyển liên kết về đại diện.

### 10.3. Đồng nhất schema và dữ liệu tái sử dụng

- catalog.places là bộ dữ liệu chính, không thêm bảng POI sạch song song.
- Migration **012** chuyển log cũ về **geo.import_runs** có sẵn và bỏ
  **catalog.poi_dedup_runs**; 011 vẫn giữ trong lịch sử migration.
- catalog.poi_aliases chỉ giữ ID đã xóa → đại diện, tên/tọa độ cũ. Không còn
  alias vật lý trong catalog.places. Get/route bằng ID cũ vẫn giữ pin cũ.
- Bỏ lọc alias khi truy vấn; map/search/nearby đọc dữ liệu vật lý.
- Importer xét floor/unit/branch khi ghép điểm gần; fixture hai POI cùng tên,
  cùng tọa độ nhưng khác tầng vẫn tạo hai bản ghi.
- Không sửa .env, dữ liệu nhà, Planner/Flight/Payment hay basemap ở bước này.

**Bộ dữ liệu:** data/poi-clean/2026-10-04/ từ gốc DEMO_1.

| File | Nội dung |
|---|---|
| pois.geojson | **131.191** POI active với canonical UUID |
| poi-sources.ndjson | **165.324** nguồn của POI, giữ payload gốc |
| legacy-ids.ndjson | **20.853** mapping ID/tọa độ cũ |
| categories.json | Danh mục tiện ích |
| manifest.json | Số lượng, quy tắc, thời điểm, SHA256 |

Chuyển cả thư mục và dùng --import-clean trên DB đích đã cài schema để giữ UUID
đồng nhất. Không chỉ chuyển GeoJSON nếu cần giữ nguồn gốc/lịch sử ID.
Bộ này không chứa nhà, ranh giới hành chính hoặc graph OSRM; chưa commit vào Git.

### 10.4. Kiểm chứng và phục hồi

- Backup **539.190.599 byte**, đã kiểm tra archive và restore đầy đủ vào DB riêng:
  data/poi-physical-cleanup-20261004/before-physical-cleanup.dump.
- SHA256: e15d333b082d0e7897dec55dfafb94dbd42732cadb7032bea5e92db64f066b7b.
- Manifest apply: 42d09ba55f71a2a0145b488d08d915bf1def61d1e5d940ea3893f92bb5c51b5a.
- Run: 101940fb-c481-456e-a148-0a6922d59bf3.
- **47 test Housing Query + 25 Platform API + 2 portable dataset đạt** trên
  database riêng; toàn bộ LifeFlow build đạt. Test giữ khác tầng/tiện ích,
  bảo vệ nhà, tương thích ID/tọa độ cũ, re-import và checksum sai.
- Đợt này không gọi LLM/provider trả phí, đặt xe hay thanh toán.
- Giới hạn nền Python/Moving ghi ở mục 9.2 vẫn chưa được sửa trong scope POI.

Reports, fingerprint và log: data/poi-physical-cleanup-20261004/.
Runtime sau restart: UI 8503, Agent API 8000, Platform 4100 và Location 4300
đều trả **200**; writes_enabled=false. Get ID đã xóa qua Location MCP và
Agent _verified_place thành công; route OSRM giữ đúng ID/tọa độ cũ. Không có
alias còn hàng vật lý hay tham chiếu đại diện bị mất. Checksum toàn bộ bộ export
khớp manifest. Log startup: data/startup-poi-clean-20261004-163535/.

**Xóa vật lý không hoàn tác bằng --rollback hoặc xóa alias**; phải restore backup
đã kiểm chứng vào DB phục hồi. Hướng dẫn mới ở
[runbook POI](../location/POI-CANONICALIZATION.md).

## 11. Kiểm tra tọa độ housing và điểm B Moving — 05/10/2026

Kiểm toán chỉ đọc sau phản ánh nhiều tin nhà chung pin. Đối chiếu theo
`source_type:source_listing_id`, không ghép theo tên/địa chỉ hoặc khoảng cách.
Mỗi housing listing nối property → housing anchor để đọc tọa độ hiện dùng;
so sánh với JSONL nguồn và payload `location` staging gốc. Không tạo bảng,
restore/reimport, sửa hoặc xóa bản ghi trong lượt này.

| Chỉ số | Kết quả |
|---|---:|
| Tin active | 38.222 |
| Record JSONL nguồn | 38.930 |
| Tọa độ khớp JSONL nguồn | **38.222/38.222** |
| Tọa độ khớp staging gốc | **38.222/38.222** |
| Khác hoặc thiếu tọa độ nguồn trong tin active | **0** |
| Tin dùng chung tọa độ chính xác với tin khác | **33.761 (88,3%)** |
| Nhóm dùng chung tọa độ | **3.818** |
| Nhóm lớn nhất | **195 tin** |
| `location_accuracy=approximate` | **15.595** |
| `location_accuracy=rooftop` | **22.627** |

Số tọa độ chia sẻ khớp audit trước lượt làm sạch POI. Kết quả xác nhận việc
làm sạch không làm đổi tọa độ housing; **không chứng minh các pin nguồn
đã đúng ngoài đời**. Nhãn rooftop cũng là metadata nguồn, không phải xác
minh độc lập. Các tin khác ID cùng tọa độ không tự xem là tin trùng.

Căn được chọn trong ảnh (`75d4463b-fc37-5c2d-9f58-d694bf538d4c`, phòng full
nội thất gần Hàng Xanh/UTH/HUTECH): nguồn ghi `approximate`, `source_map`,
tọa độ **10.800452, 106.70504**, có **10 tin active** tại chính tọa độ đó.
UI có thể hiển thị nhóm nhỏ hơn do bộ lọc/viewport; nhóm marker được làm
tròn 5 chữ số thập phân, khoảng 1 mét, và không làm đổi data.

### Điểm B bị thiếu căn đã chọn

Hội thoại có ID đã chọn trong `selected:property`, nhưng căn không nằm
trong candidates chat và không còn `state.selections.property`. Frontend
trước đây chỉ đọc các nguồn này nên B trống, map mặc định về Hà Nội.

Đã sửa ở frontend: đọc chi tiết theo ID qua endpoint hiện có, khôi phục
sau reload; ô tên/địa chỉ căn đã chọn nằm ngay dưới B và cho phép bấm dùng
lại; không ghi đè B đang nhập khi fetch trả chậm. Tọa độ gần đúng chỉ gợi ý,
vẫn cần người dùng kiểm tra pin. Nhãn nhóm map đổi thành “tin chung điểm
bản đồ”, kèm giải thích về vị trí gần đúng.

**10/10 browser có mục tiêu qua** trên desktop/mobile; TypeScript/Vite
build qua. GET chi tiết căn thật qua Agent/Location local trả 200, đúng
ID/địa chỉ/tọa độ trong khoảng **0,62 giây** tại lượt kiểm tra. Chưa gọi
LLM, báo giá hoặc đặt đơn thật. Backend, dữ liệu và quy trình xác nhận giữ
nguyên trong lượt này.

Visual smoke bản build thật 8503 dùng chi tiết căn thật, session/hội thoại
fixture và basemap công khai: desktop/mobile hiện đúng ô căn dưới B và pin
gợi ý trong Bình Thạnh; mỗi viewport tải 10 tile PBF HTTP 200, không lỗi
JavaScript/tràn ngang. Mọi chat/action/quote đều bị chặn trong smoke này.

Chứng cứ cục bộ (ignored, không thêm vào data bàn giao):
`logs/local/housing-pin-audit-20261005.json`, ảnh/trace trong
`Frontend/test-results/`. Nếu muốn cải thiện độ chính xác housing, cần
đối chiếu địa chỉ/cổng thật từ nguồn trước khi cập nhật tọa độ; không rải
pin giả hoặc xóa các tin khác nhau chỉ để map bớt chồng.

## 12. Đề xuất sửa địa chỉ và geocode housing — 05/10/2026

**Trạng thái: kế hoạch, chưa áp dụng.** Lượt này đọc file nguồn và tài liệu
provider; không gọi API geocoding, dùng key trả phí, sửa data hay backend.

### 12.1. Địa chỉ có, nhưng chưa đủ để coi là địa chỉ thật đã xác minh

Đánh giá offline **toàn bộ 38.930 record JSONL nguồn**. Số bên dưới khác
scope 38.222 tin active của mục 11; không lấy số nguồn làm số tin đang hiển thị.

| Nội dung trong nguồn | Số record |
|---|---:|
| Có `address_raw` | 38.930 |
| Có số nhà trong `address_normalized.housenumber` | 10.209 |
| Có số nhà + đường + thành phố | 10.197 |
| Có đường nhưng chưa có số nhà | 28.340 |
| Không có số nhà lẫn đường | 381 |
| Số nhà có dấu `/` (cần giữ ngõ/hẻm) | 2.899 |
| Gợi ý số nhà trong description nhưng trường số nhà còn trống | 777 |
| Nghi số nhà nằm ở đầu trường `street` | 159 |

Hai nhóm 777 và 159 là **ứng viên kiểm tra theo biểu thức**, có thể giao
nhau, chưa được xác nhận hoặc cộng vào số địa chỉ đủ. Ví dụ `street` đang
chứa `432 Đội Cấn`, `325 Kim Ngưu`, `123 Thụy Khuê`; cần tách số nhà khi
có chứng cứ, đồng thời tránh nhầm tên đường dạng số như “Đường 3 Tháng 2”.

Nguồn hiện có 17.392 khóa địa chỉ cấu trúc khác nhau; 8.272 khóa thuộc
nhóm có số nhà + đường + thành phố. Đây là đếm trước chuẩn hóa, chưa phải
số nhà thực tế hoặc số API request cần mua; tên viết tắt và tên hành chính
khác thời điểm có thể tạo nhiều khóa cho cùng địa chỉ.

Trong nguồn, 3.880 nhóm có tọa độ trùng gồm 34.439 tin. **2.609 nhóm có
nhiều địa chỉ cấu trúc**, **783 nhóm có nhiều tên đường**, **1.225 nhóm có
nhiều địa chỉ đã ghi số nhà**. Còn 20.728 tin gắn nhãn rooftop nằm trong
nhóm chung tọa độ: nhãn này cần rà lại, không được mặc nhiên xem là đã đúng.

Nhóm tại `(10.800452, 106.70504)` có 10 tin và 9 địa chỉ cấu trúc khác
nhau. Có `325/29A Bạch Đằng`, `275/1/3 Bạch Đằng`, tên đường Nguyễn Cửu Vân,
Phạm Văn Đồng, hẻm Xô Viết Nghệ Tĩnh. Đây là dấu hiệu một pin đại diện bị
dùng cho nhiều địa chỉ, không đơn thuần nhiều phòng trong cùng tòa nhà.
Tuy nhiên, vẫn phải xác minh từng địa chỉ trước khi quyết định pin mới.

### 12.2. Lựa chọn nguồn geocoding

| Hướng | Khả năng và quyết định đề xuất |
|---|---|
| Google Geocoding API | Có thể đổi địa chỉ thành tọa độ và trả cấp độ khớp. Chưa chọn để làm dataset dùng chung trên map OSM hiện tại, do giới hạn kết hợp dữ liệu Google với map khác và lưu trữ. Nếu chọn hướng này cần thiết kế Google Maps và cách lưu phù hợp trước. |
| Nominatim tự vận hành / dữ liệu OSM local | Phù hợp thử offline, có truy vấn địa chỉ cấu trúc; phải kiểm tra thực tế mức phủ số nhà/ngõ/hẻm trong PBF. Thiếu địa chỉ OSM thì không thể suy ra cổng thật. Chỉ dựng dịch vụ geocoder khi pilot chứng minh cần, không mặc định thêm Docker. |
| Provider địa chỉ Việt Nam có giấy phép phù hợp | Đưa vào pilot nếu OSM thiếu; chọn sau khi xác nhận độ phủ, quyền lưu tọa độ lâu dài, hiển thị trên map hiện tại và bàn giao dataset cho teammate. Không mặc định một API thương mại nào đáp ứng các điều kiện này. |
| Nguồn tin + người đăng / người dùng xác nhận | Dùng bổ sung địa chỉ và cổng thực tế cho trường hợp mơ hồ, không biến “gần trường/đường” thành địa chỉ chính xác. |

Google phân biệt rooftop, nội suy trên đường, tâm hình học và gần đúng;
`partial_match` là tín hiệu phải xem lại. Geocode trả thành công không
đồng nghĩa đã tìm đúng phòng hoặc cổng vận chuyển. Xem
[request/response Geocoding](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding).

Điều khoản Google Geocoding hiện hành, mục 6.2, không cho dùng content
Geocoding với map không phải Google. Mục 6.3.1 cho cache lat/lng 30 ngày;
6.3.2 có ngoại lệ lâu dài cho chức năng trực tiếp của người dùng, dữ liệu
phải tách theo người dùng và không dùng giữa nhiều người dùng. Vì vậy,
không mặc định coi ngoại lệ này là quyền xây dataset housing chia sẻ/cloud.
Xem [Service Specific Terms, mục 6](https://cloud.google.com/maps-platform/terms/maps-service-terms)
và [Geocoding policies](https://developers.google.com/maps/documentation/geocoding/policies).

Google **Address Validation API** là sản phẩm khác; danh sách phủ hiện
tại chưa có Việt Nam. Không chọn API đó làm bước bắt buộc cho housing VN.
Xem [coverage](https://developers.google.com/maps/documentation/address-validation/coverage).

Không chạy batch hàng chục nghìn địa chỉ qua Nominatim công cộng. Chính
sách giới hạn tối đa 1 request/giây, không khuyến khích batch lớn; các job
dài hơn một ngày hoặc chạy định kỳ bị giới hạn 4 request/phút. Hướng phù
hợp là instance riêng hoặc nhà cung cấp cho phép batch. Xem
[Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/),
[structured search](https://nominatim.org/release-docs/latest/api/Search/).

### 12.3. Trình tự triển khai đề xuất

1. **Chốt baseline và phạm vi.** Lấy snapshot có checksum; chọn tin active
   thuộc TP.HCM/Hà Nội/Đà Nẵng cho đợt đầu. Tin khác vùng đưa vào báo cáo,
   không xóa. Lưu manifest ID để nhận biết chính xác record thay đổi.
2. **Chuẩn hóa địa chỉ offline.** Giữ nguyên `address_raw`, description và
   source payload; tách số nhà, ngõ/hẻm, đường, phường/quận/thành phố, tòa,
   tầng/phòng. Chuẩn hóa viết tắt với bảng alias kiểm chứng. Giữ cả tên
   hành chính nguồn và alias hiện hành khi có mapping đã xác minh; không
   tự đổi phường/quận theo suy đoán. Mỗi trường trích xuất có đường dẫn
   chứng cứ; mâu thuẫn giữa description và address đưa vào review.
3. **Phân loại khả năng sửa.** Đủ số nhà/đường hoặc tòa nhà xác định → thử
   geocode; chỉ có đường/phường → giữ vị trí mức đường/khu vực; chỉ có
   “gần …” hoặc nhiều địa chỉ mâu thuẫn → cần bổ sung. Cùng tọa độ nhưng
   khác địa chỉ là ưu tiên rà; cùng địa chỉ/tòa và khác tầng/phòng vẫn giữ.
4. **Pilot trước batch.** Lấy khoảng 300 tin, 100 mỗi thành phố, có địa chỉ
   đủ, hẻm/ngõ, tòa nhiều phòng và địa chỉ mơ hồ. Dựng tập tham chiếu bằng
   chứng cứ độc lập (nguồn/cổng/GPS/đối soát thủ công). Thử geocoder trên
   khóa địa chỉ đã chuẩn hóa, không gọi lại cho từng tin cùng địa chỉ.
   Đo độ chính xác theo loại địa chỉ, tỷ lệ không tìm được, chi phí/lần,
   độ trễ và quyền lưu/export; chọn provider sau kết quả pilot.
5. **Tạo patch geocode có mức tin cậy.** Giữ tối đa một tập candidate hợp
   lệ cho từng khóa địa chỉ, không nhận kết quả đầu tiên một cách mặc
   định. Kiểm số nhà/đường, thành phố, alias hành chính, mức định vị và
   khoảng cách dịch chuyển. Kết quả trả cả đường/phường không được nâng
   thành rooftop; trường hợp từ địa chỉ đủ bị trả về mức đường phải review.
   Pin mới lệch xa hoặc khác thành phố là cờ kiểm tra, không tự ép về pin cũ.
6. **Dry-run và kiểm chứng bản đồ/routing.** Báo cáo ID, địa chỉ và tọa độ
   trước/sau, chứng cứ, mức tin cậy, lý do. Kiểm nhóm shared pin trước/sau
   và các địa chỉ khác đường/khác số còn bị dồn. Dùng OSRM kiểm graph và
   snap distance cho mẫu cổng; OSRM không chứng minh địa chỉ đúng và không
   được dùng để chuyển tọa độ nhà sang đường gần nhất. Xem cả nhóm nhiều
   phòng cùng tòa và các địa chỉ unresolved, không chỉ xem map bớt chồng.
7. **Apply theo lô và xuất dữ liệu đồng nhất.** Chỉ sau khi duyệt pilot và
   dry-run. Lưu source gốc bất biến; xuất JSONL phiên bản mới và cập nhật
   housing anchors đúng listing/property ID. Dùng metadata trong
   `attributes` và bảng hiện có để ghi địa chỉ/tọa độ gốc, phương pháp,
   chứng cứ, phiên bản, ngày rà và kết quả review; không tạo nhiều bảng
   housing sạch song song. File và DB phải cùng phiên bản, importer chạy
   lại không khôi phục nhầm pin cũ. Đóng gói snapshot/manifest/checksum và
   rollback theo lô cho teammate.

### 12.4. Tiêu chí quyết định cập nhật

- Bảo toàn số tin trong manifest, IDs, giá, diện tích, phòng ngủ và media.
  Không gộp/xóa tin chỉ vì chung địa chỉ hay tọa độ.
- Chỉ tự động chấp nhận khi địa chỉ đủ, candidate duy nhất hợp lệ, khớp
  các thành phần quan trọng và đạt cấp độ định vị đã thống nhất. Trường
  hợp verified/user-confirmed được bảo vệ; provider mới không ghi đè tự động.
- Mục tiêu pilot đề xuất: ít nhất 95% địa chỉ ở nhóm định vị chính xác
  được chấp nhận khớp tập tham chiếu, không có ca sai thành phố. Đây là
  gate cần đo, không phải cam kết provider đạt 95% hoặc sửa được 95% dataset.
- Báo cáo sai số vị trí của tập tham chiếu theo nhà/hẻm/tòa; chưa đặt một
  ngưỡng mét chung cho mọi địa chỉ. Tâm tòa nhà không coi là cổng xe đến.
- Địa chỉ chỉ đủ tới đường/phường giữ nhãn gần đúng và trạng thái cần bổ
  sung; không rải pin ngẫu nhiên, nội suy số nhà thiếu bằng LLM hoặc dùng
  reverse-geocode pin cũ để “chứng minh” địa chỉ đó đúng.
- Review toàn bộ ca sai thành phố, địa chỉ mâu thuẫn, nhiều candidate và
  các pin dịch chuyển bất thường; rerun patch không đổi thêm ngoài dự kiến.
- Moving vẫn dùng cổng lấy/giao do người dùng xác nhận. Không viết pin
  chọn cho một chuyến vào dataset housing chung. Gợi ý người dùng có thể
  là chứng cứ review sau này, không tự áp dụng toàn hệ thống.

### 12.5. Thứ tự ưu tiên và đầu ra

**Ưu tiên thực hiện:** chuẩn hóa/trích xuất địa chỉ có chứng cứ và báo cáo
khả năng geocode → pilot chọn nguồn được phép dùng với map hiện tại →
patch có review → apply/export. Không mua hàng chục nghìn lượt Google
trước khi biết địa chỉ có đủ thông tin và kết quả có quyền lưu/chia sẻ.

Đầu ra khi triển khai sẽ gồm một JSONL housing phiên bản sạch, DB dùng
cùng dữ liệu, manifest trước/sau, danh sách unresolved và runbook khôi
phục. Chưa thể hứa còn bao nhiêu shared pin sau sửa; các phòng cùng tòa
vẫn được phép chung pin. Chất lượng đo bằng đúng địa chỉ/vị trí và mức
tin cậy, không bằng số marker tách ra.

Chứng cứ phân tích offline của lượt lập kế hoạch:
`logs/local/housing-address-profile-20261005.json` (ignored). Chưa phát
sinh phí API hoặc tạo container geocoder. Docker đang chạy có 1 PostGIS
và 9 OSRM trong cấu hình app; chưa có container kiểm thử dư để dừng.

### 12.6. Làm rõ mục tiêu tọa độ chính xác và công cụ có thể thử

Theo yêu cầu tiếp theo, ưu tiên thay pin đại diện đang dùng cho **các địa
chỉ khác nhau** bằng vị trí khớp địa chỉ cụ thể. Không áp ràng buộc mỗi
listing phải có lat/lng duy nhất: phòng/tầng trong cùng tòa, chung cổng hoặc
hai tin rao cùng bất động sản có thể đúng cùng tọa độ 2D dù địa chỉ đầy đủ.
Tin chỉ có tên đường giữ mức đường; địa chỉ đủ nhưng không tìm được điểm
chính xác cũng phải giữ trạng thái cần xác minh, không tự đánh dấu đã sửa.

Các công cụ có tài liệu API phù hợp để thử:

- [VIETMAP Geocode v4](https://maps.vietmap.vn/docs/map-api/geocode-version/geocode-v4/)
  và [Place v4](https://maps.vietmap.vn/docs/map-api/place-v4/):
  search hỗ trợ lọc lớp ADDRESS/STREET/POI; lấy ref_id rồi gọi Place để đọc
  tọa độ và các thành phần số nhà/đường/phường/quận/thành phố. Một lần xử
  lý địa chỉ có thể cần nhiều request, phải tính cả bước lấy chi tiết khi
  dự toán. Chưa chứng minh API tìm đúng các hẻm cụ thể trong dataset này.
- [Goong Geocode v2](https://help.goong.io/kb/rest-api-v2/geocode-rest-api-v2/):
  có API chuyển địa chỉ thành tọa độ; cần pilot và kiểm quyền batch/lưu
  lâu dài/map khác/bàn giao trước khi chọn làm nguồn dataset chính.

Đây là các ứng viên geocoder, chưa phải lựa chọn đã nghiệm thu. Các công
cụ xuất GeoJSON hoặc chuyển hệ tọa độ chỉ xử lý hình thức dữ liệu đã có
vị trí; chúng không tìm được địa chỉ nhà bị thiếu. OSRM của dự án tìm
đường trên graph. `LocationService.resolve` hiện tìm POI/đơn vị hành
chính trong catalog, không có bộ đối soát toàn bộ số nhà Việt Nam.

Kiểm cấu hình tại thời điểm lập kế hoạch ban đầu: chưa có key VIETMAP, Goong hoặc Google Maps theo
các tên biến liên quan trong `.env`; không đọc/in giá trị key. Chưa có
request geocoding thực để so sánh chất lượng. Hướng tiếp theo là thử trên
tập địa chỉ đủ, có chứng cứ tham chiếu và giới hạn request/chi phí, sau
đó mới quyết định nguồn và tỷ lệ có thể sửa. Không hứa tất cả địa chỉ
đầy đủ sẽ trở thành tọa độ chính xác ngay khi gọi API.

### 12.7. Đã thử VIETMAP trên 10 địa chỉ

Người dùng đã bổ sung `VIETMAP_API_KEY` và yêu cầu thử vài địa chỉ. Kết quả
ngày 2026-10-05: 40 request, 40 HTTP 200, 4 ca khớp đủ thành phần địa chỉ
trong 3 candidate được lấy chi tiết/ca; chưa có xác minh vị trí độc lập.
Nhóm chung pin Bình Thạnh có candidate số nhà riêng nhưng khác phường
so với source, giữ ở review. Không cập nhật JSONL/DB hay logic ứng dụng.

Xem [báo cáo thử housing VIETMAP](housing-vietmap-pilot-2026-10-05.md)
để biết từng địa chỉ, khoảng cách trước/sau, giới hạn và chứng cứ local.

### 12.8. Công cụ chuẩn hóa và mẫu đánh giá lớn hơn

Đã thêm `scripts/housing-geocode.py` để chuẩn hóa cấu trúc có bằng chứng,
xuất bản riêng, tra cứu có cache/ngân sách/tốc độ và tạo candidate để review.
Không ghi vào DB, source live, logic Agent hoặc giao diện. Không thêm bảng.

Lần chuẩn hóa 2026-10-05 giữ đủ 38.930 tin và sửa cấu trúc địa chỉ của 432
tin. Nhóm có số nhà/đường thuộc ba thành phố là 10.301 tin (26,46%), tương
ứng 8.287 khóa địa chỉ sau chuẩn hóa; nhiều tin cùng địa chỉ vẫn được giữ.
Địa chỉ gốc được lưu trong metadata; verify đối chiếu từng record ngoài các
fields địa chỉ/metadata và checksum, bảo toàn tọa độ/giá/phòng ngủ/ID/media.

Mẫu lớn: 300 khóa địa chỉ, 100/thành phố, gồm 90 có số nhà + 10 chỉ có đường.
Không dùng focus pin cũ. Dự báo khớp có trọng số quy mô thành phố và số tin
mỗi địa chỉ; không dùng 4/10 ca của mẫu khó đầu tiên để dự báo cả dataset.
Chưa coi candidate khớp thành phần là vị trí đã verified hay đã cải thiện.

Xem [runbook geocode housing](housing-geocode-runbook.md), kết quả local
ở `data/housing-geocode/README.md` và `summary.json`. Hạn mức trial công bố
60.000 transaction có thể đủ nhóm có số nhà (tối đa khoảng 33.148 request
nếu lấy 3 candidate/khóa), nhưng số dư tài khoản chưa được đọc từ Console.
Không tự mua lượt hoặc chạy batch toàn bộ trước khi đánh giá chất lượng.

Mẫu đã hoàn tất: 1.095 request đều HTTP 200, 69/270 địa chỉ có số nhà khớp
đủ thành phần. Dự báo có trọng số khoảng 3.055 tin (7,85% toàn source),
khoảng bootstrap 95% 6,17–9,59%; đây là candidate khớp địa chỉ, chưa phải
tỷ lệ vị trí verified hay đã cải thiện. 44 ca khác phường và 6 ca nhiều vị
trí cần review. Resume không phát sinh request mới; 11 tests qua, verify
bảo toàn đủ 38.930 tin. Xem phần mở rộng trong
[báo cáo VIETMAP](housing-vietmap-pilot-2026-10-05.md).
