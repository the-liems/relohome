# Housing: đã áp dụng lô đầu — 2026-10-05

<!-- housing-key-rotation-current -->
## Cập nhật sau khi dùng key dự phòng

Thời điểm UTC: `2026-10-06T16:44:15.893163+00:00`. Trạng thái: `partial_applied_waiting_quota`.

| Chỉ số | Số đếm đã kiểm tra |
|---|---:|
| Tin nguồn giữ nguyên IDs/số lượng | 38,930 |
| Địa chỉ chuẩn hóa | 590 |
| Tọa độ nguồn đổi, tổng so với gốc | 8,834 |
| Tọa độ DB đổi, tổng so với gốc | 8,691 |
| Tọa độ nguồn đổi ở lô mới nhất | 7,827 |
| Tọa độ DB đổi ở lô mới nhất | 7,706 |
| Dòng DB được cập nhật ở lô mới nhất | 7,706 |
| Khóa địa chỉ có số nhà đã hoàn tất | 4,456/8,378 |
| Khóa có số nhà còn chờ | 3,922 |
| Tổng lượt API đã đếm, chưa bao gồm 40 lượt pilot đầu | 12,615 |

Nguồn runtime SHA256: `5297deae39607430f42231473b87f243b330076133f72f0dcca5295187f14f5b`. JSONL/PostGIS đã verify,
giữ units/giá/phòng/media/POI và IDs. Pin geocode vẫn `approximate`, không
khẳng định đúng cổng hoặc GPS. 33 tests qua; key chỉ trong `.env`, không
đưa vào docs/git. Bảng lô đầu bên dưới là lịch sử trước khi bổ sung key.
Chưa tạo lại ZIP hoặc push data. Chi tiết ở `data/housing-geocode/checkpoint.json`.

<!-- /housing-key-rotation-current -->

Người dùng đã cho phép **áp dụng phần đủ điều kiện trước**, sau đó bổ sung
API/key để xử lý tiếp. Đã commit data lúc **19:33:22 ngày 2026-10-05**
(Asia/Saigon). **Đây là lô đầu, chưa geocode xong toàn bộ.**

## Kết quả thực tế

| Nội dung | Kết quả |
|---|---:|
| Tin nguồn giữ nguyên số lượng và IDs | 38.930 |
| Địa chỉ được chuẩn hóa | 590 |
| Tọa độ được thay trong JSONL | 347 tin |
| Tọa độ được thay trong PostGIS | 340 tin |
| Dòng PostGIS cập nhật địa chỉ/metadata hoặc tọa độ | 898 |
| Dòng PostGIS ngoài patch, giữ nguyên | 37.324 |
| Khóa địa chỉ có số nhà đã tra xong | 1.067 / 8.378 |
| Khóa địa chỉ có số nhà còn chờ | 7.311 |
| Tin còn chờ geocode do quota | 9.182 |
| Tin chỉ có đường, giữ pin cũ | 27.964 |
| Tin thiếu địa chỉ / ngoài ba thành phố | 390 / 117 |
| Tests | 20/20 qua |

Trong 590 địa chỉ: 304 ca ghép số ngõ/hẻm rõ ràng, 127 ca tách số nhà nằm
trong street có raw xác nhận, 158 ca phục hồi số nhà từ dòng **Địa chỉ:**
khớp đường/phường trong mô tả, một ca ngõ có tên và một ca khoảng trắng.
Các rule có thể cùng tác động một tin, không cộng chúng thành số tin khác.

347 tin khớp 258 khóa địa chỉ đủ điều kiện; nhiều phòng/tầng cùng tòa được
giữ riêng và dùng chung vị trí nếu đúng địa chỉ. Chênh lệch JSONL/PostGIS
do source có một số tin không được importer đưa vào DB trước đó. Không
khôi phục tin bị reject, không thêm units/listings để ép DB bằng số source.

Pin mới dùng `method=vietmap_geocode_v4`, `accuracy=approximate`,
`independently_verified=false`. Chỉ khớp thành phần địa chỉ; chưa chứng minh
GPS/cổng vào/tầng hoặc tính xác thực của tin rao. Không nâng verified.

## Kiểm tra trước/sau

- Đối chiếu từng record ngoài address/location/provenance: giữ giá, phòng
  ngủ, diện tích, unit, nguồn, IDs, mô tả và ảnh.
- Fingerprints PostGIS: units, properties, offers, listing/place media, POI
  và fields nghiệp vụ listing không đổi. Không sửa tài khoản/lịch sử chat.
- Dry-run SQL trên 9 tin của ba thành phố và toàn patch: cập nhật trong
  transaction rồi ROLLBACK, đối chiếu DB/source không đổi.
- Apply thật: có backup, khóa dòng, guards verification/role/ID/hash/tọa độ,
  chỉ commit sau khi thay source thành công. Verify: 898 dòng target khớp
  source, 37.324 dòng ngoài target không đổi.
