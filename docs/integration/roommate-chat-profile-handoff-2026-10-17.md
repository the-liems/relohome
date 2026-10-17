# Bàn giao Roommate: kết nối để chat và bản giới thiệu dùng lại

Ngày: 17/10/2026. Baseline trước thay đổi: `f5e6209`, có cùng cây source với `origin/main` `713266f` tại lần đối chiếu trước. Phạm vi: code local, chưa deploy cloud, chưa tạo PR trong đợt này.

## 1. Trải nghiệm đã triển khai

**Xem hồ sơ → Gửi yêu cầu kết nối → Người nhận đồng ý → Chat trực tiếp trong ReloHome.**

- Luồng mới không yêu cầu Phone/Zalo, không chọn kênh hoặc tick chia sẻ số điện thoại. Gửi và đồng ý là hai hành động chủ động của hai người; chưa đồng ý thì chưa chat được.
- Người nhận được mở hội thoại sau accept. Người gửi có trạng thái đã đồng ý và nút **Nhắn tin**, không bị chuyển màn hình cưỡng bức.
- Widget Tin nhắn dùng chung lối vào cho Nhà thuê và Ở ghép, có nhãn loại hội thoại và số chưa đọc. Có phân trang hội thoại và tin nhắn cũ.
- Tin nhắn là text, tối đa 2.000 ký tự; có retry cùng client message ID khi kết quả mạng chưa rõ. Không tự gửi lại draft khi tải trang.
- Có Ngừng kết nối, Chặn và Báo cáo. Đóng kết nối dừng gửi hai phía; chặn/thu hồi quyền làm server từ chối truy cập. Bỏ chặn không tự khôi phục quyền gửi.
- Trong **Tài khoản → Hồ sơ** có **Bản giới thiệu ở ghép**. Account và Roommate dùng chung `/me/intro`; sang màn gửi chỉ xem tóm tắt hoặc chỉnh sửa.
- Tên tài khoản chỉ gợi ý khi chưa có bản giới thiệu. Không điền lại bản đã lưu trống/xóa, không lấy hồ sơ hành khách hoặc email đăng nhập sang Roommate.
- Bản giới thiệu riêng và hồ sơ công khai vẫn độc lập. Lưu riêng không tự publish/reconfirm; sửa nhu cầu vẫn theo kiểm tra pending cũ.
- Khi tìm kiếm: đầu vào phiên/route và criteria đã lưu có ưu tiên; intro chỉ làm mặc định khi chưa có criteria. Tải criteria lỗi thì báo lỗi, không tự tìm với bộ lọc yếu hơn.

Khung chat được kiểm tra desktop/mobile, light/dark, VI/EN, keyboard và Axe. Thông điệp làm quen có giao diện trung tính; không dùng nền cảnh báo cho trạng thái kết nối bình thường.

## 2. Những ranh giới được giữ

| Phần | Cách giữ tương thích |
| --- | --- |
| Matching | Không sửa eligibility, factors, ranking, normalization hoặc thuật toán ghép |
| Housing chat | Giữ API/bảng/vai trò tenant–landlord; chỉ dùng chung widget và `MessageComposer` trình bày |
| Kết nối Phone/Zalo cũ | Giữ route, consent, contact version, vault, grant TTL và recovery cũ |
| Định danh | Cookie quyết định actor; `X-Roommate-Actor` tùy chọn chỉ kiểm tra tài khoản dự kiến, không cấp quyền impersonate |
| Profile lifecycle | Giữ publish/review, profile TTL 30 ngày, private/public snapshot và điều kiện 18+/terms |
| Quota | Chat/contact cùng tính số yêu cầu hiện có; cooldown vẫn áp dụng. Không lách quota bằng đổi loại kết nối |
| Dịch vụ khác | Không sửa MCP/provider, payment, orchestration, dữ liệu Housing/routing hoặc workflow CI |

Kết nối legacy không tự biến thành chat. Muốn dùng chat, gửi lời mời chat và được đồng ý rõ ràng; grant Phone/Zalo cũ không tạo membership mới.

## 3. API và thành phần

Browser prefix: `/web/api/roommate`; backend: `/api/v1/roommate`.

