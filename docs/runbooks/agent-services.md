# Chạy Intake và Routing Orchestrator riêng

Hai service mới nằm trong `apps/intake-api/` and `apps/orchestrator-api/`; chưa nối `/chat` của app cũ.
Không có Executor agent riêng. Orchestrator tự quản lý planning/scheduling/tool-call
policy. Bản này chưa có MCP adapter kết nối domain, nên không tạo đơn hay lấy giá thật.

## 1. Cấu hình

Chạy từ thư mục gốc repository. Trong `.env.local` gốc, điền:

```dotenv
OPENAI_API_KEY=
INTAKE_API_TOKEN=
ORCHESTRATOR_API_TOKEN=
ORCHESTRATOR_APPROVAL_TOKEN=
INTAKE_MODEL=gpt-4o-mini
ORCHESTRATOR_MODEL=gpt-4o-mini
```

OPENAI_API_KEY là key LLM, không phải key AhaMove. Mỗi service token tạo riêng bằng:

```powershell
.venv/Scripts/python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
```

Token approval chỉ dành cho backend xác nhận và phải khác token Orchestrator.
Có thể để trống để tắt endpoint approval. Không đưa key vào ảnh, issue hoặc commit.

Intake không cần DB. Orchestrator tự tạo file SQLite để giữ workflow/checkpoint sau
restart; không cần cài PostgreSQL. Docker dùng volume `orchestrator-state`.

## 2. Chạy Docker

```powershell
docker compose --env-file .env.local -f compose.agents.yaml up -d --build
docker compose --env-file .env.local -f compose.agents.yaml ps
```

- Intake: `http://localhost:8011/docs`
- Routing Orchestrator: `http://localhost:8012/docs`
- `/health`: process sống; `/ready`: cấu hình/storage, không tự gọi provider.

Hai container khởi động độc lập, không `depends_on` nhau, không nhận key AhaMove.
Port chỉ bind loopback. Không đổi sang public bind nếu chưa có authenticated gateway.
Không chạy nhiều host/replica chia sẻ SQLite qua network filesystem.

## 3. Chạy Python thay Docker

```powershell
.venv/Scripts/python.exe -m pip install -r requirements-agents.txt
.venv/Scripts/python.exe -m uvicorn relohome_intake.app:app --port 8011 --no-access-log
```

Mở terminal khác:

```powershell
.venv/Scripts/python.exe -m uvicorn relohome_orchestrator.app:app --port 8012 --no-access-log
```

Trong Swagger, bấm Authorize và nhập service token tương ứng. Schema hiện trực tiếp
từ Pydantic. Với Intake, tạo request_id UUID mới, session_id riêng, message thật;
để history/context trống nếu chưa có. Ví dụ câu yêu cầu: “Liệt kê các khu vực
AhaMove đang phục vụ tại Việt Nam. Tôi chỉ muốn xem thông tin.” Đây là input người
dùng, không phải dữ liệu provider.

Để thử Routing riêng, dùng IntakeResult thật đã nhận làm trường `intake` của
`POST /v1/workflows`, đặt `owner_id` và header `X-Owner-ID` giống nhau. Việc chuyển
payload thủ công chỉ để kiểm thử API; hai service không tự nối nhau. Nếu bạn chưa
có key, `/v1/capabilities` và `/v1/plans/validate` vẫn cho kiểm schema/policy thật.
Chúng không chứng minh LLM hiểu đúng hay MCP đã chạy.

`advance` hiện trả task `blocked_integration`, `result: null`. Đây là trạng thái
đúng khi chưa nối MCP; không được đổi thành success chỉ để demo. Write task trước
hết sẽ là `waiting_approval`. `cancel` chỉ dừng workflow, không gọi hủy đơn AhaMove.

## 4. Kiểm thử không mock

```powershell
New-Item -ItemType Directory -Path test-results -Force | Out-Null
$agentTestDir = Join-Path (Get-Location) ('test-results/agents-' + [guid]::NewGuid().ToString('N'))
.venv/Scripts/python.exe -m pytest tests/test_agent_services -q --basetemp=$agentTestDir
```

Các test kiểm schema, DAG, auth, approval, CAS và SQLite thật. Input câu hỏi, plan
và trạng thái là đầu vào kiểm chính sách; không có mock LLM/MCP, không dựng listing,
quote, đơn hàng hoặc response provider giả. Test có trong template cũ nằm ngoài
thay đổi này; các test mới không dùng fixture mock của template.

Khi đã điền key, bật bộ live check (bốn case, thông thường năm LLM calls;
Intake có thể trích lại evidence đúng một lần khi cần, có tính phí theo tài khoản):

```powershell
$env:LIFEFLOW_LIVE_LLM='1'
.venv/Scripts/python.exe -m pytest tests/test_agent_services/test_live_llm.py -q
Remove-Item Env:LIFEFLOW_LIVE_LLM
```

Trên Windows nếu thư mục temp mặc định bị khóa, thêm `--basetemp=$agentTestDir`
với đường dẫn mới như phần test ở trên. Có thể dùng `-k real_intake_and_planner`
để chỉ chạy case chính gồm hai LLM calls. Test gọi LLM thật cho Intake và Planner,
kiểm input mơ hồ/đa domain/ngoài phạm vi và persistence thật; không gọi MCP hay provider vận chuyển.
Nếu chưa bật opt-in, test ghi **skipped**, không ghi pass giả.

Kiểm container thực:

```powershell
docker buildx build --load -f Dockerfile.agents --target intake -t lifeflow-intake:local .
docker buildx build --load -f Dockerfile.agents --target orchestrator -t lifeflow-orchestrator:local .
.venv/Scripts/python.exe scripts/smoke-agent-containers.py
```

Script tạo container test với token ngẫu nhiên, không xuất cổng host và dùng DB tmpfs,
kiểm HTTP/readiness/configuration rồi gỡ đúng container test. Không đụng volume thật.

## 5. Cập nhật registry

```powershell
npm run build --workspace=@relohome/contracts
node scripts/export-agent-registry.mjs
node scripts/export-agent-registry.mjs --check
```

Đây là export metadata/schema, không khởi động MCP và không gọi AhaMove. File JSON
được sinh từ contract thật, không sửa tay. Thay registry khiến workflow cũ bị chặn
`REGISTRY_CHANGED`; cần review/migration, không tự chạy plan với contract mới.

## Bàn giao tích hợp sau này

Review contract với owner của Intake/Routing/backend/domain; nối Chat API và
context/session resolver, thêm MCP adapter nội bộ, nối approval record của Moving,
đối soát write và kiểm domain thật trên staging. Chưa đánh dấu full end-to-end
hoàn thành trước các bước này. Trạng thái implementation theo issue; spec vẫn Draft
cho đến review team. Hiện thao tác nhận issue đang chờ GitHub authentication.
