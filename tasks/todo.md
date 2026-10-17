# Roommate Discovery — Implementation checklist

## Hồ sơ dùng lại và kết nối để chat — cập nhật 17/10/2026

Đã hoàn tất code và kiểm thử theo [kế hoạch](../docs/architecture/roommate-profile-ux-plan-2026-10-16.md). Evidence và hướng dẫn nâng cấp tại [bàn giao ngày 17/10](../docs/integration/roommate-chat-profile-handoff-2026-10-17.md); chưa deploy cloud.

- [x] RU-01 Account intro — cùng nguồn `/me/intro`, gate và dirty form đúng, tách thông tin riêng tư.
- [x] RU-02 Criteria defaults — giữ criteria/route/current edits; tải criteria lỗi không tự nới bộ lọc.
- [x] Checkpoint hồ sơ — cùng dữ liệu hai màn, guest/terms đúng; xóa hồ sơ không tự điền lại tên.
- [x] RC-01 Lời mời chat — contract/domain/migration additive; không cần Phone/Zalo; giữ eligibility/quota và pending TTL.
- [x] RC-02 Accept — mở đúng một conversation nguyên tử/idempotent; không tạo contact grant; tương thích legacy.
- [x] RC-03 Messages API — member-only read/send, pagination/unread, chống gửi trùng và rate/body limits; SQLite/PG.
- [x] Checkpoint backend — hai actor chưa có contact gửi/đồng ý/nhắn được; outsider/pending bị chặn; race/retry và legacy đạt.
- [x] RU-03 Composer — summary/edit trong một khung; bỏ chọn kênh/checkbox chia sẻ liên hệ; giữ preview/recovery.
- [x] RU-04 Accept/focus — Đồng ý kết nối mở chat; không thêm xác nhận; đổi tab giữ draft, đổi actor dọn state.
- [x] RC-04 Messenger — view chung, adapter Housing/Roommate riêng, đúng conversation identity/unread/CTA Nhắn tin, reload được.
- [x] RC-05 Lifecycle/privacy — close/block/restriction, export phân trang/erase/retention, migration/rollback; private-only sender erase cũng thu hồi chat.
- [x] Checkpoint UI/lifecycle — double click, preview lỗi, unknown/retry, expiry pending, logout/block; không chat trùng hoặc lộ nội dung.
- [x] RU-05 UI — card/footer gọn, mobile, VI/EN, light/dark, keyboard/Axe.
- [x] RU-06 Regression/handoff — build, 206 PG, 42 UI, 4 tích hợp thật, 6 Housing messenger; 32 lỗi workspace trùng baseline đã ghi, CI không sửa.

Chat nội bộ Roommate đã triển khai theo yêu cầu ngày 17/10: gửi → đồng ý → chat ngay, không chia sẻ Phone/Zalo; tái sử dụng view Housing nhưng không dùng API/bảng/grant Housing thay cho Roommate. Checklist ngày 12/10 và baseline dưới đây giữ nguyên.

> Historical layout/command evidence (M23); use the [current development map](../DEVELOPMENT.md) for this branch.


## Production expansion — 12/10/2026

Theo yêu cầu hoàn thiện cho người dùng thật, kế hoạch RP ở đầu [plan.md](plan.md). Những checkpoint bên dưới là lịch sử, không thay evidence mới.

