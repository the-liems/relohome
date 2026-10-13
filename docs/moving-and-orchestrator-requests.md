# Moving service và Orchestrator ↔ agent graph: yêu cầu tích hợp cho MVP

> Historical layout/command evidence (M23); use the [current development map](../DEVELOPMENT.md) for this branch.


- Gửi: Khoa (chủ service Moving / AhaMove; người làm Intake dùng LLM)
- Từ: Doan (agent graph / AI service)
- Ngày: 2026-09-29
- Nhánh: `integration/langgraph-services` (không đụng `main`). Nhánh `khoa` đã được ghép đủ tới commit
  `5d6f6b0`.
- Phản hồi: tạo file `docs/integration/moving-service-response.md` theo mẫu ở §8.

## 1. Bối cảnh

MVP là **chat thật với chatbot**, không có kịch bản dựng sẵn. Chuyển đồ dùng AhaMove staging, chỉ
**trong một thành phố** (liên tỉnh để sau MVP), trả tiền mặt cho tài xế (Q21). Thành phố demo chốt
chung với Dũng: phải vừa được AhaMove staging phục vụ, vừa có dữ liệu tin nhà của Location. Thanh toán vé dùng
Payment mock có nút giả lập.

Chatbot là một graph LangGraph ([agent-graph.md](../architecture/agent-graph.md),
[src/agents/README.md](../../src/agents/README.md)), thay cho hai service HTTP Intake / Routing của
ADR-006 (xem §5). Graph gọi Moving MCP qua HTTP + Bearer:

| Ai gọi | Tool | Khi nào |
|---|---|---|
| Subagent nền `relocation` ([moving.py](../../src/agents/subagents/services/moving.py)), chỉ đọc | `list_moving_services` (`lat`, `lng`, `delivery_type: TRUCK`), `estimate_move` (tối đa 3 service, `payment_method: CASH`), `get_move_order`, `find_move_orders_by_tracking_number` | Báo giá, tra đơn |
| `transaction` ([commit.py](../../src/services/adapters/commit.py)), sau khi người dùng xác nhận | `estimate_move` (báo giá lại với liên hệ thật) → ghi approval sang Moving → `create_move_order`; `cancel_move_order` | Đặt xe, huỷ đơn, huỷ bù khi thao tác khác trong cùng lần xác nhận lỗi |

Toạ độ điểm lấy / giao đồ: lấy từ tin phòng đã chọn, hoặc tìm theo địa chỉ qua service Location
(đang yêu cầu Dũng thêm `geocode_address`,
[location-service-requests.md](location-service-requests.md) §3).

## 2. Moving service: việc cần làm / cần chốt

