# Roommate Discovery — Technical design foundation

- Ngày: 2026-10-07, Asia/Saigon.
- Baseline: [product spec v1.0](../ideas/roommate-service.md), [implementation plan](../../tasks/plan.md).
- Task thực hiện: **RM-01 — Mô hình hồ sơ và tiêu chí**.
- Trạng thái: đã triển khai domain models và focused tests; service chưa được nối vào runtime/API/Agent/frontend. G1 vẫn cần RM-02, RM-03 và review trước migration RM-04.

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

Đây là quyết định chuẩn bị triển khai, **chưa tạo database hoặc schema**. RM-02/03 cần chốt transaction/UoW, pair constraints, clock và projection rồi review G1 trước migration RM-04. Nếu deployment cần nhiều replica/HA, phải chọn PostgreSQL adapter và locking/transaction design trước RM-04; không dùng SQLite file riêng từng host để giả định coordination.

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
