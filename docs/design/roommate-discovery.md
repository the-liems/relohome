# Roommate Discovery — Technical design và backend checkpoint

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


- Ngày: 2026-10-07, Asia/Saigon.
- Baseline: [product spec v1.0](../ideas/roommate-service.md), [implementation plan](../../tasks/plan.md).
- Task thực hiện: **RM-01–31 — backend, API, browser gateway và Agent**.
- Trạng thái: backend đã nối runtime, giữ `ROOMMATE_ENABLED=false` mặc định. Frontend các màn tìm/kết nối/hồ sơ cơ bản hiện đã triển khai; evidence và phần còn lại của RM-32–41 tại [frontend handoff](../../apps/web/ROOMMATE_UI_HANDOFF.md). Các mục RM-01 dưới đây là lịch sử foundation; mục 8 ghi checkpoint backend trước khi làm frontend.

## 1. Baseline và phạm vi thay đổi

Trước RM-01:

- Branch `QuangDung`; HEAD `26f63c4d24e3661930bd427e484caf94fb64e5ec`.
- Index không có thay đổi staged.
- Có 26 file tracked đã sửa, tổng diff 1.757 insertions / 1.365 deletions, thuộc frontend và tài liệu housing. Ngoài ra có file chưa tracked thuộc frontend, housing-geocode, product spec và implementation plan.
- Các file Python backend, gateway và test legacy được dùng để đối chiếu vẫn khớp HEAD. Không reset, đổi branch, sửa hoặc stage các thay đổi frontend/housing này.

RM-01 chỉ tạo `src/roommate/models.py`, `src/roommate/policy.py`, `tests/test_roommate/test_models.py` và tài liệu này; cập nhật trạng thái trong checklist. Không migration, kết nối database, API, network, LLM, scoring hay frontend. Module chưa được import bởi application runtime, nên không cần feature flag hoặc Docker ở task này; wiring/feature flag thuộc RM-20.

## 2. Typed models

Các model là giá trị domain dùng Pydantic v2, `extra="forbid"`, `frozen=True`. Boolean khai báo dùng `StrictBool`, tiền VND dùng `StrictInt`; collection vùng dùng tuple để tránh mutate sau validation. Model không có I/O hay trạng thái toàn cục.

| Model | Ý nghĩa |
| --- | --- |
| `BudgetRange` | Khoảng hoặc trần VND/mỗi người/tháng, cơ sở `rent_only` hoặc `including_fees`; cơ sở chưa rõ là `None`. |
| `HousingNeed` | `has_room` hoặc `looking_together`; khả năng rời phòng chỉ áp dụng khi có phòng. |
| `MoveInWindow` | Ngày chính xác, khoảng ngày bao gồm hai đầu, hoặc chủ động khai linh hoạt. |
| `QuietHours` | Khoảng giờ yên tĩnh theo giờ địa phương, cho phép qua nửa đêm. |
| `SelfTraits` | Giới tính tự khai, thói quen hút thuốc, có thú cưng, giờ yên tĩnh, tần suất dọn dẹp, mức dùng không gian chung. |
| `Preference[T]` | Giá trị mong muốn và mức `soft` / `hard`. Chỉ preference thực sự được cung cấp mới tồn tại. |
| `RoommatePreferences` | Tiêu chí với người ở cùng; tách hoàn toàn khỏi thông tin bản thân. |
| `ProfileFacts` | Thành phố/khu vực mục tiêu, ngân sách bản thân, nhu cầu, thời điểm và self traits tự khai. |
| `RoommateProfile` | Nội dung nháp hoặc giới thiệu riêng, gồm tên, giới thiệu, facts và preferences; không phải DTO public. |
| `RoommateSearchCriteria` | Một thành phố tìm được chọn, facts của người tìm và preferences; không đòi tên/intro hoặc hồ sơ public. |

### Unknown, linh hoạt và chấp nhận

