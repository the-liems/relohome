# Roommate backend — Runbook

## Trạng thái

**Nâng cấp 12/10/2026:** xem [bàn giao production](../integration/roommate-production-2026-10-12.md) về inbox/media/moderation/privacy, SQLite schema v2, PostgreSQL tùy chọn trên cluster hiện có, backup/cutover/rollback và gates local/cloud. Các mốc dưới đây ghi lại cấu hình và evidence trước nâng cấp; không dùng chúng để kết luận bản mới đã deploy cloud. Thuật toán và consent policy giữ nguyên.

Backend/API/Agent và frontend các màn tìm/kết nối/hồ sơ cơ bản đã triển khai; xem [frontend handoff](../../Frontend/ROOMMATE_UI_HANDOFF.md) về phạm vi và tests. `ROOMMATE_ENABLED=false` mặc định. Chỉ bật môi trường thử riêng với tài khoản/dữ liệu được đồng ý; production cần gates G7–G9 và review chủ sản phẩm.

**Cập nhật local 08/10/2026:** `scripts/local-integration.py api|ui` (và `scripts/start-local-mvp.ps1`) tự đặt `ROOMMATE_ENABLED=true` khi môi trường không phải production và chưa cấu hình cờ. Đặt `ROOMMATE_ENABLED=false` trong cấu hình local để tắt lại. Launcher dùng ID moderator bootstrap dành riêng `local-roommate-moderator` khi chưa cấu hình danh sách; không tự cấp quyền cho tài khoản hiện có. Runtime vẫn yêu cầu gateway token, dùng DB/khóa private thật và giữ nguyên kiểm tra tuổi, điều khoản, quyền truy cập. Cần cấu hình ID moderator thật để sử dụng moderation. Khởi động bằng uvicorn trực tiếp không dùng mặc định local của launcher; production vẫn mặc định tắt.

**Local ngày 07/10/2026:** chủ sản phẩm đã yêu cầu bật để sử dụng. `.env` local hiện có `ROOMMATE_ENABLED=true`, state `logs/private-roommate`; API đã restart và chat nhận intent ở ghép. Moderator bootstrap dùng ID dành riêng `local-roommate-moderator`, chưa gán quyền cho tài khoản hiện có; cần cấu hình ID moderator thật khi triển khai vận hành. Không tự khai tuổi/accept terms/đăng hồ sơ cho người dùng. Entry ở màn `/ai` mở `/roommate`.

## Cấu hình

### Bộ hồ sơ thử nghiệm

`data/roommate-demo-30.json` chứa 30 hồ sơ tổng hợp có nhãn `DEMO`, chia đều Hà Nội, TP.HCM, Đà Nẵng và 15 nam/15 nữ. Không có tài khoản, ảnh cá nhân, số điện thoại hay Zalo. Liên kết tới tin Housing thật chỉ để thử bản đồ, không thể suy ra người DEMO đang ở phòng đó. Dữ liệu này không đi vào danh sách hồ sơ thật hoặc luồng gửi yêu cầu kết nối.

Ở local/staging, đặt `ROOMMATE_DEMO_ENABLED=true` và `ROOMMATE_DEMO_DATASET=data/roommate-demo-30.json`, rồi khởi động lại API; mở `/roommate?tab=demo` để xem. Docker image hiện bỏ qua `data/`, nên staging bằng container phải mount tệp này tại đúng đường dẫn. Trong production đặt `ROOMMATE_DEMO_ENABLED=false` và không dùng bộ dữ liệu này; không sao chép `.env` local đang bật DEMO vào cấu hình cloud. Runtime sẽ từ chối bật DEMO khi `APP_ENV=production`.

File được tạo bằng `scripts/generate-roommate-demo.py --count 30 --valid-days 1095 --output data/roommate-demo-30.json`. Script từ chối ghi đè; khi cần làm mới, tạo tên file mới rồi đổi cấu hình sau khi kiểm tra. Thời hạn dài chỉ áp dụng cho dữ liệu thử nghiệm, không thay đổi quy tắc 30 ngày của hồ sơ thật.

| Biến | Yêu cầu |
| --- | --- |
| `ROOMMATE_ENABLED` | `false` mặc định; `true` mới khởi tạo DB/khóa. |
| `ROOMMATE_STATE_DIR` | Mặc định `logs/private-roommate`; thư mục private của service account. Runtime từ chối dưới `data/` và `Frontend/public/`. |
| `ROOMMATE_MODERATORS` | Account IDs do operator chọn, phân tách dấu phẩy; bắt buộc khi enabled. Không nhận role từ request/browser. |
| `ROOMMATE_AREA_CATALOG` | Tùy chọn: JSON object canonical area ID → `hcm`/`hanoi`/`danang` được export từ Location. Không có file thì chỉ whole-city IDs. Không ghi giá trị rỗng vào env cho Path tùy chọn; bỏ biến khi chưa dùng. |
| `AGENT_API_TOKEN` | Secret chung API/gateway đã có, bắt buộc khi enabled. Chỉ server giữ. |
| `LIFEFLOW_API_BASE_URL` | Gateway mặc định `http://127.0.0.1:8000/api/v1`. |

Không đổi `.env` hoặc secrets thật để chạy tests. Không thêm token vào `VITE_*`, JavaScript, URL hay logs.

