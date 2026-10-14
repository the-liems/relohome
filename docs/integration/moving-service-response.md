# Phản hồi Moving service và Orchestrator — bàn giao cho Đoàn

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


- Người bàn giao: Khoa — cập nhật 29/09/2026.
- Phạm vi được chốt: **chỉ sửa Moving trên `khoa`; ghi việc graph cần sửa, không
  sửa graph, không merge nhánh tích hợp và không xóa Intake/Orchestrator cũ**.
- Bản đối chiếu: `integration/langgraph-services` tại `f0f8413`, code tích hợp
  ở `83aa047`. Thay đổi bàn giao nằm trong commit chứa file này trên nhánh
  `khoa`, dựa trên `5d6f6b0`; chưa được triển khai lên staging.
- Yêu cầu nguồn: file `moving-and-orchestrator-requests.md` Đoàn gửi Khoa
  (bản nhận riêng, không kèm trong commit bàn giao).
- Housing: Khoa xác nhận QuangDung đã xử lý dữ liệu. Không còn coi thiếu dữ liệu
  housing là blocker trong phản hồi này; chưa chạy lại luồng housing liên service.
- Có thể dùng key LLM thật để test. Không bổ sung mock LLM/provider/dữ liệu nhà.
  Có key không đồng nghĩa class Intake/Planner đã được nối vào graph.

## 1. Kết quả phía Moving

- [x] Endpoint `POST /v1/internal/moving/approvals` trên Moving API port 4200.
- [x] Token riêng, validate schema/action/expiry tối đa 30 phút, từ chối token sai.
- [x] Cùng approval ID + dữ liệu giống nhau: idempotent; khác payload/owner/expiry:
  409. Gửi lại không hồi sinh approval đã consumed.
- [x] Tách quyền MCP trên **server**: token đọc thấy 9 tool; token ghi thấy 13 tool.
  Không thể vượt quyền bằng cách bỏ allowlist của client.
- [x] Compose cơ sở giữ read-only; thêm overlay bật ghi staging có chủ đích.
- [x] Trùng `(workflow_id, action_id)` với khóa/quote khác bị chặn có kiểm soát,
  không rơi vào lỗi unique SQL thô.
- [x] Đối soát tạo đơn không tự chọn đơn đầu tiên khi tracking trả nhiều đơn.
- [x] Không thêm giới hạn cùng thành phố; không thêm tự tăng giá 5%/20.000đ.
- [x] Cập nhật spec, contract approval, runbook, cấu hình và kiểm tra CI tương ứng.
- [x] Kiểm thử thật các thay đổi như mục 6; không tạo/hủy đơn provider.

## 2. Contract và cấu hình để graph nối vào

Chi tiết: [API approval](../api/moving-internal-approvals.md),
[runbook](../runbooks/moving-containers.md),
[Coolify handoff](../runbooks/moving-coolify.md).

| Biến ở graph/backend | Giá trị / quyền |
|---|---|
| `MOVING_MCP_URL` | `http://moving-mcp:4400/mcp` khi cùng Docker network |
| `MOVING_MCP_AUTH_TOKEN` | Token đọc, khớp Moving MCP, ít nhất 32 ký tự |
| `MOVING_MCP_WRITE_TOKEN` | Token khác, chỉ cấp cho transaction và Moving MCP |
| `MOVING_APPROVAL_URL` | `http://moving-api:4200/v1/internal/moving/approvals` |
| `MOVING_APPROVAL_TOKEN` | Token khác nữa, chỉ backend tin cậy và Moving API có |
| `MOVING_QUOTE_CONTACT_NAME/MOBILE` | Liên hệ thật được phép dùng của hệ thống, không điền người/SĐT giả |

Ba token là secret nội bộ do đội tự sinh, **không phải** API key AhaMove. Không
gửi chúng trong prompt, tool arguments hoặc frontend. Sinh độc lập 32+ ký tự và
cấp qua secret storage. `.env.example` chỉ là danh sách biến, không chứa key thật.

Request approval tương thích §2.1 tài liệu nguồn; response 200 `{approval_id}`.
Moving tự hash payload. Schema còn hỗ trợ `rate` theo tool sẵn có nhưng rating
vẫn tắt. Backend chịu trách nhiệm xác thực user và bằng chứng xác nhận; sở hữu
token approval không thay cho quy trình consent. Không có MCP tool tự approve.

MCP token ghi không tự bật AhaMove writes. Operator chỉ dùng
`compose.moving.staging-write.yaml` sau khi luồng xác nhận/đối soát đã đạt; mặc
định `AHAMOVE_WRITE_ENABLED=false`, production/rating vẫn tắt. Không public
endpoint approval cùng đường webhook; ingress chỉ cho callback đi qua.

## 3. Trả lời M1–M12

