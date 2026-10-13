# SPEC-003 — Routing Orchestrator

> Cập nhật 2026-09-29 — [ADR-018](../adr/ADR-018-llm-first-agent-components.md):
> [`LlmPlanner`](../../apps/agent-api/src/relohome_agent/agents/planner_llm.py) implement `Planner.plan` của graph,
> dùng LLM làm bộ phận suy luận chính; không chạy TemplatePlanner trước.
> Tasks là mục tiêu domain. Scheduler, validator, retry, consent và transaction vẫn
> do runtime graph quản lý. Không tạo agent Executor thứ ba. Chưa thay wiring.
> Xem [bàn giao](../integration/llm-agents-handoff.md). HTTP/SQLite/tool-plan bên dưới
> thuộc bản ADR-006 cũ, không phải lời tuyên bố graph hiện có đã persist đầy đủ.

## Acceptance bổ sung cho graph-compatible component

- `SPEC-003/AC-11`: LLM nhận mục tiêu, constraints, capabilities, kết quả và validation
  trước để lập/replan; giữ identity task hợp lệ, không nới/bỏ ràng buộc cứng.
- `SPEC-003/AC-12`: Code kiểm input grounding, capability, DAG, dependencies và intent
  ghi. Không đưa credentials/PII/approval vào model, không coi plan hợp lệ là đã được đặt đơn.
- `SPEC-003/AC-13`: Plan lỗi được repair tối đa một lần rồi báo lỗi; không fallback giả.
- `SPEC-003/AC-14` (01/10): Lĩnh vực được yêu cầu mà input có mặt nhưng chưa dùng được thì
  Planner trả `needs_input {domain, field, question}` thay vì bỏ im lặng. Code chỉ nhận lĩnh vực
  được yêu cầu, field có trong `input_schema`, không kèm task mới cùng lĩnh vực; người dùng
  nhận câu hỏi (`ASK_USER`), không nhận `PLAN_INVALID`. Kiểm địa chỉ vẫn thuộc subagent.
  Global scheduling/budget/persistence được kiểm ở đợt ghép graph, không thuộc live test component.

## Bản standalone trước ADR-016 (lưu để đối chiếu)

- Owner: Khoa (`drpie143`)
- Reviewers: AI/DS, service owners, Backend/Security
- Status: Draft
- Parent issue: existing Routing/Planning issue; assignment pending authenticated GitHub access.
- Related ADRs: [ADR-006](../adr/ADR-006-standalone-intake-routing.md), [ADR-003](../adr/ADR-003-approval-idempotency-and-recovery.md)
- Canonical schemas: [`models.py`](../../apps/orchestrator-api/src/relohome_orchestrator/models.py), [`registry.py`](../../apps/orchestrator-api/src/relohome_orchestrator/registry.py)

## Scope

Một Routing Orchestrator sở hữu lập plan, DAG, dependency resolution, scheduling,
gọi tool nội bộ, observation, retry policy, replan và workflow persistence. Không có
agent hoặc container Executor thứ ba. Bản độc lập cung cấp toàn bộ control logic;
domain MCP adapter chưa kết nối theo phạm vi người dùng đã yêu cầu.

## User flow and behavior

1. Trusted caller gửi IntakeResult cùng owner và session; Orchestrator không gọi Intake.
2. Nếu intake chưa rõ, tạo workflow chờ câu trả lời; không cần gọi LLM để lập plan rỗng.
3. Nếu đủ, LLM tạo plan từ registry; code kiểm allowlist, input schema, reference,
   dependency, DAG không chu trình và quyền read/write lấy từ metadata đáng tin cậy.
4. Lưu workflow trong SQLite; cùng owner/session/request ID và payload được trả lại
   cùng workflow. Dùng lại ID với payload khác bị từ chối.
5. `advance` chạy tối đa một wave: read độc lập được song song; write tuần tự,
   phải có approval khớp payload và input còn hạn. Port gọi tool là hàm nội bộ của
   Orchestrator. Bản standalone trả `blocked_integration` khi chưa có MCP adapter.
