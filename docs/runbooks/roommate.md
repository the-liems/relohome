# Roommate backend — Runbook

## Trạng thái

**Admin và ảnh — 17/10/2026:** bản nâng cấp local có hai hàng đợi Hồ sơ/Báo cáo,
tìm kiếm/lọc phía server, drawer và lịch sử xử lý. Đã bỏ upload/gắn avatar/duyệt
ảnh Roommate ở user, Admin, gateway và API. Ảnh cũ vẫn đọc qua private API hoặc
được chủ sở hữu xóa; không xóa dữ liệu cũ. Không thêm env/migration. Xem
[bàn giao](../integration/roommate-admin-redesign-2026-10-17.md); chưa xác minh cloud.

**Nâng cấp 12/10/2026:** xem [bàn giao production](../integration/roommate-production-2026-10-12.md) về inbox/media/moderation/privacy, SQLite schema v2, PostgreSQL tùy chọn trên cluster hiện có, backup/cutover/rollback và gates local/cloud. Các mốc dưới đây ghi lại cấu hình và evidence trước nâng cấp; không dùng chúng để kết luận bản mới đã deploy cloud. Thuật toán và consent policy giữ nguyên.

Backend/API/Agent và frontend các màn tìm/kết nối/hồ sơ cơ bản đã triển khai; xem [frontend handoff](../../apps/web/ROOMMATE_UI_HANDOFF.md) về phạm vi và tests. `ROOMMATE_ENABLED=false` mặc định. Chỉ bật môi trường thử riêng với tài khoản/dữ liệu được đồng ý; production cần gates G7–G9 và review chủ sản phẩm.

**Cập nhật local 08/10/2026:** `scripts/local-integration.py api|ui` (và `scripts/start-local-mvp.ps1`) tự đặt `ROOMMATE_ENABLED=true` khi môi trường không phải production và chưa cấu hình cờ. Đặt `ROOMMATE_ENABLED=false` trong cấu hình local để tắt lại. Launcher dùng ID moderator bootstrap dành riêng `local-roommate-moderator` khi chưa cấu hình danh sách; không tự cấp quyền cho tài khoản hiện có. Runtime vẫn yêu cầu gateway token, dùng DB/khóa private thật và giữ nguyên kiểm tra tuổi, điều khoản, quyền truy cập. Cần cấu hình ID moderator thật để sử dụng moderation. Khởi động bằng uvicorn trực tiếp không dùng mặc định local của launcher; production vẫn mặc định tắt.

**Local ngày 07/10/2026:** chủ sản phẩm đã yêu cầu bật để sử dụng. `.env` local hiện có `ROOMMATE_ENABLED=true`, state `logs/private-roommate`; API đã restart và chat nhận intent ở ghép. Moderator bootstrap dùng ID dành riêng `local-roommate-moderator`, chưa gán quyền cho tài khoản hiện có; cần cấu hình ID moderator thật khi triển khai vận hành. Không tự khai tuổi/accept terms/đăng hồ sơ cho người dùng. Entry ở màn `/ai` mở `/roommate`.

## Cấu hình

### Hồ sơ do người dùng đăng — cập nhật 17/10/2026

Roommate chỉ hiển thị hồ sơ do tài khoản người dùng chủ động đăng. Team tự tạo tài khoản,
khai thông tin, đăng hồ sơ rồi gửi/nhận yêu cầu kết nối và chat theo luồng hiện có.
Không tự cấp consent, đăng bài hoặc tạo hồ sơ thay người dùng. Khi chưa có bài phù hợp,
giao diện hiển thị danh sách trống và nút **Đăng nhu cầu của tôi**.

Tab/nút/checkbox DEMO và endpoint `POST /roommate/demo/search` đã bị bỏ.
`ROOMMATE_DEMO_ENABLED` và `ROOMMATE_DEMO_DATASET` không còn được runtime đọc;
operator có thể xóa chúng nếu cấu hình cũ còn giữ. Không cần thêm biến thay thế.
`demo_enabled:false` và input `include_demo` được giữ tương thích cho client cũ;
input này không thể bật dữ liệu giả. Link cũ `/roommate?tab=demo` mở luồng thường.

Dataset/script sinh dữ liệu tổng hợp chỉ còn phục vụ kiểm thử offline, không được nạp
vào runtime hay DB thật. Không cần xóa DB, file dữ liệu hoặc tạo lại contact key.
Bản đồ chỉ hiện hồ sơ công khai còn hiệu lực và đã đồng ý công khai liên kết phòng;
kiểm tra quyền, tuổi/điều khoản, block và moderation giữ nguyên.

| Biến | Yêu cầu |
| --- | --- |
| `ROOMMATE_ENABLED` | `false` mặc định; `true` mới khởi tạo DB/khóa. |
| `ROOMMATE_STATE_DIR` | Mặc định `logs/private-roommate`; thư mục private của service account. Runtime từ chối dưới `data/`, `Frontend/public/`, `apps/web/public/` và `apps/web/dist/`. |
| `HOUSING_MODERATOR_IDS` | Dùng lại account IDs của Admin duyệt nhà, phân tách dấu phẩy. Compose truyền cùng biến này cho platform và backend. Không dùng email hoặc role từ browser. |
| `ROOMMATE_MODERATORS` | Tùy chọn: thêm account IDs chỉ quản lý Roommate, giữ tương thích cấu hình cũ. Để trống nếu đã có Housing Admin; khi enabled cần ít nhất một ID trong hợp hai danh sách. |
| `ROOMMATE_AREA_CATALOG` | Tùy chọn: JSON object canonical area ID → `hcm`/`hanoi`/`danang` được export từ Location. Không có file thì chỉ whole-city IDs. Không ghi giá trị rỗng vào env cho Path tùy chọn; bỏ biến khi chưa dùng. |
| `AGENT_API_TOKEN` | Secret chung API/gateway đã có, bắt buộc khi enabled. Chỉ server giữ. |
| `LIFEFLOW_API_BASE_URL` | Gateway mặc định `http://127.0.0.1:8000/api/v1`. |

