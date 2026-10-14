# Housing: dữ liệu local và ZIP bàn giao — 11/10/2026

## Trạng thái đã kiểm chứng

Người dùng yêu cầu áp dụng ngay kết quả đã tra được và thay dữ liệu cũ trong ZIP
bàn giao. Đã tạo snapshot riêng, inspect, export, dry-run rollback rồi apply/verify
trên **PostGIS local `lifeflow-postgis`, DB `lifeflow`**. Lượt đầu áp phần có sẵn;
quota dùng lại được ngày 11/10, đã tra và áp nốt lượt cuối. Không áp lên cloud.

| Hạng mục | Kết quả |
|---|---:|
| Khóa địa chỉ đã tra theo policy hiện tại | 16.371 / 16.371 |
| Địa chỉ có số nhà đã tra | 8.378 / 8.378 |
| Khóa địa chỉ còn thiếu ở thời điểm đóng gói cuối | 0 |
| Tin trong mỗi file JSONL trước/sau | 38.930 |
| Tọa độ thay đổi so với source đang chạy ngày 08/10 | 2.969 |
| Bản ghi DB cập nhật cộng dồn so với 08/10 | 2.902 |
| Bản ghi partner DB ngoài hai patch, giữ nguyên | 35.320 |
| Giá, units, media, properties, POI và trường nghiệp vụ | Fingerprint không đổi |

67 tin trong patch JSONL không có bản ghi DB tương ứng do lần import trước đã
loại chúng; không tạo lại bản ghi bị loại. Không xóa/gộp phòng theo pin chung.
Các kết quả không đủ bằng chứng giữ **pin hiện hành**, không phục hồi pin raw.
Vị trí cấp đường vẫn gần đúng; chưa có xác minh độc lập từng căn.

Source và export đang dùng cùng SHA256:
`48bac15cfd6a88fbfea792c05491d71fab45eb5bf875d9724cbf50898a437e67`.

Lượt đầu: 2.729 DB / 2.791 source. Lượt cuối sau 335 request mới: 173 DB / 178 source.
Hai tập IDs không trùng nhau; tổng request tính cả pilot là 27.726. Tra hết hàng
đợi không có nghĩa mọi địa chỉ được xác minh: còn các ca không khớp, thiếu địa
chỉ, ngoài scope hoặc xung đột phải giữ pin hiện hành. Không gọi LLM cho geocode.

Đã kiểm qua API đang chạy: 3 tin vừa cập nhật có tọa độ mới khớp giữa detail
và map; frontend `http://127.0.0.1:8503/` trả HTTP 200. Đây là kiểm chứng dữ liệu
Housing, không phải kiểm thử lại toàn bộ nghiệp vụ Flight/Moving/Payment.

## File để gửi bạn bè

**ZIP chung:** `project-data-quangdung-20261008.zip`, không lưu trong Git; nhóm
gửi trực tiếp cho người nhận. Tên file giữ ngày cũ; nội dung là release **11/10/2026**,
thư mục gốc trong ZIP là `project-data-2026-10-11/`.

- 806.587.570 byte, 198 mục.
- SHA256: `0bab81c0b1e27e6fe1dd4c9d910ea238c876a2794dbba48253cb916f182767ab`.
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
DB test bản hoàn tất: `relohandoff_verify_20261011_1791701707`, không thay DB ứng dụng.

Người nhận đặt ZIP nhận từ nhóm vào `data/`, đối chiếu SHA256 với
`data/project-data-quangdung-20261008.zip.sha256` rồi dùng script hiện có:

```powershell
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

- `data/housing-geocode/releases/2026-10-11-complete-live/`: lô cuối đã hoàn tất,
  patch, baseline, dry-run/apply journal, backup source/DB và báo cáo kiểm chứng.
- `data/housing-geocode/releases/2026-10-10-partial-live/`: giữ snapshot lượt đầu
  và gói so sánh một phần cũ để đối chiếu/khôi phục, không phải bản để gửi tiếp.
- `housing-before-apply.jsonl` trong release là bản trước lô này; backup gốc
  và cache/provider response tiếp tục được giữ để resume, không prepare lại.
- ZIP cũ trước khi thay nằm tại
  `data/housing-geocode/releases/legacy-project-data/project-data-quangdung-20261008-before-20261011.zip`.
- Metadata checkpoint cũ được giữ ở
  `data/housing-geocode/releases/2026-10-08-previous-live-metadata/`.

Tất cả khóa đã tra theo policy hiện tại, trạng thái `complete_applied`; vẫn giữ
quota ledger và cache để không tra lại. Không coi bản offline cũ là lookup thật.
ZIP một phần tạo trước trong phiên đã được thay bằng ZIP hoàn tất có SHA256 trên.

Các cập nhật CI của nhóm đến `cdb9b73` đã được đồng bộ. Kiểm thử CI/deployment
native Windows: 42 test và 73 subtest qua, 2 test CI không qua do cách tạo đường
dẫn Windows và Bash mặc định trỏ WSL. Probe dùng đường dẫn POSIX chọn đúng tập
ảnh, gate chạy bằng Git Bash thành công. Không chỉnh CI ngoài phạm vi bàn giao;
không tuyên bố đã kiểm chứng toàn bộ pipeline Linux/cloud trong phiên này.

Khởi động local phát hiện thiếu hai token nội bộ Flight/Payment MCP của code mới.
Chỉ bổ sung token còn thiếu vào `data/integration.env` và nạp lại service local;
không đổi root `.env`, credentials provider hoặc cấu hình cloud. File cấu hình
riêng này không nằm trong gói chia sẻ.
