# Guest chat — Checklist

Trạng thái 14/10/2026: **đã triển khai và chạy local**. [Bàn giao/bằng chứng](../../docs/integration/guest-chat-2026-10-14.md).

Acceptance/dependencies/verification: [plan.md](plan.md). Product: [proposal](../../docs/ideas/guest-chat-login.md).

- [x] Đối chiếu nguồn OpenAI về chat trước đăng nhập.
- [x] Audit route frontend, session gateway, owner/checkpoint Agent và Roommate public/private.
- [x] Lập policy, UX flow, TTL, quota, claim và rollback.
- [x] GC-01 Guest session/identity, cookie/TTL/cách ly owner; không tạo account giả.
- [x] GC-02 Guest chat xuyên backend/frontend; Moving quote/contact vẫn cần tài khoản.
- [x] GC-03 Gate thao tác riêng và route protected ở UI/backend/tool boundary.
- [x] Checkpoint 1 local: focused account/API/checkout regression, policy review.
- [x] GC-04 Internal Agent claim, SQLite checkpoint restart/retry, chuyển draft/memory.
- [x] GC-05 Gateway claim coordinator/reconcile, commit owner sau Agent ack.
- [x] GC-06 Login giữ form/map/lựa chọn, không auto-submit; logout/expiry tách identity.
- [x] Checkpoint 2 local: old-cookie fence/cách ly guest, claim crash/retry, login sai/hủy/thành công.
- [x] GC-07 Quota guest/IP/global persisted/atomic, body streaming và call bounds; cookie rotation không reset IP budget.
- [x] GC-08 Cleanup batch/retry Agent trước gateway; không xóa account thread đã claim.
- [x] GC-09 phần local: docs/cấu hình Compose/build/focused test/HTTP và provider smoke.
- [ ] Cloud: chốt quota/hạn mức USD ở vendor, trusted proxy IP, backup retention/load test.
- [ ] Staging: multi-tab với account thật, TTL/cleanup trên volume cloud, rollback flag thực tế.
- [ ] Linux CI hiện có xanh và toàn bộ E2E; cập nhật scenario cũ theo map workspace, không bỏ/hạ gate.
- [x] Rebase main `331f03d`, push QuangDung và mở [PR #165](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/165); 601 test backend/observability/packaging và 44 contract đạt sau rebase.
- [ ] Release: team review → merge/deploy được cho phép. Chưa thực hiện trong đợt này.

Các item còn mở là gate cloud. Không suy từ readiness local rằng toàn bộ release đã hoàn tất; xem giới hạn kiểm tra trong bàn giao.
