# Jev guardrails — đợt 1: quan sát, chưa chặn

> Historical rollout description. Follow-up #155 changes runtime to structured-only
> projection and records narrative assessment privacy skips, credential validation and
> coverage metrics. Read [current hardening notes](jev-hardening-2026-10-14.md) first.

Issue: #143. Nhánh: `feat/143-jev-guardrails`. Nền: `main` tại `faae3c6` (đã có relocation #139/#141).

## Đã triển khai

Không bỏ Intake, Planner hay domain LLM. Không đổi API contract, database, checkout, quyền chủ nhà/Admin, consent Roommate hay các gate giao dịch.

Luồng mới:

```text
Intake → Planner LLM → validate_plan bằng code → Executor/DAG → kết quả
                              │
                              └→ Jev shadow chạy nền: constraint + scope

Housing/Flight LLM → kết quả có agent_assessment → Validator hiện tại
                              │
                              └→ Jev shadow chạy nền: grounding + injection
```

Jev trả lựa chọn có kiểu và phân bố xác suất; không sinh lời trả lời, không gọi tool, không cấp quyền.
**Shadow không sửa/chặn/duyệt kết quả**. Model phát hiện lỗi lúc này chỉ ghi tín hiệu để đánh giá.
Không được gọi rollout này là bảo vệ production hoàn chỉnh.

| Điểm | Hành vi trong đợt này |
| --- | --- |
| Plan LLM hợp lệ qua `validate_plan` | Tối đa một check/turn, hai câu hỏi trong một HTTP request |
| Assessment Housing/Flight đã có provider facts | Tối đa một check được lấy mẫu/turn, hai câu hỏi trong một request |
| Housing và Flight cùng có assessment | Chỉ lấy assessment đến trước; không đảm bảo kiểm mọi domain |
| Map, filter, xem/chọn nhà, UI so sánh, form Moving báo giá | Không thêm Jev vào các endpoint này; kết quả không dùng LLM không submit |
| Moving/Payment/Roommate domain assessment | Chưa có projection đã kiểm duyệt, chưa kiểm Jev |
| Nhà/Roommate public draft, xuất bản, ảnh | Chưa nối Jev moderation; giữ nguyên gate hiện có |
| Checkout, consent, approve, đặt/hủy đơn | Giữ gate code, không cho Jev thay thế hay mở khóa |

Check injection ở đợt này là **sau khi domain đã đọc tool**, không ngăn được injection trước khi LLM tiêu thụ dữ liệu.
Gate trước tool-text ingestion cần một PR riêng sau đánh giá; không tự chèn thêm model call vào mỗi lượt tool.

## Latency, chi phí và giới hạn

- Hook submit không `await` Jev; kết quả người dùng không chờ HTTP guardrail.
- Tối đa 4 task nền đang chạy/process, không queue vô hạn, không retry provider.
- Một plan + một assessment/request trong cửa sổ 15 phút; replan/retry không nhân số check trong cửa sổ đó.
- Ledger tối đa 1.024 request, định danh bằng HMAC với salt riêng của process; khi đầy thì bỏ quan sát mới, không đuổi request cũ để gọi lại.
- Ledger không bền vững: restart hoặc qua cửa sổ 15 phút có thể quan sát lại. Đây không phải cơ chế idempotency giao dịch.
- Default timeout tổng 1,5 giây, cấu hình 0,1–5 giây; shared HTTP connection pool.
- Giới hạn state 16 KB, text 4.000 ký tự, collection 40 phần tử, 12 task/plan; vượt giới hạn thì skip, không cắt evidence rồi kết luận an toàn.
- Không cache kết luận giữa user/version/context. Chưa tối ưu cache trước khi kiểm định policy.
- Task nền chạy trong contextvars sạch, không thừa hưởng authenticated actor/tracing của request. Shutdown hủy/join task rồi đóng HTTP client.
- Guardrail usage ghi riêng trong audit, không gộp vào `AgentUsage` của task hay thay trần LLM hiện tại. Provider có thể tính phí request bị timeout; không chỉ dựa vào usage nhận được.
- Tất cả timeout/unavailable/overload chỉ là thiếu quan sát, **không phải allow**. Việc flow tiếp tục là chủ ý của shadow; không được sao chép hành vi này sang gate bắt buộc cho mutation.

## Dữ liệu và audit

Projection allowlist giữ lời user hiện tại, evidence của confirmed facts, soft preferences tách riêng, task/dependency và dữ kiện cần cho assessment.
Mục tiêu mới không dùng plan cũ làm quyền; follow-up giữ evidence của ràng buộc được mang tiếp.