- `None` nghĩa là chưa cung cấp, không đồng nghĩa `False`, không hút thuốc, không thú cưng hoặc chấp nhận mọi điều kiện.
- Không đặt preference: trường preference là `None`. Đã chọn preference: phải có value hợp lệ, không được `value=None`; mặc định `soft`, chỉ `hard` khi chọn rõ.
- Unknown ngày vào ở: `move_in=None`. Chủ động khai linh hoạt: `MoveInWindow(kind="flexible")`. Không tự biến unknown thành flexible.
- `HousingNeed(kind="has_room", willing_to_move=None)` còn thiếu dữ kiện về khả năng chuyển; không tự suy ra `False` hoặc `True`.
- Giới tính không có giá trị default; không suy ra từ display name hoặc intro.
- Cơ sở phí không có default. Không đổi tiền thuê sang tổng đã gồm phí và không ước lượng phí.

### Vùng và phạm vi

- City dùng `hcm`, `hanoi`, `danang`, thống nhất vocabulary hiện có ở Location/Housing/Route contracts. Không thêm alias hoặc tự đổi thành phố ở model.
- Hồ sơ nháp có thể thiếu city/khu vực. Nếu đã có `area_ids`, phải có city; IDs phải không rỗng, không trùng sau trim.
- Preference khu vực được khai qua `Preference[AreaSelection]`; không đặt preference nghĩa là chưa giới hạn vùng theo preference trong thành phố đã chọn, không tự tạo hard filter.
- `RoommateSearchCriteria.city` là thành phố mục tiêu tìm. Nếu `self_facts.city` đã khai, phải cùng thành phố này. Đây là phạm vi muốn ở, không phải địa chỉ đang sống hay nơi xuất phát chuyển đồ.
- Model chỉ validate hình dạng ID; kiểm tra ID thực sự thuộc thành phố bằng danh mục canonical được thực hiện ở RM-08. Không chấp nhận hình dạng hợp lệ là bằng chứng vùng đã xác minh.

### Ngân sách và thời gian

- `max_vnd` là số nguyên dương; `min_vnd` nguyên không âm và không vượt max. Khi chỉ có trần, min=0 biểu diễn khoảng toán học `[0, max]`, không khẳng định người dùng có ngân sách bằng 0. Mức cố định biểu diễn min=max.
- Ngày chính xác dùng `kind="date", start=<date>` và không có end. Khoảng dùng start/end, start<=end. Flexible không chứa ngày. Không tự điền ngày thiếu hoặc đảo thứ tự khoảng.
- Quiet hours dùng thời gian không offset, theo múi giờ sinh hoạt tại Việt Nam; 22:00→07:00 hợp lệ. Start=end bị từ chối vì không phân biệt được 0 giờ và cả ngày. Không khai khoảng này giữ `None`.
- TTL profile/request/contact và UTC clock không thuộc RM-01; triển khai ở RM-02/service lifecycle. Model ngày không tự kiểm tra “đã qua hôm nay” để không làm validation phụ thuộc thời điểm.

### Vocabulary sinh hoạt

- Smoking habit của bản thân: `non_smoker`, `outdoors_only`, `indoors`.
- Smoking tolerance với người khác: `no_smoking`, `outdoors_only`, `indoors_allowed`. Hai enum riêng giúp không đồng nhất “hút thuốc” với “cho hút thuốc trong nhà”.
- `has_pets` tự khai khác `pets_allowed` trong preference.
- Cleanliness mô tả tần suất dọn: `daily`, `several_times_week`, `weekly`; sociability mô tả sử dụng không gian chung: `mostly_private`, `balanced`, `often_shared`. Không coi lựa chọn nào là tính cách tốt/xấu hoặc điểm độ tin cậy.
- Đây là vocabulary kỹ thuật cho form có cấu trúc. Factor matrix tương ứng và nhãn giao diện cần đặc tả ở RM-10/frontend; RM-01 không gán score cho enum.

### Nội dung nháp và giới hạn

- Display name nếu đã nhập phải không rỗng sau trim, tối đa 80 ký tự; introduction tối đa 1.000 ký tự. Đây là giới hạn kỹ thuật cho nội dung ngắn, không làm những trường này bắt buộc khi chỉ tìm kiếm.
- Profile nháp chưa đầy đủ vẫn validate được. Publish/send cần bổ sung validation theo product spec tại RM-14/15, gồm ít nhất một khu vực, ngân sách/cơ sở phí, nhu cầu và thời điểm hợp lệ.
- Không có `owner_id`, contact, consent, published state, tọa độ hoặc compatibility score trong model nội dung. Những input không được khai báo bị từ chối cả ở model lồng nhau.
- Không dùng `RoommateProfile.model_dump()` làm response public. Projection/authorization riêng thuộc RM-03/12; lọc contact trong free text/media thuộc lớp nội dung và moderation sau này. RM-01 chưa chứng minh intro được phép công bố hoặc đã qua moderation.

