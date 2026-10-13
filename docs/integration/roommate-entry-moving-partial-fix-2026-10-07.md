# ReloHome — Bật Ở ghép, thêm Cẩm nang và sửa chuyển màn Moving

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Ngày 07/10/2026, Asia/Saigon. Theo yêu cầu mới, chỉ bổ sung chức năng và sửa lỗi cần thiết; giữ nguyên các form/layout/logic service cũ.

## Đã thay đổi

- Bật `ROOMMATE_ENABLED=true` trong `.env` local và restart đúng Agent API 8000. Không sửa backend/API/scoring, không đổi secrets hay cấu hình khác.
- State Roommate riêng `logs/private-roommate`. Moderator bootstrap là ID service dành riêng, không tự nâng quyền tài khoản hiện có. Trước vận hành có moderator thật, cấu hình allowlist theo runbook.
- Màn bắt đầu `/ai` giữ **bốn quick cards cũ**, thêm một hàng link riêng **Ở ghép** → `/roommate`, **Cẩm nang** → `/guides`. Không đổi payload/callback của bốn dịch vụ.
- Cẩm nang đọc 18 metadata từ data đã crawl, có search/empty state, public route, nguồn và link đọc bài gốc. Data gốc và nội dung đầy đủ không bị sửa; không thêm backend/LLM service mới.
- Moving: điều kiện chuyển màn sau submit form chấp nhận `ANSWER` **hoặc `PARTIAL` có quotes hợp lệ**, vẫn từ chối mở quote workspace khi không có quote hoặc đã là order. Không thay cách lấy/tính giá, form, tuyến đường hoặc confirmation.

## Nguyên nhân Moving trong ảnh

Hội thoại `th_d37085ae431f47bdd5969712bb4e3074` đã có lượt done và 2 báo giá. `response.kind=PARTIAL` vì cảnh báo chất lượng các tin nhà chưa được xác minh; Moving không bị provider từ chối. Frontend cũ chỉ kiểm tra `kind=ANSWER`, giữ `movingSubmission` và form nên không chuyển sang chọn gói.

Lượt quan sát có tổng thời gian Moving khoảng 8,5s, gồm khoảng 6,3s LLM khi để service gợi ý; không phải mọi báo giá đều dùng đường typed 0 LLM. Không thay backend để làm kết quả thành ANSWER hoặc xóa cảnh báo nhà/sandbox.

## Kiểm chứng

- Test lỗi được viết trước sửa: desktop/mobile đều tái hiện PARTIAL có quote không mở kết quả; PARTIAL không có quote vẫn giữ form.
- Sau sửa và chuẩn hóa fixture theo contract/landmark: **6/6** ca Moving đạt (PARTIAL có quote, PARTIAL không quote, lỗi HTTP giữ pins/options để retry × desktop/mobile).
- Entry/Cẩm nang: **4/4** browser tests đạt; giữ 4 nút cũ, mở đúng route, public/search/empty/18 bài/nguồn; 320/768/1440px, axe, VI/EN và focus/console pageerror checks.
- Hồi quy có mục tiêu: **10/10** ca cũ đạt, gồm appearance Moving, Housing map/list/selection, Flight workspace và approval/PII.
- TypeScript/Vite production build đạt, đã phục vụ qua gateway 8503.
- Live availability: `enabled=true`; live chat “Tôi muốn tìm người ở ghép” HTTP 200, domain `roommate`, availability `eligibility_required` cho actor test chưa accept terms. Không còn UNSUPPORTED do flag tắt.
- Đây là 20 browser cases qua các lượt có mục tiêu, không báo là chạy lại full suite. Các lỗi baseline ghi ở báo cáo audit trước chưa được sửa.

## Bổ sung bố cục theo yêu cầu tiếp theo

Sáu chức năng hiện cùng một `quick-grid`, cùng kiểu icon/title/mô tả: Tìm nhà, Tìm chuyến bay, Chuyển đồ, Đường đi, Ở ghép, Cẩm nang. Desktop rộng có 6 cột cùng hàng; tablet 3 cột, mobile 2 cột. Bỏ hàng link riêng, không thay callback/route/API. Build và 4 browser tests entry/guide đạt, kiểm tra số cột/kích thước/overflow, các route và axe ở 320/768/1440px.

## Sử dụng

Mở http://127.0.0.1:8503/ai và tải lại tab để nhận bundle mới. Bấm Ở ghép hoặc hỏi AI; người dùng tự xác nhận 18+/điều kiện trước xem/tìm. Chưa có hồ sơ thật đang đăng thì kết quả rỗng là đúng; không đưa fixtures vào app chính.

Với Moving, những báo giá cũ có thể đã hết hạn. Sửa/yêu cầu báo giá lại theo luồng hiện có; PARTIAL còn quote sẽ mở màn chọn giá kèm các cảnh báo.

Files: `Frontend/src/App.tsx`, phần style hàng link mới trong `src/ui/pages.css`, `src/guides/*`, `tests/browser/service-entry.spec.ts`, regression PARTIAL trong `tests/browser/app.spec.ts`; cấu hình `.env` ignored và tài liệu runbook. Không tự push/merge.