| # | Vấn đề | Hiện trạng | Đề nghị |
|---|---|---|---|
| M1 | **Endpoint ghi approval** (Q22, issue #16). Tool ghi chỉ chạy khi có bản ghi approval trong DB Moving | Có `MovingService.registerApproval` nhưng chưa expose. Graph từ chối đặt xe khi thiếu endpoint | Endpoint nội bộ theo contract ở §2.1 |
| M2 | Bật ghi trên staging | `compose.moving.yaml` đặt `AHAMOVE_WRITE_ENABLED: "false"` | Bật cho môi trường demo (staging), giữ tắt ở chỗ khác |
| M3 | **Báo giá bắt buộc tên + SĐT** (`estimate_move` → `pickup/destinations.name, mobile`) | Graph báo giá bằng liên hệ tổng đài của hệ thống (`MOVING_QUOTE_CONTACT_*`), đến lúc đặt mới báo giá lại với liên hệ thật (dữ liệu cá nhân chỉ ở `transaction`, D16) | Chọn một: (a) giữ như hiện tại; (b) Moving cho phép báo giá không cần liên hệ (tự điền nội bộ); (c) thêm tool đổi liên hệ cho báo giá đã có mà giữ giá. (b) hoặc (c) tránh việc giá đổi giữa hai lần báo giá |
| M4 | **Giá lệch giữa lúc báo giá và lúc đặt** | Graph đang dừng nếu lệch 1 đồng | **Đã chốt: cho phép lệch nhỏ.** Graph đề xuất: tăng không quá 5% **và** không quá 20.000đ thì vẫn đặt và báo giá mới trong câu trả lời; tăng hơn thì dừng, xin xác nhận lại; giảm thì vẫn đặt. Ngưỡng cấu hình được. Bạn xác nhận AhaMove staging thường lệch bao nhiêu |
| M5 | Chỉ trong một thành phố | Graph chưa kiểm | Graph sẽ từ chối rõ ràng khi hai điểm khác thành phố. Cần bạn cho biết cách chắc chắn nhất để biết một toạ độ thuộc `city_id` nào (`list_moving_services(lat, lng)` có trả `city_id` đúng không; `list_service_areas` có polygon không) |
| M6 | Chọn service cho chuyển nhà | Graph lấy 3 service đầu của `delivery_type = TRUCK` | Cho danh sách `service_id` phù hợp chuyển nhà ở thành phố demo trên staging (xe tải 500 kg / 1 tấn / …), và `requests` cho bốc xếp nếu có. Graph hiện để `movers = null` |
| M7 | Đối soát khi tạo đơn không rõ kết quả | `createOrder` chỉ đối soát được khi điểm giao có `tracking_number`; graph chưa đặt | Graph sẽ đặt `destinations[0].tracking_number` = mã tham chiếu vô danh sinh từ khoá chống trùng. Xác nhận AhaMove chấp nhận định dạng `[A-Za-z0-9_-]{≤ 30}` |
| M8 | Hạn báo giá | `AHAMOVE_QUOTE_TTL_SECONDS` mặc định 300 s; graph đang coi báo giá dùng được 24 h | Graph sẽ lấy `quote.expires_at` làm hạn; vì đặt xe luôn báo giá lại nên không lỗi, nhưng xác nhận ngưỡng bạn muốn dùng cho demo |
| M9 | Token | Một `MOVING_MCP_AUTH_TOKEN` cho mọi tool | Tách token chỉ-đọc (subagent) và token ghi (`transaction`). Graph đã hỗ trợ `MOVING_MCP_WRITE_TOKEN`; hiện tự chặn tool ghi ở phía client |
| M10 | Phí huỷ đơn | Chưa có tool báo phí huỷ | Nếu AhaMove có phí huỷ theo trạng thái, trả trong `get_move_order` hoặc thêm cách "báo phí" (như `cancel_booking(confirm=false)` của Flight) để hiện trước khi xác nhận (S10) |
| M11 | Kết nối từ AI service | `MOVING_MCP_ALLOWED_HOSTS: localhost,127.0.0.1,moving-mcp` | Thêm tên container AI service khi chạy chung Docker network. Graph đọc `MOVING_MCP_URL`, `MOVING_MCP_AUTH_TOKEN` |
| M12 | Lỗi | — | Giữ mã lỗi ổn định ở đầu message hoặc JSON `{code, message}`; `QUOTE_EXPIRED`, `APPROVAL_*`, `INVALID_ORDER_STATUS`, `IDEMPOTENCY_CONFLICT` graph sẽ map sang câu trả lời phù hợp |

### 2.1. Contract endpoint ghi approval (graph đang gọi)

Code phía graph: [moving_approval.py](../../src/services/adapters/moving_approval.py).

```text
POST <MOVING_APPROVAL_URL>
Authorization: Bearer <MOVING_APPROVAL_TOKEN>
{
  "approval_id": "<uuid>",             // uuid5 ổn định theo (approval của graph, action, bước)
  "action_type": "create" | "update" | "cancel",
  "payload": { ... },                   // Moving tự tính hash bằng payloadHash()
  "approved_by": "<user_id>",
  "expires_at": "<ISO 8601>"            // ≤ 30 phút
}
→ 200 / 201 {"approval_id": "<uuid>"}
```

Payload graph gửi:
- `create`: `{action: "create", quote_id, quote_fingerprint, service_id, total_price, workflow_id, action_id}`
  (đúng `createApprovalPayload`); `workflow_id = "lifeflow:<thread_id>"`, `action_id` = khoá chống trùng
  (64 ký tự hex).
- `cancel`: `{action: "cancel", order_id, comment}`.

Endpoint từ chối: `approval_id` đã tồn tại với payload khác, hạn quá 30 phút hoặc đã qua, token sai.

## 3. Subagent của service Moving (trong MVP, làm sau)

Subagent riêng cho lĩnh vực `relocation`, do bạn viết theo contract
[agent-graph.md](../architecture/agent-graph.md) §6.3 (R1–R12), §6.3.8; JSON Schema:
[docs/api/agent-contract/](../api/agent-contract/); capability tối thiểu: `RELOCATION` trong
[`capabilities.py`](../../src/agents/subagents/capabilities.py) (chế độ `quote` và `order_status`).
Trong lúc chờ, graph dùng subagent nền; khi subagent của bạn qua bộ kiểm tuân thủ thì chỉ đổi cấu
hình, graph không sửa (D13).

| # | Yêu cầu | Ghi chú |
|---|---|---|
| A1 | Chọn cách chạy: (a) `LocalAgent` Python trong AI service, tái dùng `Planner` + `validate_plan` + registry 13 tool của `src/agent_services/orchestrator`, gọi Moving MCP qua `McpToolClient`; hoặc (b) `get_manifest` + `run_task` trên Moving MCP (TypeScript) | (a) nhanh hơn vì code planner mức tool của bạn đã là Python |
| A2 | Chỉ dùng **tool đọc** (9 tool). Tool ghi vẫn do `transaction` gọi tất định sau approval | R3. Registry của bạn có `mode: read/write`: lọc bỏ write |
| A3 | `quote`: tự chọn service / xe / bốc xếp phù hợp chuyển nhà, trả nhiều phương án đã xếp hạng; dữ liệu `route` (toạ độ, giờ đặt, không có dữ liệu cá nhân) để `transaction` báo giá lại | Giữ đúng các field trong `data` như subagent nền đang trả, vì `transaction` dùng |
| A4 | `order_status`: trạng thái đơn, link theo dõi; bỏ tên / SĐT trong `path` | D16 |
| A5 | Toạ độ: lấy từ `upstream` (phòng đã chọn) hoặc tool dùng chung của Location (`resolve_location`, `geocode_address`); không gọi thẳng DB của Location | R5 |
| A6 | Thiếu / sai địa chỉ, khác thành phố, ngày đã qua → `needs_input` kèm `questions`, không tự đoán | R4, M5 |
| A7 | Tôn trọng `budget`, báo `usage` (kể cả LLM call nếu planner dùng LLM, tầng `heavy` / `light`, Q20) | R6, R11 |
| A8 | Qua `check_conformance` ([conformance.py](../../src/agents/subagents/conformance.py)) | Điều kiện để thay subagent nền |

## 4. Intake dùng LLM

Thiết kế riêng: [intake-llm.md](../architecture/intake-llm.md) (issue #12). Tóm tắt khác với Intake của
ADR-006:

| Intake ADR-006 (`src/agent_services/intake`) | Intake trong graph |
|---|---|
| Service HTTP riêng `:8011` | Class `LlmIntake` chạy trong graph, gắn qua `AgentService.create(intake=...)` |
| `Understanding`: `intents`, `entities`, `constraints` (list `Fact`), `missing_fields`, `confidence` | `IntakeResult`: `kind`, `intent.domains`, `constraints.values`, `user_confirmed_facts`, `conflicts` |
| Thiếu / mâu thuẫn / `confidence < 0.6` → `needs_clarification` | Phần thiếu do code tính (`resolve_missing`), chỉ hỏi ngay khi không việc nào làm được (D10); không dùng `confidence` |
| Evidence sai → lỗi cả lượt | Evidence sai → trích lại một lần; vẫn sai thì node bỏ fact đó, lượt vẫn chạy |
| Intent `moving_create`, `flight_booking` … | Fact `commit:<kind>` có evidence; intent → `domains` theo bảng §3.3 của agent-graph.md |

Tái dùng: prompt (các ý an toàn), `normalize()` / `repair_evidence`, `StructuredLLM` (đã chép sang
[src/agents/llm.py](../../src/agents/llm.py)).

## 5. Orchestrator: những gì đã thay đổi so với nhánh `khoa`

Graph thay hai service Intake / Routing của ADR-006 bằng một graph LangGraph (ADR-016, Accepted trên
nhánh tích hợp; ADR-006 đã chuyển `Superseded by ADR-016`). Code của bạn **không bị xoá**; `src/agent_services/`, `Dockerfile.agents`,
`compose.agents.yaml`, workflow `agent-services.yml` vẫn nguyên trên nhánh tích hợp nhưng chatbot không
dùng.

| Phần của nhánh `khoa` | Trong graph | Ghi chú |
|---|---|---|
| `validate_plan` (id duy nhất, dependency, chu trình, allowlist, write theo intent) | [planning.py](../../src/agents/planning.py) `validate_plan` | Chuyển lên mức lĩnh vực; thêm S1 (task tốn tiền chỉ cho lĩnh vực được yêu cầu), S2 (đặt phải được yêu cầu), S8 (không đặt lại), Q25 (không đặt cọc) |
| `ApprovalRequest`, `approve()` (khớp chủ, `payload_hash`, hạn ≤ 30 phút, không dùng lại) | [approval.py](../../src/agents/approval.py), node `confirm`, `transaction` | Approval do backend tạo, gắn `payload_hash` của `cost_summary` và `pii_refs` |
| Lease, `needs_reconciliation`, write một cái một lúc | `transaction` | Ghi tuần tự; không rõ kết quả → `pending_verification`, không tự gọi lại |
| Đọc song song có giới hạn | `executor` (`max_parallel_tasks`) | |
| Kiểm revision (CAS) | API: một lượt mỗi thread, request thứ hai nhận 409 | |
| `canonical`, `fingerprint` | [common.py](../../src/agents/common.py) | |
| Planner mức **tool** + registry 13 tool (`config/agent-services/registry.json`) | Chuyển vào subagent Moving (§3) | Planner của graph lập plan mức **lĩnh vực** (một task = một mục tiêu cho một lĩnh vực). Planner mức tool của bạn nằm **bên trong** subagent Moving; trong lúc chờ, graph dùng subagent nền tất định |
| SQLite store | Không dùng | State do LangGraph checkpointer giữ theo `thread_id` |
| `ToolGateway` | `McpToolClient` ([mcp.py](../../src/services/adapters/mcp.py)) | Allowlist tool đọc / ghi riêng theo service |

Planner hiện dùng `TemplatePlanner` (tất định, 4 lĩnh vực); LLM Planner (issue #13) làm sau, làm
`fallback` cho yêu cầu phức tạp.

**Cần bạn review / xác nhận:**

| # | Việc |
|---|---|
| O1 | Review `validate_plan`, `approval_problems`, luồng `transaction` (commit tuần tự, compensate, `pending_verification`) có giữ đúng các bảo đảm của ADR-003 không |
| O2 | ADR-006 đã được đánh dấu `Superseded by ADR-016` theo code hiện tại (có bảng đối chiếu từng quyết định trong ADR-016); bạn xem lại và cập nhật SPEC-001 (Intake), SPEC-003 (Routing) theo graph |
| O3 | Quyết định xử lý `src/agent_services/`, `Dockerfile.agents`, `compose.agents.yaml`, CI `agent-services.yml` (giữ làm tham khảo, hay xoá) |
| O4 | Việc mới liên quan tích hợp làm trên (hoặc merge thường xuyên từ) `integration/langgraph-services`; nhánh `khoa` tách từ commit cũ của Dũng nên lần ghép vừa rồi xung đột ở `README.md` của Maps, `package.json`, `.env.example`, CI, mục lục ADR / SPEC |

## 6. Xung đột với phần của Dũng

| # | Xung đột | Đề nghị |
|---|---|---|
| X1 | ADR-001 (Polyglot LifeFlow workspace, của bạn) trùng chủ đề ADR-007 (hai workspace, của Dũng) | Đã đánh dấu ADR-007 `Superseded by ADR-001`; ADR-001 là bản giữ lại |
| X2 | ADR-011 / SPEC-012 của Dũng ghi "AhaMove chưa có adapter báo giá"; service Moving của bạn đã báo giá AhaMove thật | ADR-011 đã có mục cập nhật: báo giá AhaMove thuộc service Moving; ADR-003, ADR-004 của bạn cũng có mục cập nhật theo graph, bạn xem lại |
| X3 | `packages/contracts` dùng chung (bạn thêm `moving.ts`); `package.json` gốc, `package-lock.json`, CI job `lifeflow-typescript` dùng chung | `moving.ts` là của bạn, phần còn lại của Dũng; sửa `common.ts` cần cả hai review |
| X4 | Toạ độ địa chỉ cho báo giá chuyển đồ phụ thuộc tool `geocode_address` của Dũng | Nếu Moving có cách geocode riêng (AhaMove có API tìm địa chỉ?), cho mình biết để làm phương án dự phòng |

## 7. Phía graph sẽ làm (để bạn biết)

- Ngưỡng lệch giá M4; kiểm cùng thành phố M5; `tracking_number` M7; hạn báo giá theo `expires_at` M8.
- Cấu hình chọn subagent theo lĩnh vực (`nền` / `local` / `remote`) và tự quay về subagent nền khi subagent
  của bạn không gọi được (`FallbackAgent`), để thay dần mà không làm hỏng demo.
- Hỏi lại người dùng khi toạ độ chỉ khớp tới phường / quận.
- Giữ phiên MCP trong một lượt để giảm độ trễ (báo giá chuyển đồ gồm 4–5 lần gọi nối tiếp).
- Sửa các lỗi nhỏ đã biết của node `intake` / API (thời điểm ghi fact, `suggestion_key`, `request_id` khi resume, header người dùng).

## 8. Mẫu phản hồi (`docs/integration/moving-service-response.md`)

```markdown
# Phản hồi Moving service và Orchestrator
- Người trả lời: Khoa — Ngày:
- Commit / nhánh tương ứng:

## Endpoint ghi approval (M1)
- URL, cách cấp MOVING_APPROVAL_TOKEN, khác gì so với §2.1:
- Ngày dự kiến:

## Staging cho demo
- Thành phố demo AhaMove hỗ trợ:          AHAMOVE_WRITE_ENABLED bật ở đâu:
- service_id dùng cho chuyển nhà, requests bốc xếp:
- Mức lệch giá thường gặp giữa hai lần estimate (M4):
- Cách xác định city_id của một toạ độ (M5):

## Từng mục (M1–M12, A1–A8, O1–O4, X1–X4)
| Mục | Đồng ý / Không / Khác | Ghi chú, ngày dự kiến |
|---|---|---|

## Subagent Moving (§3)
- Cách chạy: LocalAgent Python / run_task trên Moving MCP:     Có dùng LLM không:
- Ngày dự kiến:

## Intake LLM (issue #12)
- Ngày bắt đầu / dự kiến xong:
- Câu hỏi về intake-llm.md:

## Việc bạn cần graph làm thêm
```
