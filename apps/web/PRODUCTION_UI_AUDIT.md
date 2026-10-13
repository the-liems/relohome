# Audit và thiết kế frontend — 07/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


> Cập nhật 08/10/2026: các đoạn dưới đây ghi lại quyết định thiết kế tại
> thời điểm audit. Biểu tượng robot sau đó đã được bỏ khỏi giao diện và favicon;
> ảnh bìa hiện là `public/images/relohome-hero-home.png`.

## Phạm vi và ranh giới

Skill: agent-skills:frontend-ui-engineering. Đã đọc cấu trúc và source
frontend (32 file trong src, 19.228 dòng), renderer, CSS, test và API helpers.
Snapshot local giữ hash 279 file backend/helper và dấu vết các call/payload
trước khi sửa. Backend, schema, giá, tìm kiếm, recommendation, auth, graph,
database và các hàm tạo request giữ nguyên. Không thay thế dữ liệu provider.

## Luồng người dùng chính

| Luồng | Mục tiêu của màn hình | Contract giữ nguyên |
| --- | --- | --- |
| Giới thiệu → đăng nhập → chat | Hiểu sản phẩm, vào không gian làm việc | /, /ai, /login, session/auth hiện có |
| Chat và câu gợi ý | Nhập yêu cầu, giữ nháp, xem phản hồi | /threads, /chat, request_id và optimistic message hiện có |
| Nhà ở / bản đồ | Lọc, xem chi tiết, lưu, so sánh, chọn nhà | Viewport/filter schema, listing ID, action/version hiện có |
| Moving | A/B, lịch, hàng, gói, addon, báo giá | Typed quote PR #53; thiếu pin vẫn theo luồng cũ |
| Flight | Nhập tiêu chí, xem/sắp xếp/chi tiết, chọn | Airport/time/price/expiry và select action hiện có |
| Kế hoạch | Tiến trình, chi phí, cần phản hồi | state.progress, pending và callbacks hiện có |
| Xác nhận / thanh toán | Xem chi phí, nhập liên hệ, phê duyệt | Ownership, write flags, consent/expiry, PII payload giữ nguyên |
| Tài khoản / lịch sử | Hồ sơ, sở thích, saved, mở lại/xóa chat | Các endpoint, guard thay đổi chưa lưu và bộ lọc giữ nguyên |

## Vấn đề phát hiện trước triển khai

| Mức | Bằng chứng | Thay đổi dự kiến |
| --- | --- | --- |
| P1 | Flight mở chi tiết bằng div onClick, không có thao tác bàn phím | Dùng button native với callback cũ |
| P1 | Thanh tab kế hoạch chưa có Arrow/Home/End, account chưa có trạng thái tab cho screen reader | Tabs có tên/panel/roving focus, kích hoạt thủ công |
| P1 | Header và bộ lọc có nhiều control trong không gian hẹp; touch target có 26–34 px | Header hai hàng khi hẹp, targets 44 px, toolbar/tablet thích nghi |
| P1 | Một số search input chỉ có placeholder; thiếu skip link cho app | Nhãn rõ, skip link và heading/landmark đúng |
| P2 | CSS legacy: 1.059 rule, 30 giá trị radius, 31 gradient, 51 shadow | Một theme entry có token + foundation/workspace/page stylesheet |
| P2 | 78 declaration chữ <12 px trong ba stylesheet | Body 14/16, helper 12, không giảm chữ để ép layout |
| P2 | Card nằm trong card, viền bo và vùng cuộn lồng nhau làm giảm không gian map | Panel hình chữ nhật, hàng kết quả, spacing theo thang 4 px |
| P2 | Màu placeholder opacity thấp; dark hover dùng màu chữ chưa đồng bộ | Token semantic light/dark, kiểm tra contrast tự động |
| P2 | Loading chủ yếu là spinner/chữ; no-result history search không giải thích | Skeleton cho nội dung, empty/error có hướng dẫn từ hành vi hiện có |
| P2 | Landing nhiều float/card đồng dạng; account overview quá trang trí | Landing biên tập, dịch vụ theo hàng; account như workspace cài đặt |

