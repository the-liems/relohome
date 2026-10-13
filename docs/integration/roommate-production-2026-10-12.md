# Roommate — bàn giao nâng cấp vận hành và trải nghiệm

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Ngày bắt đầu: 12/10/2026. Phạm vi: mở rộng Roommate hiện có; chuẩn bị triển khai cloud, chưa triển khai vào cloud hoặc chuyển dữ liệu live trong đợt này.

## 1. Người dùng nhận được gì?

| Màn hình | Nâng cấp |
| --- | --- |
| Tìm người / Đã lưu | Giữ bộ lọc, lý do phù hợp và điểm do backend tính. Danh sách thông thường; người dùng tự chọn đọc hồ sơ và gửi giới thiệu. |
| Yêu cầu kết nối | Tên/ảnh đối phương, giới thiệu ngắn khi có quyền đọc, chưa đọc, trạng thái, phân trang và nhắc xác nhận còn tìm. Hồ sơ bị chặn/hạn chế/xóa không được tiết lộ qua preview. |
| Thông báo | Thông báo riêng về yêu cầu mới, phản hồi và quyền liên hệ hết hạn/thu hồi. Cập nhật khi cửa sổ hoạt động, không cần chat với AI để kiểm tra. |
| Hồ sơ của tôi | Upload JPEG/PNG, xem ảnh chờ duyệt/đã duyệt/bị từ chối, chọn ảnh đại diện đã duyệt, xóa ảnh. Upload không tự công khai hồ sơ. |
| Có phòng muốn tìm người ở cùng | Tìm và chọn tin Housing có sẵn bằng phạm vi thành phố trên bản đồ và từ khóa; vẫn cần consent địa điểm. Có nhập mã tin nếu đã biết. Liên kết chưa xác minh quyền sở hữu/quyền ở. |
| Cài đặt | Quản lý kênh liên hệ riêng, xóa kênh, danh sách chặn/bỏ chặn, tải thông tin của mình và xóa nội dung riêng Roommate. |
| Mất mạng / reload | Draft xác nhận được mã hóa phía server trong 30 phút. Người dùng kiểm tra rồi chủ động thử lại cùng payload/key; không tự gửi lại, không lưu contact/intro trong browser storage. |
| Quản lý cộng đồng | Route `/roommate/moderation`: số liệu thật trong DB, hàng đợi báo cáo/ảnh/hồ sơ, lọc/phân trang, xử lý báo cáo, hạn chế/khôi phục tài khoản và lý do xử lý. Backend kiểm tra moderator. |

### Tham khảo sản phẩm và quyết định giao diện

