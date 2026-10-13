# ReloHome — hoàn thiện sản phẩm chủ nhà và dashboard

Ngày: 12/10/2026 (Asia/Saigon). Baseline: QuangDung/PR127 `c1de7d4`. Trạng thái: **đã triển khai sau khi người dùng duyệt**, trên `feat/housing-management-cloud`. Phần mô tả baseline và đề xuất dưới đây giữ làm dấu vết audit; trạng thái triển khai hiện tại nằm trong [báo cáo kiểm thử](../review/housing-cloud-implementation-2026-10-12.md).

## 1. Trả lời về bản đang chạy

Ứng dụng tại `http://localhost:8503` đã chạy frontend, gateway, graph và các domain server. Đây là bản MVP local có persistence và API thật; khởi động thành công không đồng nghĩa mọi quy trình đăng tin/quản trị đã hoàn chỉnh.

- Đã có tài khoản chung khách/chủ nhà, hồ sơ người đăng, tạo nhà/phòng/tin nháp, giá/phí và upload JPEG/PNG qua gateway có kiểm tra ảnh.
- Đã có backend cho gửi duyệt, duyệt/từ chối, ẩn/xóa mềm, trạng thái vacant/rented/paused, contact requests, lịch xem, nhắn tin và đánh giá.
- **Cấu hình local hiệu lực chưa có `HOUSING_MODERATOR_IDS`.** Không có tài khoản được server cấp quyền duyệt. Người mới có thể chuẩn bị hồ sơ/nhà/phòng/tin, nhưng địa điểm mới cần active membership trước submit, và không có Admin để xử lý các bước duyệt tiếp.
- Dữ liệu DB đang chạy có 23 managed listings (22 published, 1 draft), 13 host profiles. Đây là dữ liệu hiện hữu, không phải bằng chứng tài khoản mới hôm nay có thể hoàn tất publish.
- UI Admin riêng và mapping Vietmap runtime chưa triển khai. Validation submit/approve, duyệt lại khi sửa property/unit và public thumbnail còn các khoảng trống trong audit.
- Lần kiểm tra này đọc source, effective configuration, số liệu aggregate DB và health; không thử đăng/duyệt một tin thật bằng tài khoản người dùng, không thay role hoặc cấp Admin tự động.

## 2. Dashboard hiện tại có gì

Source chính: `Frontend/src/landlord/Workspace.tsx`; dữ liệu qua `platform-api/src/housing-management.ts`.

| Khu vực | Đã có | Cần hoàn thiện cho MVP |
|---|---|---|
| Tổng quan | Số nhà, phòng, vacant listings, yêu cầu mới; detail views/saves/contact events; việc tiếp theo | Phân biệt số phòng với số tin, thêm pending/rejected/published; lịch xem sắp tới và tin cần bổ sung; drill-down từ số liệu |
| Nhà và phòng | Danh mục property → unit → listing, tạo/sửa thông tin tin, hide/delete/availability | Sửa phòng từ UI; danh sách tin toàn bộ tài khoản có tìm kiếm/filter; không bắt mở từng nhà để tìm một tin |
| Tin và ảnh | Form title/description/rent/deposit/fees/date; chọn một file để upload mỗi lần | Gallery nhiều ảnh, ảnh bìa, xóa/sắp xếp; preview khách + map; checklist thiếu trước submit; giữ draft khi lỗi |
| Hộp thư | Contact requests, thread messages, unread, trạng thái; confirm/decline lịch xem | Filter chưa đọc/chờ trả lời/đã xử lý; nhìn rõ phòng nào và hành động tiếp theo; lịch xem chung |
| Lịch xem | Slot và trạng thái trong từng contact request | Danh sách theo ngày/hôm nay/sắp tới; liên kết về đúng phòng và cuộc trò chuyện; chưa cần calendar booking theo đêm |
| Thống kê | Số event cộng dồn, mốc measured_since; empty state | Bộ lọc 7/30 ngày, theo nhà/tin; định nghĩa metric; phân biệt trạng thái hiện tại và event lịch sử |
| Đánh giá | Điểm/histogram, phản hồi, báo cáo | Giữ chức năng hiện hữu; đưa các việc chưa phản hồi vào tổng quan |
| Admin | Moderation tab cũ, backend guard và review endpoints | Lối đăng nhập riêng, queue/detail/filter, kiểm tra location/revision và reason; cấu hình tài khoản có quyền cụ thể |

