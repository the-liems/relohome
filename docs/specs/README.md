# Mục lục SPEC

SPEC nói **hệ thống phải làm gì**; ADR nói **vì sao chọn cách làm**. Trạng thái
dùng `Draft`, `Accepted` hoặc `Superseded`. Mã tiêu chí (`SPEC-NNN/AC-NN`) giữ ổn
định; tiến độ theo dõi ở GitHub Issues, không ở mục lục này.

[SPEC-014 — Domain LLM agents](SPEC-014-domain-llm-agents.md) mô tả vòng tool
mission-driven theo ADR-021, contract 1.1 và kiểm chứng không mock.

## Shared product contracts

| SPEC | Status | Scope |
|---|---|---|
| [SPEC-021 — Housing Product V1](SPEC-021-housing-product-v1.md) | Accepted | Additive Tenant decision tools and isolated Landlord workspace without changing existing Housing flows |
| [SPEC-019 — Housing comparison isolation](SPEC-019-housing-comparison-isolation.md) | Draft | Read-only comparison separate from search, choice, map navigation and costs |
| [SPEC-018 — Search scope and Roommate map](SPEC-018-search-scope-and-roommate-map.md) | Draft | True administrative boundaries, viewport/radius intersection, service journey and isolated synthetic Roommate playground |

| SPEC | Status | Scope |
|---|---|---|
| [SPEC-020 — Housing controls and Roommate discovery](SPEC-020-housing-controls-roommate-discovery.md) | Draft | Explicit comparison, consented device directions and clearer separate real/DEMO discovery |
| [SPEC-016 — Interactive housing search](SPEC-016-housing-search.md) | Draft; desktop list/map and automatic viewport search confirmed | Housing interaction, custom requirements, explicit home choice, and current implementation gaps |
| [SPEC-008 — Domain MCP tool catalogue](SPEC-008-service-tools.md) | Draft | Proposed tool inputs/outputs, booking lifecycles, approval, and recovery |
| [SPEC-015 — Maps and location experience](SPEC-015-maps-and-location-experience.md) | Draft | Customer flow, geographic evidence, cross-service selection rules, and acceptance criteria |

The shared catalogue and the Maps/POI specification both carry the existing identifier SPEC-008. Use their full titles and filenames when linking them; they describe different scopes. Implementation progress is tracked in GitHub issues and PRs.

## Agent

| Cần tìm hiểu | SPEC | Trạng thái | Phụ trách |
|---|---|---|---|
| Intake / hiểu yêu cầu | [001 - Goal understanding](SPEC-001-goal-understanding.md) | Draft | Khoa |
| Routing Orchestrator | [003 - Planning and execution](SPEC-003-planning-and-execution.md) | Draft | Khoa |
| Dịch vụ chuyển nhà AhaMove, yêu cầu đóng gói và kịch bản người dùng | [004 - AhaMove moving service](SPEC-004-ahamove-moving-service.md) | Draft | Chủ service Moving |

Thiết kế graph hợp nhất (intake, Routing Orchestrator, subagent theo lĩnh vực):
[agent-graph.md](../architecture/agent-graph.md), ADR-016.

## Travel

| SPEC | Status | Scope |
|---|---|---|
| [SPEC-017 — Travel and flight booking](SPEC-017-travel-and-flight-booking.md) | Draft | Customer requirements, existing flight contracts, booking approval, payment linkage, cancellation, and recovery |

## Maps

Bắt đầu từ [SPEC-007](SPEC-007-location-platform.md) để hiểu toàn cảnh, rồi
đọc đúng phần cần làm. SPEC nói **hệ thống phải làm gì**; ADR nói **vì sao
chọn cách làm**. Phần lớn spec còn `Draft` để nhóm review; SPEC-012 là thiết kế
lịch sử chưa triển khai trong Location. [Status hiện hành](../integration/README.md)
là nơi tra code, kiểm thử và dữ liệu đã xác nhận.

| Cần tìm hiểu | SPEC | API hoặc nơi sử dụng |
|---|---|---|
| Trải nghiệm bản đồ, bằng chứng và lựa chọn của người dùng | [015 - Maps and location experience](SPEC-015-maps-and-location-experience.md) | Relocation application; bổ sung yêu cầu cho SPEC-007 đến SPEC-013 |
| Toàn cảnh và ranh giới với agent | [007 - Location Platform](SPEC-007-location-platform.md) | Maps workspace |
| Basemap, POI, nguồn dữ liệu | [008 - Bản đồ và POI](SPEC-008-ban-do-va-poi.md) | `/v1/places/map` |
| Resolve và nearby (chưa có reverse) | [009 - Tìm vị trí](SPEC-009-tim-kiem-va-tien-ich-gan.md) | `/v1/locations/resolve`, `/v1/places/nearby` |
| Tin nhà và commute | [010 - Tìm nhà](SPEC-010-tim-nha-o.md) | `/v1/housing/*` |
| Tuyến A đến B | [011 - Định tuyến](SPEC-011-dinh-tuyen.md) | `/v1/routes` |
| Vùng dịch vụ và giá (thiết kế lịch sử) | [012 - Mobility](SPEC-012-vung-dich-vu-va-gia.md) | Chưa có API Location; thuộc Moving |
| Công cụ cho agent khác gọi | [013 - MCP](SPEC-013-mcp-vi-tri.md) | MCP `stdio` / Streamable HTTP |

Field/giới hạn chính xác lấy từ Zod tại
[`packages/contracts/src/`](../../packages/contracts/src),
không chép lại schema vào SPEC. Mẫu cho tính năng mới:
[`_template.md`](_template.md).

Ví dụ "tìm nhà cách BKHN tối đa 2 km đường đi": đọc SPEC-009 để xác định
đúng vị trí, SPEC-010 để lọc nhà, SPEC-011 để hiểu quãng đường OSRM. Không
dùng bán kính PostGIS làm kết luận cuối cùng về quãng đường di chuyển.

SPEC-001, SPEC-003, SPEC-004 thuộc phần agent / Moving (mục trên); không suy ra chức năng
Maps từ số thứ tự spec.
