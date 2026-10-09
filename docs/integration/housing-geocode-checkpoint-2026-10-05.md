# Checkpoint housing — 2026-10-05

> **Trạng thái cuối lượt, 23:44 ngày 2026-10-06:** đã apply và verify
> phần đủ điều kiện vào JSONL/PostGIS. Tổng đổi 8.834 tin nguồn (1.692
> theo địa chỉ có số nhà, 7.142 theo đường gần đúng), 8.691 tin PostGIS.
> Giữ đủ 38.930 tin; units/giá/phòng/media/POI/IDs bảo toàn. Tra xong
> 4.456 khóa số nhà và 2.643 khóa đường. Scope chung pin sau apply còn
> 5.507 khóa cần tra (2.581 số nhà, 2.926 đường); vẫn còn 2.363 nhóm khác
> địa chỉ chung pin, gồm 20.249 tin cần xem xét. Cả ba key trả 429;
> tác vụ đã dừng, không có lượt tra đang chạy. Không khẳng định data đã
> sạch hết hoặc tọa độ gần đúng đã chính xác tới căn nhà. Chi tiết ở
> [báo cáo đã cập nhật](housing-geocode-batch-2026-10-05.md),
> `checkpoint.json`, `shared-pin-audit.json`, `full-verification.json`.
> Các ghi chú “đang chạy” bên dưới là lịch sử.

> **22:56 ngày 2026-10-06:** đã lưu key tài khoản thứ ba vào `.env` biến
> `VIETMAP_API_KEY_2`, nạp lại tác vụ và workflow đồng bộ, PID 20908.
> Thứ tự dùng base → `_1` → `_2`, chỉ đổi khi key trước hết khả dụng.
> Cache/candidates/counter giữ nguyên; không đưa key vào git/docs/logs.
> Đã có 204 candidate khóa địa chỉ đường đủ điều kiện gần đúng trong
> evidence, chưa áp vào live. Tổng 33 tests qua. Xem `full-run.json` và
> `continuation-state.json`; các PID bên dưới là lượt trước.

> **22:41 ngày 2026-10-06:** phát hiện road Place để `street` trống và
> tên đường ở `name`, đã sửa nhận dạng tên đường chính xác và giữ raw
> response cùng guards vị trí. Street policy v2 rà cache thêm 143 task,
> lấy được 30 candidate địa chỉ đường đủ điều kiện gần đúng, không gọi
> API lại. Chưa áp các candidate này vào live. 32 tests qua. Lượt chạy
> tiếp và workflow đồng bộ hiện dùng PID 3392; PID 25644 bên dưới là lượt
> đã tạm dừng để sửa nhận dạng. Xem state JSON để theo dõi cập nhật.

> **22:36 ngày 2026-10-06:** kiểm tra trực tiếp 4 lượt (Search + Place cho
> từng key), cả hai tài khoản đều trả 200. Đã chạy tiếp scope chung tọa
> độ gồm số nhà và đường, tổng 120 RPM, 4 workers, PID 25644. Giữ cache
> và bản gốc, tự chuyển key nếu bị 429. Workflow đồng bộ đã chờ lượt này:
> cache-only/inspect/export/dry-run/apply/verify/audit/report; dừng xem lại
> nếu có lỗi khác hoặc STOP. Kết quả candidate được lưu liên tục; số pin
> đã áp dụng chưa bao gồm lượt đang tra. Xem `full-run.json`,
> `continuation-state.json` và `quota-probe.json`. 31 regression tests qua.
> Các ghi chú quota bị chặn bên dưới là lịch sử.

> **Yêu cầu bổ sung ngày 2026-10-06:** ưu tiên dùng địa chỉ chi tiết nhất
> có thể để chuyển pin, không bỏ qua các căn chỉ có tên đường. Scope
> `--shared-pins-only` hiện gồm địa chỉ có số nhà **và** đường trong nhóm
> xung đột. Road Place phải đúng đường/quận/thành phố, phường nếu có phải
> khớp, không được là số nhà bất kỳ; kết quả ghi rõ gần đúng mức đường.
> Không tạo pin giả hay gộp/xóa tin. 30 tests qua. Rà cache thêm 6 task
> đường chưa đủ khớp để áp pin; hai key vẫn 429. Dữ liệu live không đổi
> thêm kể từ lô verify 2026-10-05. Queue/checkpoint được cập nhật theo
> chính sách mới; các đoạn “chỉ tra số nhà” bên dưới là lịch sử.

