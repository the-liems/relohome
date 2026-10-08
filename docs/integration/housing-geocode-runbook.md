# Chuẩn hóa địa chỉ và thử tọa độ housing

> **Cập nhật 2026-10-05:** đã áp dụng một phần source/PostGIS. Kết quả và
> workflow chạy tiếp ở [báo cáo lô đầu](housing-geocode-batch-2026-10-05.md).
> Input gốc đã đóng băng; **không chạy prepare lại trên data live** để resume.

## Workflow hiện tại: các lô nối tiếp

### Mục tiêu: các căn bị dồn vào cùng tọa độ

8.378 khóa có số nhà là tập có thể tra địa chỉ chi tiết, không phải số
nhóm trùng tọa độ và không phải chỉ tiêu thành công. Chỉ số chính là các
nhóm **địa chỉ khác nhau nhưng dùng chung pin** trong toàn bộ 38.930 tin.
Cùng số nhà/tòa có thể có nhiều phòng/tầng hợp lệ. Người dùng đã cho phép
địa chỉ chỉ có đường được chuyển về vị trí gần đúng của đúng đường/khu
vực để tách các đường khác nhau đang dồn chung pin, không coi đó là vị trí
chính xác của căn nhà.

```powershell
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py audit-shared-pins
```

`shared-pin-audit.json` phân loại nhóm khác địa chỉ, cùng địa chỉ có số nhà,
khác tòa/block cần xem lại, và nhóm địa chỉ thô chưa xác định. Đây là báo
cáo kiểm tra trong thư mục batch, không tạo bảng DB hoặc dataset runtime mới.
Các lượt run tiếp theo tự ưu tiên địa chỉ đang thuộc nhóm khác
địa chỉ dùng chung pin, xét dữ liệu runtime hiện tại, nhóm ảnh hưởng nhiều
tin trước. Giữ input gốc và cache; không chạy lại địa chỉ đã tra.

Không tạo tọa độ ngẫu nhiên để tách marker. Dùng vị trí theo đường nếu
địa chỉ thô có kết quả đủ khớp; nhiều căn cùng một đường vẫn có thể chung
pin gần đúng. Muốn tách tới từng căn cần thêm số nhà/hẻm/pin xác nhận.
Audit chạy offline, không tiêu API. Regression test bổ sung kiểm tra việc
ưu tiên đúng nhóm và giữ các phòng cùng tòa; tổng 26 tests qua.

### Giai đoạn hiện tại: làm nhóm chung tọa độ trước

Theo yêu cầu mới, dùng `--shared-pins-only` để lượt API xử lý cả địa chỉ
có số nhà và chỉ có đường trong nhóm khác địa chỉ dùng chung pin. Địa chỉ ngoài nhóm
được để sang giai đoạn sau. `shared-pin-queue.jsonl` liệt kê các địa chỉ
trong nhóm xung đột chưa tra; nhóm ảnh hưởng nhiều tin đứng đầu, không
đưa task đã có kết quả vào queue. Cache/tasks gốc được giữ nguyên.

```powershell
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py run --shared-pins-only --max-requests 45000 --rpm 120 --workers 4
```

Ngày 2026-10-06: còn 4.526 khóa có số nhà trong nhóm xung đột cần tra;
thêm hàng đợi đường theo yêu cầu mới. Trong nhóm khác địa chỉ dùng chung
pin có 20.148 tin chỉ có tên đường, 347 tin thiếu địa chỉ và 23 tin ngoài
phạm vi geocode hiện tại. Tin có đường được tra tới mức đường; tin thiếu
địa chỉ hoặc ngoài phạm vi vẫn cần thông tin bổ sung. Không coi chúng đã
xử lý xong chỉ vì đã phân nhóm. Khi hàng đợi scope này hoàn tất, các khóa
ngoài scope vẫn còn pending trong export toàn nguồn; `queue_complete`
của lượt run chỉ mô tả scope đã chọn. Test bảo toàn cache và lọc đúng
scope được thêm; tổng hiện tại 30 tests qua.

### Vị trí theo đường: được người dùng cho phép ngày 2026-10-06

- Sửa theo response thực tế: VIETMAP có road entity để `street` trống,
  tên đường nằm trong `name`. Khi Place không có số nhà, tên ở `name`
  khớp chính xác đường yêu cầu thì dùng làm bằng chứng đường, vẫn giữ
  raw response và tất cả guards vùng/phường/quận/thành phố. Chính sách
  street v2 rà lại các task đường đã tra theo v1 bằng cache, không mất
  quota tra lại. Regression test response thực tế đã qua; tổng 32 tests.
