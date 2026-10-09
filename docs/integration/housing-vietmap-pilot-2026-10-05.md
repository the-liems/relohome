# Thử geocoding housing bằng VIETMAP — 2026-10-05

## Phạm vi và kết quả

Theo yêu cầu thử vài căn của người dùng, đã gọi API thật cho **10 địa chỉ**:
4 tại TP.HCM (3 địa chỉ có số nhà và 1 ca chỉ có tên đường), 3 tại Hà Nội,
3 tại Đà Nẵng. Đây là mẫu có chủ đích để tìm lỗi, không phải mẫu ngẫu nhiên
để ước lượng tỷ lệ sửa được của toàn bộ dataset.

- Nguồn: `Maps VN/Data/housing_clean_2026-09-26.jsonl`.
- API: Search/Geocode v4, `display_type=6`, `layers=ADDRESS,STREET`,
  dùng tọa độ cũ làm `focus` xếp hạng. Focus không xác minh vị trí thật;
  lần thử rộng hơn cần so sánh cả truy vấn không focus/lọc theo thành phố.
- **40 request**: 10 Search + 30 Place; kiểm tra chi tiết 3 candidate đầu
  mỗi địa chỉ. Search thường trả thêm candidate chưa lấy Place.
- 40/40 HTTP 200; không gặp giới hạn tốc độ. Gọi tuần tự, cách nhau ít
  nhất 0,5 giây giữa thời điểm bắt đầu request, tối đa khoảng 120 request/phút.
- Độ trễ từng request đo được: 0,047–0,610 giây; tổng thời gian HTTP khoảng
  7,065 giây, chưa tính chờ giới hạn tốc độ/đọc và lưu file.
- Chỉ gửi địa chỉ và tọa độ tin nhà; không gửi tên/SĐT liên hệ, description,
  tài khoản người dùng hoặc lịch sử chat. Key lấy từ `.env`, không in ra báo cáo.
- **Không sửa JSONL, không cập nhật DB, không sửa logic frontend/backend.**
  Checksum SHA-256 source trước/sau bằng nhau; không có thao tác ghi DB.

## Đối chiếu các địa chỉ

Khoảng cách là **độ dịch chuyển so với pin cũ**, không phải sai số so với
vị trí thật. Bảng ghi candidate đầu tiên được API trả về, không tự động
coi candidate đó là kết quả cuối cùng để áp dụng.

| Ca | Địa chỉ nguồn rút gọn | Candidate đầu tiên | Dịch chuyển | Đánh giá |
|---|---|---|---:|---|
| 1 | 325/29A Bạch Đằng, P.15, Bình Thạnh | 325/29A Bạch Đằng, **P.2**, Bình Thạnh | 178,6 m | Khớp số nhà/đường/quận/thành phố; khác phường, cần review |
| 2 | 275/1/3 Bạch Đằng, P.15, Bình Thạnh | 275/1/3 Bạch Đằng, **P.2**, Bình Thạnh | 289,5 m | Khớp số nhà/đường/quận/thành phố; khác phường, cần review |
| 3 | Số 50, hẻm 277 Xô Viết Nghệ Tĩnh, P.15 | 277/50 Xô Viết Nghệ Tĩnh, **P.2** | 561,9 m | Có vẻ tương ứng cách viết hẻm; chưa xác minh tương đương, khác phường |
| 4 | Đường Bạch Đằng, P.15, không số nhà | Đường Bạch Đằng Khu Phố 41, **P.2** | 314,8 m | Chỉ biết đường/khu vực; không chọn một số nhà API gợi ý để thay pin |
| 5 | 43/86 Trung Kính, Trung Hòa, Cầu Giấy | 86 Ngõ 43 Trung Kính; `hs_num=43/86` | 441,9 m | Khớp đủ 5 thành phần; cần xác minh vị trí nhà/cổng |
| 6 | Housenumber: `29 Ngõ Hàng Cháo`; street: `Hàng Cháo` | 41 Hàng Cháo, Cát Linh, Đống Đa | 106,6 m | Không khớp số nhà; dữ liệu cấu trúc làm câu tìm kiếm lặp “Hàng Cháo” |
| 7 | 350 Bưởi, Vĩnh Phúc, Ba Đình | 350 Đường Bưởi, Vĩnh Phúc, Ba Đình | 6,1 m | Khớp đủ 5 thành phần; pin nguồn gần candidate |
| 8 | K39 H53/7 Võ Văn Kiệt, Phước Mỹ, Sơn Trà | 109 Võ Văn Kiệt, Phước Mỹ, Sơn Trà | 16,5 m | Không khớp số nhà/hẻm; gần pin cũ không có nghĩa là đúng căn |
| 9 | 105 Võ Nguyên Giáp, Khuê Mỹ, Ngũ Hành Sơn | 105 Võ Nguyên Giáp, Khuê Mỹ, Ngũ Hành Sơn | 1.173,0 m | Khớp đủ thành phần nhưng dịch chuyển lớn; ưu tiên kiểm chứng độc lập |
| 10 | 67 Hà Bổng, Phước Mỹ, Sơn Trà | 67 Hà Bổng, Phước Mỹ, Sơn Trà | 13,8 m | Khớp đủ 5 thành phần; pin nguồn gần candidate |

