# ADR-021 — Subagent nhận mục tiêu và tự chọn thao tác đọc

Date: 2026-10-03
Status: Accepted cho MVP local theo xác nhận của chủ task; nhóm review khi merge main.
Supersedes: ADR-020 (chính sách vòng tool, không thay ranh giới giao dịch).
Related: ADR-016, SPEC-014.

## Context

ADR-020 bắt buộc LLM gọi một composite tool do code chọn sẵn ở bước đầu. Cách này
giữ dữ liệu đúng nhưng chưa giao quyết định hữu ích cho domain agent. Đồng thời
goal/ưu tiên không được truyền xuống cùng task, và Map khám phá tiện ích đã bị
thu hẹp thành chỉ đường đi trong commit 4348df6.

## Decision

- Một LangGraph và một owner cho state. Orchestrator giao domain, mục tiêu, lời
  người dùng gần nhất, hard inputs, hints và upstream. Contract 1.1 thêm `goal`
  và `user_request` tùy chọn; request 1.0 vẫn được nhận theo major version.
- Housing/Map/Flight/Payment có prompt chuyên môn và namespace tool riêng. LLM
  chọn tra địa điểm/địa giới/sân bay, thực hiện tìm kiếm, đọc chi tiết, phân trang,
  hỏi user, đánh giá rồi kết thúc hoặc đề nghị Orchestrator xem lại kế hoạch.
  Không có `primary_tool()` bắt buộc ở lượt đầu.
- Tool nhận tham chiếu field hoặc ID/cursor đã quan sát. Code gắn dữ kiện đã
  xác nhận, kiểm schema, quyền, nguồn và budget; không cho model sửa ngân sách,
  ngày, tọa độ, danh tính hoặc tự viết SQL. Composite search vẫn là thao tác hợp
  lệ: không bắt LLM resolve lại khi đã có tọa độ/pin hay yêu cầu rõ ràng.
- Preparation dùng kết quả MCP thật và cache riêng từng invocation. Adapter
  không bị mutate chung giữa các task song song; không có cache xuyên user.
- Housing dùng PostGIS lọc không gian, giữ map_context/UI contract. Tìm gần
  địa danh là đường thẳng; không quảng bá thành thời gian/quãng đường OSRM.
  Model chỉ sắp xếp ID đã thấy; nhà chưa đọc không được tuyên bố là tốt nhất.
- Bộ lọc `nearby_*` thuộc Housing. Map khám phá dùng `map_categories`,
  `map_radius_m`, `map_near`; không thay hard filters của Housing đã chọn.
- `agent_assessment` tách biệt với dữ kiện provider; `agent_replan` là đề nghị,
  không phải quyền sửa plan. Validator chuyển đề nghị mới sang Planner trong
  trần replan; kết quả giữ từ plan cũ không kích hoạt lại cùng đề nghị.
- Moving giữ vòng tool hiện có, nhận thêm goal/user_request. Payment chỉ tra
  giao dịch thuộc user; Flight không xuất vé giả; mọi giao dịch vẫn cần luồng
  xác nhận riêng. Không deploy hoặc thay UI trong thay đổi này.

## Alternatives and consequences

### Context và thao tác cơ học (bổ sung cùng ngày)

Giữ Intake, Planner và domain LLM, không phân loại câu bằng keyword để bỏ agent.
Planner nhận mọi capability input schema; output schema thuộc Validator không
cần lặp trong prompt. Projection bỏ field render/trace, giữ toàn bộ danh sách
và dữ kiện chuyên môn/nguồn/unknown/expiry. Không dùng LLM tóm tắt thêm và không
thay dữ liệu trong state/UI. Khi search trả snapshot mới, snapshot search trước
được thay bằng marker trong lịch sử, vẫn giữ cặp function call/output và reasoning.

Housing search nhận count do model chọn trong giới hạn task (<=20), tự resolve
và đọc tối đa ba trang có cursor thật trong budget. Không bắt resolve riêng hoặc
thêm lượt LLM chỉ để lấy trang tiếp. Agent vẫn đánh giá, đọc chi tiết, hỏi hoặc
đề nghị replan. Map pin/ID xác minh có ưu tiên hơn nhãn do model nhắc lại, nhưng
vẫn qua Intake/Planner để hiểu mục tiêu và ảnh hưởng dependency. Nearby quanh
căn đã chọn không lấy anchor Housing cũ thay căn đó.

Giữ vòng cũ tiết kiệm call nhưng lượt bắt buộc chọn một tool có ít giá trị. Mở
toàn bộ MCP args cho LLM làm mất ràng buộc và kiểm chứng. Chọn namespace đọc có
quyền quyết định thao tác, nhưng giữ hard arguments bằng code.

Trần domain loop là 6 LLM calls, nằm trong budget chung của graph, không phải
số call bắt buộc. Cache tránh gọi provider lặp; giới hạn chi tiết/phân trang bởi
provider budget và deadline. Kiểm chứng dùng dịch vụ thật, không tạo mock data,
không coi test skip là pass. Dữ liệu POI/nhà và provider vẫn có giới hạn coverage.

### Bổ sung triển khai 05/10: trả dữ kiện không cần assessment

Thêm `search_housing_and_return` và `search_flights_and_return` trong namespace
**nội bộ domain agent**, không đổi tên MCP contract của teammate. Model chọn
thao tác này khi chỉ cần liệt kê theo bộ lọc; normal search/inspect/finish/replan
vẫn có cho đánh giá chuyên môn. Đây không phải fast-path phân loại câu bằng
keyword và không bỏ Intake hay Planner. Kết quả facts-only đánh dấu
`agent_completion.model_assessed=false`; nguồn tiếp tục nằm ở `source_refs`
chuẩn, không tạo assessment hay tự nới ràng buộc.

Lookup sân bay của Flight local dùng cùng catalog đang phục vụ MCP, kiểm cùng
schema, sau allowlist; chỉ bỏ vòng khởi động stdio cho lookup này. MCP HTTP hoặc
server tùy chỉnh vẫn được gọi như trước. Search giá/chuyến vẫn qua provider thật.
Không coi catalog tĩnh là giá/chuyến live.

Trade-off: task liệt kê đơn giản không có lượt LLM thứ hai chỉ để nhắc lại kết
quả; không tuyên bố model đã đánh giá độ phù hợp. Hội thoại vẫn có overhead
Intake/Planner. [Đo thực tế](../../eval/read-latency-2026-10-05.md) ghi rõ cache,
token, điều kiện đo và giới hạn, không suy ra SLA hay % tăng tốc tổng thể.
