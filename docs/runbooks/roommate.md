# Roommate backend — Runbook

## Trạng thái

Backend/API/Agent đã triển khai; giao diện Roommate chưa có. `ROOMMATE_ENABLED=false` mặc định. Chỉ bật môi trường thử riêng với tài khoản/dữ liệu được đồng ý; production cần gates G7–G9 và review chủ sản phẩm.

## Cấu hình

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

Chưa tạo background daemon/scheduler/email/push. Inbox trả trạng thái và nhắc xác nhận lại trong ba ngày cuối; frontend chưa hiển thị.

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