## Evidence và design direction

- Giữ nhận diện ReloHome: robot xanh/mint và ảnh nhà/hồ koi hiện có. Mẫu local
  Frontend MVP planning questions và ảnh người dùng cho thấy map là vùng
  làm việc chính, kế hoạch/phản hồi nằm bên cạnh; không sao chép thương hiệu.
- [Primer color](https://primer.style/product/primitives/color/): tách màu
  nền, chữ, viền, tương tác và trạng thái; dùng semantic token.
- [Carbon empty states](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states):
  trạng thái trống giải thích tình huống và hành động hiện có, không thêm luồng giả.
- [WAI tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) và
  [modal](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): focus có thứ tự,
  phím mũi tên cho tab, focus trap native dialog và trả focus khi đóng.

### Design contract

1. **Chất liệu:** nền trung tính ấm, chữ xanh đen, xanh rừng dành cho hành
   động/lựa chọn; amber/red chỉ khi có cảnh báo/lỗi. Flat, không gradient.
2. **Nhịp:** 4/8/12/16/24/32/48 px. Control 40 px desktop, 44 px touch.
   Radius 4 px control, 8 px panel/dialog; avatar là ngoại lệ tròn.
3. **Thứ bậc:** một h1 trong main; body 14–16 px; label/helper ít nhất 12 px;
   giá/giờ/địa chỉ được đọc trước badge và nội dung nguồn.
4. **Workspace:** một vùng cuộn chính cho mỗi panel. Map giữ canvas, source,
   camera/route code; không thêm fetch/remount để đổi theme hoặc mở panel.
5. **Responsive:** 320/768/1024/1440; map/form dùng sheet gọn ở mobile, pane
   bên cạnh ở desktop; control không bị che bởi footer/composer.
6. **Tương tác:** mọi thao tác có keyboard/focus; không đổi disabled guard,
   chọn ≠ đặt; đổi bố cục không gửi request hay xóa dữ liệu form.
7. **Reject:** marketing card khổng lồ, pill ở mọi nơi, nhiều bóng, padding
   để lấp chỗ trống, số liệu giả, tự động đặt dịch vụ hoặc optimistic dữ liệu mới.

## Kế hoạch triển khai (ghi trước khi sửa UI)

1. Đóng băng helper/backend/call contract; thêm kiểm tra accessibility.
2. Thay theme entry thành design tokens và ba nhóm CSS có trách nhiệm rõ.
3. Sửa rendering semantic/focus/nhãn/skeleton, giữ các handler/request gốc.
4. Áp dụng toàn bộ landing/login/chat/housing/map/Moving/Flight/plan/account,
   bao gồm busy/empty/error/expired/disabled/hover/focus và dark/light.
5. Regression hiện có + axe + responsive/keyboard + contract hash/call audit;
   build, console và kiểm tra bản chạy thật, chỉ read provider ngoài fixtures.
6. Ghi kết quả thực tế, hạn chế cần backend và cập nhật README.

## Giới hạn giữ nguyên

Flight chưa xuất vé; account chưa đổi/reset mật khẩu; quyền đặt dịch vụ do
server quyết định. Không dựng control hoạt động giả hoặc thay backend để
mở các chức năng này. Tọa độ housing gần đúng và chất lượng gợi ý địa điểm
không được sửa trong đợt UI. Không dịch câu chat/địa chỉ/provider data.

## Kết quả

Tên thương hiệu hiển thị từ 07/10/2026: **ReloHome**. UI VI/EN, metadata,
landing/login/chat/các dịch vụ/account đã đổi đồng nhất; logo robot dùng
huy hiệu `RH`. Không đổi tên API header, storage key, env hay file dữ liệu.

Lượt đổi tên: TypeScript/Vite build qua; **24/24** ca landing, appearance,
production và layout qua. Bản build preview ở 320/768/1024/1440 px qua kiểm
tra brand/title/EN/overflow, không lỗi JS; session guest được giả lập vì
gateway 8503 đang tắt ở lượt này. Baseline 279 file backend/helper và request
expressions tiếp tục giữ nguyên. Kết quả full bên dưới là lượt audit trước.

### Thay đổi đã triển khai

| Nhóm file | Quyết định |
| --- | --- |
| src/product-theme.css, src/ui/{tokens,foundation,workspaces,pages}.css, src/main.tsx | Một theme entry cuối cascade; scale 4 px, radius 4/8, semantic colors, control 40/44, font 12/14/16, theme không tween text/background gây contrast tạm thời |
| src/App.tsx | Skip link, một h1 trong main, header thích nghi, thương hiệu robot thống nhất; account tab/panel rõ nghĩa, search có nhãn và trạng thái không khớp; nháp/handler/API giữ nguyên |
| components/TabList.tsx, UiStates.tsx | Component UI thuần: keyboard tab thủ công, skeleton/empty state; không fetch hay tạo request |
| components/Dialog.tsx, PlanPeek.tsx | Tab/Shift+Tab không thoát dialog, Escape và trả focus; panel kế hoạch không che nút launcher; bỏ animation opacity làm contrast sai lúc mở |
| components/ServiceWorkspaces.tsx, MapWorkspace.tsx | Flight có button native cho chi tiết; Moving có control A/B bàn phím; pane/list/basemap/toolbar thích nghi và giữ canvas/callback; loading có skeleton |
| components/Housing.tsx, RequestHistory.tsx, Transactions.tsx | Heading/table scope/expanded states; dòng history, hình fallback và QR dùng CSS chung |
| components/LandingPage.tsx, src/locales/en.json | Mobile menu Escape trả focus, nhãn mới VI/EN, landing giảm float/card; giữ ảnh koi và nội dung future |
| package.json, package-lock.json, tests/browser/app.spec.ts | axe 4.13.0 chỉ là dev dependency; cập nhật locator role tab và hãng bay exact, giữ assertion payload |
| src/useUiMotion.ts, src/ui/motion.css | Theo yêu cầu bổ sung: feedback nút bấm, underline nav, zoom ảnh khi hover, section/message vào vị trí nhẹ; không đổi opacity chữ, không giấu nội dung hay giá; hỗ trợ reduced motion |

App vẫn giữ các handler nghiệp vụ tại chỗ để hạn chế thay đổi phạm vi; không
refactor logic fetch/auth/search/pricing thành framework hay store mới.

Hiệu ứng là progressive enhancement: không có IntersectionObserver thì
nội dung vẫn hiển thị; giảm chuyển động tắt animation/transform. Không dùng
loop float liên tục hoặc fake progress. Ca motion desktop/mobile **2/2 qua**,
axe vẫn quét contrast và xác nhận mở/scroll không gửi request nghiệp vụ.

### Kiểm chứng

- **124 ca browser: 120 pass, 4 live opt-in skip trong lượt full**.
  Các ca mới axe/keyboard/responsive qua; mọi hồi quy payload, ownership,
  expiry, consent, pin A/B, Flight, saved/history và draft hiện có qua.
  Sau chỉnh navigation xuống dòng cuối, chạy lại nhóm layout riêng 4/4 qua.
- **8/8 Python frontend/gateway contract pass** trên database fixture tạm,
  không thao tác database đang chạy.
- **Axe không có vi phạm** trong phạm vi wcag2a, wcag2aa, wcag21a,
  wcag21aa của các màn/trạng thái được kiểm tra: welcome, account, landing,
  form/modal, plan, housing/map, Moving và Flight. Đây là kiểm tra tự động
  cho phạm vi này, không phải chứng nhận WCAG toàn bộ sản phẩm/screen reader.
- **320/768/1024/1440 px**: navigation/account và pane Moving/Flight không
  tràn ngang, canvas không sụp; control/selection không mất. Welcome cũng
  qua 6 viewport thấp của regression trước với VI/EN, đủ gợi ý/composer.
- **Build TypeScript/Vite qua**. Thư viện axe không vào production bundle.
- **279 file backend/helper hash không đổi**, các biểu thức api, send,
  mutate, decision/quote/action không thêm/bớt/đổi so với baseline. Git
  diff src/, Maps VN/, Frontend/server.py, Frontend/store.py trống.
- **Build thật 8503**: landing/login tại cả 4 width, dark/EN và email nháp
  qua; 0 pageerror, 0 lỗi console ngoài 401 session guest đúng hành vi auth.
  Không submit auth, chat, quote, order, profile hay payment ở lượt live.
- **HTTP read thật**: 6 health endpoint 200; housing search/detail giữ ID,
  POI và catalog AhaMove 29 gói trả 200. Không chạy LLM/Flight search mới,
  geocode, DB import/migration, đặt/hủy đơn hoặc thanh toán.

### Finish gate và hạn chế

Đã xem ảnh landing, account, housing, Moving, Flight và login ở các width/
theme. Sửa robot trang trí chồng tiêu đề login mobile bằng cách chỉ giữ
logo thương hiệu; không ép font nhỏ để giữ hình trang trí.

### Sửa hồi quy bố cục theo ảnh người dùng (07/10)

- CSS control chung có độ ưu tiên cao hơn style input có icon: padding trái
  bị ghi đè và sinh viền kép. Sửa riêng wrapper/input Moving, chat dock và
  history; đo vị trí bắt đầu chữ so với icon bằng browser, không chỉ dựa vào axe.
- Moving giữ đầy đủ A/B, căn đã chọn dưới điểm B, ngày/giờ, kiện hàng, gói xe,
  dịch vụ thêm, giao nhận, ghi chú, khuyến mãi và bước xác nhận riêng. Thêm
  navigation năm mục để chuyển trong vùng cuộn; không submit khi chuyển mục.
- Chưa ghim A thì giải thích vì sao chưa có catalog và cho quay lại ô A.
  Sau khi chọn pin, dùng catalog/API cũ; không tự tạo xe hay bỏ điều kiện hãng.
- Loại bỏ offset chat cố định gây chồng nút Về hội thoại tại mobile/tablet.
  Nhãn bước và navigation được xuống dòng; timeline Flight, địa chỉ dài,
  chat/history có khoảng cách rõ. Input mobile giữ font 16 px.
- Bổ sung chuyển động nhẹ cho gợi ý địa chỉ, hướng dẫn xe và trạng thái chọn;
  giữ chữ luôn hiển thị và hỗ trợ reduced motion.
- Hai ca hồi quy mới chạy cả desktop/mobile (**4/4 qua**): 320/768/1024/
  1440/1920 theo màn, không chồng icon/chữ/nút; chuyển mục không mất nháp,
  B vẫn giữ địa chỉ căn, chọn A tải đúng xe, Flight/housing/history/chat qua.
  Kiểm thử nghiệp vụ dùng fixtures; không gửi thông tin liên hệ, báo giá hay
  đơn thật trong lượt này. Backend/helper và call expressions vẫn giữ nguyên.

Location vẫn có thể trả tên gần đúng không khớp query (ví dụ Bưu điện Trung
tâm Sài Gòn → Sài Gòn Garden); lỗi dữ liệu/tìm kiếm này giữ nguyên, ghi nhận
cho đợt backend riêng. Không thêm chức năng booking Flight, reset mật khẩu
hay cancellation/streaming LLM khi API hiện tại chưa cung cấp contract.

Artifacts local (ignored): logs/local/frontend-production/ có baseline,
audit, public-live report, ảnh live; Frontend/test-results/ có ảnh fixture
và kết quả browser. Không lưu credential/cookie trong báo cáo.
