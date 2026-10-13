# Bàn giao Intake LLM, Routing Planner LLM và Moving LLM

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


> Cập nhật 30/09: các component đã nối graph ở nhánh `mvp`.
> Tài liệu dưới đây giữ mốc bàn giao độc lập ngày 29/09; trạng thái hiện tại xem
> [MVP integration](mvp-completion-2026-09-30.md) và [runbook](../runbooks/local-mvp.md).

Ngày: 2026-09-29. Owner: Khoa. Base đã đồng bộ từ
`integration/langgraph-services@d5c438e`. Không sửa hai tài liệu teammate gửi ở `docs/`.

## 1. Phần mới là gì?

| Thành phần | Code/interface | Trách nhiệm |
|---|---|---|
| Intake | `src/agents/intake_llm.py`: `LlmIntake.understand` | Hiểu tiếng Việt, ý định nhiều domain, đổi ý, dữ kiện có evidence, yêu cầu đặt/hủy tách khỏi phê duyệt |
| Routing Orchestrator: phần suy luận | `src/agents/planner_llm.py`: `LlmPlanner.plan` | LLM lập/sửa kế hoạch theo domain, đọc previous results/validation/change context; không TemplatePlanner-first |
| Moving subagent | `src/agents/subagents/services/moving_llm.py`: `MovingLlmAgent.run_task` | LLM chọn tool đọc, quan sát, hỏi lại hoặc hoàn tất task bằng dữ liệu thực |
| Khởi tạo độc lập | `src/agents/llm_components.py`: `build_llm_components` | Tạo ba component, không build LangGraph, không tự mở server |
| Chạy thủ công | `python -m src.agents.llm_cli intake/planner/moving` | Nhận JSON qua stdin, gọi component thật; không vòng graph |

Đây **không phải** thêm ba HTTP server mới. Python AI runtime sẽ chứa các agent;
Moving MCP/API TypeScript vẫn là service/container riêng. HTTP Intake/Orchestrator
trong `src/agent_services/` là bản kiến trúc cũ, giữ lại nhưng không dùng làm interface ghép mới.

Luồng sau khi tích hợp (CHƯA bật):

```text
User -> Intake LLM -> kiểm/gộp facts, hỏi thiếu
     -> Orchestrator LLM lập/sửa plan -> kiểm DAG + scheduler
     -> Moving LLM -> read-only Moving MCP -> AhaMove
     -> validator -> phản hồi / hỏi lại / yêu cầu replan
     -> nếu đặt/hủy: xác nhận cụ thể -> transaction backend, không qua tool ghi của LLM
```

Không có agent Executor thứ ba. Planner LLM là bộ phận suy luận của Orchestrator;
scheduler/validator/transaction là các phần code thực thi quanh nó trong graph hiện có.

## 2. Contract và quy tắc

Nguồn chuẩn: `src/agents/intake.py`, `planning.py`, `models.py`, `contracts/agent_task.py`.
Không tạo một bộ schema cạnh tranh với graph.

### Intake

- Input là `IntakeInput`, hỗ trợ `previous`, `plan_outline`, câu hỏi/gợi ý đang chờ.
- Chỉ lấy facts mới từ lời user mới nhất; ngữ cảnh trước chỉ dùng để hiểu câu ngắn.
- Evidence phải là chuỗi con lời user; chọn option phải là ID có trong `plan_outline`.
- `requested_actions` nội bộ LLM là ý định đặt/hủy, KHÔNG approval. Graph suy ra
  `commit_requested` từ grounded facts như node hiện tại đang làm.
- Loại dữ liệu liên hệ, không dùng trí nhớ mềm như điều kiện cứng người dùng vừa xác nhận.
- Trả `IntakeResult` thô; node ghép facts bằng `ground_facts` rồi `resolve_missing` và
  `respond` mới đặt câu hỏi. CLI có normalize cho một lượt mới; không giả lập hội thoại nhiều lượt.
- Sửa output tối đa một lần; vẫn có fact không xác minh được thì đánh dấu conflict,
  không âm thầm bỏ yêu cầu để chạy một truy vấn lỏng hơn.

### Orchestrator / Planner

- Mỗi task là mục tiêu của domain, không phải tên MCP tool.
- Chỉ dùng capabilities và agents có trong input; kiểm schema, DAG, dependencies,
  input phải khớp constraints/facts/default được công bố.
