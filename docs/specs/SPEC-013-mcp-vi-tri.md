# SPEC-013: MCP truy vấn vị trí

Trạng thái: Draft | Phụ trách: @DungMQ | Review/issue cha: nhóm xác nhận sau

## Mục đích và phạm vi

MCP server cho một client/agent bên ngoài đọc dữ liệu vị trí đã có, không tự
quyết định thuê nhà hay đặt dịch vụ. Server hỗ trợ `stdio` và Streamable HTTP
trong Maps workspace. Phía graph quản lý lựa chọn tool và hội thoại.

## Giao diện và hành vi

- Tool đăng ký tại [`mcp-server/src/create-server.ts`](../../apps/location-mcp/src/create-server.ts);
  schema chia sẻ từ [contracts](../../packages/contracts/src).
- Nhóm nhà: `search_housing`, `get_housing`.
- Nhóm vị trí: `search_places`, `get_place`, `search_areas`,
  `resolve_location`, `find_nearby_places`.
- Nhóm tuyến: `calculate_route`, `calculate_route_between_entities`.
- Tool đọc dùng cùng service PostGIS/OSRM với API. Dữ liệu trả về không
  phải quyết định cuối cùng của agent.
- `calculate_route` trả distance/duration theo graph OSRM. `search_housing`
  có thể dùng `commute.max_distance_m` để lọc ứng viên theo OSRM sau bước
  PostGIS. `find_nearby_places` hiện trả khoảng cách thẳng PostGIS và chỉ
  một POI gần nhất mỗi category; **chưa có tool lọc POI theo đường đi OSRM**.

## Lỗi, bảo mật và ngoài phạm vi

Input không hợp lệ phải bị từ chối theo schema; nguồn PostGIS/OSRM lỗi không
được đổi thành câu trả lời bịa. MCP không có quyền ghi POI/tin nhà hoặc đặt
đơn. Không có tool `recommend_housing`. Việc gắn MCP vào agent, phân quyền
production và quản lý credentials cần quyết định riêng.
MCP HTTP dùng bearer token theo cấu hình triển khai. Kho đã có tin nhà thật;
độ chính xác vị trí và độ mới của nguồn phải được giữ khi trả lời. Không mở
rộng alias/viết tắt. Handoff và giới hạn timeout/cancellation được ghi tại
[trạng thái triển khai](../integration/location-service-implementation-status.md).

## Tiêu chí nghiệm thu

- **SPEC-013/AC-01:** Server công bố đúng 9 tool đọc nêu trên và không
  công bố tool đề xuất nhà hoặc ghi dữ liệu.
- **SPEC-013/AC-02:** Input/output của tool được kiểm tra bằng cùng Zod
  contracts mà Maps API sử dụng.
- **SPEC-013/AC-03:** Không có nhà/giá đối tác thì tool trả trạng thái thực
  tế, không dựng listing, lời khuyên hay báo giá.
- **SPEC-013/AC-04:** Server chạy độc lập với root Python agent.

Kiểm chứng: [test MCP](../../apps/location-mcp/tests/mcp.integration.test.ts).
Quyết định liên quan: [ADR-007](../adr/ADR-007-independent-workspaces.md),
[ADR-008](../adr/ADR-008-contract-ownership.md).