6. Mỗi cập nhật dùng `expected_revision`; hai request cạnh tranh không ghi đè nhau.
7. Khi người dùng cung cấp IntakeResult mới, replan tăng `plan_version`, giữ kết quả
   thành công còn hạn của task không đổi và dependency không đổi; revoke approval.

## Approval and recovery

Approval endpoint dùng token backend riêng, khác token gọi API thông thường.
Approval gắn owner, workflow, task, plan version, registry, resolved arguments,
dependency result hashes và action idempotency key; tối đa 30 phút. LLM không được
cấp approval hoặc điền backend-owned arguments. Backend cần tạo approval record
thật của domain trước khi nối thực thi: approval trong Orchestrator không thay thế
bản ghi approval mà Moving đang yêu cầu.

Lưu execution lease trước side effect. Lease hết hạn: read được retry có giới hạn;
write chuyển `needs_reconciliation`. Không tự gọi lại write có kết quả không rõ.
Read thất bại retryable có exponential delay và giới hạn attempts; không chạy vòng
lặp nền vô hạn. Kết quả cần đúng output schema, timestamp và TTL trước khi dùng.

Không replan khi có task đang chạy hoặc write chưa xác định. Thay đổi một write đã
thành công trả `COMPENSATION_REQUIRED`; không giả định provider có rollback.
`cancel` dừng workflow chưa có external write thành công; không phải hủy đơn AhaMove.
Reconciliation/compensation thực tế cần adapter và workflow riêng ở giai đoạn tích hợp.

## Non-goals

- Chưa nối UI, Chat API, Intake, MCP server hoặc payment backend.
- Không tạo MCP server cho chính Routing; nó là bên tiêu thụ domain tools.
- Không dùng mock provider/LLM; không nhận kết quả giả từ endpoint callback công khai.
- Chưa triển khai distributed scheduler, nhiều replica ghi chung file SQLite,
  provider fallback hoặc tự động thực thi compensation.

## Interfaces and limits

Xem [API contract](../api/agent-services.md). Mọi workflow route cần bearer token
và `X-Owner-ID` do trusted backend xác thực. Không expose token này cho frontend.
<=32 tasks/plan, <=4 parallel reads mặc định, <=3 attempts/task, <=10 plan versions.
SQLite WAL + optimistic concurrency; một host, volume bền vững. Plan/LLM timeout,
tool timeout và request size đều có giới hạn. Registry snapshot chỉ chứa metadata
thật được export từ Moving; không có URL/secret trong input LLM. Domain chưa có
trong registry phải báo unsupported; không bịa tên tool từ sơ đồ.

## Acceptance criteria

- `SPEC-003/AC-01`: Plan chỉ dùng tool đã đăng ký; input/reference/DAG sai bị từ chối.
- `SPEC-003/AC-02`: Quyền ghi lấy từ registry và phải tương ứng với intent người dùng.
- `SPEC-003/AC-03`: Task phụ thuộc chỉ sẵn sàng sau kết quả hợp lệ, còn hạn của dependency.
- `SPEC-003/AC-04`: Không chạy write trước approval khớp; general API token không cấp approval.
- `SPEC-003/AC-05`: Checkpoint tồn tại sau restart; concurrent update/request ID không nhân đôi tác vụ.
- `SPEC-003/AC-06`: Replan tăng version, revoke approval, giữ kết quả phù hợp và chặn thay đổi write đã commit.
- `SPEC-003/AC-07`: Write timeout/lease hết hạn cần reconciliation; không retry mù.
- `SPEC-003/AC-08`: Standalone không phát sinh provider call, result hoặc trạng thái completed giả.
- `SPEC-003/AC-09`: Image riêng non-root, DB volume riêng, health/readiness và API docs.
- `SPEC-003/AC-10`: Live LLM check là opt-in; test contract/policy/SQLite không dùng mock.

## Open questions

- Review/merge registry của QuangDung và Doan/api trước khi bật capability tương ứng.
- Thiết kế approval bridge, MCP adapter và đối soát write cùng Backend/Security
  trong milestone tích hợp; không bật domain writes chỉ vì plan đã hợp lệ.