> **09:28 ngày 2026-10-06:** đã thử resume `--shared-pins-only` sau khi
> sang ngày mới. Key cũ: Search 200 nhưng Place 429; key dự phòng: Search
> 429. Chưa xác nhận quota đã reset; response không có Retry-After.
> Lượt này phát sinh 6 request đã đếm, tra thêm 2 địa chỉ không có kết quả
> tọa độ đủ điều kiện; tổng đã tra 2.575/8.378 khóa có số nhà. Runtime
> JSONL/PostGIS không sửa thêm, giữ kết quả đã verify hôm trước. Hàng đợi
> chung pin còn 4.526 khóa chưa tra; cache/checkpoint đã cập nhật. Chờ
> key/quota khả dụng, không gọi lặp lại 429 liên tục. PostGIS đã khởi động;
> các OSRM vẫn tắt. Thời điểm reset thực tế của nhà cung cấp chưa biết.

> **20:43 ngày 2026-10-05 — làm nhóm chung tọa độ trước:** đã tạo queue
> `data/housing-geocode/shared-pin-queue.jsonl` cho 4.528 khóa có số nhà
> thuộc nhóm khác địa chỉ chung pin chưa tra. Resume với
> `run --shared-pins-only --rpm 120 --workers 4`; không tiêu API cho địa
> chỉ ngoài nhóm trong giai đoạn này. Đã kiểm tra scope/giữ cache, tổng
> 27 tests qua. Cả hai key còn bị 429: lượt scope mới dừng với 0 request
> mới, runtime JSONL/PostGIS không sửa thêm. Chờ key/quota khả dụng.
> Nhóm thiếu số nhà vẫn chưa đủ bằng chứng để tạo pin riêng chính xác.

> **Điều chỉnh mục tiêu theo phản hồi người dùng:** xử lý các căn khác
> địa chỉ đang chung tọa độ, không lấy việc tra đủ 8.378 địa chỉ làm tiêu
> chí thành công. Audit toàn bộ 38.930 tin runtime còn 2.505 nhóm khác
> địa chỉ chung pin (27.307 tin); trong đó có 20.148 tin chỉ có tên đường,
> 347 tin thiếu địa chỉ và 23 tin ngoài phạm vi geocode hiện tại.
> Không thể tự tạo pin chính xác để tách các tin thiếu bằng chứng.
> Các lượt run tiếp theo ưu tiên nhóm khác địa chỉ chung pin, nhóm nhiều
> tin trước. Có 4.528 khóa có số nhà trong nhóm xung đột còn chờ tra.
> Bảo toàn các phòng/tầng cùng tòa; địa chỉ thô cùng pin được đánh dấu
> chưa đủ bằng chứng, không tự coi là chung tòa hợp lệ. Audit offline,
> checksum runtime không đổi; 26 tests qua. Xem `shared-pin-audit.json`
> và [runbook](housing-geocode-runbook.md). Hiện cả hai key vẫn bị 429.

> **Trạng thái mới nhất, 20:20 ngày 2026-10-05:** key dự phòng đã trả HTTP
> 429 và cả hai key đang bị giới hạn. Lượt tra dừng lúc 20:17; workflow đã
> dry-run, apply và verify thành công phần đủ điều kiện. Đã tra 2.573/8.378
> khóa địa chỉ có số nhà (30,7%), còn 5.805 khóa. Tổng tọa độ đổi: 1.007 tin
> source / 985 tin PostGIS; riêng lô mới 660 / 645. Giữ đủ 38.930 tin nguồn,
> units/giá/phòng/media/POI/IDs không đổi. Chờ quota phục hồi hoặc key mới
> rồi resume từ cache; **không chạy prepare lại**. Các ghi chú lượt chạy
> bên dưới là lịch sử. Chi tiết ở [báo cáo cập nhật](housing-geocode-batch-2026-10-05.md)
> và `data/housing-geocode/checkpoint.json`.

> **20:01 ngày 2026-10-05:** lượt trước dừng bởi `PermissionError` lúc
> thay file đếm tiến độ, key dự phòng chưa bị giới hạn. Đã thêm retry
> nguyên tử cho trường hợp reader/editor giữ file trên Windows (25 tests
> qua) và chạy tiếp từ 1.566 khóa địa chỉ có số nhà đã tra xong. Tác vụ mới
> dùng `VIETMAP_API_KEY_1`, PID 15396; workflow đồng bộ sau lượt tra đã
> khởi động lại. Xem `full-run.json` và `continuation-state.json` để biết
> trạng thái hiện tại; các số lô đã apply bên dưới chưa gồm lượt mới.

