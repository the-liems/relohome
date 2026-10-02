# Sửa hạn chế MVP — 02/10/2026 (UTC+7)

Nền: `mvp`, commit `74f778a`. Đối chiếu file teammate cung cấp
`docs/architecture/mvp-architecture.md` và các hạn chế đã bàn.
Không đổi kiến trúc Planner LLM + executor tất định + domain agents LLM;
không deploy, không dùng dữ liệu/provider/LLM giả, không bật giao dịch.

## Thay đổi

| Vấn đề | Xử lý |
|---|---|
| BUG-01: bộ nhớ lẫn Map/Housing | Chỉ task Housing được xác nhận là nguồn của preference Housing. Không xóa bộ nhớ người dùng đã tồn tại. |
| BUG-02: catalog Moving không tới được | Thêm fact `moving_mode`, missing rules, mapping Planner và mô tả phạm vi từ catalog AhaMove thật. |
| BUG-03: viết tắt chặn cả lượt | Bỏ chặn chung tại Intake. Để domain phân giải bằng dữ liệu thật; phần độc lập vẫn chạy. Thêm `map_near`/`map_city` để Map độc lập không thay vị trí Housing. Không thêm danh sách alias gắn cứng. |
| BUG-04: thiếu địa danh/choices sai | Không tự chọn kết quả fuzzy hay đưa nó làm gợi ý chắc chắn. **Chưa bổ sung dữ liệu địa danh thiếu**; cần người phụ trách dữ liệu cập nhật nguồn hợp lệ. |
| BUG-05: mất cờ chất lượng giá | Truyền mã `attributes.quality.flags[].code` qua contract Location thành `quality_flags`; hỗ trợ cả mảng chuỗi. Giữ giá nguồn nhưng cảnh báo trong câu trả lời; giá có cờ `price_*` không thành quote ngân sách. |
| BUG-06: Planner không sửa lỗi structured output | Thử lại lỗi no-result/schema/timeout/connection trong cùng trần hai lần và deadline, không fallback plan/provider giả. Chưa chủ động gây lỗi LLM thật để kiểm nhánh retry. |
| BUG-07: đặt xe khi writes tắt báo PLAN_INVALID | Gỡ commit kinds khỏi registry live khi ghi đang tắt; Intake giải thích rõ, không gọi transaction. |
| BUG-08: thông báo sai nguyên nhân | Ownership/input không hợp lệ không được nói là lỗi provider tạm thời. Không đưa chi tiết PLAN_INVALID/LLM_NO_RESULT vào câu trả lời; chẩn đoán vẫn ở backend. |
| BUG-09: đổi sang quận bị thiếu khu vực | District là phạm vi hợp lệ khi Location phân giải được. Nếu lượt trước đã có nhà thật và city thống nhất, giữ city đó khi đổi từ địa danh sang quận; bỏ near/pin cũ. Nếu vẫn mơ hồ phải hỏi, không đoán. |
| BUG-10: Moving hỏi lại nhưng không có pin nhà | Đưa tọa độ nhà thật gần đúng vào choices, ghi rõ cần xác nhận điểm dừng xe. Bỏ tự dùng một kết quả fuzzy. **Không tự gom các POI trong 150 m thành một điểm lấy/giao**: đó có thể là các cổng khác nhau. |
| BUG-11: Moving thiếu trace | Ghi tên tool vào `data.agent_trace` cho kết quả và lỗi; không ghi payload/key/liên hệ. |
| BUG-12: near chứa selected:property | Loại marker khỏi near Housing, kể cả giá trị kế thừa; Map dùng entity ID/dependency thay vì geocode marker. |

Ngoài ra:

- Nút chọn căn đánh dấu STALE cả Map/Moving dùng ID trực tiếp, rồi lan tới task phụ thuộc.
  Chặn thay lựa chọn ảnh hưởng dịch vụ đã đặt; lựa chọn không đổi không làm stale thừa.
- Pin Moving khớp địa chỉ căn cũ được bỏ khi chọn căn khác; không chuyển tọa độ cũ sang căn mới.
- Nhà thêm qua phân trang/Map được đồng bộ nguồn, map_context, quote và missing_fields.
  Trang sau cũng bỏ tin không có giá thuê tháng hoặc địa chỉ theo cùng quy tắc search ban đầu.
- Sửa timestamp của selection: so sánh datetime có timezone, chấp nhận cùng thời điểm viết bằng
  `Z` hoặc `+00:00`, vẫn từ chối nhóm kết quả cũ hoặc timestamp không có timezone.
- Map workspace giữ thêm các bộ lọc backend hỗ trợ: availability, verification, source, nearby.
  Chỉ chỉnh mapping tham số, không thiết kế lại UI.

## Kiểm chứng thực tế

Các ca thực thi riêng, không phải một lượt toàn bộ suite trên một bản build:

