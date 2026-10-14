# Bàn giao — Chat khách và đăng nhập theo thao tác

Ngày: 14/10/2026. Đã triển khai và chạy local; rollout cloud cần gate riêng. Không sửa workflow CI.

## Trải nghiệm

- Mở `/ai` không cần tài khoản. Khách có một hội thoại trong 24 giờ cố định; reload vẫn đọc được phiên còn hạn.
- Chat/tìm nhà, xem kết quả và bản đồ, tra cứu chuyến bay, đường đi, cẩm nang dùng công khai. Chọn nhà/chuyến bay là lựa chọn tạm, chưa đặt dịch vụ.
- Lưu yêu thích, gửi/đổi/hủy lịch xem, liên hệ, hồ sơ hành khách, báo giá Moving có thông tin giao nhận, đặt dịch vụ, thanh toán, Roommate và quản lý nhà cần tài khoản. Admin vẫn cần quyền riêng.
- Thao tác riêng mở đăng nhập trong ngữ cảnh. Hủy, nhập sai hoặc đăng nhập thành công giữ form/map/lựa chọn. Sau đăng nhập vẫn tự xác nhận thao tác; không tự đặt lịch/thanh toán.
- Hết hạn xóa ngữ cảnh khách khỏi UI và tạo phiên mới. Logout không cho phiên khách đọc hội thoại tài khoản. Lịch sử backend của account giữ nguyên; không thêm nút lịch sử.
- Đã sửa race khi phản hồi đầu tiên về trước khi React commit URL hội thoại, khiến kết quả có thể bị bỏ qua.

### UI đi kèm

- Welcome co giãn theo diện tích thực tế của khung hội thoại, giữ 6 dịch vụ và câu gợi ý dễ thấy ở màn hình thấp/mobile.
- Câu gợi ý mới: `Tìm nhà ở khu Ocean Park 2 dưới 5 triệu`; composer dùng placeholder ngắn để tránh chiếm thêm dòng.
- Gợi ý dịch vụ dùng card có icon/màu nhận diện/nút mũi tên rõ hơn, áp dụng chung cho dịch vụ và chuẩn bị xem nhà; không thêm nghiệp vụ/giao dịch.

## Phạm vi source

| Thành phần | Thay đổi |
| --- | --- |
| Gateway | `guest_sessions.py`: token hash, TTL/quota; `guest_routes.py`: allowlist; `guest_body_limit.py`: body streaming; `server.py`: actor/claim/cleanup |
| Agent | `guest_access.py`: quyền API/subagent; `api/guest_claim.py`: chuyển owner/checkpoint/draft/memory có journal; chặn giao dịch của guest |
| Web | `GuestSession` tách khỏi account; login dialog dùng form cũ; giữ ngữ cảnh khi nâng phiên; gate route/action, xử lý quota/expiry/logout |
| Cấu hình | `.env.example`, môi trường web trong `compose.coolify.yaml`; local bật riêng ở `.env.local` |

Không thêm database/service/dependency. SQLite gateway thêm `guest_sessions`, `guest_budgets`, `guest_metadata` khi startup; không drop/reset bảng cũ. Agent dùng checkpoint API và checkout/session store hiện có. Không đổi thuật toán Roommate, adapter nghiệp vụ hoặc giao dịch account.

## Quyền và ownership

- Identity do gateway cấp; không tạo user/email/password giả. Cookie HttpOnly/SameSite Strict, hash token trong DB. Cloud dùng `SIU_SECURE_COOKIE=true`.
- Agent vẫn cần bearer nội bộ và identity từ gateway; `anonymous`/guest giả bị từ chối. Backend/tool boundary chặn thao tác riêng, không dựa vào prompt LLM hay chỉ ẩn nút.
- Gateway claim đúng guest thread từ cookie sau khi kiểm tra mật khẩu. Agent chuyển owner + journal, draft `selected/discarded` không có lịch/payment state; gateway commit owner sau Agent ack.
- Lỗi giữa các bước: khóa guest cũ, giữ operation key để retry/reconcile. Không coi hai SQLite store là một transaction nguyên tử. Có test retry sau đóng/mở SQLite checkpointer giữa cập nhật checkpoint và chuyển draft.
- Memory chỉ lấy giá trị của đúng guest thread; không ghi đè account hoặc ghép quận/ngân sách theo địa điểm mâu thuẫn. Cookie cũ không đọc được thread đã chuyển.

