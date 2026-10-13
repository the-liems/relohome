# SPEC-021: Housing Product V1

Trạng thái: Accepted | Phụ trách: QuangDung/Khoa | Phê duyệt: chủ sản phẩm yêu cầu hoàn tất ngày 09/10/2026

## Mục đích và phạm vi

Mở rộng Housing hiện tại thành vòng khép kín giữa người thuê và người đăng mà không thay đổi luồng tìm nhà đang hoạt động. Tenant tiếp tục dùng chat, search, map, saved, comparison và viewing; các công cụ quyết định mới chỉ bổ sung dữ liệu. Landlord có workspace riêng để quản lý nhiều địa điểm, phòng, tin, phí, ảnh, tình trạng trống và yêu cầu liên hệ.

Phạm vi phát hành gồm:

- Tenant: shortlist bền vững, so sánh 2–4 căn, bảng chi phí từ dữ liệu đã biết, kịch bản điện/nước/người/xe, giá/m², câu hỏi cần xác minh và yêu cầu liên hệ.
- Landlord: quyền quản lý theo địa điểm, CRUD bản nháp, nhiều phòng, giá/phí, media, publish/ẩn/xóa mềm, trạng thái trống, inbox và dashboard số liệu thật.
- Moderator: duyệt quyền quản lý và tin/ảnh; không đồng nhất với Landlord.
- Chế độ chủ nhà: một tài khoản chuyển giữa chế độ thuê nhà và chủ nhà; lần đầu khai hồ sơ người đăng (chủ nhà, người được ủy quyền, môi giới, doanh nghiệp). Moderator xác minh người đăng thủ công (pilot) trước khi duyệt địa điểm và tin của họ. Thiết kế: [host-mode-design.md](../review/host-mode-design.md).
- Analytics: chỉ đếm event thật sau thời điểm bắt đầu thu; không backfill và không tạo số liệu giả.

Ngoài phạm vi: hợp đồng thuê, thu tiền thuê/cọc trong ứng dụng, bảo trì, ERP tòa nhà, dự báo giá, tự động claim tin crawl và LLM cho tính toán/filter.

## Luồng sử dụng và hành vi

1. Luồng Tenant cũ giữ nguyên. Tin do Landlord quản lý có thêm nhãn nguồn, thời điểm xác nhận trống, cấu phần phí và nút gửi yêu cầu liên hệ.
2. Tenant lưu 2–4 căn và xem bảng quyết định. Trường thiếu hiển thị “Chưa rõ”; không được tính bằng 0.
3. Tenant chủ động gửi yêu cầu cho đúng listing. Landlord chỉ thấy yêu cầu của địa điểm mình được phân quyền.
4. Landlord tạo địa điểm, thêm phòng, tạo bản nháp, nhập giá/phí/ảnh, xem trước rồi gửi duyệt. Moderator duyệt trước khi tin xuất hiện trong search/map/detail.
5. Landlord cập nhật riêng trạng thái tin và trạng thái phòng; phòng đã thuê hoặc tạm ngừng không nhận yêu cầu mới.
6. Dashboard hiển thị phòng trống, tin cần xử lý, yêu cầu chưa trả lời và event thật trong phạm vi quyền.

## Giao diện và dữ liệu chuẩn

- Read contract hiện hữu: `packages/contracts/src/housing.ts`.
- Contract bổ sung: module Housing Landlord riêng; trường mới trên search/detail là optional/default để client cũ tiếp tục parse.
- Persistence: schema `housing` trong PostGIS hiện tại; không tạo database hay microservice mới.
- Browser identity: session hiện tại → gateway → trusted `X-User-Id`; browser không được tự khai actor.
- Landlord UI: route `/landlord`, component và CSS riêng; không thay hierarchy của `/ai` và Housing workspace cũ.

## Lỗi, bảo mật, giới hạn và ngoài phạm vi

- Mọi write phải xác thực gateway và kiểm tra membership theo property ở server.
- Landlord không được duyệt tin của mình, đọc lead của property khác hoặc sửa tin crawl.
- Write dùng optimistic revision/idempotency ở thao tác có thể gửi lại; conflict trả 409.
- Media kiểm tra MIME, kích thước và tên file; URL lưu trong `listing_media`; file cần volume bền vững khi deploy.
- Analytics không lưu nội dung chat, điểm đến riêng tư hoặc contact ngoài nội dung tenant tự gửi trong request.
- Nếu module Landlord tắt/chưa migrate, search/map/detail cũ vẫn hoạt động.

## Tiêu chí nghiệm thu

- **SPEC-021/AC-01:** Search/map/detail cũ giữ endpoint, payload bắt buộc và hành vi hiện tại; regression pass.
- **SPEC-021/AC-02:** Một Landlord tạo được hai phòng cùng property, sửa phí riêng và chỉ thấy tài nguyên thuộc quyền.
- **SPEC-021/AC-03:** Tin draft/hidden/rented không xuất hiện như tin active nhận liên hệ; publish cần moderator duyệt.
- **SPEC-021/AC-04:** Tenant so sánh 2–4 căn với chi phí đã biết, giả định do họ nhập và cảnh báo trường thiếu.
- **SPEC-021/AC-05:** Tenant gửi request đúng listing; Landlord xử lý lifecycle new/contacted/viewing/resolved/declined.
- **SPEC-021/AC-06:** Dashboard chỉ dùng row/event thật và có empty state khi chưa có dữ liệu.
- **SPEC-021/AC-07:** Upload từ browser không cho path traversal/file không phải ảnh/file quá giới hạn.
- **SPEC-021/AC-08:** Desktop/mobile, keyboard focus, loading/empty/error và contrast được kiểm tra.
- **SPEC-021/AC-09:** Housing/Moving/Flight/Roommate và auth hiện hữu qua regression.
- **SPEC-021/AC-10:** Chưa có hồ sơ người đăng thì không tạo được địa điểm; moderator không duyệt được địa điểm hay tin của người đăng chưa xác minh và không tự xác minh hồ sơ của mình; người thuê chỉ thấy tên hiển thị, tư cách đăng tin và trạng thái xác minh (host-mode-design HM-01..08).

## Lệnh kiểm chứng

- Backend Python: `.\.venv\Scripts\python.exe -m pytest tests -q`
- Location platform: `npm.cmd test` và `npm.cmd run build` tại repository root
- Frontend: `npm.cmd run build` trong `Frontend`
- Browser: Playwright contract và live suites liên quan Housing/Landlord.

## Liên kết và quyết định đã chốt

- Product proposal: [housing-platform-upgrade.md](../ideas/housing-platform-upgrade.md).
- Giữ nguyên luồng cũ: thay đổi chỉ additive, module Landlord tách biệt và có fallback.
- Pilot áp dụng cho các thành phố Housing đang hỗ trợ; moderator duyệt thủ công.
- MVP chỉ tạo tin mới; claim tin crawl để Phase 2.
- Liên hệ dùng inbox trong ứng dụng; không tự công khai số điện thoại.

