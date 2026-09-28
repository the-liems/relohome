# Mục lục ADR

ADR ghi **lý do và đánh đổi của một quyết định kỹ thuật**, không ghi tiến độ.
Khi thay đổi quyết định, tạo ADR mới và đánh dấu ADR cũ `Superseded by ADR-XXX`.
Bảng đánh số thống nhất giữa các nhánh: `docs/architecture/agent-graph.md` §12.1.

| Câu hỏi | ADR | Trạng thái |
|---|---|---|
| Vì sao LifeFlow là workspace đa ngôn ngữ? | [001 - Polyglot LifeFlow workspace](ADR-001-polyglot-lifeflow-workspace.md) | Accepted |
| Adapter provider nằm ở đâu? | [002 - Service adapter boundary](ADR-002-service-adapter-boundary.md) | Accepted |
| Approval, idempotency, khôi phục khi ghi? | [003 - Approval, idempotency and recovery](ADR-003-approval-idempotency-and-recovery.md) | Accepted |
| Mỗi lĩnh vực một MCP server? | [004 - One MCP server per domain](ADR-004-one-mcp-server-per-domain.md) | Accepted |
| Moving chạy container qua HTTP MCP? | [005 - Moving container HTTP boundary](ADR-005-moving-container-http-boundary.md) | Accepted |
| Intake / Routing thành service riêng? | [006 - Standalone Intake and Routing](ADR-006-standalone-intake-routing.md) | Accepted; sẽ *Superseded by ADR-016* khi 016 được Accepted |
| Vì sao Maps không chuyển vào `src/`? | [007 - Hai workspace](ADR-007-independent-workspaces.md) | Proposed |
| Schema nào là nguồn chuẩn? | [008 - Sở hữu contract](ADR-008-contract-ownership.md) | Proposed |
| Vì sao POI lưu trong PostGIS, MapLibre chỉ vẽ? | [009 - Dữ liệu vị trí](ADR-009-postgis-poi-nguon-du-lieu.md) | Proposed |
| Vì sao PostGIS lọc trước, OSRM tính đường đi sau? | [010 - Routing](ADR-010-osrm-routing.md) | Proposed |
| Vì sao chưa trả giá Ahamove/Grab? | [011 - Giá đối tác](ADR-011-ranh-gioi-gia-doi-tac.md) | Proposed |
| Vì sao tìm chuyến bằng SerpApi, đặt vé giả lập? | [012 - Nguồn dữ liệu chuyến bay](ADR-012-flight-data-source.md) | Proposed |
| Vì sao vé máy bay là MCP server riêng? | [013 - Bố cục Flight MCP](ADR-013-flight-mcp-server-layout.md) | Proposed |
| Vì sao mỗi service có Dockerfile riêng? | [014 - Đóng gói MCP server](ADR-014-containerized-mcp-servers.md) | Proposed |
| Vì sao dùng ZaloPay sandbox, dữ liệu cá nhân xử lý thế nào? | [015 - Thanh toán và dữ liệu cá nhân](ADR-015-zalopay-payment-and-data-privacy.md) | Proposed |
| Vì sao một LangGraph graph với subagent theo lĩnh vực? | [016 - Agent graph](ADR-016-agent-graph-with-domain-subagents.md) | Proposed |

Mỗi ADR dẫn tới SPEC liên quan. Tạo quyết định mới bằng
[`_template.md`](_template.md); không viết ADR cho một thay đổi nhỏ không
có đánh đổi đáng kể.
