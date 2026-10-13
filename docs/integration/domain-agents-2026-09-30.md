# Bàn giao: domain agents trong LangGraph

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Ngày 30/09/2026, local Windows. Nền `mvp`: `2893109`, đã fast-forward lấy
`cf93f9f` (Housing/Map backend) và `2893109` (tài liệu/mockup frontend) từ teammate.
Không thay giao diện, không deploy, không thêm dữ liệu hoặc provider mô phỏng.

## Xác nhận kiến trúc

Trước đợt này, Intake/Planner/Moving có LLM; Housing/Map/Flight là adapter đọc
dịch vụ, chưa có vòng LLM riêng. Payment sandbox có form API riêng, chưa là domain chat.

Hiện runtime `AgentService.open` tạo **một LangGraph**, gồm Intake LLM → Routing
Orchestrator/Planner LLM → các domain agents → validator/respond. Graph vẫn giữ
state, dependency, budget, replan và quyền giao dịch bằng code.

| Domain | Agent | Việc LLM được làm | Dịch vụ bên dưới |
|---|---|---|---|
| Housing (`property`) | ReadLlmAgent instance riêng | Search theo task, đọc chi tiết ID thật, sắp xếp kết quả đã nhận, finish | Location MCP/PostGIS |
| Map | ReadLlmAgent instance riêng | Thực thi nearby/route theo task, đọc kết quả, finish | Location MCP/OSRM |
| Flight | ReadLlmAgent instance riêng | Search thật, đọc offer ID đã nhận, sắp xếp, finish | Flight MCP/SerpApi |
| Moving (`relocation`) | MovingLlmAgent | Resolve, chọn tool và báo giá/tra cứu theo quyền đã có | Moving MCP/AhaMove staging |
| Payment | ReadLlmAgent + PaymentSubagent | Tra trạng thái giao dịch đã có, finish | Payment MCP/ZaloPay sandbox |

Các instance Housing/Map/Flight/Payment dùng chung code loop để tránh lệch chuẩn,
nhưng capability, model cấu hình, task và tool riêng. Không phải một server agent
HTTP mới cho mỗi domain. MCP server là lớp dịch vụ, **không đồng nghĩa LLM agent**.
Housing/Map vẫn dùng chung Location MCP của teammate. `compose.agents.yaml` là
harness component ADR-006 cũ; không phải entrypoint graph MVP hiện tại.

Tool đầu là nghiệp vụ composite đã ràng buộc tham số (ví dụ resolve → search);
không cho LLM tự sửa filter/giá/tọa độ, viết SQL hoặc thực thi code tùy ý.
Model có quyền đọc thêm chi tiết và sắp thứ tự Housing/Flight; không có quyền tự
chọn mua thay user. Model của từng domain cấu hình bằng `AGENT_*_MODEL` trong `.env.example`.

## Các lỗi/thiếu sót đã xử lý

- Lấy và giữ sửa đổi teammate: filter Housing thống nhất, metadata/pagination,
  Map selected housing dùng listing ID thật, route độc lập không cần search lại nhà.
- Bổ sung Payment vào enum/manifest, Intake, Planner, registry và graph; cập nhật schema.
- User identity của Payment đi từ API vào execution context, không từ model/tool.
  Kiểm tra ownership trước cả LLM lẫn MCP; không đọc đơn của người khác.
- Kết quả có `agent_trace` và `usage`; tối đa 4 LLM calls/domain invocation, chịu
  deadline/budget chung; không fallback dữ liệu giả.
- Finish Map/Payment không nhận option ID ngoài kết quả. Housing/Flight không
  thêm/bỏ ID; rerank giữ quote và chỉ số missing_fields đồng bộ.
- Flight không tùy tiện lấy sân bay đầu tiên khi có nhiều lựa chọn. Không trình
  fare rules catalog như thông tin đã được provider live xác nhận.
- Planner nhận rõ các domain đủ điều kiện chạy, kể cả Map chờ Housing qua dependency.
- Intake có tin nhắn mới nhất riêng; đối chiếu ISO với ngày DD/MM/YYYY thực sự
  xuất hiện trong câu người dùng để tránh loại nhầm ngày đổi ở lượt tiếp theo.

## Chạy local đúng runtime

Giữ `.env` và `data/integration.env` riêng tư. Không commit DB/key/file dữ liệu.

```powershell
docker compose --env-file data/integration.env -f config/local-integration.compose.yaml up -d
docker compose -f config/local-routing.compose.yaml up -d
npm run build --prefix "Maps VN/LifeFlow"
# Mỗi lệnh dài chạy ở một terminal riêng:
.venv/Scripts/python scripts/local-integration.py location
.venv/Scripts/python scripts/local-integration.py moving
.venv/Scripts/python scripts/local-integration.py api --port 18000
```