| Mục | Kết luận | Chi tiết / việc còn lại |
|---|---|---|
| M1 | Đã làm | Endpoint nội bộ, schema chuẩn Zod, 401/400/409/422/503; test DB thật đã đạt. Graph cấp URL/token rồi gọi bridge hiện có. |
| M2 | Đồng ý có điều kiện | Đã thêm overlay staging ghi; chưa bật trên môi trường thật. Không bật mặc định hay bật production. |
| M3 | Chọn (a) | Giữ liên hệ hệ thống thật để estimate; đặt thì estimate lại với liên hệ user thật. Không tự điền contact giả, không hứa đổi contact giữ nguyên giá. |
| M4 | Không duyệt ngưỡng tự tăng | Giữ xác nhận theo giá cụ thể. Giá đổi phải xác nhận lại; không coi chữ “đã chốt” trong tài liệu nguồn là sự đồng ý của Khoa. Chưa có đo đạc đủ để kết luận mức lệch giá staging. |
| M5 | Không duyệt giới hạn cùng thành phố | Tỉnh/thành gần nhau vẫn có thể được provider phục vụ. Dùng tọa độ pickup để discovery, estimate đầy đủ route để xác định khả dụng; không hứa mọi tuyến liên tỉnh đều chạy được. `city_id` không thay thế kiểm tra route. |
| M6 | Đồng ý chọn xe đúng nhu cầu | Service ID/requests phải discovery thật theo pickup và detail, không hardcode ba ID đầu. Graph/subagent chọn theo khối lượng/tải trọng và nhu cầu bốc xếp; `movers` chưa biết giữ null. Chưa chốt tuyến demo nên chưa bàn giao ID cố định. |
| M7 | Đồng ý | Graph sinh tracking vô danh ổn định và đặt vào destination **trước estimate dùng để create**. Moving đã giữ pending khi đối soát nhiều kết quả. Định dạng ≤30 ký tự đề xuất chưa được xác nhận bằng create thật; không tuyên bố provider đã chấp nhận. |
| M8 | Đồng ý | TTL mặc định 300 giây; graph dùng `quote.expires_at`, không 24 giờ. Đặt luôn estimate lại, giữ toàn bộ special requests đã chọn. |
| M9 | Đã làm | Token đọc/ghi riêng và kiểm quyền ngay tại MCP server; không chỉ dựa allowlist client. |
| M10 | Không bịa phí | Chưa có contract/provider evidence cho cancellation quote. Không thêm tool giả, không báo 0 khi chưa biết phí; graph phải thể hiện unknown và không tự hủy bù như miễn phí. |
| M11 | Sửa cách hiểu | Allowed hosts là Host của **server đích**, không phải tên container gọi. `moving-mcp` đã có; infra nối chung network, thêm alias đích nếu URL thật dùng alias khác. |
| M12 | Giữ contract lỗi | MCP trả JSON `{code,message,retryable}`. Graph đọc trường có cấu trúc; không đoán retryable từ message. Thêm `APPROVAL_CONFLICT` ở API. |

## 4. Trả lời A1–A8, O1–O4, X1–X4

Subagent Moving riêng là mục **làm sau** theo §3 yêu cầu nguồn, không nằm trong
đợt sửa Moving API/MCP này. Chưa có `get_manifest/run_task` mới và chưa tuyên bố
subagent riêng đạt conformance. Tạm dùng subagent nền sau khi sửa lỗi graph.

| Mục | Kết luận |
|---|---|
| A1 | Hoãn quyết định LocalAgent/RemoteAgent sang task subagent; không tự chuyển kiến trúc trong đợt này. |
| A2 | Đồng ý subagent chỉ đọc; server đã chặn bằng credential thật. |
| A3 | Cần task riêng: chọn/rank xe, requests, route theo contract; không nằm trong endpoint approval. |
| A4 | Đồng ý status/link không lộ tên/SĐT path; graph phải lọc dữ liệu trước state/LLM. |
| A5 | Đồng ý dùng Location qua contract, không truy cập DB service khác. |
| A6 | Thiếu/mơ hồ địa chỉ, ngày quá hạn thì hỏi lại; **loại bỏ điều kiện khác thành phố**. |
| A7 | Đồng ý ngân sách tổng, gồm cả geocode và fallback; không reset budget khi đổi agent. |
| A8 | Chưa thực hiện conformance cho subagent mới vì chưa có subagent mới. |
| O1 | Chưa xác nhận tương đương đầy đủ ADR-003: graph vẫn có in-memory receipt/approval/locks, cần lưu bền và kiểm thử restart/concurrency/đối soát trước write deployment. |
| O2 | Hướng graph có lý; nhưng ADR ghi TemplatePlanner mặc định trong khi wiring ở commit đối chiếu dùng NotImplementedPlanner. SPEC-001/003 và wiring thuộc graph, không sửa trong đợt này. |
| O3 | Giữ nguyên code standalone, Docker, CI cũ. Không xóa tự động. |
| O4 | Gửi thay đổi Moving qua PR để Đoàn ghép; không sửa/force-push nhánh của Đoàn. Review xung đột `.env.example`, docs và CI khi merge. |
| X1 | Nhánh tích hợp đã ghi ADR-007 superseded bởi ADR-001, không cần làm lại. |
| X2 | Nhánh tích hợp đã cập nhật ADR-011 về quyền sở hữu AhaMove; rà tiếp SPEC-012 cho nhất quán. |
| X3 | Chỉ thêm schema Moving trong `moving.ts`, không sửa `common.ts` của Dũng. Consumer review phần thay đổi quyền tool discovery 9/13. |
| X4 | Không tự thêm geocoder AhaMove khi chưa có contract xác minh. Housing hoàn tất không tự chứng minh geocode địa chỉ có độ chính xác đủ; đội kiểm tra contract Location khi nối graph. |

