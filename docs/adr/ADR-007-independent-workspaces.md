# ADR-007: Giữ hai workspace ứng dụng độc lập

Ngày: 2026-09-25  
Trạng thái: Proposed (chờ nhóm duyệt)  
Người đề xuất: @DungMQ | Review: chủ sở hữu phần agent và repo

## Bối cảnh

Repo có app Python trong `src/` và Location Platform Node trong
`Maps VN/LifeFlow/`. Maps đã có npm workspaces, migration, UI, MCP, test và
script vận hành riêng. Hiện chưa có kết nối runtime giữa hai ứng dụng.

## Các phương án

1. Chuyển toàn bộ Maps vào `src/`: một cây thư mục, nhưng phải sửa đường dẫn
   build/deploy và làm lẫn hai hệ package.
2. Giữ nguyên vị trí, chỉ thiết kế hợp đồng khi thật sự kết nối hai phần.

## Quyết định đề xuất

Chọn phương án 2. Không di chuyển code Maps chỉ để đồng nhất hình thức repo.
Một tích hợp agent → Maps sau này cần spec, contract và test qua ranh giới.

## Lý do

Giữ đường dẫn hiện có giúp nhóm Maps và nhóm agent làm việc/merge độc lập,
không đổi hành vi đang chạy. `src/` vẫn là nơi của app Python; Maps là một
workspace riêng có lý do kỹ thuật, không phải thư mục tài liệu bỏ quên.

## Hệ quả

Có hai bộ dependencies và cổng kiểm thử riêng. Chưa thể gọi Maps từ agent
chỉ vì hai phần cùng repo. ADR này không tự cho phép hay bắt buộc migration.

Liên quan: [SPEC-007](../specs/SPEC-007-location-platform.md),
[SPEC-013](../specs/SPEC-013-mcp-vi-tri.md).
