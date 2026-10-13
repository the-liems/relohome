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

## Header, lịch sử chat và phiên đang làm

Theo xác nhận mới nhất, backend tiếp tục giữ hội thoại và kế hoạch. Không thay source backend hoặc thời hạn lưu dữ liệu server. Frontend bỏ nút/drawer lịch sử chat, danh sách hội thoại gần đây và bộ đếm hội thoại trong tài khoản. Header luôn là “ReloHome”, không dùng prompt làm tên thương hiệu. Lịch sử yêu cầu dịch vụ và thao tác bảo mật/xóa dữ liệu đã có vẫn hoạt động.

`activeChatSession.ts` chỉ lưu `{threadId, expiresAt}` theo ID tài khoản trong localStorage, không lưu transcript hoặc dữ liệu kế hoạch. Hạn 24 giờ được gia hạn khi phiên đang làm cập nhật. Trang bắt đầu có một nút “Tiếp tục phiên đang làm”; không tự chuyển sang hội thoại cũ hoặc thay routing các ô dịch vụ. Hết hạn chỉ bỏ cache trình duyệt, không xóa dữ liệu backend. Logout, xóa phiên và reset dữ liệu đồng bộ cache; storage bị chặn không ngăn chat hoạt động.

Các `landing-inline-cta` được trình bày như nút: nền Emerald, border, padding, chiều cao tối thiểu 44 px, icon mũi tên, hover và focus. Link, điểm đến và nghiệp vụ hiện có được giữ nguyên.

Kiểm chứng phần bổ sung: build pass; 44 contract test pass; 12 browser regression về cache, logout, xóa dữ liệu, theme và profile pass. Tám screenshot/axe trường hợp Landing và Housing (Light/Dark, desktop/mobile) không có lỗi axe, JavaScript hoặc tràn ngang. Artifact local: `data/ui-design-system/chat-header-cta/`. Bàn giao cùng bản đồ và logo qua nhánh `QuangDung`, PR #146 vào `main`.

## Logo và bản đồ Dark Mode

- Wordmark trên header ứng dụng tăng lên 23 px ở desktop và 20 px trên mobile, giữ tên cố định ReloHome. Tile RH là 48 px ở desktop, 44 px trên mobile. Wordmark Landing là 28 px/21 px.
- `mapStyle.ts` giữ nguyên palette Light Mode, thêm `DARK_MAP_THEME` dùng nền slate/navy, nước xanh trầm, công viên xanh dịu, giảm opacity khối nhà. Các lớp cầu, cao tốc, hầm, đường sắt và sân bay được xử lý đầy đủ để tránh nét trắng chói. Nhãn số hiệu đường dùng chữ tối trên sprite sáng của nhà cung cấp.
- Marker giá ở Dark Mode dùng nền xanh trầm, viền Emerald và chữ sáng; marker được chọn có nền Emerald sáng/chữ tối. Marker ghép trọ màu vàng giữ nguyên ý nghĩa. `housingPriceColor()` được dùng khi khởi tạo và khi đổi theme.
- Đổi theme cập nhật paint và ảnh marker tại chỗ bằng `updateImage`; không tạo lại map hoặc source, không đổi camera, dữ liệu, lựa chọn hoặc logic tìm nhà. Paint chỉ áp dụng cho Dark Mode được lưu theo instance layer rồi khôi phục khi trở về Light Mode. API tham khảo: [MapLibre Map](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#updateimage).
- Chỉ sửa frontend, browser test và tài liệu. Không sửa backend, database, orchestration, API contract hay CI. Bàn giao trên `QuangDung` → PR #146, giữ main đã refactor làm gốc.

Kiểm chứng: build frontend pass; 12 browser regression pass trên desktop/mobile về header, cache, CTA, camera và routing; test bản đồ được chạy lại sau khi bổ sung nhãn số hiệu đường. Kiểm tra render thực bằng MapLibre/OpenFreeMap tại Cầu Giấy và trong Housing: không có lỗi map/JavaScript; bốn trường hợp Housing thật về basemap không có lỗi axe hoặc tràn ngang. Dữ liệu tin nhà của bộ kiểm tra dùng fixture local, không phát sinh giao dịch. Tám trường hợp Landing/Housing bổ sung ở 320 px và 768 px cũng không có lỗi axe/JavaScript/tràn ngang. Axe kiểm tra DOM; phần canvas được kiểm tra bằng ảnh và assertions paint/marker, không coi axe là chứng nhận tương phản toàn bộ bản đồ.

Ảnh trước/sau bản đồ thật và screenshot Housing: `data/ui-design-system/map-harmony/`. Kiểm tra responsive: `data/ui-design-system/map-logo-responsive/`. Cổng gateway `8503` phục vụ asset build mới; dùng Ctrl+F5 và đổi Light/Dark để kiểm tra.

Kiểm tra trước push bản bổ sung: 44/44 contract và 16/16 browser regression pass. Đã kiểm chứng test cache phát hiện việc đảo điều kiện hết hạn rồi khôi phục source bằng `finally`. Test layout Flight trước đây có fixture chỉ khai báo task Housing; fixture được đổi đúng task Flight và khôi phục Housing khi chuyển sang kiểm tra map, giữ nguyên các assertions. Không thay logic nhận diện dịch vụ của ứng dụng. CI được theo dõi trên head mới của PR #146, không dùng kết quả head cũ để kết luận cho phần bổ sung.

## Sửa feedback review PR #146 — 2026-10-14

Tái hiện trên Chrome: welcome desktop 1366×650 tràn 121 px; nhãn `.mv-payment-tile strong` có tương phản 4,435:1 sau animation. Lớp visual mới ghi đè quy tắc compact của `ui/pages.css`, làm ô dịch vụ/gap/title cao hơn vùng hội thoại.

- Thêm compact rules sau spacious defaults: laptop thấp dùng title/gap/card gọn hơn; mobile thấp dùng icon + tên dịch vụ cùng một hàng, bỏ mũi tên trang trí để không ép tên Flight xuống ba dòng. Giữ sáu dịch vụ, hai starter prompt, cảnh báo xác nhận giao dịch, cache resume và composer; vùng bấm tối thiểu 44 px.
- Moving Light Mode dùng semantic token `--service-moving: #a44310`; trên nền tile `#e6edf3` đạt **5,244:1**. Dark giữ palette hiện có, label đạt **7,694:1** trên `#213044`. Token cũng cải thiện các nhãn Moving dùng chung, không hardcode riêng một component.
- Helper test `waitForUiMotion()` đợi browser render và finite animations kết thúc trước screenshot/axe. Kiểm tra theme thật vẫn bật animation; không sửa CI, không sleep cố định, không giảm chuẩn contrast.

Build frontend pass. **18 browser regression pass**, gồm welcome/service entry/theme/form/cache/CTA desktop/mobile. Test đổi theme lặp thêm ba lần mỗi project: **6/6 pass**. Test bố cục có và không có nút resume ở hai viewport được báo, hai theme, kiểm tất cả control nằm trong vùng hội thoại và cao ít nhất 44 px. Screenshot/axe welcome không có lỗi hoặc pageerror; scroll delta sau sửa 0 px desktop, tối đa 1 px do rounding ở mobile với resume, mọi control vẫn nằm trong vùng hiển thị.

Evidence local: `data/ui-design-system/pr146-review-fixes/audit.json` và screenshot cùng thư mục. Asset build mới được gateway 8503 phục vụ. CI của commit mới cần hoàn tất trước merge, không dùng kết quả head cũ.