## Cấu hình

```dotenv
RELOHOME_GUEST_ENABLED=true
RELOHOME_GUEST_TURNS_30M=10
RELOHOME_GUEST_TURNS_DAY=30
RELOHOME_GUEST_IP_TURNS_30M=30
RELOHOME_GUEST_IP_TURNS_DAY=100
RELOHOME_GUEST_GLOBAL_TURNS_DAY=300
RELOHOME_GUEST_REQUESTS_MINUTE=120
```

- Template/Compose mặc định `false`; `.env.local` đã bật để test. Cloud truyền biến ở service **web**, build image mới và restart gateway/Agent; chưa deploy cloud.
- Quota dùng bucket UTC epoch cố định 30 phút/ngày, không phải cửa sổ trượt. TTL phiên là 24 giờ từ khi tạo.
- Chat mới và tra cứu chiều về Flight tính vào quota; replay request ID hoàn tất không tính lại. Chọn tạm không dùng LLM; request đọc khác chịu giới hạn/phút.
- Counter persisted/atomic; xóa cookie không reset IP budget. IP được hash có salt, không lưu IP thô. Giới hạn tạo phiên 60/30 phút/IP, 1.000/ngày toàn gateway.
- Body guest/auth tối đa 64 KiB kể cả chunked, tối đa 10 giây nhận body; chat còn giới hạn message hiện có. Upload account không đổi.
- Quota lượt và budget gọi/token Agent hiện có **không phải bộ đếm USD**. Giữ hạn mức credit/spend ở OpenRouter/provider, đo traffic trước tăng quota. Provider lỗi không được quảng bá như lỗi có thể sửa bằng đăng nhập.
- Giữ **một gateway worker/replica và một Agent worker/replica** như deployment hiện tại. Thread lock process-local; không scale bằng SQLite volume độc lập. Scale sau cần xử lý lock/state/claim xuyên replica trước.
- Cấu hình Uvicorn chỉ tin forwarded headers từ reverse proxy thật. Không tin `X-Forwarded-For` từ Internet. Sai cấu hình IP sẽ làm nhiều khách dùng chung quota của proxy.

## Cleanup và rollback

- Mỗi 60 giây: tối đa 5 claim journal, 10 phiên hết hạn. Quyền hết hạn bị từ chối ngay, không chờ cleanup.
- Delete Agent checkpoint/memory trước rồi xóa messages/runs/thread/token gateway. Agent offline giữ dữ liệu để retry. Claim hoàn tất chỉ xóa guest token, giữ account thread.
- Log lỗi chỉ ghi loại lỗi. Theo dõi backlog bằng SQL đọc, không dump chat/cookie/PII:

```sql
SELECT COUNT(*) FROM guest_sessions
WHERE claimed=0 AND claim_target IS NULL AND expires <= unixepoch();
SELECT COUNT(*) FROM guest_sessions WHERE claimed=0 AND claim_target IS NOT NULL;
```

- Rollback: flag `false`, restart gateway; account giữ luồng cũ. Không drop bảng hoặc restore đè DB có dữ liệu mới. Cleanup tạm ngừng khi flag tắt, chạy lại khi bật.
- TTL online không cam kết xóa khỏi backup sau 24 giờ; team cần áp dụng retention backup riêng.
- Backup local trước khi bật: `data/private-backups/guest-chat-20261014/`, SQLite + key traveler; ignored, không đưa vào PR/data public.

## Bằng chứng kiểm tra

### Tích hợp main và PR