## 3. Storage decision và gate trước RM-04

Baseline plan chọn repository relational với SQLite riêng cho **một host**, vì application Python hiện dùng SQLite runtime, không có ORM/driver PostgreSQL active. Model không import RuntimeDatabase, Frontend store hoặc Housing models.

Ở checkpoint RM-01 đây là quyết định chuẩn bị, chưa tạo schema. RM-04 hiện đã triển khai SQLite riêng cho một host. Deployment nhiều replica/HA cần adapter relational và locking được thiết kế riêng; không dùng file SQLite riêng từng host để giả định coordination.

Không cần sửa các service hiện có để hoàn tất RM-01. Ownership từ session/trusted actor, schema physical, contact vault và request lifecycle sẽ làm ở đúng task phụ thuộc, không thêm trước vào profile content.

## 4. Evidence RM-01

### Focused tests và lint

TDD: lần đầu fail vì chưa có `src.roommate`; sau increment đầu 24 tests pass. Thêm profile/search tests fail vì model chưa tồn tại; sau implementation đầy đủ **53 tests pass**. Tests bao gồm unknown, explicit acceptance, strict boolean/VND, ngày/khoảng/flexible, giờ qua nửa đêm, phạm vi city/area, self vs preference, extra fields, JSON roundtrip và immutability.

```powershell
.venv/Scripts/python.exe -m pytest tests/test_roommate/test_models.py -q
.venv/Scripts/python.exe -m ruff check src/roommate tests/test_roommate
.venv/Scripts/python.exe -m ruff format --check src/roommate tests/test_roommate
```

### Kiểm tra bộ test hiện tại: chưa xanh

Đã chạy `pytest tests Frontend/tests -q --tb=short` với basetemp mới trong `logs/local`, live/sandbox provider opt-in tắt: **387 passed, 29 failed, 80 skipped**. Lần chạy ban đầu dùng tmp mặc định còn gặp WinError 5; basetemp trong workspace giải quyết quyền thư mục tạm, nhưng không giải quyết lỗi subprocess Windows hay các assertion/mock legacy.

Ba lỗi tiêu biểu đã tái hiện riêng, chỉ thu thập test legacy, xác nhận **không import bất kỳ module `src.roommate` nào** và source backend/gateway liên quan khớp HEAD:

- `test_relocation_waits_for_room_choice_s4`: kỳ vọng dependency `['t1']`, code hiện trả `[]`.
- `test_invalid_addon_asks_before_any_estimate_or_write`: mock `SimpleNamespace` thiếu `catalog_cache` được MovingExecution hiện tại sử dụng.
- `test_agent_status`: fixture ASGI không mở lifespan/runtime, `/api/v1/status` trả 503, test kỳ vọng 200.

Các lỗi khác trong full suite gồm MCP subprocess bị WinError 5 và assertion của Map/Flight/Payment. Chưa điều tra/sửa tất cả 29 lỗi; không quy toàn bộ thành lỗi môi trường hoặc tuyên bố regression pass. Việc sửa chúng vượt RM-01 và yêu cầu giữ nguyên service hiện tại.

LangSmith tracing từ cấu hình local có thử gửi telemetry nhưng network bị chặn; không dùng kết quả đó làm test evidence. Lệnh test tiếp theo cần đặt `LANGCHAIN_TRACING_V2=false`, `LANGSMITH_TRACING=false`, `LANGCHAIN_TRACING=false` ở process test, không sửa `.env` của người dùng.

**Kết luận tại checkpoint RM-01:** model hoàn tất; gate hồi quy toàn project chưa đạt. Ngày 2026-10-07 chủ sản phẩm đã yêu cầu tiếp tục toàn bộ backend/API/Agent; lỗi baseline được giữ lại trong báo cáo, không sửa nghiệp vụ legacy.

## 5. Contract foundation RM-02/03 và review G1

