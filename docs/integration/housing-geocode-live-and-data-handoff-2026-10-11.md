# Housing: dữ liệu local và ZIP bàn giao — 11/10/2026

## Trạng thái đã kiểm chứng

Người dùng yêu cầu áp dụng ngay kết quả đã tra được và thay dữ liệu cũ trong ZIP
bàn giao. Đã tạo snapshot riêng, inspect, export một phần, dry-run rollback rồi
apply/verify trên **PostGIS local `lifeflow-postgis`, DB `lifeflow`**. Không áp lên cloud.

| Hạng mục | Kết quả |
|---|---:|
| Khóa địa chỉ đã tra theo policy hiện tại | 16.147 / 16.371 |
| Địa chỉ có số nhà đã tra | 8.378 / 8.378 |
| Khóa cấp đường còn thiếu ở thời điểm đóng gói | 224 |
| Tin trong mỗi file JSONL trước/sau | 38.930 |
| Tọa độ thay đổi so với source đang chạy ngày 08/10 | 2.791 |
| Bản ghi DB cập nhật ở lô này | 2.729 |
| Bản ghi partner DB ngoài patch, giữ nguyên | 35.493 |
| Giá, units, media, properties, POI và trường nghiệp vụ | Fingerprint không đổi |

62 tin trong patch JSONL không có bản ghi DB tương ứng do lần import trước đã
loại chúng; không tạo lại bản ghi bị loại. Không xóa/gộp phòng theo pin chung.
Các kết quả không đủ bằng chứng giữ **pin hiện hành**, không phục hồi pin raw.
Vị trí cấp đường vẫn gần đúng; chưa có xác minh độc lập từng căn.

Source và export đang dùng cùng SHA256:
`e77306ad8342143b6096cf7fd337d41f18734851afe8659fe7842820ebe12fbf`.

Đã kiểm qua API đang chạy: 3 tin vừa cập nhật có tọa độ mới khớp giữa detail
và map; frontend `http://127.0.0.1:8503/` trả HTTP 200. Đây là kiểm chứng dữ liệu
Housing, không phải kiểm thử lại toàn bộ nghiệp vụ Flight/Moving/Payment.

## File để gửi bạn bè

**ZIP chung đã được thay dữ liệu ngay tại tên file hiện có:**
`data/project-data-quangdung-20261008.zip`.
Tên lịch sử giữ nguyên để tương thích Git LFS; nội dung là release **11/10/2026**,
thư mục gốc trong ZIP là `project-data-2026-10-11/`.

- 806.537.804 byte, 198 mục.
- SHA256: `66836180ccefd5cf9d9df48b13b95618bb820f118ba12531f516416486fe1485`.
- Checksum ngoài ZIP: `data/project-data-quangdung-20261008.zip.sha256`.
- `database/lifeflow.dump` thay snapshot 05/10 bằng snapshot đã áp chuẩn hóa,
  có schema/index/read model và migration 019–022; dữ liệu phục vụ của 16 bảng.
- 180 file graph OSRM và dữ liệu Roommate DEMO giữ nguyên nội dung/CRC/kích thước.
- `housing/01-before-standardization.jsonl` và `02-after-standardization.jsonl`
  là hai phiên bản đầy đủ để đối chiếu. Bản trước là trước chuẩn hóa địa chỉ/tọa độ,
  đã có xử lý ingest/phòng ngủ từ trước.
- `housing/review.csv`, manifest, README, UPDATE-DATA và checksum từng file được bổ sung.

Không xuất `.env`, keys/tokens, account/chat/checkpoint, contact requests, dữ liệu
giao dịch Moving/Payment, audit hoặc crawler staging. Schema runtime có thể có
trong dump, nhưng các bảng dữ liệu riêng bị loại khỏi phần data.

Ngoài ZIP chung, gói nhỏ chỉ để so sánh nằm tại:
`data/housing-handoff/current/housing-before-after.zip` (local, không lưu Git).

## Kiểm tra gói và khôi phục

Đã kiểm SHA256 mọi file, CRC toàn ZIP, không có tên entry trùng. Restore dump
vào DB test riêng thành công: số hàng của 16 bảng khớp manifest; các bảng riêng
được kiểm đều rỗng; `geo.normalize_search` hoạt động với search_path cố định.
DB test: `relohandoff_verify_20261011_1791700130`, không thay DB ứng dụng.

Người nhận lấy file bằng Git LFS, kiểm checksum rồi dùng script hiện có:

```powershell
git lfs pull
Get-FileHash -LiteralPath data/project-data-quangdung-20261008.zip -Algorithm SHA256
powershell -File scripts/import-teammate-snapshot.ps1 -ArchivePath data/project-data-quangdung-20261008.zip
```

Script import kiểm dump/graph/migrations và không ghi đè thư mục đích. Đọc README
trong ZIP để dựng DB **mới**, ANALYZE, migration/grants và khởi động service.
Hai JSONL so sánh được giải nén riêng nếu cần xem; không ingest lại nguồn tọa độ
cũ lên DB đã restore. Khi cần source, dùng bản sau cho
`Maps VN/Data/housing_clean_2026-09-26.jsonl`.

Cloud/máy đã có người dùng hoặc nhà do chủ trọ đăng cần patch với baseline của
DB đích; không restore dump local đè dữ liệu đang hoạt động.

## Backup và tiến độ nội bộ

Các đường dẫn sau là local/ignored, không nằm trong ZIP chia sẻ:

- `data/housing-geocode/releases/2026-10-10-partial-live/`: snapshot bằng chứng,
  patch, baseline, dry-run/apply journal, backup source/DB và báo cáo kiểm chứng.
- `housing-before-apply.jsonl` trong release là bản trước lô này; backup gốc
  và cache/provider response tiếp tục được giữ để resume, không prepare lại.
- ZIP cũ trước khi thay nằm tại
  `data/housing-geocode/releases/legacy-project-data/project-data-quangdung-20261008-before-20261011.zip`.
- Metadata checkpoint cũ được giữ ở
  `data/housing-geocode/releases/2026-10-08-previous-live-metadata/`.

Giữ nguyên 224 khóa thiếu và quota ledger; không coi bản offline
`preserve_street_only` là đã tra provider. Đợt này là **áp dụng một phần có kiểm chứng**.
Kết quả tra tiếp sau thời điểm đóng gói không tự thay DB hoặc ZIP đã bàn giao.

Khởi động local phát hiện thiếu hai token nội bộ Flight/Payment MCP của code mới.
Chỉ bổ sung token còn thiếu vào `data/integration.env` và nạp lại service local;
không đổi root `.env`, credentials provider hoặc cấu hình cloud. File cấu hình
riêng này không nằm trong gói chia sẻ.
