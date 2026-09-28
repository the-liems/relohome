# Mục lục ADR

ADR ghi **lý do và đánh đổi của một quyết định kỹ thuật**, không ghi tiến độ.
Các ADR dưới đây (trừ khi ghi khác) đều `Proposed`: mô tả hướng hiện tại để nhóm review, chưa
được xem là đã phê duyệt. Khi được đồng ý, đổi trạng thái thành `Accepted`
qua PR; nếu thay đổi quyết định, tạo ADR mới và đánh dấu ADR cũ
`Superseded by ADR-XXX`.

| Câu hỏi | ADR |
|---|---|
| Vì sao Maps không chuyển vào `src/`? | [007 - Hai workspace](ADR-007-independent-workspaces.md) |
| Schema nào là nguồn chuẩn? | [008 - Sở hữu contract](ADR-008-contract-ownership.md) |
| Vì sao POI lưu trong PostGIS, MapLibre chỉ vẽ? | [009 - Dữ liệu vị trí](ADR-009-postgis-poi-nguon-du-lieu.md) |
| Vì sao PostGIS lọc trước, OSRM tính đường đi sau? | [010 - Routing](ADR-010-osrm-routing.md) |
| Vì sao chưa trả giá Ahamove/Grab? | [011 - Giá đối tác](ADR-011-ranh-gioi-gia-doi-tac.md) |
| Vì sao tìm chuyến bằng SerpApi, đặt vé giả lập? | [012 - Nguồn dữ liệu chuyến bay](ADR-012-flight-data-source.md) |
| Vì sao vé máy bay là MCP server riêng? | [013 - Bố cục Flight MCP](ADR-013-flight-mcp-server-layout.md) |
| Vì sao mỗi service có Dockerfile riêng? | [014 - Đóng gói MCP server](ADR-014-containerized-mcp-servers.md) |
| Vì sao dùng ZaloPay sandbox, dữ liệu cá nhân xử lý thế nào? | [015 - Thanh toán và dữ liệu cá nhân](ADR-015-zalopay-payment-and-data-privacy.md) |
| Vì sao một LangGraph graph với subagent theo lĩnh vực? | [016 - Agent graph](ADR-016-agent-graph-with-domain-subagents.md) |

ADR-001…006 (workspace, adapter boundary, approval / idempotency, MCP theo lĩnh vực,
Moving container, Intake / Routing độc lập) nằm trên nhánh `khoa`, sẽ vào mục lục khi
nhánh đó được ghép. Bảng đánh số thống nhất: `docs/architecture/agent-graph.md` §12.1.

Mỗi ADR dẫn tới SPEC liên quan. Tạo quyết định mới bằng
[`_template.md`](_template.md); không viết ADR cho một thay đổi nhỏ không
có đánh đổi đáng kể.
