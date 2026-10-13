# PR135: sửa sau review và tích hợp main

Ngày 13/10/2026. Theo chỉ đạo của người dùng, chỉ hoàn thiện PR135;
không sửa nhánh PR133 và không merge PR128/PR129. Theo dõi tại
[issue #136](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/136).

## Phạm vi sửa

- Tích hợp main `e2f0621` vào Housing. Conflict duy nhất là launcher local:
  nhánh Housing thêm Vietmap vào allowlist cũ, main đã bỏ allowlist.
  Giữ launcher của main nguyên vẹn; Vietmap vẫn được truyền qua env như các
  biến khác. `scripts/local-integration.py`, `src/config.py` và
  `tests/test_local_env.py` không có diff so với main.
- Backup Windows được bảo vệ bằng ACL cho account chạy công cụ và SYSTEM,
  bỏ quyền kế thừa trước khi copy dữ liệu. Nếu thiết lập ACL thất bại, không
  copy database, ảnh hoặc khóa. Linux giữ mode 0700/0600.
- Kiểm tra database/khóa trước khi tạo archive, tránh ghi backup thiếu khóa.
- Test kiểm ACL thật trên NTFS thay vì coi `stat().st_mode` là quyền POSIX;
  thêm các ca lỗi tool, SID không hợp lệ, ACL bị từ chối và thiếu khóa.

## Kiểm chứng local

| Kiểm tra | Kết quả |
| --- | --- |
| Python Housing/Admin/backup + deployment | 70 passed, 62 subtests passed |
| Bản tích hợp Housing + Roommate + deployment | 256 passed, 6 skipped, 62 subtests passed |
| Housing platform unit tests | 9 passed |
| Frontend pure contracts | 42 passed |
| Housing + Roommate browser desktop/mobile | 44 passed |
| TypeScript workspaces + frontend build | passed |
| Ruff hai file Python sửa + diff whitespace | passed |

Browser dùng API fixtures, proxy test trỏ cổng đóng; không gọi backend đang
chạy, không đặt xe/thanh toán và không thay database/config thật. Env tối thiểu
chỉ nằm trong worktree review và được Git ignore. ACL Windows được kiểm bằng
`Get-Acl`, backup/restore dùng SQLite test có WAL và ảnh/khóa giả.

Docker local không khả dụng nên 6 test PostgreSQL tùy chọn không chạy ở máy
này. CI hiện có cấp PostgreSQL test riêng; chỉ merge khi check của đúng commit
mới hoàn tất thành công. Không coi kết quả CI của commit cũ là bằng chứng cho
bản sửa này. Kiểm Vietmap thật và cấp Admin trên cloud vẫn cần operator,
theo [runbook](../runbooks/housing-cloud.md).

Bộ UI tổng quát `app.spec.ts` có các failure từ trước được theo dõi ở issue
136; chưa sửa trong PR này theo thay đổi phạm vi của người dùng. Không báo
toàn bộ suite browser là xanh. Test assertion env Windows của PR133 cũng
để teammate xử lý, không đưa vào lần sửa Housing này.
