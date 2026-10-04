# ADR-011: Không suy đoán giá hay vùng phục vụ của đối tác

> Cập nhật 29/09/2026: đây là đề xuất lịch sử cho Location, không mô tả trạng thái
> adapter AhaMove/Grab ở nhánh Moving của nhóm. Location chưa có API/tool
> service-area/estimate; Moving sở hữu vùng phục vụ và báo giá. Output mobility
> bên dưới là thiết kế, chưa phải contract có thể gọi. Xem [status](../integration/README.md).

Ngày: 2026-09-25  
Trạng thái: Proposed (chờ nhóm duyệt)  
Người đề xuất: @DungMQ | Review: người phụ trách sản phẩm/tích hợp đối tác

## Bối cảnh

LifeFlow muốn tương thích Ahamove/Grab, nhưng một API key hoặc polygon tự lưu
không chứng minh có quyền lấy giá trực tiếp, dịch vụ hiện khả dụng hoặc
đối tác chấp nhận đơn. OSRM chỉ trả quãng đường và thời gian.

## Các phương án

1. Dùng công thức nội bộ và gắn nhãn "giá Grab/Ahamove": nhanh nhưng gây
   hiểu nhầm về nguồn và độ tin cậy.
2. Không có giao diện service area/estimate cho đến khi có adapter.
3. Chuẩn bị contract và dữ liệu vùng có nguồn; chỉ tính giá LifeFlow khi có
   rule nội bộ hợp lệ, để đối tác ở `not_configured` cho tới khi tích hợp.

## Quyết định đề xuất

Chọn phương án 3. Vùng phục vụ có nguồn/thời hạn; phải phủ cả điểm đi và
điểm đến. Giá LifeFlow cần rule còn hiệu lực cùng route OSRM và trả phiên
bản rule. Ahamove/Grab chưa có adapter báo giá nên không trả `amount_vnd`.

## Lý do

Trạng thái rõ ràng giữ ranh giới giữa "có dữ liệu vùng", "có ước tính
nội bộ" và "có báo giá chính thức của đối tác". Không biến dữ liệu của
LifeFlow thành lời hứa thương mại từ nhà cung cấp khác.

## Hệ quả

UI/client phải xử lý `available`, `unavailable`, `not_configured` và
`amount_vnd=null`. Tích hợp thật cần spec/ADR riêng về quyền API, xác thực,
service code, dữ liệu vùng động, nguồn giá, thời hạn cache và lỗi đối tác.

## Cập nhật 2026-09-29 (theo code hiện tại)

Quyết định này áp dụng cho **service Location** (`/v1/mobility/*`): Location không định giá và không
suy đoán vùng phục vụ của đối tác. Báo giá AhaMove **đã có** nhưng thuộc service Moving
(ADR-002 đến ADR-005, SPEC-004): giá lấy từ API AhaMove, không từ công thức nội bộ. Agent graph (ADR-016)
dùng service Moving cho chuyển đồ, không dùng `/v1/mobility/estimate`.

Liên quan: [SPEC-012](../specs/SPEC-012-vung-dich-vu-va-gia.md).
