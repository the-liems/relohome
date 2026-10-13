# SPEC-007: Nền tảng vị trí ReloHome

Trạng thái: Draft (chưa được nhóm duyệt)  
Người phụ trách: @DungMQ  
Người review: nhóm xác nhận sau  
Issue cha: tạo khi đưa vào kế hoạch thực hiện

## Mục tiêu

Người dùng cần xem bản đồ, tìm địa điểm và tiện ích gần nhà, tra cứu nhà ở
và xem tuyến đường. Kết quả phải phản ánh dữ liệu thực tế; không tự tạo tin
đăng, địa chỉ, tuyến đường hay giá đối tác khi chưa có nguồn dữ liệu.

Phạm vi của spec là ứng dụng trong `apps/platform-api/`, `apps/location-mcp/` và `examples/map-app/`. Agent Python ở thư mục
`apps/agent-api/` hiện chạy độc lập.

Status kiểm thử 29/09/2026: có housing thật, 9 tool MCP, HTTP bearer auth và
đã thử cả 9 graph OSRM. Chưa chứng nhận độ phủ kín vùng/production SLA hoặc
bài hội thoại của graph. Xem [status hiện hành](../integration/README.md).
Draft nói về review tài liệu, không có nghĩa chưa có code.

## Luồng sử dụng

1. Chọn thành phố và xem các nhóm POI trên bản đồ MapLibre.
2. Tìm ứng viên địa điểm/khu vực bằng văn bản; reverse chưa triển khai.
3. Xem tiện ích quanh một điểm hoặc tìm nhà theo điều kiện không gian.
4. Chọn A và B để xem tuyến, khoảng cách, thời gian và hình học từ OSRM.
5. Chuyển nhu cầu vùng phục vụ/báo giá sang Moving; Location chưa có API mobility.

## Đọc chi tiết theo việc cần làm

| Nhu cầu | Tài liệu chi tiết |
|---|---|
| Xem basemap, POI, nguồn POI | [SPEC-008](SPEC-008-ban-do-va-poi.md) |
| Tìm tên, địa chỉ, reverse, nearby | [SPEC-009](SPEC-009-tim-kiem-va-tien-ich-gan.md) |
| Tìm nhà, điều kiện gần và commute | [SPEC-010](SPEC-010-tim-nha-o.md) |
| Tuyến A đến B, distance/ETA | [SPEC-011](SPEC-011-dinh-tuyen.md) |
| Vùng dịch vụ và ước tính giá | [SPEC-012](SPEC-012-vung-dich-vu-va-gia.md) |
| Công cụ MCP để client khác đọc | [SPEC-013](SPEC-013-mcp-vi-tri.md) |

Các AC bên dưới là tiêu chí tổng quan đã có; tiêu chí chi tiết của từng luồng
nằm trong SPEC tương ứng. Không dùng trạng thái `Draft` để suy ra phần nào
đã triển khai xong.

## Ngoài phạm vi

Spec này không cam kết báo giá trực tiếp từ Ahamove/Grab, xác thực production,
định vị tài xế theo thời gian thực, map matching, tuyến xe đạp hoặc kết nối
tự động với agent Python. Những phần đó cần yêu cầu và hợp đồng riêng.

## Giao diện và dữ liệu chuẩn

- Schema Zod chuẩn nằm tại [`packages/contracts/src/`](../../packages/contracts/src).
- HTTP endpoint được đăng ký tại [`platform-api/src/app.ts`](../../apps/platform-api/src/app.ts).
- MCP dùng lại package contracts; [tài liệu tích hợp](../integration/location-service-implementation-status.md) chỉ dẫn tới
  nguồn chuẩn, không định nghĩa lại field.
- Dữ liệu không gian nằm trong PostGIS; OSRM cung cấp bằng chứng tuyến đường.

## Lỗi, bảo mật và giới hạn

Input sai phải được báo lỗi validation. Không tìm thấy bản ghi thì trả kết quả
rỗng hoặc 404 theo endpoint; OSRM offline/không tìm được tuyến không được biến
thành tuyến dài 0 m. Location không cung cấp báo giá/vùng phục vụ đối tác,
không dựng phản hồi mobility khi chưa có API. API hiện phục vụ môi trường local;
không coi CORS localhost là cơ chế bảo mật production. API key chỉ ở file môi
trường bị Git bỏ qua, không đưa vào phản hồi hoặc tài liệu.

## Tiêu chí nghiệm thu

- **SPEC-007/AC-01:** Bản đồ hiển thị basemap và các nhóm POI có dữ liệu.
  Lọc nhóm chỉ đổi phần hiển thị, không xóa POI gốc.
- **SPEC-007/AC-02:** Tìm văn bản trả gợi ý địa điểm/khu vực trong giới hạn
  truy vấn; tra ngược vị trí cho biết độ chính xác, không bịa địa chỉ.
- **SPEC-007/AC-03:** Tìm tiện ích gần và tìm nhà dùng ràng buộc không gian
  trong PostGIS. Không có tin phù hợp thì hiển thị trạng thái rỗng.
- **SPEC-007/AC-04:** Tuyến A→B thuộc profile được hỗ trợ trả khoảng cách,
  thời gian và geometry từ OSRM. Offline, phản hồi sai hoặc không có tuyến
  phải được báo lỗi.
- **SPEC-007/AC-05 (thiết kế cũ, ngoài phạm vi Location hiện tại):** Service area và estimate phân biệt đã cấu hình,
  ngoài vùng và chưa cấu hình; không tạo giá đối tác khi chưa có tích hợp.
- **SPEC-007/AC-06:** Maps API và MCP kiểm tra input theo cùng Zod contracts
  và chạy độc lập với agent Python.

## Cần nhóm xác nhận

Người review, issue cha và milestone; hợp đồng tích hợp với agent Python;
yêu cầu bảo mật production và tích hợp nhà cung cấp dịch vụ.

Các quyết định liên quan nằm trong [mục lục ADR](../adr/README.md).