- [SpareRoom — Who’s interested](https://www.spareroom.com/content/info-faq/whos-interested-explained): phân biệt lưu quan tâm và hành động liên hệ. ReloHome giữ bookmark riêng, không báo đối phương chỉ vì người dùng lưu hồ sơ.
- [Badi — chat requests](https://badiapp.zendesk.com/hc/en-gb/articles/12134918502684-Chat-requests-and-contacting-listers): dùng giới thiệu, hộp thư và trạng thái accept/decline rõ ràng. ReloHome vẫn dùng consent hai chiều và kênh liên hệ hiện có.
- [Roomies](https://www.roomies.com/about): tham khảo cách giới thiệu hồ sơ và thông tin tin cậy. ReloHome chưa có xác minh danh tính/điện thoại, nên không thêm huy hiệu “đã xác minh”.

Design contract: một màn có một công việc chính; bộ lọc nằm cạnh danh sách trên desktop và xếp dọc trên mobile; màu xanh/tokens ReloHome; nhãn trạng thái bằng chữ; chi tiết ít dùng nằm trong disclosure. Không dùng swipe, like để ghép tự động, boost hay thuật toán học hành vi. Đây là điều chỉnh cho ReloHome, không sao chép branding/layout/ảnh của các trang tham khảo. Tài liệu tham khảo đã đọc; evidence giao diện ReloHome là kiểm thử/screenshot local.

## 2. Những quy tắc được giữ nguyên

- Hard filter hai chiều, scoring xác định bằng code, cách xử lý thông tin thiếu và điều kiện hiển thị điểm không thay đổi. Không gọi LLM để tính/ghép.
- Hồ sơ 30 ngày; request 7 ngày; quyền liên hệ 7 ngày; cooldown, 10 yêu cầu mới/24 giờ và 20 pending giữ nguyên.
- Không bắt đăng công khai để gửi giới thiệu riêng. Đăng/resume/reconfirm vẫn cần người dùng xem lại và xác nhận.
- Contact chỉ mở theo consent và phiên bản kênh liên hệ; block, thay kênh, hết hạn và hạn chế vẫn đóng quyền theo logic cũ.
- Xóa dữ liệu riêng không xóa quota, restriction hoặc lịch sử xử lý để tránh vượt giới hạn bằng cách xóa rồi tạo lại.
- Chat/Map/Agent và dịch vụ Housing/Flight/Moving/Payment giữ luồng hiện có. Không thay cấu hình giao dịch thật/sandbox của các dịch vụ khác.

## 3. Kiến trúc và dữ liệu

Browser → gateway session `/web/api/roommate/*` → API `/api/v1/roommate/*` → các service/repository Roommate hiện có.

Gateway lấy actor từ cookie đăng nhập, không tin `X-User-Id`/role client; token upstream chỉ ở server. JSON giới hạn 64 KiB; ảnh tối đa 5 MiB, 16 triệu pixel, JPEG/PNG một frame, sanitize thành PNG ≤1024px và bỏ metadata. Dữ liệu private dùng no-store. Log mới chỉ route template, HTTP status, latency; không body/contact/intro/DSN.

### Schema v2

Migration additive 1 → 2 trong transaction; giữ ID, version, deadline, nội dung và ciphertext cũ. Thêm index discovery/expiry/room/map/queues và bảng `notifications`, `operation_times`, `rate_buckets`, `operation_drafts`, `private_metadata`. Draft dùng cùng vault Fernet; fingerprint key giúp phát hiện cấu hình khóa sai. Startup từ chối schema tương lai và khóa không khớp.

### Lựa chọn storage

| Chế độ | Khi dùng | Điều kiện |
| --- | --- | --- |
| SQLite, mặc định | Một host có persistent disk, lượng ghi vừa phải | DB/WAL/key nằm cùng private volume; không dùng network filesystem cho WAL. Read snapshot không lấy domain writer lock; mutation vẫn serialize. |
| PostgreSQL, tùy chọn | Cần Roommate state chung giữa các API process/replica | Dùng cluster PostgreSQL hiện có, schema/role riêng. Pool hữu hạn, timeout, atomic mutation và advisory lock giữ chính sách serialized writer. Read dùng MVCC. |

Chọn PostgreSQL để vận hành Roommate nhiều process; không thêm database server/microservice mới. Adapter SQL chỉ xử lý dialect tại boundary, tái sử dụng service/domain/repository cũ. Tham khảo [SQLite WAL](https://www.sqlite.org/wal.html), [PostgreSQL locks](https://www.postgresql.org/docs/current/explicit-locking.html), [Psycopg pools](https://www.psycopg.org/psycopg3/docs/advanced/pool.html).

**Giới hạn toàn hệ thống:** nâng Roommate sang PostgreSQL không tự chuyển `Frontend/store.py`, session, chat/checkpoint hoặc checkout sang persistence dùng chung. Chưa được suy ra toàn bộ ReloHome đã hỗ trợ nhiều web host/HA. Roommate mutations vẫn serialize; không tuyên bố throughput/load cloud đã được đo.

### API bổ sung, tương thích

- Availability thêm `features`; UI mới chỉ dùng capability đã bật, contract cũ giữ.
- Inbox GET nhận thêm `offset`, `limit` (1–50), `direction`; không truyền pagination vẫn giữ cách gọi cũ. Items bổ sung counterparty/preview/unread; danh sách không trả contact.
- GET `notifications`, POST `notifications/read`, POST `requests/{id}/read`.
- GET `me/media`; GET moderation queues có pagination/status; GET `moderation/summary`. CRUD ảnh/duyệt/bảo vệ ảnh tái sử dụng API cũ.
- GET `me/privacy` chỉ version, GET `me/privacy/export`, POST `me/privacy/erase` với xác nhận/version. Owner vẫn có quyền quản lý dữ liệu này khi bị hạn chế; không được mở discovery vì vậy.
- PUT `operation-drafts`, GET `me/operation-drafts`, GET/DELETE `operation-drafts/{key}`; route/schema payload allowlist, actor scope, mã hóa, TTL, tối đa 10 draft hoạt động. Original operation API/idempotency giữ nguyên.

API resource budgets dùng DB chung theo actor/phút: search 60, upload 12, report 10, read 240, write 120. Đây là giới hạn tải bổ sung, không thay quota request nghiệp vụ. Báo cáo mở trùng actor/target/reason được gom; đánh dấu reviewed có audit và không tự block. SQLite API còn transaction ghi ngắn cho rate counter; không nói tất cả GET hoàn toàn không chờ writer.

## 4. Cấu hình cloud

Không chép nguyên `.env` local lên cloud. Cấu hình qua secret manager của platform; không lưu DSN/key trong Git, `VITE_*`, PR hoặc log.

| Biến | Giá trị / yêu cầu |
| --- | --- |
| `ROOMMATE_ENABLED` | `true` khi operator đã cấu hình persistence và moderator. |
| `ROOMMATE_DEMO_ENABLED` | `false`; dataset 30 hồ sơ chỉ để test. Production runtime từ chối demo. |
| `ROOMMATE_MODERATORS` | ID tài khoản đăng nhập thật, phân tách dấu phẩy; bootstrap local không phải moderator vận hành. |
| `ROOMMATE_STORAGE` | `sqlite` mặc định hoặc `postgres` khi cutover rõ ràng. |
| `ROOMMATE_STATE_DIR` | Private persistent path, Compose `/app/private-roommate`. Không dưới public/data. |
| `ROOMMATE_DATABASE_URL` | Secret DSN role riêng, bắt buộc cho PostgreSQL; theo chính sách TLS của cluster. |
| `ROOMMATE_DATABASE_SCHEMA` | `roommate` mặc định; không `public`/system schema. |
| `ROOMMATE_DATABASE_POOL_SIZE` | 8 mặc định, tối đa 32/process; tính tổng theo worker/replica với hạn mức cluster. |
| `ROOMMATE_CONTACT_KEY` | Fernet key ổn định; bắt buộc PostgreSQL. Di chuyển dữ liệu phải dùng đúng key cũ. SQLite có thể dùng `contact.key` từ volume. |
| `AGENT_API_TOKEN` | Secret hiện có, đồng nhất API và gateway. |
| `ROOMMATE_AREA_CATALOG` | Canonical area→city từ Location nếu cần; không dùng label tự đoán làm ID. |

`compose.coolify.yaml` hỗ trợ các biến tùy chọn, vẫn mặc định SQLite để không tự bỏ dữ liệu volume. Compose local thêm private volume backend. APP_ENV/payment mode hiện có không bị đổi trong đợt này; chuyển toàn app sang production cần checklist chung của dự án.

### Moderator và role DB

Tạo/chọn account thật trong ReloHome, lấy ID từ admin DB hoặc session tin cậy, cấu hình `ROOMMATE_MODERATORS`, restart API. Kiểm tra account moderator mở `/roommate/moderation`, account thường nhận 403 từ API và không đọc queue. Không cấp moderator theo email client hoặc nút UI.

Nếu chưa có role/schema, operator có thể dùng `python scripts/roommate-ops.py provision` với `ROOMMATE_ADMIN_DATABASE_URL`, `ROOMMATE_DB_USER`, `ROOMMATE_DB_PASSWORD` được set qua secrets. Role bắt buộc tên riêng chứa `roommate`. Command tạo schema riêng/role; nếu role đã tồn tại command cập nhật password: chỉ chạy trong cửa sổ cấu hình có chủ đích. Không dùng Housing role hay cluster superuser cho API runtime. Nếu schema đã có owner khác, operator kiểm tra ownership/grants/migration quyền trước khi dùng; không tự đổi owner/schema Housing.

## 5. Sao lưu, chuyển storage và rollback

Tools mới: `scripts/roommate-ops.py`. Chạy bằng virtualenv/image chứa requirements mới. Lệnh chỉ xuất trạng thái/count, không contact/key/DSN; lỗi chỉ thông báo generic. Paths dưới đây là ví dụ ngoài repository, phải chọn private disk thực tế. Trên Windows dùng Python venv tương ứng, cấu hình ACL owner-only; Unix directory 0700 và file 0600.

```bash
# Trước khi startup bản mới có migration: giữ ROOMMATE_STORAGE=sqlite và state/key nguồn.
python scripts/roommate-ops.py backup-sqlite --directory /secure-backups/roommate-before-upgrade
# Snapshot giữ nguyên schema v1; SQLite backup API bao gồm WAL đã commit, không copy mỗi .db thô.

# Sau khi cấu hình/khởi động bản mới:
python scripts/roommate-ops.py check
python scripts/roommate-ops.py backup --directory /secure-backups/roommate-current
```

Một snapshot gồm `roommate.sqlite3` và `contact.key`; luôn bảo vệ cả thư mục như dữ liệu riêng tư, không gửi chung ZIP housing/data. Backup PostgreSQL xuất snapshot transaction vào định dạng SQLite portable, đọc theo batch nhỏ. Không thay tuổi/cooldown/quota khi restore.

**Cutover SQLite → PostgreSQL:**

1. Thử restore trên DB/schema test trước; kiểm tra count/consent/ciphertext/idempotency bằng tài khoản thử.
2. Tạm dừng ghi Roommate tại proxy/API trong cửa sổ bảo trì. Lấy backup mới nhất cùng key. Không để hai storage cùng nhận ghi.
3. Cấp schema/role riêng trong cluster hiện có. Đặt storage PostgreSQL, DSN và đúng key nguồn qua secret manager. Destination phải trống (metadata key runtime được phép đã có).
4. Chạy `python scripts/roommate-ops.py import --directory /secure-backups/roommate-current`. Import atomic, từ chối destination có dữ liệu hoặc key khác, giữ nguyên IDs/versions/deadlines. Không sửa snapshot nguồn.
5. Chạy `check`, đối chiếu counts với snapshot. Startup API mới, kiểm tra login, discovery, inbox, contact consent/revoke, ảnh/moderator bằng test account. Mở ghi Roommate khi đạt.
6. Sao lưu PostgreSQL sau cutover và ghi mốc source/destination/version vào nhật ký vận hành riêng.

**Rollback:** tạm dừng ghi; nếu đã có ghi mới trên PostgreSQL phải backup dữ liệu mới và import về một SQLite state **trống** bằng cùng key, kiểm tra counts rồi đổi cấu hình/restart. Không dùng lại snapshot cũ và làm mất ghi mới. Rollback cả code xuống schema1 phải dùng snapshot v1 + key đã chụp trước nâng cấp; schema2 không tự downgrade. Operator cần thống nhất cách giữ dữ liệu mới nếu rollback code cũ.

Backup bất kỳ storage cần lịch backup của platform, disk mã hóa, restore drill và retention được operator cấu hình. Code không tự lưu backup vào public bucket hoặc tự xoay khóa.

## 6. Vận hành và giới hạn cần biết

- Maintenance mỗi 60s, startup/shutdown theo lifespan; hết hạn theo policy cũ, cleanup rate buckets cũ, draft sau 30 phút, notification đã đọc sau 90 ngày. Read kiểm tra quyền/deadline; không chờ cron mới hết hiệu lực.
- Giữ operations/quota/cooldowns/restrictions/audit theo behavior cũ; chưa đặt một retention tự xóa có thể phá idempotency/chống abuse. Theo dõi tăng trưởng bảng; retention audit/backup phải được chủ sản phẩm/operator quyết định và thông báo cho người dùng trước khi thay policy.
- Xóa dữ liệu riêng làm sạch public content/intro/criteria/bookmarks/ảnh/contact/draft và đóng quyền liên hệ. Không thể xóa bản copy contact mà đối phương đã lưu ngoài ứng dụng. Chỉ export dữ liệu của actor, không intro/contact của người khác.
- Notification là in-app polling khi tab hoạt động. Chưa có email/SMS/push; chưa có OTP/ID/background check. Không trình bày thông tin tự khai thành đã xác minh.
- Moderation thủ công có queue + role + audit, cần người trực thực tế. Báo cáo reviewed không đồng nghĩa tin bị gỡ; restriction là hành động riêng có lý do.
- Upload mất mạng dùng key cũ trong memory; sau reload kiểm tra danh sách ảnh của mình trước upload mới. Binary draft không được lưu browser/server recovery journal; không auto-upload.
- Reverse proxy cloud cần HTTPS, body/time limits, chặn direct upstream/private DB, IP abuse limit và log không chứa payload. Các service account/volume/role/secrets/backup schedule thực tế chưa được thao tác trên cloud trong đợt này.
- Bật INFO cho logger `roommate.http` bằng logging configuration hiện có để thu route/status/latency; theo dõi 5xx/429, pool wait và `roommate_maintenance_failed`. Không bật log body/contact/DSN để chẩn đoán. Chưa bổ sung alert provider hoặc dashboard metrics ngoài hệ thống log hiện có.
- UI đi qua session hiện có; dịch vụ không xác minh ownership của room chỉ bằng liên kết tin. Người dùng phải xác nhận quyền ở và không dùng địa điểm map gần đúng để khẳng định quyền sở hữu.

## 7. Kiểm thử và evidence

Các dữ liệu dưới đây là synthetic, PostgreSQL test tách riêng localhost:15433, không dùng hồ sơ thật. Kết quả cuối cập nhật trong task checklist. Evidence local `.tmp/rp-regression-clean.txt`, `Frontend/test-results/roommate-ui`, `Frontend/test-results/roommate-integration` không đưa vào Git.

- Backend focused: **194 passed**, domain/API/PG/backup/drafts/privacy/notification/rate/read concurrency và Agent/gateway; race gửi hai replica, consent/revoke, restore hai chiều giữ key/version/deadline/idempotency, startup role không superuser, mismatch thành phố đã biết. Mutation đảo điều kiện expiry bị test bắt lỗi; source khôi phục nguyên byte.
- Browser: **26 passed**, desktop/mobile, VI/EN light/dark, keyboard và Axe; Settings/Moderation, restricted-owner controls, city picker/consent và reload thử lại cùng key không PII trong storage.
- Real browser/API/SQLite: **4 passed**, riêng tư không tự publish; publish/pause/resume/delete; gửi/accept/read/revoke; upload/duyệt/gắn ảnh; erase xóa contact memory khỏi UI và giữ phiên đăng nhập, qua session gateway thật.
- Full regression Windows với feature flags mặc định: **870 passed**, 96 skipped, 16 failures thuộc Bash/symlink/Linux path (gồm subtest), không error setup. Cùng các nhóm CI script trên Linux container: **33 tests +73 subtests passed**. Không xóa/skip assertion để xanh. Log cuối: `.tmp/rp-final-regression.txt`.
- TypeScript/Vite build và Ruff theo phạm vi CI đạt; deployment/config checks **35 passed +62 subtests**. GitHub CI/cloud load test chưa chạy cho các thay đổi chưa push này; không đồng nhất local green với remote CI green. Quét Ruff toàn thư mục scripts ngoài scope CI có 9 lỗi cũ thuộc hook logging/module name `Frontend`; không sửa logging files trong đợt này.

```powershell
$env:PYTHONUTF8='1'
# DSN test riêng do operator set, không dùng DSN live:
$env:ROOMMATE_TEST_DATABASE_URL='<isolated PostgreSQL test DSN>'
$env:ROOMMATE_DEMO_ENABLED='false'
.venv/Scripts/python.exe -m pytest tests/test_roommate Frontend/tests/test_roommate_gateway.py Frontend/tests/test_roommate_full_stack.py tests/test_agents/test_roommate_privacy.py tests/test_agents/test_roommate_subagent.py -q
npm.cmd --prefix Frontend run build
# Từ Frontend/:
npx.cmd playwright test -c playwright.roommate-ui.config.ts roommate.spec.ts roommate-production.spec.ts
npx.cmd playwright test -c playwright.roommate.config.ts
```

CI lint-and-test bổ sung PostgreSQL service test với port riêng của job để parity tests không silently skip. Tham khảo [GitHub PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).

## 8. Điểm bàn giao

Backend: `src/roommate/` (storage adapter/domain services), `src/api/roommate_*`, `src/main.py`; gateway `Frontend/roommate_gateway.py`. UI: `Frontend/src/roommate/`. Ops: `scripts/roommate-ops.py`, Compose/config/requirements/CI. Tests cùng module cũ, thêm tests cho production boundaries và browser.

Trạng thái release: code đã mở rộng và kiểm thử local; operator cần hoàn tất role/secrets/volume/backup/moderator và rehearsal trên staging cloud trước mở người dùng thật. Không seed hồ sơ DEMO vào danh sách thật. Không thay đổi matching để triển khai các nâng cấp này.
