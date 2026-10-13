# Roommate Discovery — Frontend handoff

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


**Mở rộng 12/10/2026:** [Roommate production handoff](../../docs/integration/roommate-production-2026-10-12.md) bổ sung Inbox/notifications, media/settings, moderator workspace, linked-room picker và recovery sau reload. Các nội dung dưới đây là baseline 07/10, vẫn giữ nguyên policy; evidence mới ở tài liệu mở rộng và task checklist.

Ngày: 2026-10-07, Asia/Saigon. Phạm vi: frontend theo contract backend đã có; không sửa backend, database, scoring, API schemas hoặc nghiệp vụ service khác.

## Luồng và design direction

- Service bổ sung tại `/roommate`, entry từ Tài khoản và result Roommate trong chat. Giữ nguyên hero, header, map/chat layout và các form Housing/Moving/Flight.
- Bốn mục: Tìm người, Đã lưu, Yêu cầu kết nối, Hồ sơ của tôi. Deep links: `/roommate/profiles/{id}` và `/roommate/requests/{id}`.
- Người chưa đăng nhập chỉ xem giới thiệu; login quay lại route Roommate. Account đủ 18+/chấp nhận terms mới xem người thật. Feature disabled/restricted/session expired có trạng thái rõ ràng.
- Sidebar tiêu chí trên desktop, stacked trên mobile. Disclosure cho thông tin bản thân và preferences để không bắt điền form dài ngay từ đầu. City và các enum giữ canonical values, không gửi nhãn dịch lên backend.
- Form tách self facts và preferences. Unknown không đổi thành false/linh hoạt; hard chỉ khi người dùng tự đánh dấu. Danh mục area ID lấy từ API, không tự đoán ID.
- Cards hiển thị ngân sách mỗi người/tháng, cơ sở phí, ngày vào ở và nhu cầu. Lý do/score dùng nguyên response backend; thiếu dữ liệu không giả score hoặc nhãn cao. Detail hydrate từ API mới, không dùng hồ sơ snapshot từ lịch sử chat.
- Phiên bản VI/EN, sáng/tối và tokens/controls dùng hệ thống ReloHome hiện có. CSS mới chỉ có selector `rm-*`; radius/padding/contrast theo design tokens. Hiệu ứng fade ngắn, tắt khi reduced motion.

## Kết nối và riêng tư

1. Mở hồ sơ → viết/xem lại private introduction → chọn kênh của mình → chủ động đánh dấu consent → gửi.
2. Không bắt public profile hoặc tự publish khi gửi. Người nhận đọc intro và consent riêng trước accept.
3. Pending, accepted, grant state/deadline hiển thị riêng. Có reject/withdraw/revoke theo `actions` backend trả; không suy ra quyền từ nút frontend.
4. Writes hỗ trợ operation key dùng một key cho double-click/retry. `operation_unknown` mở kiểm tra trạng thái; không tạo request mới, không tự retry ghi. Chỉ retry cùng payload/key sau khi tra trạng thái.
5. Contact lease chỉ lưu memory, không localStorage/sessionStorage/chat. Ẩn khi blur/hidden, kiểm tra lại khi focus; revalidate 15 giây và ẩn tại deadline. Không có push/SSE nên không hứa thu hồi đồng thời ở mọi tab; backend kiểm tra mỗi read.
6. Bookmark riêng tư; bỏ lưu được cả hồ sơ unavailable. Report độc lập block; block giải thích hệ quả và rời hồ sơ đang xem.
7. Private intro/public profile có luồng review riêng, publish/reconfirm/resume cần xác nhận mới. Delete xóa ngay intro cũ khỏi form; version conflict chỉ reload, không tự ghi đè.
8. Avatar đã được backend cho phép đọc được fetch private/no-store, dùng Blob URL và revoke khi unmount; không public asset URL.

## File/module

