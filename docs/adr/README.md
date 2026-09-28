# Mục lục ADR Maps

ADR ghi **lý do và đánh đổi của một quyết định kỹ thuật**, không ghi tiến độ.
Các ADR dưới đây đều `Proposed`: mô tả hướng hiện tại để nhóm review, chưa
được xem là đã phê duyệt. Khi được đồng ý, đổi trạng thái thành `Accepted`
qua PR; nếu thay đổi quyết định, tạo ADR mới và đánh dấu ADR cũ
`Superseded by ADR-XXX`.

| Câu hỏi | ADR |
|---|---|
| Vì sao Maps không chuyển vào `src/`? | [001 - Hai workspace](ADR-001-independent-workspaces.md) |
| Schema nào là nguồn chuẩn? | [002 - Sở hữu contract](ADR-002-contract-ownership.md) |
| Vì sao POI lưu trong PostGIS, MapLibre chỉ vẽ? | [003 - Dữ liệu vị trí](ADR-003-postgis-poi-nguon-du-lieu.md) |
| Vì sao PostGIS lọc trước, OSRM tính đường đi sau? | [004 - Routing](ADR-004-osrm-routing.md) |
| Vì sao chưa trả giá Ahamove/Grab? | [005 - Giá đối tác](ADR-005-ranh-gioi-gia-doi-tac.md) |

Mỗi ADR dẫn tới SPEC liên quan. Tạo quyết định mới bằng
[`_template.md`](_template.md); không viết ADR cho một thay đổi nhỏ không
có đánh đổi đáng kể.
