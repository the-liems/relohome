# SPEC-013: MCP truy vấn vị trí

Trạng thái: Draft | Phụ trách: @DungMQ | Review/issue cha: nhóm xác nhận sau

## Mục đích và phạm vi

MCP server cho một client/agent bên ngoài đọc dữ liệu vị trí đã có, không tự
quyết định thuê nhà hay đặt dịch vụ. Đây là một server `stdio` riêng trong
Maps workspace; root Python agent hiện chưa nối vào server này.

## Giao diện và hành vi

- Tool đăng ký tại [`mcp-server/src/create-server.ts`](../../Maps%20VN/LifeFlow/mcp-server/src/create-server.ts);
  schema chia sẻ từ [contracts](../../Maps%20VN/LifeFlow/packages/contracts/src/).
- Nhóm nhà: `search_housing`, `get_housing`.
- Nhóm vị trí: `search_places`, `get_place`, `search_areas`,
  `resolve_location`, `reverse_location`, `find_nearby_places`.
- Nhóm tuyến/dịch vụ: `calculate_route`, `check_service_area`,
  `estimate_delivery`.
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
MCP `stdio` hiện chạy local; không có xác thực hoặc endpoint nhiều client cho
product. Kho chưa có tin nhà thật nên không thể nghiệm thu câu hỏi gợi ý nhà
trên dữ liệu production chỉ bằng các test schema/tool.

## Tiêu chí nghiệm thu

- **SPEC-013/AC-01:** Server công bố đúng 11 tool đọc nêu trên và không
  công bố tool đề xuất nhà hoặc ghi dữ liệu.
- **SPEC-013/AC-02:** Input/output của tool được kiểm tra bằng cùng Zod
  contracts mà Maps API sử dụng.
- **SPEC-013/AC-03:** Không có nhà/giá đối tác thì tool trả trạng thái thực
  tế, không dựng listing, lời khuyên hay báo giá.
- **SPEC-013/AC-04:** Server chạy độc lập với root Python agent.

Kiểm chứng: [test MCP](../../Maps%20VN/LifeFlow/mcp-server/tests/mcp.integration.test.ts).
Quyết định liên quan: [ADR-001](../adr/ADR-001-independent-workspaces.md),
[ADR-002](../adr/ADR-002-contract-ownership.md).