- `src/roommate/types.ts`, `client.ts`: typed DTO theo contract, lỗi code/retry/reasons, JSON `null` hợp lệ cho record chưa có.
- `Workspace`, `RoommateGuest`, `AccessGate`: routing/navigation/eligibility.
- `FactsForm`, `PreferencesForm`, `Fields`, `ProfileEditor`: structured forms.
- `Discovery`, `CandidateDetail`, `ProfileSummary`, `PrivateAvatar`, `SavedProfiles`: search/detail/reasons/bookmarks.
- `ConnectionComposer`, `ContactPicker`, `Inbox`, `ConnectionDetail`, `useOperation`, `useContactLease`: review, consent và thời hạn.
- `MyProfile`, `ProfileDialogs`, `SafetyActions`, `ErrorNotice`, `useResource`: lifecycle/safety/states.
- `roommate.css`, `text.ts`: styles scoped và bilingual copy.
- Wiring tối thiểu: `App.tsx` (route/guest entry/account link), `Results.tsx` (nhánh Roommate), `PlanProgress.tsx` (nhãn/icon Roommate). Không đổi handlers/payload của domain cũ.
- Test files/config: `tests/browser/roommate.spec.ts`, `roommate.integration.spec.ts`, `tests/roommate_test_server.py`, `playwright.roommate*.config.ts`. Config mock hiện có loại `*.integration.spec.ts` để không trộn evidence.

## Kiểm chứng

- `npm run build`: TypeScript + Vite production build đạt. Vite/Chrome trên Windows cần quyền spawn subprocess; lần sandbox đầu gặp EPERM, build/test được chạy với quyền phù hợp, không sửa build config để né kiểm tra.
- 10 UI browser tests (desktop/mobile): guest/disabled/age/terms, missing score, fresh detail, reviewed consent/payload, empty/unavailable/error, uncertain write reconciliation; console không có error/warning trong happy flows.
- Responsive 320/768/1024/1440px, VI/EN và light/dark. Axe WCAG A/AA kiểm tra không có violations; keyboard Enter/Escape, native modal focus return và reduced motion được kiểm tra.
- 2 real browser tests: session gateway → Roommate routers/services → SQLite thật, không mock Roommate responses. Synthetic accounts/data private trong `logs/local/roommate-browser-*`; không gọi external LLM, đặt xe hoặc thanh toán.
- Real flows: private intro không tự publish; preview/consent publish; pause/resume; delete clear form; A gửi B, B accept/read/revoke, A thấy quyền đã thu hồi.
- Legacy UI suite: **109 passed / 1 failed**. Test mobile welcome kỳ vọng scroll overflow <=2px, thực tế 19px. Đã tháo riêng wiring Roommate, chạy lại chính test này trên UI trước khi bổ sung và tái hiện cùng 19px; mọi source được khôi phục nguyên byte. Giữ nguyên UI cũ theo yêu cầu, không sửa/skip assertion.
- Snapshot và reports local: `Frontend/test-results/roommate-ui`, `roommate-integration`; `logs/local/roommate-ui-final.txt`, `roommate-browser-integration-final.txt`, `roommate-welcome-baseline.txt`. Có screenshots dùng dữ liệu giả.

```powershell
npm.cmd --prefix Frontend run build
# Chạy từ Frontend/:
npm.cmd exec -- playwright test --config playwright.roommate-ui.config.ts roommate.spec.ts --workers=1
npm.cmd exec -- playwright test --config playwright.roommate.config.ts --workers=1
npm.cmd exec -- playwright test --config playwright.roommate-ui.config.ts app.spec.ts --workers=2
```

Ports test riêng 18574/18503; không dừng hoặc thay cấu hình hệ thống đang chạy. Test server khởi tạo runtime enabled riêng trong fixtures; không bật feature trên `.env` thật.

## Giới hạn contract và phạm vi còn lại

- Production flag vẫn `ROOMMATE_ENABLED=false`. Để dùng thật cần cấu hình runtime/moderator/token hiện có và review phát hành; không tự bật bằng task frontend.
- Canonical areas API chỉ trả IDs, chưa có nhãn vùng chi tiết; whole-city có nhãn thân thiện, ID chi tiết giữ nguyên. Không invent địa danh hoặc thay backend để thêm label.
- Inbox API summary chưa có display name/ID đối phương; list nhận/gửi dùng request ID/status/deadline, detail hiển thị intro được API cho phép. Không fabricate tên đối phương từ history.
- Media upload editor, moderator dashboard và management đầy đủ các channel/blocks chưa thuộc các màn tìm/kết nối yêu cầu ở đợt này. Backend endpoints vẫn giữ nguyên; RM-35/39 trong plan tổng chưa hoàn tất toàn phần.
- Chưa chạy live LLM NLU; test Agent entry dựa contract/read-only result. Full product release/regression gates vẫn chưa được tuyên bố đạt.
