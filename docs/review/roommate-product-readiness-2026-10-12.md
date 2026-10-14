# Roommate — Đánh giá khả năng phát hành và kế hoạch cải thiện

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


- Ngày: 12/10/2026, Asia/Saigon.
- Code kiểm tra: `QuangDung`, HEAD `93fb6ba8fd422d892482adf64914662bcf5ce6a8`.
- Phạm vi: đọc backend, API, Agent, frontend, storage, deployment và chạy tests hiện có. Không sửa nghiệp vụ, API, database, `.env` hoặc cấu hình cloud.
- Đây là đánh giá source local. Chưa kiểm tra biến môi trường, volume, backup, tài khoản moderator hay lượng người dùng trên cloud.

Nâng cấp sau audit được bàn giao tại [Roommate production](../integration/roommate-production-2026-10-12.md). Nội dung bên dưới mô tả baseline `93fb6ba`, không mô tả trạng thái sau nâng cấp. Lưu ý: baseline đã kiểm tra tin Housing tồn tại qua `validate_room`/`explored_listing`; phần nâng cấp chỉ bổ sung picker, scope thành phố và từ chối mismatch khi city của tin biết rõ, không phải thêm lại validation tồn tại.

## 1. Kết luận

**Luồng lõi đã hoạt động; phù hợp chuẩn bị beta giới hạn có vận hành. Chưa đủ bằng chứng để tuyên bố sẵn sàng mở công khai đại trà.**

Điều kiện để dùng beta với người thật: demo tắt, người dùng tự đăng và quản lý hồ sơ, một nơi lưu state bền vững, backup DB/khóa đã thử restore, moderator thật và có cách xử lý báo cáo, giới hạn tài nguyên/API và kiểm chứng luồng trên cloud. Không nên coi việc đã deploy hoặc CI xanh là bằng chứng các điều kiện này đã được đáp ứng.

SQLite không buộc phải thay ngay để chạy beta trên một host. Đối với mục tiêu nhiều replica hoặc vận hành dài hạn với tải tăng, nên chuẩn bị chuyển persistence Roommate sang PostgreSQL hiện có, giữ các contract và luồng consent.

## 2. Sản phẩm hiện có

### Người dùng

1. Vào dịch vụ từ chat, tài khoản hoặc `/roommate`; đăng nhập và chủ động xác nhận 18+/điều khoản.
2. Chọn thành phố, ngân sách mỗi người/tháng, thời điểm vào ở và các ưu tiên sinh hoạt; xem hồ sơ, lý do phù hợp và thông tin còn thiếu.
3. Lưu hồ sơ quan tâm; không bắt buộc đăng hồ sơ công khai để tìm/xem/lưu.
4. Tạo bản giới thiệu riêng; xem trước và xác nhận nếu muốn đăng nhu cầu công khai. Có tạm dừng, tiếp tục, xác nhận còn tìm, đã tìm được và xóa.
5. Gửi lời giới thiệu riêng cho người khác, chọn kênh liên hệ của mình và xác nhận chia sẻ. Người nhận có thể chấp nhận/từ chối; người gửi có thể rút.
6. Sau consent hai chiều, hai bên mới đọc được kênh liên hệ; có thu hồi, chặn, báo cáo.
7. Khi kết nối được chấp nhận và quyền liên hệ còn hiệu lực, UI có gợi ý tìm nhà cùng nhau/cẩm nang; không tự tạo mục tiêu hoặc gửi yêu cầu dịch vụ khác.

### Quy tắc và bảo vệ đã có