Không chạy migrate/import/restore nếu chỉ khởi động snapshot hiện có.
API `/api/v1/status` cần Bearer token + user identity đã xác thực; phải thấy
property/map/relocation/flight/payment và `uses_llm=true` khi đủ cấu hình.
Graph agent loop chỉ đọc. Không dùng `--sandbox-writes` cho regression đọc.
UI nếu đang mở phải trỏ `LIFEFLOW_API_BASE_URL` tới đúng API 18000, không dùng
nhầm ứng dụng khác chiếm cổng 8000. Không sửa `.env` sang production để thử.

## Kiểm chứng

Lệnh live (cần các dịch vụ thật đang chạy):

```powershell
$env:RUN_LIVE_INTEGRATION='1'
$env:RUN_LIVE_API_URL='http://127.0.0.1:18000/api/v1'
.venv/Scripts/python -m pytest tests/test_llm_agents/test_integrated_live.py tests/test_llm_agents/test_multiturn_live.py tests/test_llm_agents/test_payment_agent_live.py -q
```

Không chạy các test dùng mock có sẵn của teammate để thay bằng chứng live.
Không tạo đơn xe/thanh toán mới trong đợt này; Payment test dùng giao dịch sandbox
đã có và kiểm tra user khác bị chặn. Date normalization là kiểm tra hàm thuần;
SQLite/checkpoint kiểm tra DB thật và khởi động lại runtime với LLM thật.

Kết quả thực tế đợt này:

- Build TypeScript toàn bộ 8 workspaces: đạt.
- Ruff/check format các file Python thay đổi, compile và `git diff --check`: đạt.
- Lượt regression tổng: **18 passed, 1 failed / 19 ca** (236,58 giây). Ca lỗi:
  Intake trả evidence không khớp câu hỏi có “2 phòng ngủ”, nên dừng để hỏi lại.
  Không phải lỗi resolve căn nhà/OSRM và không che lỗi bằng dữ liệu giả.
- Sau khi bổ sung hướng dẫn repair evidence: chạy lại **2/2 passed** (36,59 giây):
  chọn nhà rồi tính đường từ listing ID thật; tra Payment hiện có và xác nhận
  user khác thực sự đi vào task Payment rồi bị chặn. Chưa chạy lại toàn bộ 19 ca
  trên patch repair cuối; không ghi thành một lượt 19/19 xanh.
- **4/4 passed**: chuẩn hóa bằng chứng ngày, SQLite encrypted form/approval,
  checkpoint sống qua restart với LLM thật (`RUN_LIVE_LLM=1`).
- Bộ regression đã chạy qua Housing, Flight, Map, báo giá Moving thật, Payment
  sandbox hiện có, sửa ngày/giờ, đổi vùng loại pin cũ, chọn option, đổi mục tiêu,
  và kiểm soát truy cập. Đây là mẫu kiểm thử, không bảo đảm mọi diễn đạt đều đúng.

LLM vẫn có thể lỗi trích xuất ngẫu nhiên. Guard giữ nguyên: không khớp evidence
thì repair có giới hạn rồi hỏi lại; không âm thầm bỏ hard filter để trả kết quả.

## Còn giới hạn gì?

- Payment chat **tra cứu**, chưa tạo/refund qua chat. Form ZaloPay sandbox và
  luồng giao dịch xác nhận riêng không bị thay bằng LLM tự thu tiền.
- Flight chưa có provider xuất vé thật. Không bật booking giả để gọi là hoàn chỉnh.
- Map phụ thuộc coverage dữ liệu/OSRM; địa chỉ mơ hồ vẫn cần người dùng chọn/xác nhận.
- Snapshot Housing có tin tiêu đề và giá/chu kỳ canonical không khớp (ví dụ tiêu
  đề nói theo tuần nhưng record là tháng). Không tự sửa tiền dựa vào tiêu đề;
  cần chủ dữ liệu kiểm tra ingestion trước khi coi đó là giá đáng tin cậy.
- DNS/network tới OpenAI/ZaloPay có lúc lỗi ở máy local. Không coi lỗi mạng là
  lỗi do người dùng hỏi sai, cũng không coi test lỗi mạng là pass.
- Đợt này là tích hợp local và regression có phạm vi, không chứng nhận mọi câu
  hội thoại/production, không deploy và chưa push các thay đổi này.

Thiết kế: [ADR-020](../adr/ADR-020-llm-domain-agents.md).
Contract/tiêu chí: [SPEC-014](../specs/SPEC-014-domain-llm-agents.md).