## 5. Checklist Đoàn/backend cần hoàn thiện (không sửa trong đợt này)

- [ ] Nối token đọc, ghi, approval đúng vai trò. Không fallback sang read token
  nếu thiếu token ghi; báo chưa cấu hình giao dịch.
- [ ] Địa chỉ: không lấy kết quả đầu tiên mặc định; kiểm ambiguity/precision,
  dùng geocode địa chỉ thực và hỏi lại nếu chỉ có tọa độ phường/quận.
- [ ] Ngày/giờ: không biến ngày quá khứ thành đặt ngay; không tự coi 08:00 là giờ
  user đã đồng ý. Hỏi thời điểm còn thiếu và kiểm timezone Việt Nam.
- [ ] Chọn xe/requests theo đồ đạc; giữ requests, thời gian và route khi báo giá
  lại. Truyền tracking number ổn định trước estimate/create.
- [ ] Dùng hạn quote thật; giá đổi xin xác nhận lại; không thêm chặn khác thành phố.
- [ ] Parse `retryable` có cấu trúc; write timeout/kết quả chưa rõ vào đối soát,
  không blind retry. Đối soát được sau restart, không chỉ trong RAM.
- [ ] Không trả phí hủy 0 khi chưa biết; không tự cấp approval hủy bù mới bằng
  consent cũ nếu chưa bao gồm điều kiện hủy/phí. Trường hợp chưa rõ chuyển xử lý có người.
- [ ] Checkpoint, approval, PII refs, receipt và khóa/lease có lưu bền/kiểm soát
  đồng thời phù hợp deployment; một `asyncio.Lock` không bảo vệ nhiều process.
- [ ] Nối Intake/Planner thật trong wiring. Test LLM bằng key thật; không tạo mock
  để làm đẹp kết quả. Xử lý PII trước khi đưa chat vào LLM; bỏ khỏi output thôi chưa đủ.
- [ ] Bảo vệ user identity ở gateway/backend, không tin header tùy ý từ client.
- [ ] Chọn `AGENT_SUBAGENTS=live`, xác nhận nguồn dữ liệu thật, không dùng chế độ
  fake mặc định hoặc âm thầm fallback sang fake.
- [ ] Kiểm thử graph + Moving HTTP + Location và xác nhận người dùng end-to-end.
  Chỉ thực hiện create/cancel staging với kịch bản và consent cụ thể của operator.

## 6. Bằng chứng kiểm thử và giới hạn

Đã chạy ngày 29/09/2026, từ `Maps VN/LifeFlow`:

| Kiểm tra | Kết quả |
|---|---|
| `npm run build:moving` | Đạt, build TypeScript 5 workspace Moving/phụ thuộc |
| `npm run test:ci` | Đạt: 21 test contract; 13 test live được skip đúng cờ opt-in; hai package không có test riêng |
| `npm run test:moving:native` với PostgreSQL 18 tại máy | Đạt 9/9 test HTTP, quyền, approval, readiness; gọi catalog/service/detail AhaMove staging thật |
| Migration trên DB test riêng | Chạy hai lần thành công, runtime role riêng; kiểm readiness khi thiếu UPDATE và phục hồi quyền |
| Compose base, CI và staging-write overlay: `config --quiet` | Cả ba cấu hình hợp lệ; không bật container/write |

Bài security test tạo request kiểm tra/approval trong PostgreSQL cô lập, không
mock client/DB/provider, không tạo dữ liệu nhà hay giả báo giá AhaMove. Không gọi
provider create/update/cancel; kiểm DB không có order. DB test đã dừng, giữ trong
thư mục temp phục vụ kiểm tra, không đụng DB hiện có.

Docker Linux engine hiện không kết nối được trong phiên kiểm tra, nên **chưa
rebuild/chạy image mới**. Không coi kết quả native là bằng chứng container UAT.
Chưa test vòng webhook thật, tạo/hủy đơn, LLM graph hay luồng toàn hệ thống trong
đợt này. Không công bố các mục đó đã đạt.

## 7. MVP sau bước này

Phía Moving có giao diện approval và phân quyền để graph tích hợp. Housing đã có
theo xác nhận của Khoa và LLM có key thật là điều kiện thuận lợi, nhưng **không
chỉ ghép code + điền key là đã nghiệm thu MVP đặt đơn**. Cần hoàn thiện checklist
graph, chạy luồng thật và kiểm soát side effect. Có thể nghiệm thu tìm kiếm/báo
giá trước, bật giao dịch sau khi xác nhận/đối soát và UAT đạt.