| Nhóm | Triển khai hiện tại |
| --- | --- |
| Vùng | TP.HCM, Hà Nội, Đà Nẵng; area IDs canonical, mặc định toàn thành phố nếu chưa cấu hình catalog chi tiết. |
| Matching | Hard filter hai chiều; scoring bằng code theo khu vực, ngân sách, ngày vào ở và sinh hoạt. Có điểm phù hợp/khác biệt/thiếu thông tin; chỉ công bố số điểm khi đủ dữ liệu. Không dùng LLM tính điểm từng người. |
| Agent | Hỗ trợ hiểu và điều hướng nhu cầu; Roommate subagent chỉ tìm kiếm. Kết quả/checkpoint dùng tham chiếu ID; không cấp contact hoặc quyền tự publish/connect cho Agent. |
| Vòng đời | Hồ sơ 30 ngày sau đăng/xác nhận lại; pending request 7 ngày; contact grant 7 ngày sau chấp nhận. Read-time kiểm tra hạn và quyền hiện tại. |
| Chống spam request | Tối đa 10 request mới/24 giờ và 20 pending của người gửi; cooldown theo từ chối/rút/hết hạn/thu hồi. Pair hai chiều ngăn tạo kết nối song song. |
| Đồng thời | Transaction, version hồ sơ/contact và operation key + fingerprint cho các thao tác kết nối/contact/safety quan trọng. Không phải mọi mutation đều có operation key. |
| Gateway | Identity từ session server, allowlist routes, cùng cơ chế same-origin/CSRF hiện có; upstream dùng token server. Response private/no-store. |
| Contact | Mã hóa Fernet trong DB. UI chỉ giữ lease trong memory, ẩn khi blur/hidden, tải lại khi focus và revalidate 15 giây. Không lưu contact vào lịch sử chat hoặc browser storage. |
| Ảnh | Backend decode JPEG/PNG, giới hạn 5 MiB/16 triệu pixel/10 ảnh mỗi owner, bỏ metadata, resize tối đa 1024; cần duyệt trước khi gắn avatar công khai cho người đủ quyền. |
| Moderation | API duyệt ảnh, xem/resolve report, restrict/restore; có audit cho duyệt ảnh/restrict/restore. Chưa có dashboard moderator. |
| Demo | 30 hồ sơ tổng hợp tách nguồn, không có tài khoản/contact và không nhận kết nối. Runtime cấm demo khi `APP_ENV=production`; Compose cloud hiện tắt demo rõ ràng. |

Đây là sản phẩm kết nối có consent, chưa có chat 1–1 nội bộ. Sau đồng ý, người dùng trao đổi qua kênh liên hệ. Chat nội bộ là lựa chọn phát triển thêm, không bắt buộc để hoàn thành MVP hiện tại.

## 3. Kiểm chứng mới trong lần audit này

| Kiểm tra | Kết quả |
| --- | --- |
| Domain/API/Agent/gateway/full-stack ASGI | **182 passed**, 7,40 giây. |
| Browser UI desktop/mobile | **10 passed**, 21,6 giây; gồm guest/age/terms, payload/consent, unknown outcome, stale/error/empty, keyboard, theme/ngôn ngữ và accessibility. |
| Browser với gateway → Roommate API → SQLite thật | **2 passed**, 11,5 giây; publish/pause/resume/delete và gửi/accept/contact/revoke giữa tài khoản test. |
| Search query-count fixture | 10/100/1.000 candidates: **4 SELECT** mỗi lượt; thời gian local khoảng **1,4/10,6/88 ms**, 3 test qua. Các test này là một phần của suite 182, không cộng thành test backend mới độc lập. |

Browser dùng Chrome profile/test server riêng và dữ liệu tổng hợp, không ghi vào state người dùng đang chạy hoặc gọi provider/LLM ngoài. Timing fixture chỉ là lượt đo development đơn lẻ, không phải P95/SLA hay chứng minh tải đồng thời. Chưa chạy load test cloud hoặc toàn bộ hồi quy browser các dịch vụ trong lần audit này.

Lệnh kiểm tra:

```powershell
.venv/Scripts/python.exe -m pytest tests/test_roommate tests/test_agents/test_roommate_capability.py tests/test_agents/test_roommate_subagent.py tests/test_agents/test_roommate_intake.py tests/test_agents/test_roommate_graph.py tests/test_agents/test_roommate_privacy.py Frontend/tests/test_roommate_gateway.py Frontend/tests/test_roommate_full_stack.py -q --basetemp .tmp/roommate-product-audit-tests
npm exec --offline --workspace Frontend -- playwright test --config playwright.roommate.config.ts --workers=1
npm exec --offline --workspace Frontend -- playwright test --config playwright.roommate-ui.config.ts roommate.spec.ts --workers=2
.venv/Scripts/python.exe -m pytest tests/test_roommate/test_discovery_cost.py -q -s --basetemp .tmp/roommate-product-audit-cost
```