Request và grant có state riêng. IntroSnapshot là whitelist đã review: tên, giới thiệu, facts, thời điểm review; không copy preferences hoặc contact. ContactConsent gắn actor, người nhận, channel ID/version và xác nhận rõ ràng. Clock UTC nhận timezone-aware datetime, deadline dùng `now >= expires_at`.

Actor chỉ được composition/API tạo từ danh tính tin cậy, không có role do body chọn. ProfileRecord giữ owner/version/state/deadline; PublicProfile chỉ có ID tham chiếu, tên, intro, facts và avatar ID. OwnerProfile yêu cầu owner. Projection không thay thế read-time authorization/expiry/block trong service.

Repository boundaries độc lập LangGraph: hồ sơ có optimistic version; transaction UoW nguyên tử cho write. SQLite một host là baseline đã duyệt; không cần Docker cho module này. G1: migration chỉ tạo DB Roommate riêng, không đụng tài khoản/Housing; foreign keys nội bộ, operation `(actor, key)`, unordered pair reservation riêng, quota dựa request history. Contact vault dùng Fernet với khóa riêng, không có plaintext contact trong record/prompt. Backup bắt buộc giữ cả DB và khóa, không đóng gói vào zip data công khai.

RM-02: 69 tests (53 RM-01 + 16 mới) pass; commit `98a53e6`. RM-03 bổ sung projection/ownership tests; gate chạy trước migration.

## 6. Normalization RM-08

AreaCatalog nhận canonical IDs/membership từ **snapshot JSON server đã xuất từ Location**, cấu hình qua `ROOMMATE_AREA_CATALOG`. Runtime hiện không tự gọi `/v1/areas/search`. Không tin city/area do LLM tự đoán; IDs không có trong catalog bị từ chối. Mặc định chỉ có `city:hcm/hanoi/danang` là lựa chọn toàn thành phố. Phải nạp snapshot trước khi dùng vùng chi tiết; không geocode cho từng hồ sơ.

Ngân sách VND/người/tháng: chỉ comparable khi hai bên khai cùng fee_basis, overlap bao gồm endpoint (khoảng bằng một mức hợp lệ). Move-in flexible đáp ứng mọi ngày đã khai, không thay thế unknown. Quiet hours là local wall-clock, minute resolution, tỷ lệ phút yên tĩnh mong muốn được bên kia đáp ứng; cho phép qua nửa đêm.

