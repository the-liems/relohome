# Location — đọc trạng thái hiện hành

Landing UX (frontend only): [visitor experience and verification 10/10](landing-page-ux-2026-10-10.md).

Cập nhật 10/10: [Bàn giao QuangDung: tối ưu Housing, triển khai migration và kế hoạch gộp data geocode](quangdung-housing-performance-handoff-2026-10-10.md).

Cập nhật 08/10: [Phạm vi hành chính thật, luồng workspace và Roommate DEMO](search-scope-roommate-2026-10-08.md).

Runtime graph tổng thể: [bàn giao domain agents 30/09](domain-agents-2026-09-30.md).

Kiểm chứng song song/phụ thuộc: [hai luồng phức tạp 30/09](complex-flows-2026-09-30.md).

Sửa luật nhiều lượt, phạm vi thành phố, Planner hoãn domain và ANALYZE sau restore:
[kiểm thử và sửa lỗi 01/10](turn-rules-fixes-2026-10-01.md).

Chế độ bản đồ cho tìm nhà (danh sách theo vùng, chat điều khiển bản đồ, chọn địa điểm):
[map workspace 01/10](map-workspace-2026-10-01.md).

Cập nhật: **29/09/2026**. Phạm vi là Location/Map trong checkout này;
không xác nhận trạng thái code hay deployment của nhánh Graph/Moving khác.

**Cập nhật bổ sung 30/09/2026:** [Backend Map liên kết với Graph](map-backend-update-2026-09-30.md) ghi các thay đổi mới ở Location/Platform API và graph trong checkout local, API mẫu và giới hạn kiểm chứng.

| Bạn cần biết | Tài liệu chuẩn |
|---|---|
| Code đã làm gì, 9 tool, schema, lỗi, timeout, test | [Trạng thái triển khai](location-service-implementation-status.md) |
| Số liệu có nghĩa gì, data ở đâu, backup nào, kiểm tra DB leader | [Status dữ liệu](location-data-status.md) |
| Cách chạy/deploy MCP | [Current location guide](../location/README.md) |
| Cách import dữ liệu mới | [Current imports](../location/README.md) |
| Phạm vi thay đổi đã duyệt | [Kế hoạch](location-service-change-plan.md) |
| Lý do và đối chiếu yêu cầu lúc đầu | [Khảo sát lịch sử](location-service-response.md) |

## Tóm tắt để đồng bộ nhóm

- 9 tool MCP; có `calculate_route_between_entities`; housing có accuracy/method/deposit.
- Giữ Hà Nội, Đà Nẵng, HCM và 3 profile OSRM. Graph xử lý viết tắt/mơ hồ và chọn tool.
- Đã có dữ liệu housing thật. Số POI trên bản đồ, số hàng catalog và số tin nhà là các đại lượng khác nhau.
- Build/Docker đã qua; lần kiểm thử 29/09 có **93 pass, 9 skip**. Không gộp với số test checkpoint cũ.
- Đã thử 9 graph; chưa chứng nhận phủ kín địa giới, SLA cloud hoặc hội thoại end-to-end của Graph.
- ZIP cũ đã xóa. Backup chỉ giữ data/checksum; code và hướng dẫn lấy từ Git.
- Khi lấy bản bàn giao, đồng bộ nhánh `QuangDung` và ghi commit đang triển khai;
  không coi code local là đã có trên máy đồng đội trước khi họ pull/rebuild.

Các checkpoint 24–26/09 giữ lại để truy vết. Ưu tiên hai trang status trên khi
đọc thông tin mâu thuẫn; schema và registry trong code là nguồn chuẩn cho field/tool.
Khi cập nhật tiếp, ghi ngày, môi trường, nguồn bằng chứng và phạm vi đếm; không
chép số liệu local thành cam kết của mọi deployment.

- [Root workspace tooling validation (#110)](monorepo-tooling/validation.md):
  exact-base/head commands, lock replay, Chrome failure IDs, image startup checks.

## Monorepo consolidation

- [Root development map](../../DEVELOPMENT.md): functional ownership, install,
  per-app commands, test modes, persistent data and delivery.
- [Final #115 consolidation audit](monorepo-final-audit.md): acceptance-to-evidence
  checklist, combined-tree reference counts, compatibility exceptions, ADR status
  and owned #116 follow-ups.
- [Location relocation slice (#141)](location-relocation.md): source accounting,
  data/Compose identities and reviewed validation.
- [Python examples and shim retirement slice (#142)](python-examples-and-shims.md):
  installed demos, caller migration and the sole persisted checkpoint alias.