- [x] RP-01 Storage/query — SQLite read concurrency + map 100 hồ sơ <=6 SELECT; focused 173 pass ở checkpoint. Domain scoring không thay đổi.
- [x] RP-02 Schema — additive v1→v2, raw backup trước migration; giữ ID/version/deadline/ciphertext.
- [x] RP-03 PostgreSQL — real PG race/consent/restore và role không superuser đạt.
- [x] Checkpoint storage — 194 focused tests (domain/API/PG/Agent/gateway); policy/scoring không sửa.
- [x] RP-04 Inbox API — pagination/counterparty/unread/events/reminder, preview không contact và fresh permissions.
- [x] RP-05 Inbox UI — names/previews/badges/poll/reminder/paging/read; UI và real browser đạt.
- [x] RP-06 Media/settings — upload/review/attach/delete, quản lý contact/blocks; erase gỡ cả contact memory khỏi UI.
- [x] RP-07 Moderation — queue/filter/reason/audit + stats thật; reviewed không tự restrict; server role kiểm soát.
- [x] RP-08 UX/room — city-scoped picker/check thành phố khi biết rõ, unknown không đoán; explicit consent và VI/EN/Axe.
- [x] Checkpoint UX — 26 UI tests +4 real browser tests; desktop/mobile, VI/EN/sáng/tối/keyboard.
- [x] RP-09 Hardening — shared budgets/body/array caps/dedupe/safe errors/route metrics, giữ quota nghiệp vụ.
- [x] RP-10 Retry — encrypted server draft TTL30m/actor scope; explicit retry sau reload cùng key/payload; không PII trong browser storage.
- [x] RP-11 Data lifecycle — own export/erase/maintenance; quota/restriction/audit giữ nguyên. Retention backup/audit cần owner cấu hình cloud.
- [x] RP-12 Cloud ops — private DB/key snapshot/import/rollback/check/provision; SQLite↔PG, readonly snapshot và dedicated role đạt; chưa áp cloud thật.
- [x] Checkpoint operations — deployment 35 tests +62 subtests, Linux CI scripts 33 tests +73 subtests; không sửa state/key live.
- [x] RP-13 Code/handoff — [bàn giao](../docs/integration/roommate-production-2026-10-12.md), build/CI-scope Ruff/gates local; mutation expiry bị test bắt lỗi và source khôi phục nguyên byte.
- [ ] Release cloud — role/secrets/volume/backup/retention/moderator thật, staging rehearsal/cutover/load test và remote CI trước mở công khai.

Full regression cuối: 870 pass /96 skip /16 lỗi Bash/symlink/Linux path trên Windows (gồm subtests); các nhóm đó qua Linux 33 tests +73 subtests. CI-scope Ruff và Vite/TypeScript đạt. Handoff ghi rõ cấu hình vận hành thật chưa được áp trên cloud.