Migration dùng `BEGIN IMMEDIATE` và execute từng statement để rollback DDL cùng version; không dùng executescript vì có implicit commit ([Python sqlite3](https://docs.python.org/3.11/library/sqlite3.html#sqlite3.Cursor.executescript)). Các test repository thực sự dùng file SQLite riêng và hai connection độc lập cho race unordered pair.

## 7. Factor matrix RM-10 (chốt trước engine)

Chỉ preference đã đặt được tính. Unknown hoặc ngân sách khác/mất fee_basis: factor nội bộ 0,5 nhưng known=false, giữ nguyên weight. Giới tính chỉ filter khi must, không cộng điểm giới tính/nghề nghiệp.

| Tiêu chí | Factor đã biết |
| --- | --- |
| Vùng (20) | Có giao vùng hoặc chọn toàn thành phố: 1; không giao: 0. |
| Ngân sách (20) | Khoảng giao nhau: 1; không giao: `max(0, 1-gap/max(trần mong muốn,1))`. |
| Move-in (15) | Giao khoảng hoặc một bên flexible: 1; lệch ngày: `max(0,1-gap_days/30)`. |
| Hút thuốc (10), thú cưng (10) | Đáp ứng tolerance: 1; không đáp ứng: 0. Không đánh giá tốt/xấu cá nhân. |
| Quiet hours (10) | Tỷ lệ phút mong muốn có giao với giờ yên tĩnh của candidate. |
| Sạch sẽ (10), giao tiếp (5) | Cùng lựa chọn: 1; lệch một bậc trong ba hành vi: 0,5; lệch hai bậc: 0. |

Ví dụ: muốn thuê tối đa 4 triệu rent_only, candidate tối thiểu 5 triệu rent_only → 0,75; khác fee_basis → unknown. Muốn 7/10, candidate 22/10 → 0,5. Yên tĩnh 22–06 so với 02–06 → 0,5. Đây là thước đo đáp ứng yêu cầu, không phải xác suất hòa hợp. Hard filter đã loại trường hợp must không đáp ứng trước khi xếp hạng.

## 8. Checkpoint RM-04–31: backend/API/Agent hoàn tất

### Runtime và boundaries

- State riêng `ROOMMATE_STATE_DIR/roommate.sqlite3`; FK/WAL/busy timeout; writes `BEGIN IMMEDIATE`, rollback DDL/mutations cùng transaction. Connection riêng mỗi context; không dùng DB Housing/Auth/Agent checkpoint để lưu Roommate.
- Contact ciphertext Fernet, khóa file riêng; channel/version thuộc từng owner. Idempotency `(actor, operation key, fingerprint)` trả safe IDs, không plaintext contact. Unordered pair reservation + quota và cooldown trong transaction.
- API `/api/v1/roommate/*` qua browser gateway `/web/api/roommate/*`: token server, actor từ session tin cậy; strict schema không cho body chọn actor/role. Availability công khai, dữ liệu người thật cần 18+/terms. No-store trên private JSON/media/lỗi.
- Media JPEG/PNG bounded, metadata stripped, lưu private BLOB, moderator duyệt trước gắn public; không dùng public asset URL để bỏ qua authorization.
- Read-time check hết hạn, contact version, block/restrict/delete cả hai bên. Accept và đổi contact/block serialize bằng transaction; rollback không để lộ một nửa grant. Contact đọc riêng, không có trong discovery/history/Agent.
- Canonical area snapshot do server cấu hình; không triển khai network adapter Location mới. Default whole-city; không tạo tọa độ hoặc sửa Housing.

### Ranking/lifecycle/Agent

- Score chỉ hiển thị khi comparable vùng/ngân sách, >=4 applied factors known, >=2 lifestyle known, coverage >=80%. Missing giữ weight với neutral 0,5. Làm tròn half-up để hiển thị, threshold label dùng raw; partial group không đánh giá người dựa trên lifestyle thiếu.
- TTL 30 ngày profile, 7 ngày pending và grant; edit không gia hạn. Hệ quả pause/expire/resolve/delete/restrict và hướng cooldown giữ theo spec. Underage declaration pause/cancel/revoke/redact; khôi phục eligibility không tự publish hoặc consent.
- Roommate capability read-only/cheap, budget LLM/provider=0; output chỉ entry/availability/ID refs và criteria có cấu trúc. Planner không tạo dependency vào Housing/Moving; không có commit kinds hay tool publish/send/accept cho Agent.
- Intake LLM chỉ trích xuất `roommate_criteria` có schema; không suy ra tuổi/consent/contact. Self facts tách khỏi preferences; hard chỉ khi người dùng nói rõ. LLM planner có grounding cho namespace mới.
- Domain result cache TTL 60 giây là ID handles; hydrate profile mới qua API kiểm tra lại quyền, không coi lịch sử/cache là snapshot công khai. Prompt/history projection whitelist Roommate, không đổi projection domain cũ.

### Evidence và quyết định phát hành

169 focused tests pass; full project 503 passed / 29 failed / 80 skipped. 29 lỗi giống baseline, chưa đạt gate hồi quy toàn project. Ruff/format/compileall đạt cho module Roommate mới. Test ASGI dùng API/gateway/DB thật; provider startup/NLU là offline DI, chưa xác nhận live LLM hay browser.

Discovery trước đây 2N+3 SELECT (block/restrict từng candidate), nay gom exclusions cùng search transaction: 4 SELECT với 10/100/1.000 candidates. Bảng thứ tự/score và quyền không thay đổi; fixture có block hai chiều + restriction. Sắp xếp toàn eligible set trước phân trang; chưa tuyên bố SLA/scale nhiều host.

G1–G6 backend đã có evidence; G7–G9 còn pending frontend/browser/full regression/release. Feature off mặc định. Chi tiết test mapping/29 lỗi/tài liệu bàn giao tại [checkpoint](../integration/roommate-backend-checkpoint.md), cấu hình/backup/rollback tại [runbook](../runbooks/roommate.md).