| Method / path sau prefix | Chức năng |
| --- | --- |
| `POST /chat/requests` | `recipient_id`, `intro`, `operation_key`; không contact/consent chia sẻ số |
| `POST /chat/requests/{id}/accept` | Accept đúng recipient, trả `conversation_id` |
| `GET /chat/conversations?offset=0&limit=25` | Danh sách được phép, `has_more`, `unread_total`; limit tối đa 50 |
| `GET /chat/conversations/{id}/messages?before=...&limit=30` | Tin nhắn phân trang, actor đang xem, trạng thái và retention; limit tối đa 50 |
| `POST /chat/conversations/{id}/messages` | `body`, `client_message_id`; sender do server suy ra |
| `POST /chat/conversations/{id}/read` | `message_id` đã xem; cursor không đi lùi hoặc đánh dấu nhầm tin mới đến |
| `POST /chat/conversations/{id}/close` | `operation_key`; ngừng kết nối |
| `GET /me/privacy/chat-messages?before=...&limit=250` | Xuất tiếp tin do chính actor gửi; tối đa 500/response |

`/me/privacy/export` giữ dữ liệu export cũ và thêm tối đa 250 tin nhắn cùng `chat_messages_next`. UI hiện nút tải tiếp khi còn dữ liệu, không âm thầm cắt lịch sử và không gom toàn bộ tin nhắn vào một response lớn.

API cũ `/requests`, `/requests/{id}/accept`, `/requests/{id}/contact` vẫn cho kiểu contact. Record mới có `mode="chat"`; record cũ mặc định `mode="contact"` và vẫn bắt buộc consent hợp lệ. Gateway chỉ mở thêm các route/query được liệt kê.

Nguồn chính:

- [Chat service](../../packages/python/roommate/src/relohome_roommate/services/chat.py), [API chat](../../apps/agent-api/src/relohome_agent/api/roommate_chat.py), [gateway](../../apps/browser-gateway/src/relohome_gateway/roommate_gateway.py).
- [Widget chung](../../apps/web/src/components/ContactMessenger.tsx), [Roommate thread](../../apps/web/src/roommate/RoommateThread.tsx), [composer](../../apps/web/src/roommate/ChatConnectionComposer.tsx), [chi tiết kết nối](../../apps/web/src/roommate/ChatConnectionDetails.tsx).
- [Account intro](../../apps/web/src/roommate/AccountIntroPanel.tsx), [nguồn intro dùng lại](../../apps/web/src/roommate/useIntro.ts), [client gắn actor dự kiến](../../apps/web/src/roommate/useRoommateClient.ts).

## 4. Database, quyền và retention

Schema Roommate **v3**, additive, dùng cùng cơ chế SQLite/PostgreSQL hiện có. Thêm `chat_pairs`, `chat_conversations`, `chat_messages`, `chat_reads`, `chat_message_keys` và indexes. Không thêm FK sang bảng Housing/auth hoặc sửa dữ liệu chuẩn hóa.

- Một cặp chỉ có một hội thoại active. Gửi ngược chiều, accept đồng thời, timeout và retry được xử lý bằng transaction/uniqueness/idempotency.
- Request pending vẫn hết hạn sau 7 ngày. Chat đã accept không dùng grant TTL 7 ngày; profile hết hạn/pause/resolved cũng không tự khóa cuộc chat đã đồng ý.
- Mỗi lần read/send kiểm tra membership, tài khoản, restriction, block và quyền đã thu hồi. Xóa riêng dữ liệu Roommate cũng thu hồi chat khi người gửi chưa từng có hồ sơ công khai.
- Ngừng kết nối giữ lịch sử chỉ đọc khi còn quyền; xóa/thu hồi quyền có thể làm hội thoại không còn truy cập được. Tạo kết nối lại cần lời mời mới.
- Tin nhắn mới giữ mặc định **180 ngày**, cấu hình `ROOMMATE_CHAT_RETENTION_DAYS=1..3650`; có trong [.env.example](../../.env.example). Worker maintenance hiện có chạy mỗi 60 giây; đường đọc cũng đối soát trước khi trả dữ liệu.
- Giữ ledger hash/ID để retry không tái tạo tin đã bị xóa do retention/erase. Ledger không giữ body. Chính sách quota/audit cũ được giữ.
- Export chỉ gồm nội dung do chính người dùng gửi; erase xóa tin do họ gửi, đóng/thu hồi hội thoại và xóa cursor của họ. Người kia không được dùng chat đã thu hồi để đọc lại nội dung.
- Rate limit gửi chat là 20 lần/phút/actor, dùng store chung. Giới hạn request/quota cũ độc lập với giới hạn tài nguyên này.
- Không đưa body chat vào LLM, browser storage, thông báo hoặc log mới. UI render text, không thực thi HTML. HTTP private có `no-store`; thao tác từ tab giữ actor cũ bị gateway từ chối trước upstream.