“Khớp đủ” trong thử nghiệm là so sánh `hs_num`, `street`, `ward`,
`district`, `city`, sau khi bỏ dấu và tiền tố hành chính/đường; không phải
chứng nhận độ chính xác rooftop. Mỗi ca 5/7/9/10 có một candidate khớp đủ
trong **3 candidate đã đọc chi tiết**, không khẳng định duy nhất trong toàn
bộ kết quả API hay ngoài thực tế.

### Nhóm Bình Thạnh đang chung pin

Ba ca có số nhà 1/2/3 cùng tọa độ nguồn `(10.800452, 106.705040)` nhưng
VIETMAP trả các candidate khác nhau:

| Địa chỉ candidate | Latitude | Longitude |
|---|---:|---:|
| 325/29A Bạch Đằng | 10.802045817 | 106.704833945 |
| 275/1/3 Bạch Đằng | 10.802862036 | 106.706042694 |
| 277/50 Xô Viết Nghệ Tĩnh | 10.802407934 | 106.709783268 |

Đây là tín hiệu tích cực: provider có thông tin số nhà/hẻm cụ thể, giúp
tìm candidate để thay pin đại diện. **Chưa chứng minh cả ba candidate là
tọa độ thật của các tin rao.** Source ghi P.15; phản hồi legacy của API ghi
P.2 và `data_new` ghi phường Gia Định. Chưa có bằng chứng độc lập để kết
luận source sai, provider sai hay có khác biệt phiên bản địa giới; không
tự động ánh xạ P.15 thành P.2/Gia Định.

## Kết luận cho bước tiếp theo

1. **4/10 ca khớp đủ thành phần**, nhưng chưa ca nào được xác minh bằng
   GPS/cổng nhà hoặc bằng chứng độc lập. Không diễn giải 40% là tỷ lệ sửa
   được của cả bộ housing.
2. **3 ca HCM có candidate đáng kiểm tra**: 2 khớp số nhà/đường nhưng khác
   phường, 1 cần chuẩn hóa cách viết hẻm và rà phường. Giữ ở hàng đợi review.
3. **2 ca ngõ/hẻm chưa khớp**: làm sạch cấu trúc đầu vào, thử cách viết có
   bằng chứng từ địa chỉ gốc, không lấy số nhà gần nhất do API tự gợi ý.
4. **1 ca chỉ có đường**: giữ mức vị trí gần đúng; không tạo số nhà hoặc
   nâng lên rooftop.
5. Với kết quả khớp đủ nhưng lệch xa (ca 9), cần review vị trí thật trước
   khi tạo patch. Với pin cũ gần candidate (ca 7/10), không cần dịch chuyển
   chỉ để tạo cảm giác đã làm sạch.
6. Có thể tiếp tục pilot lớn hơn sau bước kiểm chứng. Trước khi xây dataset
   lâu dài/chia sẻ trên cloud, xác nhận điều kiện batch, lưu/export tọa độ và
   dùng với bản đồ hiện tại của nhà cung cấp.

**Data đang chạy của ứng dụng vẫn nguyên trạng.** Kết quả chỉ là candidate
thử nghiệm, chưa phải housing sạch đã nghiệm thu.

## Chứng cứ và cách xem lại

Thư mục local (ignored, không đưa lên Git):

`logs/local/vietmap-housing-pilot-20261005/`

- `manifest.json`: 10 địa chỉ, source listing IDs/URLs, tọa độ cũ,
  số tin dùng pin/địa chỉ, checksum source và ngân sách request.
- `results.json`: phản hồi Search/Place đã loại key, phép so sánh thành
  phần, tọa độ candidate, khoảng cách dịch chuyển, log HTTP và checksum.
- Script: `logs/local/vietmap-housing-pilot.py`; không gọi lại khi có
  `results.json`, tránh dùng thêm quota ngoài dự kiến.

