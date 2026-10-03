# Bàn giao domain agents theo mục tiêu — 03/10/2026

Trạng thái bàn giao nhánh `khoa` và việc còn lại:
[agent-handoff-khoa-2026-10-03.md](agent-handoff-khoa-2026-10-03.md).
Các ghi nhận “chưa push” bên dưới giữ nguyên theo thời điểm từng đợt đo.

## Bổ sung tối ưu và sửa lỗi sau review

[3 ca mới + số đo trước/sau](../../eval/agent-context-efficiency-2026-10-03.md)
ghi kết quả mới nhất: context projection, search batch, bind lựa chọn map,
đồng bộ POI category, pin Moving và scope assessment đã được sửa. Regression
assessment được nhắc bên dưới đã qua lại trên checkpoint thật. Intake/Planner/
domain vẫn dùng LLM, không có keyword router để bỏ Planner. Ba ca mới đã qua
từng bước bằng provider thật; có tiếp tục checkpoint sau sửa, không che các
lần fail/timeout hoặc gọi chúng là một lần chạy suite sạch. Chưa push/deploy.

Phần bên dưới giữ ghi nhận của đợt trước để đối chiếu, không phải trạng thái
hiện tại của regression assessment.

Đánh giá bổ sung sau bàn giao: [A/B và multiturn thực](../../eval/domain-mission-quality-2026-10-03.md).
Có cải thiện khả năng hoàn tất task, nhưng còn regression phạm vi phản hồi
assessment và chi phí tăng trong ca phân trang; không được hiểu các PASS dưới đây
là xác nhận toàn bộ bản mới luôn tốt hơn.

## Nền code và phạm vi

Đã fetch và fast-forward toàn bộ nhánh `mvp` trước khi tiếp tục chỉnh backend:

- `4309dd5`: tài liệu review/kiến trúc và kết quả test của teammate.
- `b18fb4b944e2a9cacc34a3e73cd8ade7b055fdf9`: giao diện chat, plan panel,
  account/history và POI của teammate.

HEAD và `origin/mvp` cùng ở `b18fb4b` tại lần fetch cuối của đợt này. Các chỉnh sửa
backend nằm trên nền đó, không thay source UI. File riêng
`docs/architecture/mvp-architecture.md` được giữ nguyên, không đưa vào thay đổi.
Chưa commit/push hoặc deploy trong đợt này.

Quyết định: [ADR-021](../adr/ADR-021-mission-driven-domain-tools.md).
Yêu cầu: [SPEC-014/AC-24–29](../specs/SPEC-014-domain-llm-agents.md).

## Luồng hiện hành

```text
Intake LLM: hiểu yêu cầu, tham chiếu và thay đổi qua nhiều lượt
  → Planner LLM: giao domain + inputs + mục tiêu + dependency
  → scheduler: dispatch task sẵn sàng, chạy song song hoặc chờ dependency
  → domain LLM: chọn thao tác đọc → xem kết quả → bước tiếp / hỏi / kết thúc
  → Validator: kiểm contract, nguồn, độ mới và đề nghị replan
  → Planner khi cần; hoặc phản hồi / luồng xác nhận giao dịch riêng
```

Không thêm graph hoặc agent Executor mới. Scheduler không dùng LLM để quyết định
quyền, budget hay việc dependency đã hoàn thành. Nó không quyết định thay domain
LLM thao tác tra cứu đầu tiên.

## Đã thay đổi gì

- Contract 1.1 thêm `goal`, `user_request` có mặc định rỗng, được giới hạn/redact
  trước khi giao. Client 1.0 cùng major vẫn tương thích.
- Housing/Map/Flight/Payment nhận nhiệm vụ ngữ nghĩa và prompt chuyên môn riêng.
  Đã bỏ cơ chế bắt LLM gọi duy nhất `primary_tool()` ở bước đầu.
- Housing có thể phân giải địa danh/địa giới, tìm, đọc chi tiết, đọc trang tiếp
  bằng cursor thật, xếp thứ tự các ID đã thấy và đánh giá kết quả.
