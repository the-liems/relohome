# Bàn giao giao diện ReloHome — 13/10/2026

## Phạm vi

Nâng cấp lớp trình bày của toàn bộ frontend: Landing, AI Workspace/Chat, Housing/Map, Kế hoạch và lịch xem, Flight, Moving, Roommate, Chủ nhà/Admin và Cẩm nang. Giữ nguyên handler, state nghiệp vụ, routing, API và dữ liệu. Không thay đổi backend, database, agent hoặc cấu hình CI.

## Kết quả audit và hướng thiết kế

Trước đây palette được khai báo ở cả `ui/tokens.css` và `visual-polish.css`; màu dịch vụ đôi khi phụ thuộc thứ tự DOM. Card, section và CTA có độ nổi bật gần nhau; nhiều workspace có màu riêng hardcode hoặc fallback cũ. Dark Mode có nhiều nền xanh, glow và màu trạng thái chưa thống nhất.

Palette mới giữ Emerald làm thương hiệu, dùng nền sáng với surface trắng ở Light Mode; nền navy/charcoal và surface nhiều cấp ở Dark Mode. Card có border/elevation nhẹ, icon tile, giá và tiêu đề rõ hơn. Gradient chỉ giữ ở lớp phủ ảnh Hero để đảm bảo chữ dễ đọc. Các ô dịch vụ ở trang bắt đầu đổi thành 3 cột × 2 hàng desktop, 2 cột ở tablet/mobile; mobile giảm chiều cao để nhìn được sáu lựa chọn.

## Các file và quy ước chính

| Nơi chỉnh | Vai trò |
| --- | --- |
| `apps/web/src/ui/tokens.css` | Nguồn palette chuẩn: nền, surface, chữ, border, CTA, trạng thái, dịch vụ, shadow, radius và màu ảnh Hero/demo bản đồ |
| `apps/web/src/visual-polish.css` | Bố cục, phân cấp card/section và áp dụng token cho các workspace |
| `apps/web/src/ui/hero.css` | Lớp trình bày Hero ảnh nhà hiện có, gồm overlay, responsive và reduced motion |
| `apps/web/src/ui/foundation.css`, `ui/motion.css` | Control dùng chung, focus, màu trạng thái, transition và reduced motion |
| CSS Landing, Chủ nhà, Cẩm nang, Roommate, Housing | Loại bỏ màu literal/fallback cũ; liên kết với palette chuẩn |
| Component có `data-service` | Nhận diện dịch vụ bằng tên, không dùng `nth-child` |

### Nhận diện dịch vụ

| `data-service` | Màu nhấn | Áp dụng |
| --- | --- | --- |
| `property` | Emerald | Tìm nhà, giá/card nhà, filter, kết quả |
| `map` | Blue | Form địa điểm, đường đi, icon và chip bản đồ |
| `relocation` | Orange | Form chuyển đồ, điểm lấy/giao, lựa chọn xe, báo giá |
| `flight` | Indigo | Form chuyến bay, bộ lọc, carrier, timeline và nút chọn vé |
| `roommate` | Rose | Điều hướng, hồ sơ, tìm kiếm và CTA ở ghép |
| `landlord` | Amber/Gold | Chủ nhà/Admin, KPI, điều hướng và hành động quản lý |
| `guides` | Teal/Cyan | Cẩm nang, bộ lọc và bài viết |

Mỗi palette có màu dịch vụ chính và `*-soft`. Màu trạng thái dùng `--ui-success`, `--ui-warning`, `--ui-danger`, `--ui-pending` và `--ui-info`, không dùng màu dịch vụ để báo thành công/lỗi. QR thanh toán giữ surface trắng riêng để đọc được mã. Palette vẽ địa lý trên canvas vẫn được tập trung tại `mapStyle.ts`; không đổi nguồn tile, dữ liệu POI, marker hay routing.

### Khi mở rộng component

1. Gắn `data-service` ở container/card hoặc icon cần nhận diện.
2. Dùng `--service-color` / `--service-soft` cho nhận diện; dùng `--ui-*` cho trạng thái và nội dung.
3. Nút nền màu nhấn dùng `--ui-on-accent`, không hardcode chữ trắng: Dark Mode cần chữ tối trên accent sáng.
4. Dùng border control khác border trang trí; giữ focus-visible và nhãn thao tác.
5. Giữ callback và payload nghiệp vụ hiện có; CSS không được tự chuyển dịch vụ hay tạo lịch/đơn.

## Kiểm chứng