Backup là bản sao riêng: thay đổi retention/erase ở DB hoạt động không tự xóa snapshot ngoài hệ thống. Operator tiếp tục áp chính sách backup/retention hiện có và bảo vệ key ổn định.

## 5. Nâng cấp local/cloud

1. Giữ nguyên state dir/private schema, moderator, token và contact key hiện tại. Không tạo key mới cho dữ liệu cũ.
2. Chụp backup **trước khi process v3 mở storage**. Với SQLite dùng lệnh raw backup hiện có từ root và môi trường đã cấu hình:

   ```powershell
   .venv/Scripts/python.exe scripts/roommate-ops.py backup-sqlite --directory logs/private-roommate-backups/pre-chat-20261017
   ```

   Thư mục đích phải mới. Snapshot gồm DB và key; không đưa vào public assets. Với PostgreSQL, chụp snapshot/`pg_dump` schema private và giữ key trước khi khởi động image mới. Lệnh `backup` thông thường mở runtime nên có thể chạy migration trước khi chụp; không dùng nó thay snapshot trước nâng cấp PostgreSQL.
3. Deploy/restart agent API để nâng schema và có API chat, sau đó browser gateway để có allowlist mới. Build web bằng `npm run build --workspace apps/web`, phục vụ bundle mới và tải lại browser.
4. Availability thêm feature `chat`; frontend mới chỉ dùng composer mới khi backend thông báo feature này. Frontend cũ vẫn dùng API legacy; backend cần lên trước frontend.
5. Thử bằng hai tài khoản test: recipient đăng hồ sơ đang tìm, sender hoàn thiện intro rồi gửi yêu cầu, recipient đồng ý và nhắn hai chiều. Sender không bắt buộc đăng hồ sơ công khai.
6. Rollback frontend có thể giữ backend v3 hỗ trợ cả hai kiểu. Không chạy backend chỉ hiểu schema v2 trên DB v3; muốn rollback backend cần phương án snapshot/giữ ghi mới được operator xét, không tự downgrade hoặc xóa bảng chat.

Đợt triển khai này chỉ dùng state test riêng để nghiệm thu; chưa áp migration hay deploy vào database/cloud thật của người dùng.

## 6. Kiểm chứng

| Nhóm | Kết quả |
| --- | --- |
| TypeScript + Vite production build | Đạt |
| Domain/API/storage Roommate với PostgreSQL thật | **206 passed**; database test riêng, xóa sau test |
| SQLite + gateway Roommate | **200 passed, 7 skipped**; skip là những ca PG trong lượt không cấp URL test |
| Cross-service auth/gateway/API/agent privacy | **53 passed** tại checkpoint; contract gateway/chat bổ sung tiếp tục đạt |
| UI Roommate cũ/mới | **42 passed**; VI/EN, sáng/tối, desktop/mobile, Axe, dirty form và export phân trang |
| Chrome → session gateway → API → SQLite | **4 passed**, gồm chat hai chiều/close, upload/moderation, publish/pause/resume/delete và privacy erase |
| Messenger Housing dùng chung | **6 passed**: owner/tenant names, timeline/deep link và admin bell |

Lượt browser workspace rộng: **128 passed, 32 failed**. Đã đối chiếu nguyên 32 ca lỗi Housing/Moving/Flight trên worktree baseline `f5e6209`: **cùng 32 ca lỗi**, thêm 2 ca trong nhóm đối chiếu đạt. Không sửa CI, không xóa/skip các ca này để làm xanh kết quả. Vì vậy không coi toàn bộ suite frontend là xanh.

Artifact local:

- `apps/web/test-results/roommate-chat-release/`: UI và ảnh chat light/VI, dark/EN, desktop/mobile.
- `apps/web/test-results/roommate-chat-release-integration/`: lượt tích hợp thật cuối.
- `.tmp/roommate-ui-baseline/baseline-focused.json`: đối chiếu nhóm lỗi baseline.
- `.tmp/run-roommate-chat-postgres.py`: helper local kiểm thử qua DB `rmchat_test_*` tách riêng, không chứa password cố định.

Lệnh chạy lại (root repo; Chrome và môi trường theo DEVELOPMENT.md):

```powershell
.venv/Scripts/python.exe -m pytest tests/test_roommate apps/browser-gateway/tests/test_roommate_gateway.py -q
npm run build --workspace apps/web
npm run test:e2e --workspace apps/web -- --config playwright.roommate-ui.config.ts roommate.spec.ts roommate-production.spec.ts
npm run test:e2e --workspace apps/web -- --config playwright.roommate.config.ts
```

Các ca PostgreSQL yêu cầu `ROOMMATE_TEST_DATABASE_URL` của database test tách riêng. Không dùng URL production cho suite vì có tạo/xóa schema test và bài kiểm tra quyền. Các ca UI fixture không chứng minh provider thật; các ca tích hợp đều dùng người/nội dung synthetic, không gửi liên hệ tới người dùng thật.

## 7. Giới hạn thực tế

- Chat text và polling, chưa thêm file/ảnh gửi trong chat, push notification hoặc WebSocket; tab mở hội thoại poll 15 giây, danh sách poll 10 giây.
- Intro riêng vẫn chưa có optimistic version đa thiết bị. Có bảo vệ dirty form, actor và refetch; không cam kết merge đồng thời từ hai thiết bị.
- Cloud backup schedule, tải thực tế và observability hạ tầng tiếp tục theo runbook vận hành; chưa diễn tập deploy cloud trong đợt này.
- Các lỗi baseline ở mục 6 cần được xử lý riêng trước khi tuyên bố toàn bộ frontend CI xanh.

## 8. Sửa lỗi review PR #212 — 17/10/2026

Hai ca lỗi đã được tái hiện trước khi sửa:

- Tải 60 tin rồi gửi tin 61 làm mất tin 31 khỏi giao diện. Test Chrome thất bại cả desktop/mobile; database vẫn giữ tin.
- Đọc thông báo tin đầu, nhận tin mới: badge thông báo là 0 trong khi messenger là 1. Test service SQLite thất bại tại đúng assertion unread.

Bản sửa:

- Ghép các trang theo message ID và thứ tự cursor `(created_at, id)`, giữ `has_more` của biên lịch sử cũ nhất đã tải. Không thay toàn bộ lịch sử bằng cửa sổ 30 tin mới nhất.
- Nếu tab bỏ lỡ hơn một trang tin, đọc tiếp bằng cursor tới đoạn đã biết trước khi ghép. Tải trang cũ không được ghi đè trạng thái hội thoại mới hơn; phản hồi từ trước lần invalidation không được phục hồi lịch sử đã xóa khỏi UI.
- Thông báo chat dùng message ID làm khóa sự kiện, còn `resource_id` vẫn là request/conversation để deep link hiện có hoạt động. Retry cùng client message ID trả kết quả cũ trước bước phát thông báo. Thông báo lifecycle khác giữ cách định danh cũ.
- Không cần migration bổ sung so với schema v3 của PR; không đổi API contract, workflow CI, matching hoặc luồng Phone/Zalo cũ.

Kiểm chứng bổ sung:

- Roommate SQLite/PostgreSQL, gateway Roommate và auth matrix: **255 passed**, database PostgreSQL test riêng.
- UI Roommate rộng: **52 passed**, desktop/mobile, theme/ngôn ngữ, retry, privacy và accessibility.
- Hồi quy lịch sử: **12 passed** ở lượt cuối; gửi/poll với 60 tin, tải một phần trong 90 tin, nhận 31 tin khi tab bỏ lỡ một cửa sổ, tải trang cũ chậm sau khi hội thoại đóng; gồm desktop/mobile.
- Chrome → gateway → API → SQLite: **4 passed** với state synthetic riêng; gồm chat hai chiều, từ chối actor cũ, đóng kết nối và privacy erase.
- Production web build, Ruff check/format và diff whitespace đạt. Không gọi provider/LLM trả phí để kiểm thử hai bản sửa này.