- Search lớp STREET; chỉ chọn kết quả đúng tên đường, Place không có số
  nhà, đúng quận/thành phố, tọa độ nằm trong vùng dự kiến. Nếu provider
  có phường thì phải khớp; đường không trả phường vẫn có thể dùng ở mức
  đường/quận. Không dùng một căn có số nhà làm đại diện cho cả đường.
- Kết quả tọa độ duy nhất, độ dịch chuyển tối đa 5 km; trường hợp xa hơn,
  mơ hồ, khác khu vực hoặc đã verified/khác tòa cần xem lại được giữ.
- Source/DB ghi `accuracy=approximate`, `method=vietmap_street_v4`,
  provenance `position_precision=street`, `house_position_known=false`.
  Không nâng verified và không sửa giá/phòng/media/IDs.
- Nếu các địa chỉ khác nhau vẫn được provider gán đúng một điểm, guard
  giữ lại để kiểm tra, không tái tạo cụm sai hoặc rải pin giả.
- Những task đường từng được bỏ qua offline được mở lại cho chính sách
  này; giữ cache và bằng chứng cũ, không coi chúng đã tra thành công.
- 6 task đường được rà lại bằng cache, đều chưa có kết quả đường đủ khớp;
  chưa đổi thêm pin thực tế trong lượt này. Hai key vẫn bị 429.

Cả hai key hiện trả 429, đã ghi trạng thái ngừng dùng trong ngày. Chạy
scope mới đã dừng an toàn với 0 request mới; chờ quota phục hồi hoặc thay
key trong `.env` rồi resume bằng lệnh trên. Không xóa cache/prepare lại.

`housing-geocode-full.py` đọc input gốc trong `inventory.frozen_source`, dùng
task/cache đã có. `housing-geocode-apply.py` so với source/DB hiện tại trước
khi áp phần bổ sung, có backup, dry-run/rollback và verify bảo toàn giá,
phòng, media, IDs, POI. Không sửa logic ứng dụng hoặc tạo bảng sạch lâu dài.

```powershell
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py cache-only --shared-pins-only
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py run --shared-pins-only --max-requests 45000 --rpm 120 --workers 4
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py inspect
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py export --allow-partial
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py dry-run
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py apply
```

`--rpm` là **tổng Search + Place**. Console có Geocode 1.500/ngày; hạ tốc độ
không khắc phục hết quota ngày. Không mua thêm quota hoặc đổi billing.
`--allow-partial` chỉ áp địa chỉ đủ điều kiện đã có, giữ pin và đánh dấu
pending cho phần chưa tra. Bỏ cờ này nếu muốn chờ hoàn tất toàn hàng đợi.
Các phòng/tầng/tin trong cùng tòa vẫn được giữ riêng; không rải pin hoặc
gộp/xóa tin. Tọa độ mới vẫn approximate, không nâng verified.

### Key dự phòng

Ngày 2026-10-06 người dùng bổ sung tài khoản thứ ba, lưu ở biến
`VIETMAP_API_KEY_2`. Thứ tự: `VIETMAP_API_KEY` → `VIETMAP_API_KEY_1` →
`VIETMAP_API_KEY_2`. Chỉ dùng key tiếp theo khi key trước không còn khả
dụng; tổng RPM giữ nguyên. Đã nạp lại lượt chạy để nhận key mới, giữ cache
và counter. Test thứ tự cả ba key qua; tổng 33 regression tests.

Script batch đọc `VIETMAP_API_KEY`, rồi `VIETMAP_API_KEY_1` và các biến có
đuôi số trong `.env`, bỏ key rỗng hoặc giống nhau. Người dùng đã cho phép
dùng key tài khoản dự phòng. HTTP 429/401/403 làm key hiện tại ngừng dùng
trong lượt chạy và chuyển sang key còn khả dụng; không lặp gọi key bị chặn.
Nếu tất cả key không dùng được, lưu tiến độ và dừng. Giới hạn tốc độ 120
lượt/phút vẫn là tổng của các endpoint và tất cả key, không nhân lên.

`api-key-state.json` chỉ lưu tên biến, dấu vân tay SHA256 và trạng thái lỗi;
không lưu giá trị key. Cache kết quả dùng chung giữa các key để tránh gọi lại.
Thay giá trị key rồi chạy lại sẽ nhận diện key mới. Trạng thái chặn được
thử lại vào ngày tiếp theo theo giờ máy Asia/Saigon; đây không phải cam kết
giờ reset quota của nhà cung cấp. Không cần xóa cache hay prepare lại.
Key chỉ được đọc khi bắt đầu lượt chạy; thay `.env` giữa lượt cần dừng bằng
file `data/housing-geocode/STOP`, chờ script dừng, bỏ file STOP rồi chạy lại.