Không đổi `.env` hoặc secrets thật để chạy tests. Không thêm token vào `VITE_*`, JavaScript, URL hay logs.

Cài dependency bằng `requirements.txt` trong virtualenv project; Roommate thêm Pillow cho decode/sanitize ảnh. Module này không cần Docker. Khởi động application vẫn dùng provider/settings của project hiện tại:

```powershell
.venv/Scripts/python.exe -m uvicorn relohome_agent.main:app --host 127.0.0.1 --port 8000
# Một terminal khác, cùng cấu hình server/token:
npm run dev:gateway
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
from relohome_agent.config import get_settings
from relohome_agent.roommate_runtime import RoommateRuntime
from relohome_roommate.maintenance import reconcile
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

### Dùng Admin hiện có — cập nhật 17/10/2026

Đăng nhập bằng **Đăng nhập Admin**, mở `/admin` → **Ở ghép** (hoặc
`/admin?tab=roommate`). Tái sử dụng các công cụ Roommate hiện có: danh sách báo cáo,
chi tiết/lịch sử hồ sơ và hạn chế/khôi phục quyền sử dụng. Các tab duyệt nhà/người đăng/đánh
giá vẫn dùng API và kiểm tra quyền Housing cũ.

Backend nhận cùng `HOUSING_MODERATOR_IDS` đã cấp quyền Admin cho platform. **Không
cần thêm `ROOMMATE_MODERATORS`** nếu danh sách Housing đã đúng. Sau thay đổi này phải
build/deploy cả web và backend với Compose mới; phiên bản backend cũ vẫn chỉ đọc danh
sách Roommate riêng. Nếu deploy các service bằng resource tách rời ngoài Compose,
truyền cùng giá trị `HOUSING_MODERATOR_IDS` hiện có sang backend, không tạo danh sách
quyền thứ hai. `ROOMMATE_ENABLED=true`, token, DB/private volume và contact key giữ
cấu hình hiện tại. Không cần migration hoặc tạo lại DB/key.

Admin không phải tạo hồ sơ ở ghép hoặc tự nhận đã đủ tuổi/đồng ý điều khoản cá nhân
để kiểm duyệt. Điều này không tự mở quyền tìm người, đăng hồ sơ, gửi yêu cầu hay đọc
tin nhắn của người khác. API vẫn xác thực bearer từ gateway và account ID trong
danh sách server; không tin `is_admin` hoặc role do browser gửi.

Các thao tác hạn chế hồ sơ giữ operation key để tránh làm lặp khi retry; Admin chỉ
đọc/khôi phục draft và kết quả thao tác của chính mình. Draft cho hành động cá nhân
vẫn yêu cầu điều kiện sử dụng Roommate như cũ. `ROOMMATE_MODERATORS` riêng vẫn hỗ trợ
công cụ `/roommate/moderation` nếu chưa chuyển sang Admin Housing.

Moderators dùng routes `/web/api/roommate/moderation/*` qua session của account
allowlisted. Report không tự block/restrict; đánh dấu đã xem xét là thao tác
riêng với hạn chế tài khoản. Upload/duyệt ảnh đã đóng; audit ảnh cũ vẫn được giữ.
Restrict/revoke có audit. Khôi phục hồ sơ trả về **tạm dừng**, không
tự đăng lại hoặc mở lại consent.

Smoke test sau deploy:

1. `/web/api/roommate/availability` trả `enabled:true`; đăng nhập Admin đang duyệt nhà.
2. Tab **Ở ghép** mở báo cáo/hồ sơ; `/access` có `moderator:true` kể cả `eligible:false`.
3. Lọc/xem chi tiết hồ sơ, xử lý báo cáo, hạn chế rồi khôi phục tài khoản test được phép;
   kiểm tra lịch sử. User/Admin không còn uploader hoặc hàng đợi ảnh.
4. Người dùng thường không gọi được `/moderation/*` (403); tab duyệt nhà vẫn hoạt động.
5. Nếu startup vẫn báo thiếu moderator, kiểm tra env **hiệu lực trong backend**, không
   chỉ env platform hay file `.env` local. Không gửi token/key khi chụp cấu hình.

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
.venv/Scripts/python.exe -m pytest tests/test_roommate tests/test_agents/test_roommate_capability.py tests/test_agents/test_roommate_subagent.py tests/test_agents/test_roommate_intake.py tests/test_agents/test_roommate_graph.py tests/test_agents/test_roommate_privacy.py apps/browser-gateway/tests/test_roommate_gateway.py tests/browser_gateway/test_roommate_full_stack.py -q --basetemp $roommateTemp
```

Các test dùng dữ liệu giả trong DB tạm, không đặt xe/thanh toán/gửi contact thật. Kết quả và baseline errors xem [backend checkpoint](../integration/roommate-backend-checkpoint.md).