- `npm run build:web`: TypeScript và Vite build thành công.
- Chủ nhà/Admin + Roommate: 28/28 browser test pass.
- Landing + form dịch vụ + gợi ý + đặt lịch: lượt đầu 76/78 pass. Hai case cẩm nang bị selector cũ đếm cả `ServiceSuggestions` là section bài viết; sửa selector chỉ đếm `guide-section-*`, không giảm số section mong đợi.
- Chạy lại hai case trên và test ô dịch vụ/thư viện: 6/6 pass. Test layout service cập nhật đúng 3 cột desktop, 2 cột tablet/mobile; cập nhật nhãn heading Roommate theo giao diện hiện có.
- Browser test sử dụng fixture local, bao gồm VI/EN, bàn phím, theme, submit payload, giữ draft, chống gửi lặp và đặt lịch từng phần. Không dùng fixture để tạo số liệu analytics trong sản phẩm.
- Screenshot/axe dùng các màn hình Landing, Welcome, Housing, Plan, lịch xem, form và kết quả Flight/Moving, Routing, Roommate, Chủ nhà, Admin, Cẩm nang; kích thước 320/390/768/1440 px, Light/Dark. Các artifact được lưu local tại `data/ui-design-system/` (git ignored).

Tổng hợp: 110 case browser khác nhau đã pass qua các lượt trên; 112 trường hợp screenshot/axe không có lỗi JavaScript, tràn ngang hoặc vi phạm WCAG A/AA mà axe phát hiện. Đây là kiểm chứng tự động và rà soát các màn hình đại diện, không phải chứng nhận toàn bộ WCAG. File `data/ui-design-system/audit-final.json` tổng hợp kết quả mới nhất; mở [compare.html](../../data/ui-design-system/compare.html) để chọn theme/kích thước và xem ảnh trước/sau. Các trạng thái mới bổ sung audit không có ảnh baseline sẽ được ghi rõ.

Phát hiện và sửa hai lỗi contrast Dark Mode ở nút về hội thoại trên map và filter Cẩm nang. Đã kiểm tra trực quan Hero, bố cục service desktop/mobile, card nhà, timeline Flight, form chuyển đồ, lịch xem, Roommate và dashboard quản lý. Bản đồ trong screenshot fixture không có tile thật; các kiểm tra này không xác nhận chất lượng geocoding, báo giá nhà cung cấp hoặc giao dịch thanh toán live.

## Cách xem bản đang chạy

Mở `http://127.0.0.1:8503`, refresh để nhận asset mới. Build được phục vụ bởi gateway local hiện có. Đổi Light/Dark, kiểm tra `/ai`, `/roommate`, `/landlord`, `/guides`; Admin dùng tài khoản có quyền hiện có. Thử các ô dịch vụ, xem kết quả và mở Kế hoạch để kiểm tra surface/tab/CTA bên trong.

Không cần migration hoặc thay `.env` cho bản UI này. Các file review main có sẵn và kế hoạch Roommate trước đó được giữ nguyên.

## Điều chỉnh phân chia nền theo feedback

Nền trang và section trước đó đều pha xanh nhạt, khó nhận ra ranh giới. Đã đổi nền trang sang xám lạnh `--ui-bg`, surface phụ sang xám xanh `--ui-soft`; section nổi bật dùng Emerald rõ hơn `--ui-section` với border riêng `--ui-section-line`. Card chính vẫn trắng ở Light Mode. Dark Mode giữ nền navy và dùng section xanh trầm rõ hơn. Các token dùng chung nên header/card của workspace cũng phân cấp rõ hơn.

Chữ nhỏ trên section Emerald dùng màu Emerald đậm; nhãn chủ nhà có `--service-landlord-text` để đảm bảo tương phản trên nền mới. Giữ màu nhận diện icon và luồng tương tác. Artifact kiểm tra bổ sung tại `data/ui-design-system/section-contrast/` và `section-contrast-fixed/`.

Build lại thành công. Kiểm tra bổ sung 36 trường hợp (9 màn hình × Light/Dark × desktop/mobile); các lỗi tương phản chữ nhỏ trên Landing đã được sửa và chạy lại cả bốn trường hợp Landing, không còn lỗi axe, JavaScript hoặc tràn ngang. Screenshot cận ranh giới section: `section-contrast-fixed/section-boundary-light-1440.png`. Trang so sánh local đã cập nhật ảnh mới.

## Tích hợp trên main đã refactor

- Base: `origin/main` tại `0c53c6e` (đã merge PR #139, #141, #142, #144).
- Tạo nhánh trực tiếp từ main này rồi cherry-pick riêng commit UI; không đưa source hoặc cấu trúc cũ trở lại.
- `MapPanel.tsx` tự merge được: giữ comment đường dẫn `examples/map-app` từ main và bổ sung `data-service` của UI. Không phát sinh conflict cần chọn phiên bản hoặc ghi đè file.
- Npm dependencies được cài theo lockfile mới. Backend, package layout, API, database và `.github/` không có diff so với main.
- Bàn giao qua nhánh `QuangDung` → PR vào `main`; push fast-forward, không force-push lịch sử nhánh dùng chung.
- Kiểm tra lại trên nhánh ổn định sau tích hợp: `npm run build:web` pass; `npm run test:contracts` 42/42 pass; bảy suite browser liên quan 110/110 pass trong một lượt chạy. Lượt trước bị gián đoạn do checkout khi Vite còn chạy, đã bỏ kết quả lượt đó và chạy lại đầy đủ.