> **19:50 ngày 2026-10-05:** người dùng bổ sung `VIETMAP_API_KEY_1` và cho
> phép tự chuyển tài khoản. Key cũ trả 429; tác vụ đã chuyển thành công
> sang key dự phòng, tiếp tục từ cache ở tổng 120 RPM. Trạng thái tra mới
> ở `data/housing-geocode/full-run.json`; tiến độ đồng bộ tự động ở
> `data/housing-geocode/continuation-state.json`. Khi tra kết thúc bình thường
> hoặc tất cả key không còn khả dụng, workflow sẽ inspect/export/dry-run/
> apply/verify, rồi cập nhật checkpoint và báo cáo. Nếu có lỗi khác hoặc
> file STOP, dừng để kiểm tra, không tự áp data. Key không đưa vào docs/git.
> Các số đếm lô đầu dưới đây là phần **đã áp dụng**, chưa bao gồm lượt mới.

> **Đã tiếp tục và áp dụng một phần lúc 19:33 ngày 2026-10-05:** chuẩn hóa
> 590 địa chỉ, đổi 347 tọa độ source / 340 tọa độ PostGIS. Trạng thái mới ở
> [báo cáo lô đầu](housing-geocode-batch-2026-10-05.md) và
> `data/housing-geocode/checkpoint.json`. Phần dưới lưu checkpoint cũ lúc offline.

**Lịch sử checkpoint trước khi áp dụng data:** tạm dừng theo yêu cầu người dùng.

## Mục tiêu

Chuẩn hóa toàn bộ housing bằng VIETMAP đã cấu hình trong `.env`. Người dùng
cho phép chủ động sửa data crawl nếu phù hợp. Giữ riêng từng tin, tầng/phòng
và tòa; không ép mỗi tin thành một tọa độ khác nhau. Thiếu địa chỉ cụ thể thì
giữ pin. Không đổi logic Agent/Moving/Flight/frontend, giá, phòng ngủ, ảnh, IDs.

## Tiến độ đã lưu

| Nội dung | Kết quả |
|---|---:|
| Source | 38.930 tin |
| Chuẩn hóa địa chỉ trong **bản riêng**, chưa apply | 590 tin |
| Phục hồi số nhà từ dòng “Địa chỉ” trong mô tả | 158 tin |
| Tin đủ số nhà và đường ở ba thành phố | 10.459 |
| Khóa đủ số nhà cần tra | 8.378 |
| Đã hoàn tất tra / còn lại | 830 / 7.548 |
| Candidate đủ điều kiện sơ bộ, **chưa apply** | 208 khóa |
| Giữ vì chưa khớp / lệch trên 1 km | 596 / 26 khóa |
| Khóa chỉ có đường giữ pin bằng kiểm tra offline, **không gọi API** | 7.993 |
| Tổng khóa có quyết định | 8.823 / 16.371 |
| Bộ đếm request cuối, gồm pilot 300 địa chỉ | 2.585 |
| PostGIS baseline | 38.222 tin khớp tọa độ source; chưa ghi DB |
| Tests hiện tại | 19/19 qua |

Pilot 10 địa chỉ ban đầu có thêm 40 request ở log riêng, ngoài bộ đếm 2.585.
Request đang chờ bị hủy có thể chưa có dòng response trong ledger; resume
phải tính cả bộ đếm lần chạy cuối. 208 là **khóa địa chỉ sơ bộ**, chưa phải
số tin đã sửa hoặc tọa độ verified. Khi export còn kiểm provider trả pin trùng.

Source canonical **chưa thay đổi**:
`Maps VN/Data/housing_clean_2026-09-26.jsonl`.
SHA256: `95c92c1e56046f9f8e7953ff5f0e9c879ff75e3a6b5b14bbb5f6fd1b895953fd`.
Chưa export toàn bộ, apply, tạo ZIP/snapshot mới, commit hoặc push.

## Files cần giữ

Tiến độ local nằm trong **`data/housing-geocode/`** (Git ignored):

- `STOP`: đã tạo để ngăn resume khi người dùng offline.
- `inventory.json`, `tasks.jsonl`, `housing-address-normalized.jsonl`: bản
  địa chỉ riêng với 590 tin chuẩn hóa; tọa độ chưa đổi.