Không gửi session memory toàn bộ, contacts/form hành khách, API tokens, private user/thread/transaction IDs, ảnh, geometry, GPS fields hay raw provider payload.
Provider detail map được gửi theo giá trị, bỏ ID key. Email/điện thoại/CCCD và các dạng secret/cookie/JWT/URL thông dụng được che trong text.
**Redaction không phải DLP hoàn chỉnh:** không nhận diện chắc chắn họ tên, địa chỉ riêng hoặc bí mật tùy ý người dùng gõ trong câu tự nhiên.
Tên khu vực/địa chỉ cần cho nhiệm vụ có thể còn trong projection; phải xem đây là gửi dữ liệu sang OpenRouter/TypeSafe và tuân thủ chính sách dữ liệu trước khi bật với người dùng thật.

Audit `jev_shadow` chỉ chứa policy/model/served snapshot, point, HMAC scope, thời gian, enum/xác suất/confidence, token/cost.
Không log state, prompt, response body, credential hoặc exception có dữ liệu gốc. Counter in-memory ghi completed/unavailable/overload/skip và token.
Runtime opt-in cấu hình logger nếu ứng dụng chưa có handler để audit không bị mất dưới Uvicorn; hệ thống thu stderr quyết định retention.

## API và cấu hình

Model pin: `typesafe/jev-1.13`, không dùng alias latest. Adapter riêng gọi:

```text
POST https://openrouter.ai/api/alpha/decisions
```

Không đổi model trên `AsyncOpenAI.responses`/Chat Completions để gọi Jev.
Client kiểm đúng tên câu hỏi, kiểu Choice, lựa chọn allowlist, probabilities/confidence hữu hạn, usage/cost, model snapshot và response-size limit; redirect bị từ chối.

Biến server-only đã có trong `.env.example` và backend Compose:

```dotenv
AGENT_GUARDRAIL_MODE=off
AGENT_GUARDRAIL_TIMEOUT_S=1.5
OPENROUTER_API_KEY=
```

Muốn thử trên nhánh này: đặt `AGENT_GUARDRAIL_MODE=shadow` trong env local riêng, khởi động lại backend từ code nhánh mới.
Dùng `OPENROUTER_API_KEY`, hoặc tương thích key `sk-or-v1-*` đang ở `OPENAI_API_KEY`.
**Key OpenAI thông thường tuyệt đối không gửi sang OpenRouter.** Thiếu key: warning `unconfigured`, không mở client.
Không expose các biến/key này sang browser. Chỉ nhận `off`/`shadow`, không có flag `enforce` giả hoạt động.

Rollback: `AGENT_GUARDRAIL_MODE=off` + restart backend. Không cần migration hay xóa dữ liệu.
Chưa đổi env/runtime của server local cũ hoặc staging trong task này.

## Kiểm chứng

Test offline mới: adapter contract, HTTP lỗi/redirect/timeout/no retry, reply limit, kiểu/xác suất/model malformed, privacy,
evidence/soft preferences, real Housing/Flight field shapes, bounds, budget/concurrency, ledger isolation,
contextvars/shutdown, schema gate trước submit, Jev unavailable không đổi plan, typed completion không gọi Jev.

Harness live chỉ gửi các ca tự tạo trong `eval/jev_guardrail_cases.py`, không dùng thread thật hay giao dịch:

```powershell
python scripts/eval-jev-guardrails.py --live --env-file .env.test --timeout 1.5
```

Cần cài package Python của monorepo theo `requirements-dev.txt`; credential file ignored, không đưa vào git/log/chat.
Kết quả smoke và giới hạn diễn giải nằm ở [báo cáo eval](../../eval/jev-guardrails-2026-10-13.md).

## Bước tiếp theo trước enforce

1. Gán nhãn tập tiếng Việt lớn hơn, tách calibration/holdout; thêm nhiều lượt, sửa ý, tên trùng, provider injection và nội dung public Housing/Roommate.
2. Chốt ngưỡng theo false positive/false negative và mức rủi ro; không lấy confidence cao làm bảo đảm đúng.
3. Khi cần enforce plan: tín hiệu nghi vấn dẫn tới repair có budget hoặc hỏi lại, không tự thay ngân sách/địa điểm.
4. Public text moderation phải tích hợp draft → pending review → publish bằng revision/hash và quyền moderator; Jev không tự xác minh người thật/lừa đảo hay duyệt ảnh.
5. Sensitive agent-proposed mutation phải fail closed khi check bắt buộc unavailable; vẫn kiểm owner/approval/version/hash/TTL/idempotency bằng code.
6. Chọn check trước tool ingestion có batching và cache gắn content+policy+model+context, đo lại p95/coverage, review rồi bật từng điểm trên staging.

Thiết kế theo OpenAI Docs: đặt guardrail ở ranh giới phù hợp và giữ approval cho hành động nhạy cảm, không thay toàn bộ agent bằng rulebase.
Nguồn chính: [OpenAI guardrails/approvals](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals),
[OpenRouter Jev Decisions API](https://openrouter.ai/blog/insights/what-is-jev/),
[TypeSafe confidence](https://docs.typesafe.ai/confidence).
