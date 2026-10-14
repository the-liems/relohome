# Implementation plan — Guest chat và đăng nhập theo thao tác

Ngày 14/10/2026. **Đã triển khai và kiểm tra local.** Trạng thái từng gate: [todo.md](todo.md); thực tế: [bàn giao](../../docs/integration/guest-chat-2026-10-14.md).

Product/policy/UX/retention: [proposal](../../docs/ideas/guest-chat-login.md).
Task target: [todo.md](todo.md). Dùng folder riêng theo convention `tasks/ui-design-system/` và `tasks/viewing-bulk-scheduling/`; không ghi đè kế hoạch Roommate đang còn release task ở `tasks/plan.md`.

## Quyết định

- Một guest thread/phiên, TTL server 24 giờ; đăng nhập ở thao tác cần tài khoản.
- Giữ graph/adapter nghiệp vụ, bearer nội bộ, owner checks và Roommate consent; mở rộng authorization bằng code.
- Dùng gateway store và backend hiện có; migration additive, feature flag, không infrastructure mới.
- Ownership claim phải chuyển cả gateway và Agent bằng operation idempotent; không chỉ đổi `threads.owner`.
- Đăng nhập xong trở về form; mọi tác động/giao dịch vẫn cần xác nhận riêng.

## GC-01 — Session khách có định danh riêng

Scope M. Dependencies: none.
Files: gateway `store.py`, `server.py`, module session/policy mới, focused gateway tests.

Acceptance:

- Cookie/token hashed, TTL 24 giờ; không tạo user/email giả; capabilities additive không đổi account session.
- Hai guest cách ly; owner không lấy từ payload; hết hạn bị từ chối.
- Account login/admin/session regression vẫn pass; feature flag off giữ hành vi cũ.

Verify: focused session/ownership/cookie/expiry tests; `npm run deployment:check`.

## GC-02 — Chat và tra cứu công khai xuyên tầng

Scope: tách hai slice M: backend policy trước, frontend guest context sau. Dependencies: GC-01.
Files từng slice: gateway `server.py`, Agent `api/routes.py`, policy module, tests; sau đó web `App.tsx`, `types.ts`, `api.ts`, browser spec mới.

Acceptance:

- `/ai` chat Housing/Flight/Map được khi chưa đăng nhập; form/map/results như account; guest scope luôn do trusted gateway xác định.
- Code chặn task/tool/action riêng dù được yêu cầu qua chat; account graph không thay thuật toán.
- Khảo sát báo giá Moving thật: xác định chỗ cần contact, gate trước khi gửi PII; không giả quote và không mở rộng provider writes.

Verify: gateway+Agent permission tests, browser guest chat và multiline/multi-service, build web. Test riêng POST tìm kiếm đọc so với POST ghi.

## GC-03 — Quyền cho mọi chức năng riêng

Scope M/backend, M/frontend. Dependencies: GC-02.
Files từng slice: gateway policy/guards + focused tests; web protected routes/action helper/login form + browser tests.

Acceptance:

- Roommate workspace, Landlord/Admin, saved/profile, lịch xem/contact, checkout/payment bắt buộc account ở server; các quyền domain hiện có còn nguyên.
- Guest có CTA cụ thể theo thao tác; đóng login tiếp tục khám phá, không auto-submit.
- Dữ liệu draft tạm không bị nhầm thành lịch hẹn/đơn đã tạo; direct URL/direct HTTP không vượt guard.

Verify: authorization matrix và browser route/action tests, Admin role/Roommate consent regressions.

### Checkpoint 1 — Guest chat và gate

Account flows, build và focused tests đạt; review policy trước khi triển khai ownership transfer. Chưa mở public nếu quota chưa sẵn sàng.

## GC-04 — Internal ownership claim ở Agent

Scope M. Dependencies: GC-03.
Files: Agent `api/routes.py`, module claim mới, service/checkpointer integration, focused tests.

Acceptance:

- Chuyển owner/checkpoint/memory/draft selection của đúng một guest thread bằng internal operation; không bypass bearer hay nhận quyền client.
- Thread lock, idempotency và stale-owner fence; không transfer khi turn đang chạy, không transfer giao dịch thật.
- Inventory tất cả store phụ tham chiếu owner/thread trước khi bật; retry/offline không reset kế hoạch hoặc replay tool.

Verify: Agent claim concurrency/idempotency/old-owner/invalid-identity tests trên checkpointer thực tế đang dùng.

## GC-05 — Claim coordinator ở gateway