- Giữ task ID khi sửa cùng task; không tự bỏ domain đã đủ dữ kiện hay ý định đặt
  khi có thể lập kế hoạch. Không tự bỏ bộ lọc cứng hoặc thêm domain tốn phí.
- Cho phép làm phần đủ dữ kiện, để graph hỏi phần còn thiếu. Replan nhận kết quả,
  validation và change context; không tự làm mới trạng thái task của graph.
- Không sinh approval, thanh toán, token, địa chỉ/tọa độ/provider ID giả.
- Kế hoạch lỗi sau hai lượt trả `LLMError`; node phải hiển thị lỗi/hỏi lại, không coi là đã hoàn thành.

### Moving

- Ba mode: `catalog`, `quote`, `order_status`; manifest quảng bá ngân sách/schema mở rộng.
- LLM chỉ nhìn các tool phù hợp mode, mỗi vòng một call. ID dịch vụ phải có trong
  danh mục vừa đọc; ID đơn/tuyến lấy từ request đáng tin, không từ model bịa ra.
- Catalog gọi `list_service_areas`, `list_moving_services`, `get_moving_service`.
- Quote xác minh tuyến/ngày giờ, lấy dịch vụ thật, gọi `estimate_move`, trả quote ID,
  hạn giá, lựa chọn, km/thời gian/phí khi provider có, route để transaction báo giá lại.
- Mỗi estimate tối đa ba dịch vụ đã đọc; không tuyên bố đã so sánh toàn bộ thị trường.
- Không geocode bằng trí nhớ LLM. Địa chỉ mơ hồ/cấp quận hoặc housing chỉ gần đúng phải hỏi lại.
  Tọa độ trực tiếp chỉ nên do bản đồ/user xác nhận; graph cần giữ nguồn xác nhận.
- Không chặn hai thành phố khác nhau. Provider quyết định vùng phục vụ từng tuyến.
- Không suy diễn số người bốc xếp, tải trọng phù hợp hoặc phí hủy. Thiếu là unknown/null.
- Tra trạng thái dùng ID thật hoặc tracking khớp duy nhất. Tool events hiện chỉ kiểm tra lịch sử;
  chưa chuẩn hóa toàn bộ timeline vào kết quả agent; MCP gốc vẫn có dữ liệu.
- Không có tool tạo/sửa/hủy/đánh giá trong allowlist của agent. Các chức năng ghi Moving
  đã có ở MCP/API gốc, chỉ transaction backend mới gọi sau approval đúng payload.
- Số liên hệ báo giá lấy từ cấu hình hệ thống, không gửi cho LLM hay trả vào kết quả.
- Kết quả/giá do code lấy từ phản hồi MCP, không dùng câu trả lời tự viết của LLM làm giá.

## 3. Cấu hình và chạy độc lập

Trong `.env` (không commit):

```dotenv
OPENAI_API_KEY=<key thật>
AGENT_INTAKE_MODEL=gpt-4.1-mini
AGENT_PLANNER_MODEL=gpt-4.1-mini
AGENT_MOVING_MODEL=gpt-4.1-mini
MOVING_MCP_URL=http://127.0.0.1:4400/mcp
MOVING_MCP_AUTH_TOKEN=<token chỉ đọc của server>
MOVING_QUOTE_CONTACT_NAME=<liên hệ thật của hệ thống>
MOVING_QUOTE_CONTACT_MOBILE=<số thật>
LOCATION_MCP_URL=<Location HTTP MCP nếu cần resolve địa chỉ>
LOCATION_MCP_AUTH_TOKEN=<token Location>
```

Factory không tự load `.env`: application caller load cấu hình trước. CLI và live tests
nhận biến môi trường từ lệnh khởi động (`node --env-file`). Thiếu key báo lỗi, thiếu Moving endpoint thì `components.moving=None`;
không tự thay bằng fake. Có model key không có nghĩa Moving server/database đang chạy.

Ví dụ PowerShell cho Intake, không cần DB:

```powershell
$env:PYTHONIOENCODING='utf-8'
$OutputEncoding = [System.Text.UTF8Encoding]::new()
'{"message":"Tìm phòng ở Quận 10 dưới 5 triệu"}' | .venv/Scripts/python.exe -m src.agents.llm_cli intake
```

