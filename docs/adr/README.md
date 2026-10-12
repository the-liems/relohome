# Mục lục ADR

Cập nhật domain agents: [ADR-021 — Mission-driven tools](ADR-021-mission-driven-domain-tools.md).
ADR-020 giữ làm quyết định lịch sử, đã được ADR-021 thay chính sách vòng tool.

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
| Intake / Routing thành service riêng? | [006 - Standalone Intake and Routing](ADR-006-standalone-intake-routing.md) | Superseded by ADR-016 |
| Vì sao Maps không chuyển vào `src/`? | [007 - Hai workspace](ADR-007-independent-workspaces.md) | Superseded by ADR-001 |
| Schema nào là nguồn chuẩn? | [008 - Sở hữu contract](ADR-008-contract-ownership.md) | Proposed |
| Vì sao POI lưu trong PostGIS, MapLibre chỉ vẽ? | [009 - Dữ liệu vị trí](ADR-009-postgis-poi-nguon-du-lieu.md) | Proposed |
| Vì sao PostGIS lọc trước, OSRM tính đường đi sau? | [010 - Routing](ADR-010-osrm-routing.md) | Proposed |
| Vì sao chưa trả giá Ahamove/Grab? | [011 - Giá đối tác](ADR-011-ranh-gioi-gia-doi-tac.md) | Proposed |
| Vì sao tìm chuyến bằng SerpApi, đặt vé giả lập? | [012 - Nguồn dữ liệu chuyến bay](ADR-012-flight-data-source.md) | Proposed |
| Vì sao vé máy bay là MCP server riêng? | [013 - Bố cục Flight MCP](ADR-013-flight-mcp-server-layout.md) | Proposed |
| Vì sao mỗi service có Dockerfile riêng? | [014 - Đóng gói MCP server](ADR-014-containerized-mcp-servers.md) | Proposed |
| Vì sao dùng ZaloPay sandbox, dữ liệu cá nhân xử lý thế nào? | [015 - Thanh toán và dữ liệu cá nhân](ADR-015-zalopay-payment-and-data-privacy.md) | Proposed |
| Vì sao một LangGraph graph với subagent theo lĩnh vực? | [016 - Agent graph](ADR-016-agent-graph-with-domain-subagents.md) | Accepted trên nhánh tích hợp (review lại khi merge `main`) |
| Vì sao Intake/Planner/Moving dùng LLM-first nhưng quyền thực thi vẫn kiểm bằng code? | [018 - LLM-first components](ADR-018-llm-first-agent-components.md) | Accepted trên `khoa`; chưa ghép graph |

Runtime local mới: [ADR-019 — integrated MVP](ADR-019-local-integrated-mvp.md).

Typed form Moving: [ADR-022 — confirmed quote intent](ADR-022-confirmed-moving-form-intent.md)
(Proposed, issue #52; không thay Planner LLM cho hội thoại).
ADR-018 đã được nối vào graph trong nhánh `mvp`; dòng trạng thái `khoa` ở trên là mốc trước tích hợp.

ADR-003, 004, 008, 011 có mục cập nhật 2026-09-29 cho khớp với agent graph (ADR-016); quyết định
gốc giữ nguyên.

Mỗi ADR dẫn tới SPEC liên quan. Tạo quyết định mới bằng
[`_template.md`](_template.md); không viết ADR cho một thay đổi nhỏ không
có đánh đổi đáng kể.

Device-to-home long-distance routing: [ADR-023 — public routing with explicit consent](ADR-023-consented-public-device-routing.md)
(Proposed; issue #81; browser-only trial, no automatic MCP/commute fallback).

Automatic routing: [ADR-024 — automatic public device routing](ADR-024-auto-public-device-routing.md)
(Proposed / awaiting PR review; follows and revises ADR-023’s explicit-consent
trial with local-first routing and automatic public fallback).

Monorepo migration: [ADR-025 — application layout and migration contract](ADR-025-monorepo-layout.md)
(Proposed; #108/#109; includes tracked-path inventory and validation baseline).