- Flight có thể tra sân bay, tìm chuyến, đọc offer và đánh giá giờ/giá/giới hạn
  nguồn. Không tự đổi ngày/người bay hay bịa điều kiện hành lý.
- Map có thể phân giải điểm trước khi tính tuyến hoặc tìm tiện ích. Khôi phục
  Map exploration độc lập và quanh căn đã chọn; không biến thành lọc/tìm lại nhà.
- Payment chỉ đọc giao dịch đã được backend kiểm ownership. Khi task rõ, gọi
  `get_payment` rồi kết thúc là hợp lý; không thêm suy luận để tự quyết trạng thái.
- Moving giữ vòng tool đã có, nhận thêm mục tiêu và lời người dùng mới nhất.
- Code gắn hard inputs đã xác nhận; model chọn field/ID/cursor được cấp hoặc đã
  quan sát, không sinh tọa độ, SQL, giá, quyền giao dịch hay approval.
- Cache MCP chỉ nằm trong một invocation, dùng kết quả provider thật; không
  mutate client chung khi các agent chạy song song. Provider calls và cache hits
  được đếm riêng. Trần domain loop là 6 LLM calls, không phải số call bắt buộc.
- `search_radius_m` là bán kính tìm nhà; phản hồi thông báo rõ khoảng cách đường
  thẳng và khi dùng default. `nearby_*` là bộ lọc Housing; `map_categories` và
  `map_radius_m` là yêu cầu khám phá Map, không sửa bộ lọc Housing đã chốt.
- `agent_assessment` là đánh giá model, không phải provider fact. Kết quả `limited`
  được phản hồi là `PARTIAL`, kèm hạn chế có nhãn rõ ràng.
- `request_replan` là đề nghị gửi Validator/Planner, không sửa plan trực tiếp.
  Kết quả giữ từ plan cũ không kích hoạt lại cùng đề nghị; task attempt sau không
  được đề nghị lặp qua tool này. Budget/grounding của Planner vẫn có hiệu lực.

## Bằng chứng kiểm thử thật

Không tạo mock data, mock client, phản hồi provider giả hoặc giao dịch mới.

| Ca | Kết quả và phạm vi đã kiểm |
| --- | --- |
| Tool session với Location/PostGIS thật, không LLM | PASS: resolve Bách khoa Hà Nội, bán kính 2 km, ngân sách 5 triệu, chi tiết nhà, phân trang bằng cursor thật; ID lạ bị chặn trước MCP; cache và nguồn/quote/viewport giữ đúng. |
| Semantic feedback trên chính kết quả Location thật, không LLM | PASS: `request_replan` chuyển Validator sang REPLAN; result giữ từ version cũ không kích hoạt lại; hard inputs không đổi. Đây là kiểm policy, chưa phải ca Planner LLM replan end-to-end. |
| Housing → chọn căn → Map, API/LLM thật | PASS: tìm quanh Bách khoa Hà Nội, chọn ID thực qua endpoint UI action, hỏi nhà thuốc 1 km quanh căn vừa chọn; giữ selected ID và search_request Housing. Map dùng `find_nearby_places → finish`. |
| Map + Flight độc lập, API/LLM/provider thật | PASS: nhà thuốc quanh Bách khoa Hà Nội + chuyến Hà Nội–Đà Nẵng ngày 13/10/2026. Map `resolve_location → find_nearby_places → finish`; Flight `search_flights → finish`. |
| Payment sandbox đã tồn tại + người dùng khác | PASS: chủ giao dịch đọc được ZaloPay; user khác không nhận payment và có 0 provider calls. Không tạo/thu/hoàn tiền. |
| Phản hồi hạn chế từ checkpoint thực, không LLM | PASS: Map đã trả assessment `limited` thật; compose mới hiển thị PARTIAL và đánh giá có nhãn, giữ kết quả nguồn. Không ghi lại checkpoint. |
| Ruff, compile Python, JSON Schema, build UI | PASS: lint phần agents/test mới, import/compile; schema sinh từ Pydantic; `npm run build` UI teammate. Build không phải kiểm browser tương tác toàn bộ. |