Tắt tracing LangChain/LangSmith trong process test. Không thay cấu hình chạy thật.

## 4. Các vấn đề cần cải thiện

### A. Persistence và deployment — điều kiện trước beta thật

**Hiện có:** `Storage` mở SQLite WAL; state gồm DB, WAL/SHM và `contact.key`. `compose.coolify.yaml` đã mount volume private bền vững và Dockerfile cấp quyền thư mục cho service user. Không kết luận bản cloud hiện mất dữ liệu.

**Cần xác minh:** volume thật vẫn được dùng sau recreate/redeploy; DB và đúng khóa được backup nhất quán; restore chạy được; moderator ID là tài khoản thật của môi trường cloud. Không dùng bootstrap local moderator làm bằng chứng có người duyệt.

`docker-compose.yml` ở root chỉ mount `/app/data`, không mount thư mục private Roommate mặc định. Nếu dùng Compose này để chạy Roommate, phải bổ sung persistence phù hợp trước khi dùng dữ liệu thật. Không áp kết luận này cho Compose Coolify đã có volume.

Compose cloud hiện ghi `APP_ENV: staging` và các cấu hình giao dịch thử. Resource tên “production” không đồng nghĩa toàn ứng dụng chạy production mode. Khi mở cho bên ngoài, cần tách rõ chính sách Roommate với cấu hình thử Flight/Payment/Housing và kiểm chứng cấu hình thực; không tự đổi `APP_ENV` mà chưa xét guard startup của các service khác.

### B. Khóa database khi đọc — rủi ro kỹ thuật ưu tiên cao

- `src/roommate/storage.py` gọi `migrate()` trên mỗi connection; migration dùng `BEGIN IMMEDIATE` ngay cả khi schema đã ở version 1.
- `RoommateContext.transaction()` cũng dùng `BEGIN IMMEDIATE`; search, detail, đọc contact, ảnh và nhiều GET chạy trong transaction này.
- Search giữ transaction trong suốt lọc, parse JSON, scoring và sort. Vì vậy các lượt đọc cũng tranh quyền writer, hạn chế lợi ích reader concurrency của WAL. Đây là phân tích code, chưa phải số liệu sự cố cloud.

**Đề xuất:** migration ở startup/deploy; phân biệt read transaction với write unit-of-work; snapshot cho search và giữ read-time authorization cho contact/detail. Các mutation accept/block/revoke phải giữ kiểm tra + ghi nguyên tử. Không bỏ lock đại trà hoặc giảm kiểm tra consent để tăng tốc.