Test bổ sung: tự đổi tài khoản khi 429, dừng hữu hạn khi tất cả hết quota,
resume bằng key mới, không lộ key trong artifacts và dựng lại task từ cache
không tiêu thêm request. Tổng 23 regression tests đã qua.

Lượt chạy tiếp đã gặp `PermissionError` khi thay file counter JSON trên
Windows. Công cụ data hiện thử lại việc thay file nguyên tử trong khoảng
ngắn nếu file đang bị reader/editor giữ; nếu lỗi kéo dài vẫn dừng, không
gọi API tiếp khi chưa lưu được counter. Hai regression tests mới kiểm tra
khóa tạm thời và khóa kéo dài; tổng hiện tại 25 tests qua. Resume giữ cache
và số đếm lớn nhất của các lần chạy, không bắt đầu lại từ đầu.

## Tài liệu pilot lịch sử

Phần dưới là workflow pilot **trước khi apply**, không chạy lại prepare trên
thư mục batch hiện tại. Các thông tin “chưa ghi live” chỉ mô tả giai đoạn đó.

## Phạm vi

`scripts/housing-geocode.py` là công cụ xử lý data độc lập. Không thay logic
Agent, Moving, Flight hay frontend; không ghi PostGIS và không thay source live.

Phạm vi geocode: TP.HCM, Hà Nội, Đà Nẵng. Tin ngoài phạm vi vẫn được giữ trong
file xuất. Không xóa/gộp tin nhà chỉ vì cùng tọa độ, không đổi số phòng ngủ hoặc
số nhà theo suy đoán. Tin chỉ có tên đường vẫn là gần đúng.

## Chuẩn hóa offline

Các phép sửa có bằng chứng từ trường địa chỉ gốc:

- `50`, street `Hẻm 277 Đường Xô Viết Nghệ Tĩnh` → `277/50`, street
  `Xô Viết Nghệ Tĩnh`; không ghép thêm 277 nếu housenumber đã là `277/50`.
- `29 Ngõ Hàng Cháo`, street `Hàng Cháo` → house `29`, street `Ngõ Hàng Cháo`.
- Street `325/29A Bạch Đằng` → tách số nhà nếu phần đầu `address_raw` xác nhận
  nguyên văn cùng địa chỉ. Đường `3 Tháng 2`, `30 Tháng 4`, `2 Tháng 9` không
  bị nhận nhầm thành số nhà.
- Chuẩn hóa khoảng trắng; không đổi phường/quận/thành phố.

Ở pilot chưa trích số nhà trong description. Batch đã thêm rule chỉ lấy dòng
“Địa chỉ:” rõ ràng khớp đúng street, số nhà duy nhất và không khác phường;
không lấy địa điểm lân cận hoặc số liên hệ.
`derived.address_normalization` giữ cấu trúc gốc, rule và evidence để kiểm tra lại.

## Chạy trên Windows

Cài dependencies hiện có của project (`httpx`, `python-dotenv`) trong `.venv`.
Key service VIETMAP đặt ở `VIETMAP_API_KEY` trong `.env`; không dùng tile key.

```powershell
.\.venv\Scripts\python.exe scripts/housing-geocode.py prepare --per-city 100
.\.venv\Scripts\python.exe scripts/housing-geocode.py verify
.\.venv\Scripts\python.exe scripts/housing-geocode.py geocode --selection sample --max-requests 1200 --rpm 120
.\.venv\Scripts\python.exe scripts/housing-geocode.py report
```

Mẫu mặc định: 300 **địa chỉ duy nhất**, 100/thành phố, gồm 90 có số nhà và
10 chỉ có đường. Chọn ngẫu nhiên có thể tái lập bằng hash trong từng nhóm.
Không dùng tọa độ cũ làm focus trong đợt này, để kiểm tra khả năng tìm địa chỉ
độc lập với pin nguồn. Lấy chi tiết tối đa 3 candidate đầu cho địa chỉ có số
nhà; ca chỉ có đường không lấy Place và không tạo candidate tọa độ nhà.

`--max-requests` là trần request đã ghi trong cache của thư mục chạy (tính cả
request thất bại/thử lại), không phải ngân sách mới cho mỗi lần resume. Không
tự động chạy toàn bộ data hoặc nâng budget. API thành công được cache theo
endpoint/tham số; địa chỉ hoàn tất không chạy lại. Khi gặp 429/5xx/timeout,
retry có giới hạn; 401/403/423 và response sai cấu trúc sẽ dừng để kiểm tra.
Nếu Retry-After quá 60 giây, dừng để resume sau. Không in URL chứa key hoặc
exception có thông tin xác thực.