Hai task Map/Flight có thời gian thực thi chồng nhau:

- Map: `07:46:32.447400 → 07:46:39.662900 UTC`.
- Flight: `07:46:32.448383 → 07:46:40.027443 UTC`.

Đây là execution trace thực, không chỉ hai ô đặt cùng tầng DAG. Trong ca nhiều
lượt, Map chạy sau khi có căn được backend xác nhận; không chạy lại Housing.

Đợt test đầu phát hiện schema `uniqueItems` bị nhà cung cấp LLM từ chối. Đã bỏ
keyword không tương thích và vẫn chặn ID lặp bằng code; chạy lại ca liên quan đã
qua. Test chọn nhà ban đầu dùng sai action `select_housing` và bị API trả 422 đúng
contract; sửa thành `select`, tiếp tục trên thread thật để không trả tiền chạy lại
bước tìm nhà đã qua.

### Usage được runtime ghi nhận cho các ca đã qua

| Lượt | LLM calls, gồm Intake/Planner/domain | Input tokens | Output tokens |
| --- | ---: | ---: | ---: |
| Tìm Housing gần Bách khoa | 5 | 25.559 | 600 |
| Hỏi Map quanh căn vừa chọn | 4 | 18.168 | 491 |
| Map + Flight song song | 7 | 17.145 | 855 |

Đây là số ghi trong SQLite usage meter cho từng request, không phải dự toán tiền
hay tổng toàn bộ lần test lỗi/Payment. Housing đọc hai trang nên input khá lớn;
giới hạn call không đồng nghĩa input token luôn thấp. Không chạy lại ca full đã
qua chỉ để thu thêm trace.

## Cách kiểm lại có kiểm soát

Khởi động dịch vụ theo [runbook local](../runbooks/local-mvp.md). Test opt-in:

```powershell
$env:RUN_LIVE_INTEGRATION='1'
$env:RUN_LIVE_API_URL='http://127.0.0.1:18000/api/v1' # API riêng dùng trong đợt test
.venv/Scripts/python.exe -m pytest tests/test_llm_agents/test_domain_missions_live.py::test_grounded_tools_with_real_location_and_no_llm -q
```

Các ca graph trong cùng file gọi LLM/provider thật và tốn credit. Chỉ chọn ca cần
kiểm, không chạy lại cả suite mặc định. `RUN_LIVE_MISSION_RESUME_THREAD` cho phép
tiếp tục thread Housing thật bằng đúng owner từ checkpoint; chỉ dùng môi trường
local tin cậy. Test assessment từ checkpoint cần một thread có assessment limited
thực; thiếu dữ liệu thì skip, không tự tạo kết quả thay thế.

## Giới hạn không được hiểu nhầm

Đối chiếu **toàn bộ MVP gốc** và bản sửa trên 4 câu liên kết mới, gồm token và
đánh đổi, ở [original-mvp-followups-2026-10-03.md](../../eval/original-mvp-followups-2026-10-03.md).
Không dùng kết quả snapshot trung gian làm bằng chứng tăng tốc so với bản gốc.

- Chưa deploy và chưa push các chỉnh sửa này.
- Không khẳng định mọi ca đời thực đã qua. Coverage địa điểm/nhà và chất lượng
  dữ liệu vẫn phụ thuộc nguồn; tọa độ gần đúng không tự thành điểm dừng xe chính xác.
- Đợt này không kiểm lại tạo/hủy đơn Moving hoặc thanh toán tiền; giữ luồng
  confirmation hiện có. Flight tìm chuyến thật nhưng chưa có provider xuất vé thật.
- Ca replan qua Planner LLM, nhánh mơ hồ và mọi loại tuyến/phân trang provider
  không được tuyên bố đã test đầy đủ chỉ từ các ca trên.
- UI teammate được giữ và build thành công; không thêm/sửa giao diện hay khẳng
  định đã kiểm mọi thao tác trình duyệt.
