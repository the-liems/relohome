# Housing geocode — lô 2026-10-08

## Kết quả đã áp dụng

Tiếp tục từ cache và input gốc bất biến trong `data/housing-geocode/`. Chạy ưu tiên các **địa chỉ khác nhau đang dùng chung tọa độ** bằng ba biến key VIETMAP trong `.env`, tốc độ tổng 120 request/phút. Mỗi key lần lượt nhận HTTP 429 ở Search sau khoảng 1.500 lượt Search; không ghi giá trị key vào tài liệu hoặc log. Job đã dừng và lô đủ điều kiện đã được áp dụng vào JSONL canonical `Maps VN/Data/housing_clean_2026-09-26.jsonl` cùng PostGIS.

| Chỉ số | Kết quả |
| --- | ---: |
| Tin nguồn được giữ | 38.930 |
| Khóa số nhà đã có quyết định | 6.652 / 8.378 |
| Khóa số nhà còn chờ API trong toàn nguồn | 1.726 |
| Khóa còn chờ trong các cụm xung đột pin hiện tại | 940: 362 số nhà, 578 cấp đường |
| Tin đổi tọa độ thêm trong JSONL lô này | 4.381 |
| Anchor PostGIS cập nhật và khớp JSONL | 4.286 |
| Dòng DB ngoài target không đổi | 33.936 |
| Tin đã đổi tọa độ so với input gốc qua các lô | 13.215 |

So với trước lô này, số nhóm **địa chỉ khác nhau cùng một pin** giảm từ 2.363 xuống 1.987; số tin trong các nhóm ấy giảm từ 20.249 xuống 15.920. Tổng tin chia sẻ pin giảm từ 33.308 xuống 32.509. Số nhóm cùng địa chỉ cấp đường chưa có số nhà tăng từ 1.481 lên 1.973 vì có thêm vị trí gần đúng theo đường; đây không phải tọa độ căn cụ thể. Các căn cùng tòa/địa chỉ có thể chia sẻ pin hợp lệ. Không rải pin ngẫu nhiên và không gộp/xóa record để làm số liệu trông đẹp hơn.

Pin mới mang `accuracy=approximate`, `independently_verified=false`. Search/Place chỉ giúp định vị địa chỉ; không xác minh căn, trạng thái còn trống hay GPS tại cửa. Trường hợp không khớp số nhà, đường, tòa hoặc dịch chuyển quá xa vẫn giữ tọa độ cũ và lý do trong candidate report.

## Kiểm tra và phục hồi

- `tests/test_housing_geocode.py`: 33/33 bài đạt.
- `housing-geocode-apply.py inspect` đối chiếu DB và source trước ghi; `dry-run` chạy transaction rồi rollback thành công với 4.286 target.
- `housing-geocode-apply.py verify` sau apply: 4.286 target khớp JSONL; 33.936 dòng DB khác không đổi; trường giá, phòng, media, POI và nghiệp vụ giữ nguyên.
- SHA256 source trước lô: `5297deae39607430f42231473b87f243b330076133f72f0dcca5295187f14f5b`; sau lô: `6fc554d73432188196cf61c953e1bfb4e07376a542d3270b5766d6e75d764db3`.
- `data/housing-geocode/housing-before-apply.jsonl`, `db-touched-original.json` và `apply-journal.json` là backup/journal của lô. Không dùng các file này thay cho runtime data.

## Tiếp tục khi quota Search mở lại

Không chạy `prepare` lại; không xóa cache hay input gốc. Đặt key trong `.env`, không đưa key vào lệnh hoặc commit. Chạy tuần tự, với PostGIS hoạt động trước bước `inspect`:

```powershell
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py run --shared-pins-only --rpm 120 --workers 8
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py cache-only --shared-pins-only
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py inspect
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py export --allow-partial
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py dry-run
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py apply
.\.venv\Scripts\python.exe scripts/housing-geocode-apply.py verify
.\.venv\Scripts\python.exe scripts/housing-geocode-full.py audit-shared-pins
```

Xem `data/housing-geocode/checkpoint.json`, `full-run.json`, `full-verification.json` và `shared-pin-audit.json` để kiểm tra tiến độ mới nhất. Dataset/cache thuộc môi trường local và không được Git theo dõi; khi bàn giao cho máy khác, cần gửi JSONL canonical và snapshot PostGIS cùng phiên bản hoặc nhập lại JSONL theo quy trình ingest hiện có.