- Đã rebase trên `main` tại `331f03d` (merge PR #107 observability). Giải quyết 2 conflict, giữ `traced_node`/`invoke_graph`, middleware không tin trace từ browser và toàn bộ observability của main.
- Sau rebase: **601 backend/observability/packaging tests passed, 2 skipped**; `npm run lint:python`, build web và **44 contract tests** đạt.
- Repo local còn cache/egg-info của layout `src/` cũ; đã chuyển 221 file generated vào `.tmp/legacy-src-cache-20261014/`, không xóa source. Test packaging chạy Python UTF8 trên Windows đạt.
- [PR #165 — QuangDung → main](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/165). Đã push, chưa merge/deploy; xem checks của PR để biết CI mới nhất.
- CI của commit code `14371c2` đạt: **17 success, 2 skipped** theo điều kiện workflow Moving; GitHub báo `mergeable=true`, `clean`. [CI run](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/38517505922). Các cập nhật tài liệu sau đó phải kiểm checks ở head mới.

### Kiểm tra tính năng trước khi rebase

- Backend Agent/API/checkout/gateway: **554 passed, 2 skipped** theo điều kiện có sẵn; test ACL backup Windows chạy với quyền phù hợp, không bỏ assertion.
- Focused session/bearer/policy/concurrency/chunked body/expiry retry/durable claim: **12 passed**, nằm trong bộ trên.
- Browser gợi ý dịch vụ/chat presentation/service entry/viewing suggestions: **58 passed** desktop/mobile.
- Race phản hồi đầu tiên: lặp 5 lần mỗi desktop/mobile sau sửa, **10/10 passed**.
- Gate browser cuối sau sửa race: **22/22 passed**, gồm guest auth light/dark VI/EN, form/login và lịch chung desktop/mobile.
- Build TypeScript/Vite, Ruff trên file Python thay đổi đạt. Compose thật render được flag false/true, quota và secure cookie với biến giả, không deploy.
- HTTP local thật: session/thread 200, lịch/Roommate 401, status 200. Một lượt tìm nhà Ocean Park 2 qua Agent/provider thật trả `ANSWER`, property **2 kết quả**; đã xóa riêng thread test.
- Browser auth dùng transport fixture để kiểm Axe, light/dark VI/EN, giữ map DOM và không gửi booking/payment; không mô tả fixture là kiểm chứng giao dịch vendor thật.
- Browser trên hệ thống thật 8503: welcome/login đạt ở 4 tổ hợp desktop/mobile × light/dark; Axe dialog không có vi phạm, không có page error. Screenshot local tại `.tmp/guest-preview/` (ignored).
- Sau restart: 8/8 readiness HTTP 200; PostGIS healthy, 9 OSRM container đang chạy. Web phục vụ bundle mới `index-DoQONbs4.js`.

### Giới hạn của kiểm tra rộng

- Test cũ `app.spec.ts: chat, housing details, selection, saved, plan and reload` vẫn kỳ vọng thẻ nhà trong chat/nhãn `Đang hiển thị 2 căn` đã không còn trong UI hiện tại. Đối chiếu App nguyên bản `main` cũng lỗi desktop/mobile. Không skip/delete test; team cần cập nhật scenario theo map workspace trước gate E2E đầy đủ.
- Bộ deployment mở rộng trên Windows: test Compose lọc env làm CLI không tìm thấy plugin, báo `unknown flag: --env-file`; bash CI có khác biệt shell/timeout. Render riêng với môi trường Docker chuẩn đạt; CI Linux trên PR đã xanh ở commit code nêu trên. Không sửa `.github` hoặc hạ gate. CI xanh không đồng nghĩa toàn bộ browser E2E/staging thủ công đã đạt.
- Chưa kiểm staging multi-tab/account thật, load test cloud hoặc giao dịch thật. Gate release còn lại: [todo](../../tasks/guest-chat/todo.md).

## Test thủ công

1. Mở cửa sổ ẩn danh tại `http://127.0.0.1:8503/ai`, chat câu Ocean Park 2; xem kết quả/map không cần đăng nhập.
2. Điền form, mở đăng nhập rồi đóng/nhập sai; kiểm form còn nguyên. Roommate/chủ nhà mở yêu cầu đăng nhập.
3. Chọn nhà rồi gửi lịch: đăng nhập, kiểm căn/lịch còn nguyên và tự xác nhận lại; không tự gửi lúc login.
4. Reload cùng cửa sổ giữ phiên còn hạn; cửa sổ độc lập không đọc được URL thread đó.
5. Account kiểm lưu nhà, Roommate consent, chủ nhà, lịch/checkout theo luồng cũ; không thử giao dịch production.

PostGIS + 9 OSRM chạy Docker; 8 dịch vụ ứng dụng chạy launcher local hiện có. Readiness không đồng nghĩa đã bật giao dịch sandbox.