SQLite WAL cho phép readers đồng thời với một writer, nhưng chỉ một writer tại một thời điểm và không hỗ trợ mô hình WAL chia sẻ giữa nhiều host trên network filesystem. [SQLite WAL](https://www.sqlite.org/wal.html).

### C. Query và khả năng tăng số hồ sơ

1. Search đã tránh N+1 query, nhưng vẫn tải mọi hồ sơ active của thành phố, tính điểm và sort rồi mới cắt page. `limit=12/50` chỉ giới hạn response, không giới hạn công việc xử lý.
2. `src/api/roommate_map.py` dùng `ctx.profiles.all()` rồi kiểm tra access từng owner **trước** điều kiện listing ID; map có quét toàn DB và query tăng theo người.
3. `reconcile_profiles()` đọc toàn bộ hồ sơ; request/inbox gọi reconciliation trong transaction. Inbox, bookmarks, report queue và media queue cũng chưa có phân trang đầy đủ.

**Đề xuất trước mở rộng:** query map theo listing ID/index và batch authorization; reconciliation theo state/deadline có index; phân trang inbox/moderation; SQL prefilter những điều kiện chắc chắn tương đương với hard filter hiện có. Giữ score/tie-break stable. Không tùy tiện `LIMIT` candidate trước scoring vì có thể làm mất người phù hợp ở trang đầu. Cursor cần snapshot/version hoặc quy tắc nhất quán khi hồ sơ thay đổi.

### D. Moderation và chống lạm dụng

Backend có block/report/restrict và duyệt ảnh, nhưng frontend chưa có công cụ moderator, upload avatar hoặc quản lý đầy đủ block/contact channel. Report không tự hạn chế người bị báo cáo — tránh lạm dụng report hàng loạt — nên cần người xử lý.

**Đề xuất:** dashboard nhỏ dùng API hiện có: report/ảnh chờ duyệt, lọc trạng thái, preview private, restrict/restore/resolve có lý do. Chốt người trực, thời gian xử lý và cách khiếu nại. Avatar có thể để tắt trong beta nếu chưa hoàn thiện upload/duyệt; không dùng ảnh giả làm ảnh người thật.

Quota gửi request hiện tại không thay thế rate limit cho search, report, block và upload. Chưa thấy limiter riêng cho các endpoint này trong module/gateway; chưa xác minh giới hạn proxy cloud. Cần rate limit theo actor và IP, giới hạn JSON body/array, timeout, số report lặp và lưu trữ ảnh. API upload đã có giới hạn bytes/pixels/count; tiếp tục giữ chúng. [OWASP API4: Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/).

### E. Trải nghiệm tạo hồ sơ và inbox

| Hiện tại | Cải thiện |
| --- | --- |
| Self facts và preferences đã tách, nhưng form còn nhiều thuật ngữ/khái niệm. | Bắt đầu với nhu cầu, vùng, ngân sách, ngày vào ở; sinh hoạt ở phần bổ sung. Dùng nhãn “Bắt buộc”/“Ưu tiên” dễ hiểu cho hard/soft. |
| Bản giới thiệu riêng và hồ sơ công khai có lifecycle riêng. | Giữ logic; làm rõ “Lưu riêng”, “Đăng tìm”, nội dung nào người khác sẽ thấy, thông báo thay đổi chưa được đăng. |
| Inbox list chủ yếu mã request/status/deadline, phải refresh. | Tên/ảnh đối phương được API cho phép, preview lời giới thiệu, trạng thái chưa đọc, bộ lọc, CTA dễ hiểu. Không lấy PII từ chat history để điền tên. |
| Backend có `profile_reminder` ba ngày trước hạn; Inbox chưa render. | Hiện banner nhẹ + CTA xác nhận còn tìm. |
| Room trên map nhập `listing ID` thủ công, một số copy ở phần này chưa dịch EN. | Chọn tin qua Housing picker hiện có; tên/ảnh/address preview, kiểm tra tin tồn tại và thành phố. Không tự gắn căn từ chat. |
| Liên hệ chưa có màn quản lý độc lập đầy đủ. | Xem/sửa/xóa kênh; cảnh báo rõ đổi kênh sẽ thu hồi phiên bản đang chia sẻ. Có danh sách đã chặn và bỏ chặn theo API. |

Khai báo đang có phòng và consent vị trí **chưa xác minh quyền ở/đăng phòng**. Map đã ghi nhãn tự khai; cần giữ nhãn này và không gọi là “đã xác minh”. Muốn cấp badge về phòng cần quy trình xác minh riêng, không suy ra từ việc có listing ID.

### F. Thông báo và việc người dùng quay lại

Hiện không có scheduler/email/push/SSE riêng cho Roommate; inbox chủ yếu tải khi vào/refresh. Pending có thể hết hạn mà người nhận không biết.

**MVP đề xuất:** thông báo trong app cho request mới, accept/reject/revoke và hồ sơ sắp hết hạn; badge unread, deep link vào đúng request. Poll có điều kiện khi tab đang active là đủ bước đầu. Nếu thêm email thì gửi link/thông báo tối giản, không gửi contact, địa chỉ riêng hoặc toàn bộ intro. Chống gửi trùng bằng event key/outbox, respect opt-out; không cần tạo notification microservice mới.

### G. Tin cậy, riêng tư và vòng đời dữ liệu

- Tuổi 18+ là tự khai; phone/Zalo chỉ kiểm tra định dạng. Web register/login chưa có bước xác minh email. Vì vậy không gắn badge “đã xác minh người thật”. Có thể thêm xác minh email trước, OTP khi có lý do; không bắt KYC/giấy tờ chỉ để hoàn thành MVP.
- Regex ngăn contact phổ biến trong text không chặn được mọi kiểu viết số bằng chữ/obfuscation/contact trong ảnh. Kết hợp moderation, report, giới hạn spam và hướng dẫn rõ.
- Contact grant 7 ngày là **thời hạn API cho đọc**, không phải lời hứa xóa được số điện thoại đã được người kia ghi lại/chụp màn hình. Poll 15 giây cũng không phải push thu hồi tức thời.
- “Xóa nhu cầu” hiện clear profile/intro, null ciphertext, xóa media và redact intro lịch sử, nhưng không xóa toàn bộ `criteria`, bookmarks, access, requests, operations, reports/audit hoặc bản backup. Cần phân biệt xóa hồ sơ đăng tìm và yêu cầu xóa dữ liệu tài khoản; chốt retention/export/cleanup và cách xử lý backup.
- Các bảng `operations`/reports/audit không có chính sách cleanup tự động rõ ràng. `operations` hiện thiếu created/expiry để làm cleanup có quy tắc. Không xóa key ngay sau response vì retry trễ sẽ mất bảo đảm idempotency; cần chốt replay window trước.

### H. Đối soát khi lỗi và refresh

`useOperation` giữ payload/key trong `useRef`; kiểm tra trạng thái và retry cùng key hoạt động trong component đang mở. Refresh/rời trang mất journal đang đối soát. Backend pair/quota vẫn bảo vệ luồng request; không kết luận refresh chắc chắn tạo duplicate.

**Đề xuất:** giữ journal tối thiểu actor scope + operation key/type + resource ID và trạng thái cần đối soát; không lưu contact/intro/payload PII vào localStorage/sessionStorage. Sau refresh, GET trạng thái trước cho retry, hoặc dùng draft server-side nếu cần khôi phục form. Không tự gửi lại mutation hoặc đổi key.

### I. Vận hành, analytics và release evidence

- Cần metric request/error/latency/lock wait, search candidate count, no-result rate, pending age, report backlog, dung lượng DB/ảnh, backup success và restore drill.
- Event sản phẩm: search → profile view → send → accept → người dùng chủ động đánh dấu đã tìm được. Theo dõi tỷ lệ phản hồi/report và độ mới, không chỉ số điểm cao.
- Không log contact, raw intro, ảnh, token; không gửi chúng vào analytics hoặc trace LLM. Analytics phải lấy từ sự kiện thật, không tạo biểu đồ số giả.
- Cần cloud E2E hai account, stale tab, revoke/block cạnh tranh, mạng chập chờn, restart/redeploy, lỗi backup và tải đồng thời. Các tests vừa chạy không chứng minh những điều này trên cloud.
- Spec/plan/handoff 07/10 còn giữ “chưa push/deploy” và baseline failures cũ. Những dòng đó là lịch sử checkpoint, không đại diện HEAD hiện tại. Cập nhật ma trận gate bằng evidence mới; không tự tick toàn bộ RM-35–47 từ vài test happy path. CI xanh của PR cũng không bao gồm mọi browser scenario hoặc vận hành cloud.

## 5. Database: giữ gì, bổ sung gì

### Hiện tại

DB riêng `roommate.sqlite3`, schema version 1, 16 bảng:

`access`, `profiles`, `intros`, `criteria`, `bookmarks`, `contacts`, `requests`, `grants`, `pairs`, `cooldowns`, `operations`, `blocks`, `restrictions`, `reports`, `moderation`, `media`.

Có PK/unique pair, contact owner-kind, operation actor-key; profile index state/city/expiry và request sender-time/recipient-state. Profile/request/grant phần lớn nằm trong JSON TEXT; ảnh BLOB trong DB. Contacts được mã hóa, nhưng profile/introduction/facts không được mã hóa cấp field — storage/backup vẫn là private data.

### Phương án ít thay đổi nhất

1. **Beta nhỏ, một host:** giữ SQLite private volume; sửa transaction/query/limit; backup có restore drill; avatar tắt hoặc moderation thủ công có quy trình. Không cần thêm DB/service mới chỉ để thử với người thật.
2. **Mở rộng công khai / nhiều replica:** dùng PostgreSQL cluster đã có trong ReloHome, schema private `roommate` và role riêng quyền tối thiểu. Đây là đề xuất cần đánh giá capacity/backup/burst load của cluster Location/Moving hiện có, không cấp cho Roommate role ingest hoặc quyền rộng trên Housing. Không đổi database Housing hoặc đưa PII vào schema/public snapshot Housing.
3. Giữ domain/scoring/DTO/endpoints và consent state machine; thay repository/unit-of-work. Chuyển DB không tự sửa được full-scan, thiếu thông báo hoặc UX.

PostgreSQL có row locks/transaction; phải thiết kế khóa pair + version/contact/consent và constraint khi migration, không chỉ thay cú pháp SQLite bằng SQL PostgreSQL. [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html).

### Bổ sung schema có mục đích

| Nhóm | Bổ sung / thay đổi được đề xuất |
| --- | --- |
| Queryable profile | Cột state/city/deadline/version đã có; thêm các trường dùng lọc thường xuyên: budget bounds + fee basis, need, move-in bounds, room listing ID; area relation khi cần multi-area. Giữ JSONB cho traits/preferences mở rộng và validate một nguồn nội dung thống nhất. |
| Index | Expiry theo state, incoming/outgoing request theo actor/state/time, grant expiry, block chiều ngược, report/media status-time, listing linkage. Chọn index từ EXPLAIN/load test, không tạo tràn lan. |
| Integrity | Enum/check constraints và FK nội bộ Roommate; optimistic versions; unique unordered active pair; idempotency actor-key-fingerprint; UTC timestamps. |
| Account linkage | Owner ID hiện trỏ web account, trong khi users nằm ở `siu-web.sqlite3`. Không thể giả có FK cross-database; dùng identity server đáng tin, quy trình account deletion/reconciliation. Không di chuyển auth chỉ để có FK. |
| Notification | Event/outbox + delivery/read state có unique event key, retries giới hạn; private payload tối thiểu. |
| Retention | Created/expiry cho operation/audit policy, cleanup theo replay window; tombstone tối thiểu cần thiết và purge workflow. Không xóa pending/cooldown/grant còn hiệu lực. |
| Media | Khi dung lượng thật tăng, dùng storage private/object storage hiện có nếu có; metadata/status/hash/owner trong DB, đọc ảnh tiếp tục kiểm tra fresh permission. Không public hóa bucket/avatar để giảm tải. Nếu beta không có ảnh thì chưa cần infrastructure này. |
| Trust | Verification status có timestamp/method thực, room-link review status nếu triển khai xác minh. Không tự tạo badge từ dữ liệu tự khai. |

### Migration không phá luồng cũ

- Lấy backup DB/key nhất quán; kiểm đếm và kiểm tra pair/grant/contact versions trước chuyển.
- Tạo schema/repositories mới; chạy cùng contract/concurrency/expiry/restore tests với cả hai backend storage.
- Import owner IDs, record versions, operation results, deadlines, ciphertext và key đúng; không gia hạn nhu cầu/consent khi import.
- Dùng thời gian dừng ghi ngắn cho cutover và đối chiếu counts/invariants; tránh tự xây dual-write khi chưa cần.
- Sau khi DB mới nhận writes, rollback image không được quay về SQLite cũ đã stale; rollback persistence cần kế hoạch đồng bộ dữ liệu đã phát sinh hoặc fix-forward.

## 6. Thứ tự triển khai đề xuất

P0 dưới đây là điều kiện phát hành cần chứng minh, không phải khẳng định cloud đang vi phạm. Độ phức tạp S/M/L là tương đối, không phải số ngày cam kết.

| Ưu tiên | Việc | Lợi ích | Độ phức tạp / dependency |
| --- | --- | --- | --- |
| P0 — trước beta thật | Xác minh volume/DB-key backup-restore, moderator thật, demo tắt, cấu hình cloud và giới hạn API | Không mất dữ liệu, có người xử lý abuse, tách thử nghiệm/người thật | S–M; cần quyền vận hành cloud và chính sách sản phẩm. |
| P0 — trước công khai | Moderator workflow dùng API cũ, quy trình report, privacy/retention và các nhãn tự khai rõ | Kiểm soát spam/lừa đảo/PII | M; frontend + operator, không cần service mới. |
| P1 | Bỏ migration per-request, tối ưu read transaction, map N+1, reconciliation và pagination | Giảm lock/tải; bảo vệ trải nghiệm nhiều người | M; phải giữ tests cạnh tranh/consent. |
| P1 | Inbox tên/ảnh được phép, unread + nhắc hạn + notification in-app | Người dùng phản hồi được, ít bỏ lỡ request | M; thêm DTO/event tối thiểu, đồng bộ contract trước UI. |
| P1 | Upload/avatar moderation, channel/block management, Housing room picker | Hoàn thiện luồng và độ tin cậy dễ nhìn | M; reuse endpoints; picker cần validation linkage. |
| P1 | Unknown-operation journal không PII và cloud E2E/load/observability | Đối soát khi mạng kém, evidence để mở beta | M; cần evidence cloud, không tạo giao dịch thật cho tests. |
| P1 khi nhiều replica | PostgreSQL repositories + cutover | Shared transactional state bền vững | L; capacity/role/migration, DB+key backup, concurrency tests. |
| Phase 2 | Email opt-in/OTP nếu có nhu cầu, shortlist so sánh người, chất lượng top-result và empty-state | Tăng độ tin cậy/chuyển đổi | M; chỉ triển khai theo dữ liệu người dùng thật. |
| Future | Chat nội bộ, nhóm nhiều người, lịch gặp, gợi ý phòng cho cả nhóm | Mở rộng hợp tác | L; thêm moderation, consent, notification và retention; chưa cần trước MVP. |

## 7. Chia việc để tránh xung đột

- **Frontend/UX:** `Frontend/src/roommate/*`, i18n/scoped CSS, tests browser; không sửa state machine/scoring hoặc giả DTO. Dashboard moderator có route/components riêng.
- **Backend/database:** `src/roommate/*`, `src/api/roommate_*`, storage/migrations, authorization, notification events và tests domain/API.
- **Contract chung:** chốt fields inbox/notification/media trước, một người sở hữu DTO/API/client; PR hợp đồng riêng rồi mỗi người làm trên contract đã thống nhất.
- **Cloud/ops:** compose/private volume/roles/backup/metrics/release checklist có owner riêng. Tránh cùng sửa `.env`, `App.tsx`, gateway và schema trong hai nhánh.
- Chia PR nhỏ: persistence/query → moderation → inbox/notifications → onboarding/media → release evidence. Không gộp migration DB vào PR đổi layout nếu không phụ thuộc nhau.

## 8. Khuyến nghị quyết định

**Giữ kiến trúc ReloHome và các luồng consent/scoring đang hoạt động. Hoàn thiện P0 và P1 quan trọng, chạy beta với tài khoản thật tự nguyện, đo hiệu quả phản hồi/tìm được người rồi mới mở rộng.**

Chưa cần recommender dùng LLM, vector database, microservice Roommate, chat server riêng hoặc KYC giấy tờ. Dữ liệu DEMO chỉ phục vụ kiểm thử; sản phẩm thật phải nhận hồ sơ từ đúng chủ tài khoản và có vận hành xử lý báo cáo.

## Nguồn code và tài liệu

- [Product spec](../ideas/roommate-service.md), [technical design](../design/roommate-discovery.md), [runbook](../runbooks/roommate.md), [frontend handoff](../../Frontend/ROOMMATE_UI_HANDOFF.md), [task checklist](../../tasks/todo.md).
- [Storage](../../src/roommate/storage.py), [schema](../../src/roommate/migrations.py), [runtime](../../src/roommate/runtime.py), [discovery](../../src/roommate/services/discovery.py), [map rooms](../../src/api/roommate_map.py).
- [Profile lifecycle](../../src/roommate/services/profiles.py), [consent](../../src/roommate/services/consent.py), [contacts](../../src/roommate/services/contacts.py), [media](../../src/roommate/media.py), [moderation](../../src/roommate/services/moderation.py).
- [Inbox backend](../../src/roommate/services/inbox.py), [Inbox UI](../../Frontend/src/roommate/Inbox.tsx), [operation UI](../../Frontend/src/roommate/useOperation.tsx), [room editor](../../Frontend/src/roommate/ProfileEditor.tsx).
- [Cloud Compose](../../compose.coolify.yaml), [production deployment](../../deploy/README.md), [gateway](../../Frontend/roommate_gateway.py).