Sau khi thử xong có thể chạy lại `geocode` cùng tham số để xác minh resume:
không có request mới nếu mẫu đã hoàn tất. Kiểm tra kết quả ở `last-run.json`.

## Đầu ra trong một thư mục

Tất cả ở `data/housing-geocode/` (ignored; không đưa data/key lên Git):

| File | Vai trò |
|---|---|
| `housing-address-normalized.jsonl` | Bản housing riêng, giữ số tin và toàn bộ fields ngoài cấu trúc địa chỉ/metadata. **Chưa đổi tọa độ.** |
| `inventory.json`, `tasks.jsonl`, `sample.json` | Checksum, thống kê, khóa địa chỉ và mẫu |
| `candidates.jsonl`, `coordinate-candidates.jsonl` | Kết quả tra cứu và đề xuất khớp thành phần, **chưa apply** |
| `cache.json`, `requests.jsonl`, `last-run.json` | Cache, nhật ký request và kết quả resume |
| `summary.json`, `verification.json`, `README.md` | Tỷ lệ ước lượng, kiểm tra bảo toàn và hướng dẫn |

Không tạo thêm bảng DB hoặc thay dịch vụ geocoding trong ứng dụng. Không đổi
tên source đang được importer sử dụng. Bản JSONL chuẩn hóa không phải bộ tọa
độ đã sạch; chưa cần thay ZIP data đang chạy cho teammate.

## Đọc tỷ lệ đúng cách

Phân biệt:

1. **Đủ địa chỉ:** số tin có số nhà/đường/thành phố để thử.
2. **Khớp thành phần:** provider trả số nhà, đường, phường, quận và thành phố
   khớp, tọa độ hợp lệ trong vùng kỳ vọng. Không bỏ qua khác phường dù có
   tên nhà đúng; không tự ánh xạ địa giới.
3. **Đúng vị trí:** cần GPS/cổng nhà/chứng cứ độc lập. Khớp thành phần hoặc
   pin tách ra chưa chứng minh tọa độ chính xác.
4. **Cải thiện thực tế:** vị trí mới đã đúng hơn pin cũ. Một số pin nguồn đã
   gần đúng nên không cần di chuyển chỉ để tính là đã sửa.

Mẫu chọn đều khóa địa chỉ theo từng thành phố/nhóm; dự báo số tin khớp có
trọng số theo số tin mỗi khóa và quy mô từng nhóm. Khoảng bootstrap là độ
bất định của dự báo khớp thành phần, không đo sai số GPS hay cam kết chất
lượng toàn dataset. Chỉ công bố dự báo khi toàn mẫu đã hoàn tất.

Nếu một địa chỉ có nhiều tọa độ nguồn, hoặc nhiều candidate khớp nhưng khác
tọa độ, cần review. Địa chỉ chung nhiều phòng/tầng vẫn được phép chung tọa độ.
Không tự nâng `verification.status`, không gắn `rooftop` cho kết quả API.

## Trước khi áp dụng tọa độ

Review sample bằng chứng độc lập; rà tất cả ca khác phường, dịch chuyển lớn,
vị trí verified và candidate mơ hồ. Xác nhận điều kiện lưu/export và dùng trên
bản đồ hiện tại của nhà cung cấp. Sau đó mới xây patch đã duyệt theo listing
IDs/checksum, backup, cập nhật JSONL và DB cùng version, kiểm tra importer
không khôi phục pin cũ. Công cụ này chưa có bước apply tự động.

Hạn mức trial công bố là 60.000 transaction; Search/Place mỗi request là một
transaction. **Công cụ không biết số dư quota của tài khoản**, cần xem Console
trước batch lớn; không thiết lập thanh toán hay tự mua lượt.
[VIETMAP overview](https://maps.vietmap.vn/docs/vi/map-api/overview/),
[Geocode v4](https://maps.vietmap.vn/docs/map-api/geocode-version/geocode-v4/),
[Place v4](https://maps.vietmap.vn/docs/map-api/place-v4/).

## Kiểm tra

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_housing_geocode.py
```

Các regression kiểm tra tên đường dạng ngày tháng, dữ kiện trong description,
không đoán phường, hẻm đã chuẩn không bị ghép lặp, nhiều phòng cùng địa chỉ,
tọa độ sai vùng/NaN, candidate mơ hồ và bảo toàn data gốc.