- Không thay logic Agent, Moving, Flight, frontend, API ứng dụng hay schema.
  Chỉ thêm công cụ data độc lập, tests và docs; TEMP tables tự hết sau transaction.

| Chỉ số pin trong source | Trước | Sau |
|---|---:|---:|
| Tin dùng tọa độ chung với tin khác | 34.439 | 34.227 |
| Nhóm tọa độ có nhiều tin | 3.880 | 3.892 |
| Nhóm có địa chỉ khác nhau dùng cùng pin | 2.612 | 2.577 |

Địa chỉ được chuẩn hóa cùng rule khi so trước/sau để không nhầm thay đổi
format thành thay đổi chất lượng pin. Số nhóm chung pin có thể tăng khi một
nhóm lớn được tách thành các tòa nhỏ, mỗi tòa có nhiều phòng hợp lệ. Không
rải pin ngẫu nhiên hoặc xóa tin nhằm làm marker tách ra. Đây mới là cải thiện
của lô đầu; phần lớn data chưa đủ số nhà hoặc còn chờ tra.

## Quota VIETMAP

Ảnh Console người dùng gửi có Geocode **200/phút, 1.500/ngày**, quyền chỉnh
limit ở chế độ view-only. Kiểm tra live sau thời gian nghỉ: Search 200,
Place 429 với body `Too many requests`, không có Retry-After. 429 xuất hiện
ngay ở một lượt Place, nên hạ RPM đơn thuần chưa giải quyết. Điều này phù
hợp giới hạn ngày; chưa có ánh xạ riêng Place trong ảnh để xác nhận loại
counter của endpoint. Không mua thêm quota hoặc đổi billing/limit.

Tận dụng cache thêm 237 khóa không phát sinh API. Bộ đếm tích lũy hiện
2.588 request, cộng 40 request pilot 10 địa chỉ ban đầu ở log riêng.
`full-request-count.json` được ghi **trước** request, tính cả lượt đang chờ
bị hủy; không chỉ đếm các response khi resume. Cache vẫn dùng lại khi đổi
key VIETMAP. Nếu đổi sang provider khác phải thêm adapter và namespace
cache phù hợp, không trộn response các provider.

## Source và backup

Runtime vẫn đọc đúng tên canonical:

`Maps VN/Data/housing_clean_2026-09-26.jsonl`

- SHA256 trước: `95c92c1e56046f9f8e7953ff5f0e9c879ff75e3a6b5b14bbb5f6fd1b895953fd`.
- SHA256 sau: `a627c472f2b5aa19b27e197b4a9ba85059fec5ca2165575455cacc4f68cfb8bc`.

Tất cả artifact/cache ở `data/housing-geocode/`:

- `housing-original.jsonl`: **input gốc bất biến**, không nhập lại làm runtime.
  `inventory.frozen_source` trỏ vào đây để tra tiếp cùng các task/cache cũ.
- `housing-geocoded.jsonl`: bản xuất của lô đã áp dụng, có trạng thái pending.
- `db-touched-original.json`, `apply-journal.json`: backup DB và journal lô.
- `checkpoint.json`, `batch-summary.json`, `full-verification.json`: trạng thái
  hiện tại và chứng cứ bảo toàn. Checkpoint trước lúc offline đã trở thành lịch sử.
- Cache, ledger và candidates: giữ để không gọi lại địa chỉ đã có.

## Chạy tiếp sau khi API/key có quota

Không `prepare` lại trên file live hoặc xóa cache/bản gốc khi chưa hoàn tất.
Không chạy hai job/importer cùng lúc với apply. Key chỉ đặt trong `.env`;
không commit key hoặc in nội dung ra log.

```powershell
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py run --max-requests 45000 --rpm 120 --workers 8
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py inspect
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py export --allow-partial
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py dry-run
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py apply
```

Nếu có sentinel STOP sau khi chủ động dừng thì chỉ bỏ đúng file đó khi muốn
resume. `export` không có `--allow-partial` yêu cầu toàn bộ hàng đợi xong.
`cache-only` xử lý các địa chỉ đã đủ responses mà không gọi API. Apply các
lô sau so patch với **source/DB đang chạy**, còn provenance và task lấy từ
input gốc; không ghi đè pin được user xác minh hoặc source thay ngoài lô.

## Bàn giao data

Đợt này chưa push code hoặc tạo lại ZIP/snapshot. ZIP đã tạo trước geocode
vẫn là data cũ. Để teammate nhận data mới: gửi JSONL canonical và snapshot
PostGIS mới cùng phiên bản, hoặc import JSONL canonical mới bằng ingest
sẵn có. Không gửi `housing-original`, cache, logs hoặc `.env` như runtime data.
Importer tiếp tục đọc cùng tên file, nên không tự phục hồi pin gốc sau lô này.