Planner nhận JSON đúng `PlannerInput` sau normalize, Moving nhận `AgentTaskRequest`.
Cuối lifespan phải `await components.close()`.

Live tests có chi phí OpenAI:

```powershell
$env:RUN_LIVE_LLM='1'
$env:RELOHOME_LIVE_CHECKS='1'
npm run test:live -- python tests/test_llm_agents/test_live_components.py -q

# Build TypeScript trong Maps VN/LifeFlow trước: npm.cmd run build:moving
$env:MOVING_TEST_POSTGRES_BIN='C:\Program Files\PostgreSQL\18\bin'
$env:MOVING_TEST_AGENT_PYTHON=(Resolve-Path .venv/Scripts/python.exe).Path
# AhaMove credentials, route and contact: root .env.test (see .env.test.example)
node 'Maps VN/LifeFlow/scripts/test-moving-native.mjs'
```

Runner tạo DB riêng, migrate hai lần, chạy HTTP/MCP thật, rồi chạy agent live nếu có
`MOVING_TEST_AGENT_PYTHON`. Cuối cùng dừng DB và giữ thư mục tạm để kiểm tra.
Không xóa DB hiện có; không Docker reset; không đặt đơn AhaMove.
Ca quote cần `MOVING_LIVE_QUOTE_INPUTS` là JSON tuyến thực được operator cho phép;
không có biến này thì skip riêng ca quote, không thay route/provider bằng mock.

## 4. Phần Đoàn/AI cần ghép tiếp — CHƯA thực hiện

- [ ] Inject `components.intake` và `components.planner` vào deps của graph.
  Dùng `LlmPlanner` trực tiếp, không bọc trong `TemplatePlanner(fallback=...)` mặc định.
- [ ] Đăng ký `components.moving` dưới `AgentName.RELOCATION`, dùng đúng manifest mới;
  các domain khác chỉ đăng ký khi service/subagent thật đã sẵn sàng.
- [ ] Giữ node intake hiện có để merge/ground facts, selected options, memory, hỏi thiếu;
  kiểm lại quick reply và chọn phòng thật qua UI.
- [ ] Gắn các outcome validator, needs_input, failed và user change vào replan đúng giới hạn.
- [ ] Sửa cách tính usage ở node: dùng `component.usage`/`last_call_count`, tính cả lượt
  repair và calls thất bại, thay giả định mỗi invocation chỉ có một LLM call.
  Reserve ngân sách global trước call; nếu còn một lượt thì component không được repair lượt hai.
- [ ] Cấu hình `GraphSettings(price_tolerance={})`: chủ task không duyệt ±5% mặc định.
  Khi giá đổi phải yêu cầu consent mới; không giữ default cũ mà chỉ đổi câu hiển thị.
- [ ] Approval/PII stores, checkpointer, idempotency và reconciliation phải bền vững
  trước staging nhiều worker. Factory này không biến các in-memory stores thành production-ready.
- [ ] Chạy E2E thật: chat -> hỏi thiếu -> plan -> đọc service -> hiển thị -> consent ->
  transaction; kiểm quote hết hạn, đổi ý, timeout không rõ đã ghi hay chưa, hủy có phí.
- [ ] Không dùng Payment mock để tuyên bố payment live. Flight booking mô phỏng của
  teammate cũng phải gắn nhãn đúng; không phải phần được chuyển thành live ở đợt này.

Sau đợt này **bước kế tiếp là ghép LangGraph**. Không chỉ điền API key là toàn bộ MVP
tự chạy: còn dependency injection, policy/budget, UI consent, persistence và E2E ở trên.

## 5. Bảo mật và giới hạn chứng cứ

Không log raw prompts, credentials, contact hoặc provider payload. Scrubber giảm PII
nhưng không nhận diện hoàn hảo mọi tên riêng nằm trong câu văn; dữ liệu nhạy cảm phải
đi qua form riêng. `store=False` dùng cho OpenAI calls, không đồng nghĩa không có mọi
dạng lưu giữ ở provider. Không có bảo đảm LLM chống được mọi prompt injection;
quyền ghi bị chặn bằng code và credential riêng.

Kết quả kiểm thử và lỗi thật phát hiện: [báo cáo live](../../eval/llm-agents-2026-09-29.md).
Quyết định: [ADR-018](../adr/ADR-018-llm-first-agent-components.md).