- `cache.json`, `requests.jsonl`, `candidates.jsonl`, `pilot-300-summary.json`:
  chứng cứ/cache pilot; không xóa để tránh gọi lại.
- `full-cache.jsonl`, `full-requests.jsonl`, `full-candidates.jsonl`,
  `full-run.json`: cache append-only, kết quả từng khóa và tiến độ batch.
- `building-context.json`, `db-baseline.json`, `db-protected.json`:
  ngữ cảnh project/tower/unit và guard DB.
- `checkpoint.json`: trạng thái máy đọc được, checksum source và số đếm.

Scripts mới chưa commit:

- `scripts/housing-geocode.py`: prepare/pilot/verify; phục hồi số nhà từ raw
  hoặc dòng địa chỉ rõ ràng, không lấy số điện thoại/địa điểm “gần …”.
- `scripts/housing-geocode-full.py`: batch async, cache/resume, export.
- `scripts/housing-geocode-apply.py`: inspect/apply/verify source+housing anchors.
- `tests/test_housing_geocode.py`: bảo toàn unit/giá/IDs, ngõ/hẻm, verified,
  tower khác nhau và provider trả cùng pin cho địa chỉ khác nhau.

Docs pilot: `housing-geocode-runbook.md`, `housing-vietmap-pilot-2026-10-05.md`,
phần 12.8 trong `location-data-quality-plan-2026-10-04.md`. Thống kê 432 tin,
69 candidate, 7,85% trong đó là **lịch sử pilot**, không phải kết quả batch.
Runbook toàn source còn cần hoàn thiện trong lượt tiếp theo.

## Vấn đề còn lại

1. VIETMAP trả **429** khi chạy 180 RPM/API và cả tổng 180 RPM dùng chung.
   Lượt cuối dừng lúc **17:45:37 ngày 2026-10-05**, reason
   `http_429_resume_at_lower_rate`. Chưa xác định chắc chỉ là RPM hay giới
   hạn khác của consumer/tài khoản. Nếu còn lỗi ở tốc độ thấp, kiểm phản hồi
   429/Retry-After và Console. **Không tự mua quota.**
2. Resume **tổng 120 RPM Search + Place** trước; pilot ở tốc độ này đã thành
   công. Script có pacer chung dù vẫn nhận alias `--rpm-per-api`. Cần lấy
   max bộ đếm lần chạy trước và ledger, hoặc ghi bền bộ đếm trước request,
   để tính cả request đang chờ bị hủy.
3. Apply script đã compile và kiểm COPY Unicode/nháy/backslash/xuống dòng
   bằng TEMP table + ROLLBACK trên PostGIS. **Chưa test apply end-to-end trên
   data thật**; rà transaction, backup/rollback và mất xác nhận COMMIT trước
   khi dùng. Không tạo bảng data sạch lâu dài.
4. Export chỉ khi toàn hàng đợi hoàn tất. Refresh baseline trước export/apply
   nếu DB đã thay đổi; không ghi đè sửa mới của user/teammate.

## Tiếp tục khi người dùng yêu cầu

Không tạo lại inventory hoặc xóa cache giữa lô. Không chạy hai job cùng lúc.

```powershell
Remove-Item -LiteralPath data/housing-geocode/STOP
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py run --max-requests 45000 --rpm 120 --workers 8
```

Sau khi batch xong và đã rà apply:

```powershell
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py inspect
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py export
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py apply
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py verify
```

## Quy tắc trước apply

Khớp số nhà/đường/phường/quận/thành phố, một candidate hợp lệ duy nhất trong
vùng thành phố, dịch chuyển không quá 1 km. Khác phường/nhiều candidate/lệch
xa, nhiều project/tower trong cùng khóa hoặc provider trả một pin cho các
khóa địa chỉ khác nhau thì giữ để review. Nhiều phòng/tầng cùng tòa giữ riêng
và có thể chung pin. Tin chỉ có đường, ngoài phạm vi, verified, anchor DB dùng
chung hoặc DB lệch source được bảo vệ.

Pin nhận mới: `method=vietmap_geocode_v4`, `accuracy=approximate`,
`independently_verified=false`; giữ provenance gốc, không tuyên bố GPS/cổng
chính xác hoặc nâng verified. Apply cần backup source và đúng dòng DB sửa,
đồng bộ source/PostGIS cùng phiên bản, đối chiếu giá/phòng/media/IDs/POI.
Sau verify mới báo số tin thực sự được cập nhật và hướng dẫn bàn giao data.