Scope M. Dependencies: GC-04.
Files: gateway `store.py`, claim coordinator mới, `server.py`, focused tests.

Acceptance:

- Journal/reconcile giữ đúng thứ tự giữa Agent và SQLite; account commit chỉ khi claim xác nhận, rollback không được giả là atomic hai DB.
- Chỉ guest cookie hiện tại được claim; không nâng quyền admin/profile/Roommate consent theo guest.
- Cookie guest bị thu hồi, account binding đúng; retry khi crash giữa hai bước không rò dữ liệu/nhân đôi thao tác.

Verify: crash-between-steps/retry/relogin/two-tab tests; restart gateway và kiểm tra journal.

## GC-06 — Trở về đúng form sau login

Scope M. Dependencies: GC-05.
Files: web auth/form composition, route/action guard, context, browser spec.

Acceptance:

- Login thành công giữ thread, map camera, lựa chọn và draft; hủy/login sai giữ guest.
- Lịch, đặt vé/xe, gửi contact, thanh toán vẫn có xác nhận riêng, không replay request lúc mount.
- VI/EN, light/dark, mobile/keyboard; logout chuyển guest mới và không hiển thị account data.

Verify: Playwright claim/gate/draft/map continuity, session expiry, two tabs, account regressions; `npm run build:web`.

### Checkpoint 2 — Đăng nhập liên tục

Chứng minh quyền sở hữu xuyên store và luồng xác nhận trước khi tiếp tục mở quyền guest trên cloud.

## GC-07 — Quota và giới hạn chi phí

Scope M. Dependencies: GC-02; phải hoàn tất trước public rollout.
Files: persistence/policy, gateway request gate, configuration template, tests.

Acceptance:

- Guest/session/IP budgets, một request đang chạy, giới hạn input/provider cost; không chỉ in-memory limiter.
- Cookie mới không vượt IP/cost cap; 429 khác provider 503; frontend hiển thị quota đúng.
- Cấu hình và concurrency có bằng chứng; nếu nhiều gateway replica, dùng shared database hiện có trước khi mở.

Verify: race/quota reset/body-cap/cost-bound tests; load test với provider stub không tốn quota vendor.

## GC-08 — Cleanup dữ liệu guest

Scope M. Dependencies: GC-05.
Files: gateway maintenance module mới, store metadata, Agent delete integration, tests.

Acceptance:

- Expired session mất quyền ngay; batch cleanup xóa gateway + checkpoint + memory, retry khi Agent offline.
- Không xóa account/claimed thread, keys, dữ liệu Roommate/Housing hay giao dịch cũ.
- Có đo backlog/failure không kèm PII; chính sách backup retention ghi rõ.

Verify: fake-clock/expiry/offline/restart/claimed-thread tests; dry-run maintenance trên state copy.

## GC-09 — Staging và bàn giao

Scope M. Dependencies: GC-06, GC-07, GC-08.
Files: focused end-to-end tests, proposal/runbook/handoff, additive feature-flag config nếu cần.

Acceptance:

- Existing CI xanh; không sửa workflow/gate. Account/Housing/Flight/Moving/Map/Roommate regression đạt.
- Incognito guest, login giữa chừng, TTL, quotas, backend deny và rollback flag được kiểm trên staging.
- Bàn giao actual evidence, retention/cost settings và giới hạn còn lại; chỉ tick hoàn thành theo kết quả thật.

Verify: existing test commands trong DEVELOPMENT.md, focused guest Playwright, security matrix và smoke trên staging được cho phép.

## Rủi ro chính

| Rủi ro | Xử lý |
| --- | --- |
| Claim đổi owner thiếu store phụ | Inventory, lock, journal, idempotency, crash tests trước public |
| Khách chạy nghiệp vụ riêng qua prompt | Capability policy ở API/tool boundary, không dựa LLM/ẩn nút |
| Chi phí LLM/API công khai | GC-07 là release gate; không tăng quyền tự động khi provider lỗi |
| Phiên cũ qua logout/URL/back button | Cookie rotation, server owner checks, context/cache partition |
| Over-engineering | Giữ storage/service/auth providers hiện có; chưa thêm OAuth/OTP/Redis |

Quotas đã cấu hình qua gateway/Compose. Giới hạn lượt và ngân sách gọi Agent hiện có không thay thế hạn mức USD của nhà cung cấp. Cloud/CI vẫn là release gate riêng; không suy từ readiness local rằng rollout production đã hoàn tất.