Không gọi mọi phần trên là “đầy đủ”. Chưa có dashboard tài chính thực, xác minh giao dịch thu tiền hoặc hệ thống vận hành cho thuê như các nền tảng lớn. Với demo hiện tại, những phần đó chưa phải ưu tiên.

## 3. Tham khảo chính thức và áp dụng có chọn lọc

Các mô tả dưới đây tóm tắt tài liệu sản phẩm công khai của nền tảng, không phải audit màn hình sau đăng nhập bằng tài khoản partner.

| Nền tảng | Điều đã xác minh từ tài liệu | Áp dụng cho ReloHome |
|---|---|---|
| Airbnb | Today, Calendar, Listings, Messages và Menu; xem tin như khách; quản lý nội dung/ảnh/tiện nghi | Tổng quan ưu tiên việc cần xử lý; nhà/phòng/tin có trạng thái rõ; preview khách; hộp thư và lịch xem tách dễ hiểu. [Hosting tools](https://www.airbnb.com/resources/hosting-homes/a/exploring-your-hosting-tools-738) |
| Airbnb | Đổi ảnh bìa, sắp xếp ảnh, sửa mô tả ảnh và quản lý bộ ảnh | Gallery thủ công: nhiều ảnh, chọn bìa, sắp xếp/xóa; không thêm AI photo tour. [Photo management](https://www.airbnb.com/help/article/477) |
| Zillow Rental Manager | Bắt đầu từ địa chỉ, unit number và property type; sau xác nhận address mới hoàn thiện property/listing/lease/media/amenities | Nhà/địa chỉ → phòng → thông tin/ảnh → xem trước/gửi duyệt. Giữ ID phòng riêng trong cùng nhà. MVP giữ nút Lưu nháp; chưa cần autosave phức tạp. [Creating a listing](https://zillow.zendesk.com/hc/en-us/articles/32915356424595-Creating-a-Listing) |
| Booking.com Pulse | Messages/requests, cập nhật activity, performance, room availability và review từ thiết bị di động | Hộp thư và việc cần làm có số unread/status rõ; cập nhật phòng còn trống/đã thuê dễ bấm trên mobile; refresh dữ liệu. MVP chưa cần realtime push hoặc auto-reply. [Pulse official](https://www.booking.com/propertyapp.en-gb.html) |
| Agoda Partner Hub | Partner Portal Calendar quản lý room inventory, rates và availability | Giữ trạng thái phòng khác với review tin; quản lý theo phòng/nhà. Không bê mô hình rates/calendar theo đêm vào flow thuê tháng. [Rates and availability](https://partnerhub.agoda.com/how-do-i-manage-my-availability/) |

Mục tiêu là hoàn tất tác vụ chủ nhà trên desktop/mobile: biết tin đang ở đâu, thiếu gì, có ai hỏi, lịch xem nào cần xử lý. Không đo mức hoàn thiện bằng số lượng biểu đồ hoặc chức năng sao chép từ nền tảng du lịch.

## 4. Bố cục sản phẩm đề xuất

Giữ tài khoản khách/chủ nhà và cách chuyển chế độ hiện tại. Khu `/landlord` tiếp tục dùng design system ReloHome, với các mục:

1. **Tổng quan:** số liệu gọn và việc cần xử lý.
2. **Nhà & phòng:** property/unit hiện hữu, thông tin địa chỉ/pin, tình trạng từng phòng.
3. **Tin đăng:** bảng/card theo trạng thái, tìm theo tiêu đề/mã phòng, lọc theo nhà và publication/availability riêng.
4. **Hộp thư:** contact requests + message threads, filter trạng thái và unread.
5. **Lịch xem:** danh sách theo ngày; dùng contact/viewing data hiện hữu, không thêm reservation engine.
6. **Thống kê:** 7/30 ngày, từng nhà/tin, chỉ event thật và định nghĩa rõ.
7. **Đánh giá:** tái sử dụng khu đánh giá đã có.

Mobile có thể gom mục phụ vào menu để tránh quá nhiều tab; không tạo bảy ô navigation hẹp trên một hàng. Mọi empty/loading/error state và retry giữ nguyên ngữ cảnh đang thao tác.

### Tổng quan cần trả lời ngay

- Có bao nhiêu nhà/phòng đang quản lý?
- Có bao nhiêu tin đang public, chờ duyệt, bị trả lại hoặc còn draft?
- Có yêu cầu/tin nhắn/lịch xem nào chưa xử lý?
- Tin nào thiếu thông tin hoặc cần xác nhận lại còn trống?
- Bấm chỉ số phải mở danh sách đã lọc đúng, không chỉ hiện con số trang trí.

Không lấy count managed listings làm số phòng nếu một unit có nhiều listing. Chỉ đếm những trạng thái thực sự đã biết; phòng chưa có thông tin availability không tự coi là vacant. Phân biệt “phòng còn trống” và “tin đang công khai”.

### Form đăng tin có mapping

**Địa điểm → Phòng → Nội dung & ảnh → Xem trước & gửi duyệt.**

- Tái sử dụng nhà đã có cho nhiều phòng; không geocode lại mỗi lần thêm phòng.
- Nhập địa chỉ, tìm gợi ý Vietmap, chọn đúng địa điểm, server resolve ref, xem pin và xác nhận. Sửa address/pin làm mất hiệu lực xác nhận cũ khi cần.
- Map preview trong form và Admin là private preview; chưa đưa vào Map Customer cho tới khi được duyệt và còn khả dụng.
- Form có trường bắt buộc và lỗi ngay cạnh trường; lưu nháp được dù chưa đủ thông tin. Checklist dựa vào validation, không dùng điểm chất lượng/AI.
- Giá tháng, cọc và khoản phí rõ; khoản chưa rõ không đổi thành 0.
- Bộ ảnh nhiều file, thumbnail, bìa, sắp xếp/xóa và trạng thái upload từng ảnh. Server vẫn kiểm JPEG/PNG/bytes/ảnh giải mã được; không tin URL/cờ validated từ browser.
- Preview dùng dữ liệu draft, không gọi public detail endpoint để đọc tin chưa duyệt. Owner/Admin preview có authz riêng.
- Gửi duyệt dùng revision hiện tại; lỗi không mất nội dung và không tạo listing trùng khi retry. Sửa tin đã duyệt nêu rõ sẽ cần review lại.

### Admin

- Lối “Đăng nhập Admin” ở màn đăng nhập → `/admin`, cùng authentication/backend hiện hữu. Không tạo đăng ký Admin công khai hoặc menu Admin cho khách/chủ nhà.
- Hàng chờ hồ sơ/địa điểm/tin hiện hữu được trình bày rõ trên một workspace; tin detail có chủ nhà, phòng, giá/phí, gallery và address/map.
- Filter pending/published/rejected/hidden và search; review đúng revision, reason bắt buộc khi reject, backend kiểm quyền/self-review.
- Dashboard Admin chỉ cần số đang chờ, cần bổ sung, vừa xử lý; không cần risk scoring, BI hoặc hệ thống finance.
- Gán quyền Admin cho tài khoản do người dùng chỉ định ở bước cấu hình được duyệt; không tự chọn một account đang có trong DB để nâng quyền.

## 5. Thống kê phải có nghĩa đúng

Source hiện ghi detail_view theo session + listing; save theo account + listing và dedupe lâu dài. Bỏ lưu không xóa event đã ghi. Vì vậy **saves hiện là số sự kiện lưu đã ghi nhận, không phải số khách hiện còn lưu tin**.

MVP thống kê đề xuất:

- Snapshot: số nhà, số phòng, tin public, pending/rejected/draft, phòng có trạng thái vacant/rented/paused.
- Hoạt động theo 7/30 ngày: detail views theo định nghĩa session, các lần lưu được ghi nhận, contact requests và lịch xem mới/xác nhận.
- Định nghĩa/cửa sổ ngày theo timezone ứng dụng Việt Nam; mốc “bắt đầu ghi nhận” lấy từ event thật. Không dựng lịch sử trước thời điểm đó.
- Nếu thêm biểu đồ, SQL/group theo occurred_at và cùng filter với totals; không sinh dữ liệu giả hoặc suy ra impressions từ detail_view.
- Chưa đủ event thì empty state; không gọi tiền thuê dự kiến hay “khách đã báo trả” là doanh thu thực.
- Các chỉ số tỷ lệ chuyển đổi chỉ thêm sau khi định nghĩa được denominator và dedupe nhất quán; không so unique saves toàn đời với views trong bảy ngày rồi gọi là conversion.

## 6. Thứ tự triển khai tối thiểu

**P0 — hoàn tất được một tin mới:** cấu hình tài khoản Admin được chỉ định; lối login/workspace review; validation đầy đủ; ownership/self-review/revision/transaction; address mapping + private preview; ảnh public approved; draft → submit → reject/resubmit → publish → hide/rented đồng bộ Search/Map/MCP.

**P1 — chủ nhà quản lý được nhiều phòng:** danh sách tin có filter, gallery/cover, tổng quan cần xử lý, inbox filters và lịch xem chung. Tái sử dụng tables, contact requests, messages và CSS/component hiện có. Endpoint quản lý mới vẫn owner-scoped.

**P2 — thấy hiệu quả thật:** range/filter thống kê 7/30 ngày, event definitions/dedupe, drill-down; giữ reviews. Không thêm thu tiền thuê, hợp đồng điện tử, pricing động, channel manager, AI moderation, CCCD hoặc microservice mới vào MVP này.

Khi P0/P1 qua nghiệm thu mới mô tả là demo đăng tin/quản lý khép kín. Không coi việc có UI/upload endpoint hoặc health 200 là nghiệm thu publish.

## 7. Nghiệm thu sản phẩm

1. Tài khoản mới khách/chủ nhà hoàn thiện hồ sơ, tạo một nhà có pin và hai phòng cùng tọa độ; lưu draft, upload ảnh, gửi duyệt đúng quyền.
2. Admin khác tài khoản đăng nhập khu Admin, xem preview đầy đủ, reject có lý do; chủ nhà sửa/gửi lại, Admin approve đúng version.
3. Customer thấy đúng tin đã duyệt/còn trống và đúng ảnh/pin; chưa duyệt không vào Search/Map/MCP. Tin rented/hidden rút khỏi public.
4. Chủ nhà không sửa nhà/tin/media người khác; Admin không tự duyệt nội dung của mình; quyết định màn hình cũ bị 409.
5. Dashboard status counters/drill-down khớp DB, calendar/inbox cùng contact/viewing IDs; refresh không làm mất form/draft/thread.
6. Gallery cover/order hiển thị giống preview sau approval; upload lỗi giữ draft và không tạo listing/ảnh trùng khi retry.
7. Thống kê có cửa sổ thời gian, định nghĩa và empty state đúng; số đếm từ event thật, không tạo impressions/revenue giả.
8. Desktop/mobile, keyboard, VI/EN/theme và regression PR127 map/viewing/service forms qua. Dữ liệu crawl hiện hữu được giữ theo phạm vi đã chốt.

Phụ thuộc kế hoạch backend/data trong [audit hệ thống](../review/relohome-listing-mvp-audit-2026-10-12.md) và [kiểm chứng data PR127](../review/pr127-housing-data-verification-2026-10-12.md). Chưa thay code, grants, tài khoản hoặc configuration trong lượt nghiên cứu này; servers đang chạy vẫn là bản PR127.