Tài liệu API đã đối chiếu:
[Geocode v4](https://maps.vietmap.vn/docs/map-api/geocode-version/geocode-v4/),
[Place v4](https://maps.vietmap.vn/docs/map-api/place-v4/).

## Mở rộng: 300 địa chỉ và dự báo tỷ lệ

Theo yêu cầu tiếp tục xử lý và dự báo, đã chuẩn hóa toàn source offline rồi
thử mẫu 300 địa chỉ duy nhất. Mỗi thành phố chọn 90 địa chỉ có số nhà và 10
chỉ có đường, chọn bằng hash có thể tái lập. Đợt này **không truyền focus
tọa độ cũ**; đọc chi tiết tối đa 3 candidate đầu cho địa chỉ có số nhà.
Không coi 10 ca có chủ đích ở phần trên là mẫu đại diện.

### Chuẩn hóa data

- Giữ đủ 38.930 tin; sửa cấu trúc địa chỉ của **432 tin**.
- 304 lượt quy tắc chuyển số nhà/hẻm rõ ràng sang dạng slash; 127 lượt tách
  số nhà trong street có `address_raw` xác nhận; 1 lượt sửa lặp ngõ có tên;
  1 lượt khoảng trắng. Một tin có thể dùng nhiều quy tắc nên không cộng các
  lượt thành số tin.
- Sau chuẩn hóa, 10.301 tin (**26,46%** toàn source) có số nhà/đường trong
  ba thành phố; tương ứng 8.287 khóa địa chỉ có số nhà.
- 28.122 tin trong phạm vi chỉ có đường, 390 thiếu street/house, 117 ngoài
  ba thành phố. Các tin vẫn được giữ trong bản xuất.
- File riêng: `data/housing-geocode/housing-address-normalized.jsonl`.
  Metadata lưu địa chỉ gốc/evidence. Đã đối chiếu từng record, bảo toàn tọa
  độ, giá, units/phòng ngủ, listing IDs và media; source checksum không đổi.

### Kết quả API thật

**1.095 request, tất cả HTTP 200**, không gặp 429/lỗi dịch vụ. Ngân sách tối
đa 1.200 request, tốc độ tổng 120 request/phút. Cache tái sử dụng 7 request;
chạy resume cùng mẫu hoàn tất phát sinh **0 request mới**.

| Thành phố | Có số nhà được thử | Khớp đủ thành phần, một vị trí trong candidate đã đọc | Chỉ có đường được thử |
|---|---:|---:|---:|
| TP.HCM | 90 | 37 | 10 |
| Hà Nội | 90 | 15 | 10 |
| Đà Nẵng | 90 | 17 | 10 |
| Tổng | 270 | **69** | 30 |

Phân loại 300 ca: 69 khớp đủ, 44 khớp số nhà/đường/quận/thành phố nhưng
khác phường, 149 chưa khớp, 6 có nhiều vị trí khớp, 2 không kết quả và 30
chỉ có đường. “Chưa khớp” là không có candidate đáp ứng đầy đủ trong 3
candidate đầu đã đọc, không chứng minh provider không có địa chỉ đó.

Trong 69 candidate khớp, độ dịch chuyển lớn nhất so với các pin nguồn của
cùng địa chỉ: 4 ca dưới 25 m, 55 ca từ 25–1.000 m và 10 ca trên 1.000 m.
Các ngưỡng này chỉ mô tả phân bố để review, không phải quy tắc xác minh.

### Dự báo cho toàn source

Dùng mẫu đều khóa địa chỉ trong từng nhóm và trọng số số tin mỗi khóa:

- Ước lượng **3.055 tin, khoảng 7,85% toàn source**, có candidate khớp đủ
  thành phần theo quy trình tra cứu hiện tại.
- Khoảng bootstrap 95%: **6,17–9,59%**. Không dùng trực tiếp 69/300 nhân
  toàn dataset, vì đa số dataset thiếu số nhà và tỷ trọng ba thành phố khác nhau.
- **0 candidate được xác minh độc lập; 0 tọa độ đã apply.** Dự báo trên là
  khả năng tìm candidate, chưa phải phần trăm nhà có tọa độ chính xác hơn.
- Nhóm 44 ca khác phường và 6 ca nhiều vị trí có thể được xử lý thêm sau
  kiểm tra địa giới/nguồn; chưa tính là thành công và chưa hứa tỷ lệ tăng.

Nếu tài khoản còn đủ quota trial, nhóm 8.287 khóa có số nhà cần tối đa
khoảng 33.148 request (1 Search + 3 Place/khóa), dưới mức trial công bố
60.000 transaction. Công cụ chưa biết số dư trong Console; không tự mua
lượt. Hạn mức miễn phí không phải lý do chính khiến tỷ lệ chính xác thấp:
thiếu số nhà, địa chỉ cấu trúc chưa tốt và kết quả mâu thuẫn là vấn đề chính.

Đã thêm [runbook](housing-geocode-runbook.md), script
`scripts/housing-geocode.py`, 11 regression tests đều qua. Cache, đề xuất
tọa độ và summary nằm chung `data/housing-geocode/`; không thêm bảng DB và
không chỉnh logic/giao diện của ứng dụng. Source live và ZIP đang chạy giữ
nguyên; bản xuất chỉ sạch hơn về cấu trúc địa chỉ, chưa phải tọa độ đã sạch.
