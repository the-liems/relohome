# Roommate — đối chiếu main và bàn giao PR (13/10/2026)

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Baseline đã đối chiếu

- `origin/main`: `df4999b7e3c127020ca9a4a373d2da23d74e6f35`, merge PR #127.
- `origin/QuangDung`: `67a55220cb913f85a0779fa33e11c2ea8073a81d`, sửa lỗi #132 của Khoa đã nằm trong PR #127.
- Ba commit Roommate local: `92c5a93` backend/persistence, `8dc6721` UI/gateway, `42e8cbf` cấu hình/bàn giao.
- Merge main vào nhánh làm việc tại `5b29fee`; không xung đột. Cả main và QuangDung remote đã kiểm tra là ancestor của head mới; push thường, không force.

## Sửa đổi của Khoa được giữ nguyên

`Frontend/src/serviceRequest.ts` đọc `intake.intent.domains` đúng shape API, chọn task ID hiện tại hoặc task do người dùng mở; plan inputs thay stale progress, không kéo budget/amenities/city cũ sang yêu cầu mới. `Frontend/src/App.tsx` giữ task ID khi mở form, reset prefill không liên quan và remount form khi đổi task. Draft vẫn được giữ khi submit tạo thread hoặc Agent báo lỗi.

Đã đối chiếu diff và các regression mới, gồm hai tuyến cùng domain, yêu cầu Housing mới có lịch sử cũ, pending task và comparison. Sau merge, hai file này không có diff so với main; PR mới bổ sung Roommate, không viết lại bản fix này.

## Kiểm chứng sau merge

| Gate | Kết quả local |
| --- | --- |
| `npm run build` toàn workspace + asset check | Pass |
| Ruff đúng scope CI | Pass |
| Frontend contracts | 41 pass, gồm regressions scope mới |
| Chrome desktop/mobile: service-input + roommate + roommate-production | 48 pass |
| Chrome → gateway → Roommate API/SQLite | 4 pass: profile lifecycle, consent/revoke, photo review và privacy erase |
| Python toàn repo với test flags, PG test riêng | 870 pass, 96 skip, 16 lỗi Bash/symlink/Linux path trên Windows (gồm subtests); không lỗi nghiệp vụ mới |
| Các nhóm CI script tương ứng trong Linux container | 33 tests +73 subtests pass |

Không xóa/skip assertion để xanh. Test provider/LLM live và giao dịch thật không được suy ra từ fixture tests. PG test ở localhost:15433, không dùng DB live. Log local: `.tmp/roommate-merge-regression-20261013.txt`, `.tmp/roommate-merge-ui-20261013.txt`; artifacts browser trong `Frontend/test-results/roommate-main-merge-20261013`.

## Review và phát hành

- Review correctness/architecture/privacy: consent/scoring/TTL/quota giữ nguyên; schema v2 additive, private role/key, import destination trống, actor-scoped notifications/recovery/privacy và moderator authorization.
- Giữ nguyên `.env`, dữ liệu live, AI-log và báo cáo PR khác chưa được commit. Push hook logging chạy theo cấu hình repository.
- PR mới `QuangDung` → `main`, kèm [bàn giao cloud](roommate-production-2026-10-12.md). Không tự merge PR hoặc deploy cloud.
- Kết quả GitHub CI phải xem trên **head SHA mới của PR**; CI đã xanh của PR #127 không chứng minh PR mới xanh. Theo dõi tất cả required checks, xử lý lỗi nếu phát sinh; kết quả remote được báo trong PR/final response.