Artifact nằm trong worktree test riêng `apps/web/test-results/chat-fixes-release`, `chat-history-final`, `chat-fixes-integration`; không đưa dữ liệu test vào bundle hoặc DB ứng dụng.

## 9. Bỏ hồ sơ demo khỏi sản phẩm — 17/10/2026

- Bỏ tab DEMO, CTA xem demo ở trạng thái trống, checkbox trên bản đồ và component `DemoDiscovery`. Link cũ `?tab=demo` mở khám phá hồ sơ người dùng theo gate tài khoản/tuổi/điều khoản hiện có.
- Backend không nạp dataset và bỏ endpoint `/roommate/demo/search`; gateway không chuyển tiếp route này. Hai biến `ROOMMATE_DEMO_ENABLED`/`ROOMMATE_DEMO_DATASET` được bỏ khỏi settings, env mẫu và Compose; cấu hình cũ còn lưu không bật lại demo hoặc làm runtime đọc file cũ.
- Giữ `demo_enabled:false` và nhận `include_demo` nhưng bỏ qua để client cũ vẫn đọc được marker thật. Frontend chỉ hiển thị marker `source_kind=real`, kể cả khi nhận phản hồi từ backend cũ.
- Không thay matching, publish/review, quyền/consent, chat, thời hạn lưu tin nhắn, database hoặc key. Dữ liệu tổng hợp và generator chỉ phục vụ test offline, không nạp vào runtime.
- Team dùng tài khoản của từng người, tự khai thông tin và đăng bài. Hồ sơ riêng vẫn không tự công khai; chưa có bài phù hợp thì có CTA **Đăng nhu cầu của tôi**.
- Thay đổi cần build/deploy web và backend; bản cloud đang chạy chưa tự đổi chỉ vì sửa code local. Không cần biến môi trường mới, migration hay xóa database.

Kiểm chứng đợt bỏ demo: **255 passed** cho Roommate SQLite/PostgreSQL + gateway/auth; **42 passed** UI Roommate desktop/mobile, light/dark và VI/EN; **4 passed** bản đồ/gallery với phản hồi legacy trộn real/demo; **4 passed** Chrome → gateway → API → SQLite cho đăng hồ sơ, ảnh, kết nối/chat và privacy. Web build, Ruff và diff check đạt. Các test live dùng provider ngoài đã cập nhật kỳ vọng nhưng không chạy trong đợt này; toàn bộ state ghi kiểm thử nằm riêng, không đăng hồ sơ vào DB người dùng.

## 10. Tích hợp Roommate vào Admin Housing — 17/10/2026

- Thêm tab **Ở ghép** trong `/admin`, tái sử dụng `ModerationWorkspace`, API báo cáo,
  ảnh và hạn chế hồ sơ, không tạo hệ thống duyệt hoặc tài khoản Admin thứ hai.
- Backend hợp `HOUSING_MODERATOR_IDS` hiện có với `ROOMMATE_MODERATORS` legacy.
  Compose truyền Housing IDs cho backend, cùng nguồn đang cấp quyền platform.
  Bắt buộc ít nhất một moderator khi bật Roommate; không âm thầm cấp quyền cho mọi
  người đăng nhập hoặc tự tắt dịch vụ khi cấu hình lỗi.
- Quyền kiểm duyệt độc lập với consent khám phá cá nhân. Admin không cần đăng hồ sơ
  để duyệt; người dùng thường vẫn giữ kiểm tra tuổi/điều khoản/quyền hiện có.
- Khôi phục thao tác quản trị khi mất mạng dùng draft mã hóa/operation key hiện có,
  chỉ đọc được dữ liệu thao tác của chính actor. Không mở đọc chat/contact người khác.
- Không đổi schema, matching, luồng chủ nhà, khóa mã hóa hay CI. Không sửa `.env` thật.
  Cần deploy web/backend/Compose mới; code local không tự thay cấu hình Coolify.
- Chi tiết cấu hình và smoke test: [runbook](../runbooks/roommate.md#dùng-admin-hiện-có--cập-nhật-17102026).