- Plan chi tiết: [plan.md](plan.md).
- Product spec: [roommate-service.md](../docs/ideas/roommate-service.md).
- Feature issue: [#65](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/65).
- Trạng thái: RM-01–31 hoàn tất backend/API/Agent. Frontend các luồng tìm, xem hồ sơ, gửi/nhận consent và lifecycle cơ bản đã triển khai; evidence: [frontend handoff](../Frontend/ROOMMATE_UI_HANDOFF.md). Backend 169 focused tests pass; frontend 10 UI + 2 real browser tests pass. Legacy UI 109 pass / 1 lỗi baseline mobile welcome; full backend 503 pass / 29 lỗi baseline / 80 skip. Các task tổng và release gates còn pending; chưa tạo issue con.
- Tick task xác nhận phạm vi task đó đạt; không thay kết quả checkpoint hoặc gate phát hành. Test command/acceptance criteria/file/dependency của từng task nằm trong plan.
- Không triển khai task phụ thuộc trước khi dependency đạt; tests viết/chạy cùng từng task. Phase Tests kiểm tra thêm xuyên lớp.
- Nếu chuyển sang tracker sau này, dùng mã RM cố định và chuyển nguồn tiến độ; không giữ hai checklist chạy độc lập.

## Data model

- [x] [RM-01 — Mô hình hồ sơ và tiêu chí](plan.md#rm-01) — dependency: không có. 53 focused tests pass; evidence và baseline failures: [technical design](../docs/design/roommate-discovery.md#4-evidence-rm-01). Full suite tại checkpoint RM-01: 387 passed / 29 failed / 80 skipped; chưa sửa service legacy.
- [x] [RM-02 — Mô hình request và consent](plan.md#rm-02) — dependency: RM-01. 16 tests mới pass, commit `98a53e6`.
- [x] [RM-03 — Contract nội bộ và projection an toàn](plan.md#rm-03) — dependency: RM-01, RM-02. 4 tests mới pass; foundation tổng 73 pass, G1 reviewed trong technical design.

### CP-01 — sau RM-01–RM-03

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## Repository/storage

- [x] [RM-04 — Khởi tạo persistence riêng](plan.md#rm-04) — dependency: RM-03.
- [x] [RM-05 — Lưu hồ sơ và quan tâm](plan.md#rm-05) — dependency: RM-04.

### CP-02 — sau RM-04–RM-05

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-06 — Persistence nguyên tử cho kết nối](plan.md#rm-06) — dependency: RM-04, RM-02.
- [x] [RM-07 — Persistence cho block và moderation](plan.md#rm-07) — dependency: RM-04.

### CP-03 — sau RM-06–RM-07

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## Scoring engine

- [x] [RM-08 — Chuẩn hóa giá trị dùng cho so sánh](plan.md#rm-08) — dependency: RM-01, RM-03.
- [x] [RM-09 — Hard filter hai chiều](plan.md#rm-09) — dependency: RM-08.

### CP-04 — sau RM-08–RM-09

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-10 — Hàm tính từng tiêu chí](plan.md#rm-10) — dependency: RM-08, RM-09.
- [x] [RM-11 — Điều kiện hiện score và xếp hạng](plan.md#rm-11) — dependency: RM-09, RM-10.

### CP-05 — sau RM-10–RM-11

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## Service layer

- [x] [RM-12 — Quyền dùng Roommate](plan.md#rm-12) — dependency: RM-05, RM-07.
- [x] [RM-13 — Discovery và chi tiết theo quyền](plan.md#rm-13) — dependency: RM-05, RM-11, RM-12.
- [x] [RM-14 — Lifecycle hồ sơ](plan.md#rm-14) — dependency: RM-05, RM-06, RM-12.

### CP-06 — sau RM-12–RM-14

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-15 — Gửi request và cooldown](plan.md#rm-15) — dependency: RM-06, RM-09, RM-12, RM-14.
- [x] [RM-16 — Accept và mở contact](plan.md#rm-16) — dependency: RM-06, RM-12, RM-15.
- [x] [RM-17 — Thu hồi và đổi kênh liên hệ](plan.md#rm-17) — dependency: RM-16.

### CP-07 — sau RM-15–RM-17

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-18 — Block/report và xử lý vi phạm](plan.md#rm-18) — dependency: RM-07, RM-12, RM-14, RM-17.
- [x] [RM-19 — Expiry, inbox và nhắc nhu cầu](plan.md#rm-19) — dependency: RM-14, RM-15, RM-16, RM-18.

### CP-08 — sau RM-18–RM-19

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## API

- [x] [RM-20 — Composition và feature availability](plan.md#rm-20) — dependency: RM-04, RM-13, RM-19.
- [x] [RM-21 — Guard và API discovery](plan.md#rm-21) — dependency: RM-03, RM-12, RM-13, RM-20.
- [x] [RM-22 — API hồ sơ và quan tâm](plan.md#rm-22) — dependency: RM-14, RM-20, RM-21.

### CP-09 — sau RM-20–RM-22

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-23 — API request, consent và đối soát](plan.md#rm-23) — dependency: RM-15, RM-16, RM-17, RM-19, RM-21.
- [x] [RM-24 — API an toàn và moderator](plan.md#rm-24) — dependency: RM-18, RM-21.

### CP-10 — sau RM-23–RM-24

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-25 — Ảnh hồ sơ riêng tư](plan.md#rm-25) — dependency: RM-14, RM-18, RM-21.
- [x] [RM-26 — Browser gateway Roommate](plan.md#rm-26) — dependency: RM-21, RM-22, RM-23, RM-24, RM-25.

### CP-11 — sau RM-25–RM-26

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## Agent integration

- [x] [RM-27 — Capability và fixture Roommate](plan.md#rm-27) — dependency: RM-03, RM-11.
- [x] [RM-28 — Subagent discovery không LLM](plan.md#rm-28) — dependency: RM-13, RM-20, RM-27.
- [x] [RM-29 — Intake tiêu chí và định tuyến](plan.md#rm-29) — dependency: RM-01, RM-27, RM-28.

### CP-12 — sau RM-27–RM-29

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

- [x] [RM-30 — Planner và phản hồi domain](plan.md#rm-30) — dependency: RM-28, RM-29.
- [x] [RM-31 — Không rò dữ liệu từ lịch sử Agent](plan.md#rm-31) — dependency: RM-18, RM-26, RM-28, RM-30.

### CP-13 — sau RM-30–RM-31

- [x] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [x] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [x] Review gate tương ứng ở plan; không cho task kế tiếp dùng hành vi chưa được kiểm chứng.

## Frontend

- [x] [RM-32 — Typed client và entry quyền dùng](plan.md#rm-32) — dependency: RM-26, RM-31. Guest/disabled/18+/terms/session states và strict payload được kiểm tra.
- [x] [RM-33 — Form tiêu chí và danh sách](plan.md#rm-33) — dependency: RM-11, RM-32. Self/preference riêng, hard explicit, backend score/reasons, missing score và pagination.
- [x] [RM-34 — Chi tiết hồ sơ và quan tâm](plan.md#rm-34) — dependency: RM-22, RM-32, RM-33. Fresh API detail, bookmark riêng, unavailable không phục hồi snapshot, bỏ lưu được khi unavailable.

### CP-14 — sau RM-32–RM-34

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

- [ ] [RM-35 — Editor bản giới thiệu riêng](plan.md#rm-35) — dependency: RM-22, RM-23, RM-25, RM-32. Editor text/facts/preferences và contact picker đã có; media upload editor và management đầy đủ channel còn ngoài phạm vi tìm/kết nối hiện tại.
- [ ] [RM-36 — Quản lý nhu cầu và xuất bản](plan.md#rm-36) — dependency: RM-14, RM-19, RM-35. Đã có preview/publish/reconfirm/pause/resume/resolve/delete, tests thực tế publish/pause/resume/delete; task tổng vẫn pending nhắc hạn 3 ngày và dependency RM-35.
- [ ] [RM-37 — Form gửi request và consent](plan.md#rm-37) — dependency: RM-23, RM-34, RM-35. Luồng review/consent và đối soát unknown outcome đã có 2 nhóm browser tests; task tổng giữ pending theo dependency RM-35.

### CP-15 — sau RM-35–RM-37

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

- [ ] [RM-38 — Inbox và xem liên hệ có thời hạn](plan.md#rm-38) — dependency: RM-19, RM-23, RM-37. Received/sent, accept/reject/withdraw/revoke, memory-only lease/expiry/blur/focus đã có; task tổng giữ pending dependency và bộ stale-tab scenarios cuối.
- [ ] [RM-39 — Block/report và moderation UI](plan.md#rm-39) — dependency: RM-24, RM-34, RM-38. Block/report riêng đã có; moderator dashboard chưa thuộc phạm vi UX tìm/kết nối đợt này.

### CP-16 — sau RM-38–RM-39

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

- [ ] [RM-40 — Navigation và result card Agent](plan.md#rm-40) — dependency: RM-30, RM-31, RM-32, RM-33, RM-34, RM-36, RM-38, RM-39. Route/account entry/Roommate result card/progress label đã nối; task tổng giữ pending dependencies của plan phát hành đầy đủ.
- [ ] [RM-41 — VI/EN, responsive và accessibility](plan.md#rm-41) — dependency: RM-40. Các màn hiện có pass 320/768/1024/1440, light/dark, VI/EN, axe, keyboard/focus/reduced motion; task tổng chờ đầy đủ các màn ở dependency.

### CP-17 — sau RM-40–RM-41

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

## Tests

- [ ] [RM-42 — Integration vòng đời và cạnh tranh](plan.md#rm-42) — dependency: RM-19, RM-20, RM-26.
- [ ] [RM-43 — Full-stack browser Roommate](plan.md#rm-43) — dependency: RM-26, RM-31, RM-41, RM-42.
- [ ] [RM-44 — Privacy, số lần gọi LLM và chi phí tìm](plan.md#rm-44) — dependency: RM-11, RM-26, RM-31, RM-43.

### CP-18 — sau RM-42–RM-44

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

## Regression

- [ ] [RM-45 — Hồi quy backend và Agent hiện tại](plan.md#rm-45) — dependency: RM-42, RM-43, RM-44.
- [ ] [RM-46 — Hồi quy frontend toàn bộ service](plan.md#rm-46) — dependency: RM-41, RM-43, RM-45.
- [ ] [RM-47 — Gate phát hành và bàn giao](plan.md#rm-47) — dependency: RM-44, RM-45, RM-46.

### CP-19 — sau RM-45–RM-47

- [ ] Focused tests của các task trong checkpoint pass; ghi lệnh và evidence.
- [ ] Review diff, dependency và contract; feature-off giữ ứng dụng hiện tại hoạt động.
- [ ] Build frontend và kiểm tra flow liên quan; lưu lỗi console/network và kết quả responsive.

## Gate cuối

- [ ] G1–G9 ở plan đã có bằng chứng tương ứng.
- [ ] AC-01..31 có test mapping và kết quả, không bỏ tiêu chí để rút scope.
- [ ] Backend/gateway/Agent/frontend regression pass; build sạch; không làm thay đổi logic service cũ.
- [ ] Chủ sản phẩm review trước bật service; không tự deploy/push.

## Checkpoint backend hiện tại

- G1–G6 có evidence tại backend checkpoint; các checkbox CP-01–13 phản ánh review/test backend, không thay gate phát hành toàn project.
- RM-42: đã thêm race, expiry/restart, backup/restore xuyên backend; vẫn giữ task tổng pending vì phase tests/regression cuối còn theo plan.
- RM-43/44: có real session ASGI integration, privacy và query-count 10/100/1000; bổ sung 2 real browser flows, chưa đủ toàn bộ privacy/media/moderation/cost scenarios của task tổng.
- RM-45: đã chạy hồi quy; 29 lỗi baseline còn tồn tại, không tick pass.
- RM-46: UI cũ 109/110 tests pass; mobile welcome overflow 19px được tái hiện khi tháo wiring Roommate. Giữ UI cũ, không skip/sửa assertion. RM-47/gate phát hành chưa đạt. Feature giữ off; chưa push/deploy.

## Checkpoint frontend theo phạm vi hiện tại

- Chỉ các màn tìm/kết nối/hồ sơ cơ bản; không sửa backend, API/scoring hoặc UX/UI service cũ.
- Handoff có module list, test commands/evidence và giới hạn contract: [ROOMMATE_UI_HANDOFF.md](../Frontend/ROOMMATE_UI_HANDOFF.md).
- Các mục chưa tick vẫn là yêu cầu cho bản phát hành đầy đủ trong plan, không bị xóa hoặc hạ acceptance criteria.

## Roommate Admin UI — 17/10/2026

Thiết kế: [kế hoạch chi tiết](../docs/design/roommate-admin-redesign-2026-10-17.md).
Chỉ tab **Admin → Ở ghép**. Tất cả task dưới đây **chưa triển khai**.
Giữ nguyên trạng thái của các task lịch sử phía trên.

### RA-01 — Chốt dữ liệu và adapter danh sách

Phụ thuộc: không. Quy mô S, 2–3 file types/adapter và test liên quan.

- [ ] Mapping hồ sơ/ảnh/báo cáo đúng enum, `facts`, ngân sách/người/tháng và dữ liệu thiếu.
- [ ] Ghi rõ trường có sẵn/chưa có; không tạo title, ngày đăng, PII hay KPI giả.
- [ ] Đồng bộ baseline main vào nhánh triển khai an toàn, giữ thay đổi local; adapter tests đạt.

### RA-02 — Header, KPI và bảng/card hồ sơ

Phụ thuộc: RA-01. Quy mô M, `admin/RoommateModeration.tsx`, component mới ở
`admin/roommate/`, CSS scope riêng và `roommate-admin.spec.ts`.

- [ ] Tab con compact có selected/count, KPI thật, toolbar thẳng hàng; hồ sơ table desktop/card mobile.
- [ ] Dữ liệu thật từ queue/status/pagination hiện có; chưa hiện filter/batch giả hoặc CTA duyệt toàn hồ sơ.
- [ ] Build + Chrome light/dark desktop/mobile đạt; không đổi CSS các màn Roommate người dùng hoặc Admin Housing.

### RA-03 — Trình bày hàng đợi ảnh và báo cáo

Phụ thuộc: RA-01, RA-02. Quy mô M, hai view queue và browser test.

- [ ] Ảnh có preview đọc được qua private API; báo cáo có mục tiêu, lý do và trạng thái đúng.
- [ ] Pending/empty/error/403 phân biệt được; payload/client/actor và quy trình duyệt/resolve hiện có được giữ.
- [ ] Browser qua gateway/API test xác nhận duyệt ảnh không tự gắn avatar, resolve không tự hạn chế tài khoản.

### RA-04 — Drawer và hành động quản trị

Phụ thuộc: RA-02, RA-03. Quy mô M, drawer/actions, Dialog reuse, browser test.

- [ ] Drawer đọc dữ liệu có sẵn, giữ focus/filter/page; footer sticky hoạt động trên mobile, Escape và keyboard dùng được.
- [ ] Hạn chế/khôi phục có lý do và thông báo tác động đúng policy; restore trả hồ sơ về paused.
- [ ] Test Admin chưa consent, user thường, timeout/recovery/hết phiên và bấm đôi; không tự submit lại sau đăng nhập.

### Checkpoint A — Giao diện sử dụng được với API hiện có

- [ ] So sánh screenshot trước/sau, light/dark, desktop/mobile; controls chưa hoạt động không xuất hiện.
- [ ] Build, focused browser/API và hồi quy Admin Housing/Roommate người dùng đạt hoặc ghi rõ lỗi baseline đã đối chiếu.

### RA-05 — Tìm kiếm/lọc/sort và số đếm phía server

Phụ thuộc: Checkpoint A. Chia thành hai lát M: read service/API/tests, sau đó toolbar/URL/tests.
File chính: `services/moderation.py`, `api/roommate_safety.py`, gateway whitelist,
typed client và toolbar của Admin Roommate.

- [ ] Query có validate/allowlist, total/list cùng predicate/expiry; thứ tự có khóa phụ ổn định, SQLite/PostgreSQL nhất quán.
- [ ] Tên/mã hồ sơ, thành phố/nhu cầu/ngân sách và status kết hợp được; date chỉ theo timestamp thật, không lọc tại một trang client.
- [ ] Filter reset page/selection; hủy response cũ, Back/Forward đúng; PII search không mặc định lưu URL/localStorage; API/browser tests đạt.

### RA-06 — Chi tiết đầy đủ và lịch sử xử lý có quyền

Phụ thuộc: RA-04, RA-05. Chia thành hai lát M: detail/history read API, sau đó drawer/history UI.
File chính: moderation service/router, gateway allowlist, drawer và tests.

- [ ] Detail/history theo target, có phân trang và quyền moderator; không mở chat, contact, preferences riêng hoặc nội dung đã xóa.
- [ ] Audit chỉ hiện actor/target/action/reason/time thật; không dựng before/after, ngày tạo tài khoản hay ID ảnh mà DB chưa lưu.
- [ ] Test record biến mất/version thay đổi, privacy erase và outsider; thêm schema/index chỉ khi có thiết kế và bằng chứng cần thiết.

### RA-07 — Resolve báo cáo hàng loạt trong trang

Phụ thuộc: RA-03, RA-05, RA-06. Quy mô M, selection/batch bar và browser/API tests.

- [ ] Checkbox chọn mục hợp lệ trong trang, select-all indeterminate, hiện đúng số lượng và xác nhận; không bulk restrict hoặc duyệt hồ sơ.
- [ ] Resolve dùng endpoint hiện có, giới hạn đồng thời; kết quả riêng từng mục, giữ mục lỗi và refetch KPI/list sau xử lý.
- [ ] Test partial failure, timeout, đổi trang/filter/account, hết phiên giữa batch; không retry mù hoặc tạo audit lặp cho resolve.

### Checkpoint B — Công cụ quản trị đầy đủ trong phạm vi

- [ ] KPI/filter/list/detail/history thống nhất dữ liệu và quyền; restrict/restore không đổi policy Roommate.
- [ ] Test SQLite/PostgreSQL, race/expiry/retry/partial failure đạt; không hạ assertion hoặc skip test để làm xanh.

### RA-08 — Nghiệm thu và bàn giao

Phụ thuộc: Checkpoint B. Quy mô M, browser regression, docs/runbook và test evidence.

- [ ] Build, focused backend/browser, axe/keyboard/zoom và VI/EN light/dark đạt ở desktop/tablet/mobile; trạng thái lỗi/trống/disabled rõ ràng.
- [ ] Hồi quy các tab Admin Housing và Roommate người dùng; hai ca auth baseline cũ được kiểm tra lại và báo đúng trạng thái.
- [ ] Bàn giao phạm vi/ảnh trước-sau/API/env không đổi, CI đúng SHA và smoke cloud bằng tài khoản test được phép; ghi rõ phần chưa xác minh.