Cài dependency bằng `requirements.txt` trong virtualenv project; Roommate thêm Pillow cho decode/sanitize ảnh. Module này không cần Docker. Khởi động application vẫn dùng provider/settings của project hiện tại:

```powershell
.venv/Scripts/python.exe -m uvicorn src.main:app --host 127.0.0.1 --port 8000
# Một terminal khác, cùng cấu hình server/token:
.venv/Scripts/python.exe -m uvicorn Frontend.server:app --host 127.0.0.1 --port 8503
```

Không thay `AGENT_SUBAGENTS` của môi trường thật chỉ để bật Roommate; app production hiện yêu cầu live mode. Kiểm tra `/health`, sau đó `/web/api/roommate/availability`. Availability công khai không chứa người thật. Route riêng qua `/web/api/roommate/*` cần cookie đăng nhập; mutations dùng `X-SIU-Request: 1` và same-origin hiện có. Không cho browser tự gắn `X-User-Id` vào API upstream.

## State, backup và restore

Thư mục state gồm `roommate.sqlite3`, SQLite WAL/SHM khi chạy và `contact.key` (Fernet). Media private nằm trong DB. Runtime không tự sinh khóa thay thế khi DB có sẵn mà mất key.

- Linux: thư mục chỉ service account truy cập, backup có quyền tương tự. Windows: cấu hình NTFS ACL cho service account/operator; `chmod 0600` trong code không đủ chứng minh ACL Windows riêng tư.
- Sao lưu khi đóng API/maintenance, hoặc dùng SQLite `Connection.backup()` để tạo snapshot nhất quán. Không chỉ copy `.sqlite3` đang chạy WAL.
- Giữ **snapshot DB và đúng `contact.key` cùng phiên bản** trong kho backup mã hóa có kiểm soát quyền. Không in khóa/contact hoặc đưa vào zip cloud data phục vụ map.
- Restore vào thư mục private mới, khôi phục DB/key, chạy integrity/FK checks và smoke bằng tài khoản test được phép. Chỉ đổi `ROOMMATE_STATE_DIR` sau xác nhận; giữ bản cũ để rollback. Restart không tự gia hạn profile/pending/grant.
- Không cố decrypt bằng khóa mới nếu mất key. Khôi phục khóa đúng từ backup; nếu không có phải xử lý incident/mất dữ liệu liên hệ trước bật lại.

`tests/test_roommate/test_operational_integrity.py` kiểm chứng backup/restore thật, quyền consent và operation retry còn giữ nguyên sau restore.

## Maintenance và moderation

Read-time luôn kiểm tra deadline/quyền; maintenance cập nhật trạng thái expired và cooldown vật lý, không quyết định mở contact. Có thể gọi `maintenance.reconcile(ctx)` định kỳ từ process nội bộ:

```powershell
@'
from src.config import get_settings
from src.roommate.runtime import RoommateRuntime
from src.roommate.maintenance import reconcile
runtime = RoommateRuntime.open(get_settings())
if runtime is not None:
    try:
        with runtime.context() as ctx, ctx.transaction():
            reconcile(ctx)
    finally:
        runtime.close()
'@ | .venv/Scripts/python.exe -
```

Chưa tạo background daemon/scheduler/email/push. Inbox trả trạng thái và nhắc xác nhận lại trong ba ngày cuối; frontend đã có trạng thái/deadline, nhắc ba ngày cuối còn trong checklist phát hành đầy đủ.

Moderators dùng routes `/web/api/roommate/moderation/*` qua session của account allowlisted. Report không tự block/restrict. Review ảnh trước approve; reject xóa ảnh gắn public; restrict/revoke có audit. Restore profile trở về paused, không tự mở lại consent. Moderator UI ở phase frontend.

## Lỗi/timeout/rollback

- Lỗi private trả `detail.code`, có `retry_at` nếu cooldown/quota. Không log body/contact/token.
- Write timeout qua gateway trả `operation_unknown`. Tra `/web/api/roommate/operations/{operation_key}`; nếu retry dùng cùng key và cùng payload. Không tự tạo key mới để tránh trùng thao tác.
- Version conflict: tải dữ liệu hiện tại và review lại, không ghi đè phiên bản.
- Tắt feature bằng `ROOMMATE_ENABLED=false` rồi restart. Không drop DB hoặc xóa khóa. Existing Housing/Moving/Flight vẫn dùng contract cũ.
- Không dùng nhiều replicas với file DB riêng: pair/quota/consent cần cùng DB và transaction.

## Kiểm thử

```powershell
$env:LANGCHAIN_TRACING_V2='false'
$env:LANGSMITH_TRACING='false'
$env:LANGCHAIN_TRACING='false'
$roommateTemp=Join-Path (Get-Location).Path ('logs/local/rmcheck-'+[guid]::NewGuid().ToString('N'))
.venv/Scripts/python.exe -m pytest tests/test_roommate tests/test_agents/test_roommate_capability.py tests/test_agents/test_roommate_subagent.py tests/test_agents/test_roommate_intake.py tests/test_agents/test_roommate_graph.py tests/test_agents/test_roommate_privacy.py Frontend/tests/test_roommate_gateway.py Frontend/tests/test_roommate_full_stack.py -q --basetemp $roommateTemp
```

Các test dùng dữ liệu giả trong DB tạm, không đặt xe/thanh toán/gửi contact thật. Kết quả và baseline errors xem [backend checkpoint](../integration/roommate-backend-checkpoint.md).