| Ca | Bằng chứng / kết quả |
|---|---|
| Catalog AhaMove → yêu cầu đặt xe khi read-only | `th_4591855e6d2e4b23ac7496c9aa6b0244`: ANSWER → CLARIFY giải thích ghi chưa bật. |
| Housing → Map qua dependency → chọn căn → Map quanh căn → đổi căn → phân trang | `th_b478ed4e1845470f9bea73a466d738dd`: qua kiểm tra luồng, lựa chọn mới làm Map bound cũ STALE, citations đồng bộ trang sau. Tiếp tục checkpoint đã có để không tìm nhà lại sau lỗi test harness. |
| Gần Bách khoa → đổi quận Hà Đông, giữ ngân sách | `th_f805e0ca79a14084834a101d89105fa6`: ANSWER → ANSWER, near cũ bị bỏ, 6 triệu được giữ. Ca trước sửa `th_d823252b291a4dc287aba0d1ed1b0919` có hỏi lại và không được tính là pass. |
| Nhà Quận 1 TP.HCM + Map quanh Bách khoa Hà Nội độc lập | `th_59f40dfdb2b34e818fd86ad067bc613f`: CLARIFY cho Housing chưa phân giải được viết tắt; Map DONE, có kết quả thật, không depends_on Housing. Không nói toàn yêu cầu đã thành công. |
| Thanh toán mã không tồn tại/không thuộc user | `th_ee960f26ad8748459ff70475ea981eae`: ERROR với lời giải thích dữ kiện/quyền truy cập; task Payment invalid_input, không gọi thanh toán. |
| Cờ price_outlier_low thật qua MCP → candidate | Test PostGIS/MCP đạt; lần đầu test bị skip do truy vấn nhầm flags là chuỗi. Sau đối chiếu cấu trúc thật và sửa extraction/truy vấn, test đạt, không tạo record thay thế. |
| Nhà gần đúng → Moving endpoint/pin suggestion | Test dùng ID và tọa độ nhà hiện hữu trong DB: không auto-resolve endpoint, có choice để xác nhận, không gọi LLM. |

Test files:

- `tests/test_llm_agents/test_limitations_rules.py`: 6 kiểm tra hàm thuần, không mock client/LLM/provider.
- `tests/test_llm_agents/test_location_quality_live.py`: 2 ca với DB/MCP thật, không LLM.
- `tests/test_llm_agents/test_mvp_limitations_live.py`: 5 ca chat/API thật, đọc checkpoint thật để kiểm
  citations/task results (public state endpoint không trả raw task_results).

Build TypeScript 8 workspaces và React thành công. Audit 9 Location MCP tools và 9 OSRM engines
thành công. Ruff/diff được kiểm trước bàn giao. Không chạy suite mock sẵn có để chứng minh live.

Usage ghi trong runtime DB cho toàn đợt (gồm lần test harness lỗi và ca sửa chưa đạt):
**43 LLM calls; 133.391 input tokens; 3.184 output tokens**.
Đây là usage app ghi nhận, không suy ra hóa đơn hoặc cached-token discount.

Chạy các ca cần kiểm lại, tránh chạy cả suite nếu không cần:

```powershell
$env:RUN_LIVE_INTEGRATION='1'
$env:RUN_LIVE_API_URL='http://127.0.0.1:8000/api/v1'
.venv/Scripts/python.exe -m pytest tests/test_llm_agents/test_limitations_rules.py tests/test_llm_agents/test_location_quality_live.py -q
# Dòng dưới gọi LLM thật; chọn ::test_name để chỉ kiểm ca đang thay đổi:
.venv/Scripts/python.exe -m pytest tests/test_llm_agents/test_mvp_limitations_live.py -q -s
```

## Chưa được tuyên bố hoàn chỉnh

- Dữ liệu địa danh thiếu chưa được import; không bịa tọa độ/POI hay sửa giá gốc.
- Viết tắt chưa phân giải được vẫn có thể cần hỏi tên đầy đủ, nhưng không chặn task độc lập.
- Bộ nhớ cũ có thể đã bị lẫn từ phiên bản trước; chưa tự xóa dữ liệu của người dùng.
  API quên bộ nhớ có sẵn nếu người dùng muốn làm mới.
- Các pin/cổng chuyển đồ cần user xác nhận. Không hạ guard chỉ để có báo giá.
- Map viewport chưa hỗ trợ filter commute như search Housing. Chưa mở rộng query/UI commute
  trong đợt này; không khẳng định mọi marker map tương đương kết quả lọc commute.
- Fan-out vẫn theo wave LangGraph, không đổi thành scheduler liên tục.
- Payment chat chỉ tra trạng thái; Flight chưa có provider xuất vé thật. Không bật booking giả.
- Không test lại toàn bộ flight, đặt/hủy xe hoặc thanh toán sau đợt sửa này; không có giao dịch mới.

Contract/tiêu chí: [SPEC-014](../specs/SPEC-014-domain-llm-agents.md), AC-14 đến AC-19 (Draft, chờ review nhóm).
