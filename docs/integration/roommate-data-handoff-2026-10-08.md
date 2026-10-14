# Bàn giao dữ liệu Roommate DEMO — 08/10/2026

> **Cập nhật 11/10:** ZIP tại cùng tên file đã được thay bằng dump Housing mới và
> hai bản JSONL so sánh, giữ nguyên nội dung Roommate DEMO/routing. Các số hash,
> kích thước và snapshot 05/10 bên dưới mô tả gói cũ; khi tải ZIP hiện tại, dùng
> [bàn giao 11/10](housing-geocode-live-and-data-handoff-2026-10-11.md) và checksum
> mới trong `data/project-data-quangdung-20261008.zip.sha256`.

## Phạm vi

- `data/roommate-demo-30.json` được lưu trực tiếp trong Git: 30 hồ sơ tổng hợp (15 nam, 15 nữ; 10 hồ sơ mỗi thành phố Hà Nội, TP.HCM, Đà Nẵng). Hồ sơ có nhãn `DEMO`, không có tài khoản, ảnh, số điện thoại hoặc Zalo; không thể gửi yêu cầu kết nối tới các hồ sơ này.
- `data/project-data-quangdung-20261008.zip` là gói bàn giao mở rộng từ ZIP ngày 05/10. Gói thêm `roommate/roommate-demo-30.json`, `roommate/manifest.json`, `ROOMMATE-ADDENDUM-2026-10-08.md` và `ROOMMATE-SHA256SUMS.txt`. Ba thành phần gốc là dump PostGIS, graph OSRM và checksum gốc không bị sửa.
- **Dump PostGIS trong gói vẫn là snapshot ngày 05/10.** Gói mở rộng này không chứa lô geocode Housing đã áp dụng ngày 08/10. Không dùng dump 05/10 để ghi đè DB mới hơn. Tiến độ lô mới nằm ở [housing-geocode-batch-2026-10-08.md](housing-geocode-batch-2026-10-08.md).

## Lấy code và tệp bàn giao

```powershell
git fetch origin
git switch QuangDung
git pull --ff-only origin QuangDung
Get-FileHash -LiteralPath data/project-data-quangdung-20261008.zip -Algorithm SHA256
```

ZIP lớn không lưu trong Git; đặt ZIP nhận từ nhóm vào `data/` rồi đối chiếu giá trị SHA256 với `data/project-data-quangdung-20261008.zip.sha256`. File JSON 30 hồ sơ nằm trực tiếp trong Git nên không cần giải nén ZIP để mở thử Roommate.

SHA256 ZIP mở rộng: `c9acb8770173f9dbfc03827505f8864f503ec45e262a070ce3a2e2793d97a4e9` (723.501.401 byte, 188 mục). Bốn mục mới có checksum riêng trong `ROOMMATE-SHA256SUMS.txt`; 184 mục gốc vẫn giữ CRC, kích thước và nội dung của ZIP ngày 05/10.

Nếu dựng **máy mới** từ ZIP, `scripts/import-teammate-snapshot.ps1` chỉ trích xuất DB/OSRM và kiểm checksum gốc; các tệp `roommate/` là phần bổ sung độc lập và đã có trong repo. Không import hồ sơ DEMO vào DB hồ sơ người dùng. Ở local/staging, xem [runbook Roommate](../runbooks/roommate.md) để bật chế độ thử nghiệm; trên production đặt `ROOMMATE_DEMO_ENABLED=false`.

## Kiểm tra dữ liệu

- SHA256 của ZIP nền 05/10 trước khi mở rộng: `27d2554170dd26a18029b1aec9f6a906de927e306a9331ec6791ec3a2abe34c5`.
- SHA256 của `roommate-demo-30.json`: `25268f8712cc21ba8d199e1dcb09bf5d3f59ae964f46b0b60dd281804fa75f85`.
- `zipfile.testzip()` và SHA256 từng tệp mới phải pass trước khi chuyển gói. CRC/checksum gốc của PostGIS và OSRM vẫn được kiểm bằng script import hiện có.
