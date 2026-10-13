# Chạy MVP tích hợp trên máy — không deploy

## Local configuration and service mappings

Use root `.env.example` as the committed template and ignored `.env.local` as the
single source of actual local values. `npm run dev:init` initializes a fresh setup;
existing installations must copy their current credentials, not rotate passwords.

Source names identify values independently of the service's runtime variable names:

| Source value | Backend environment | Location environment |
| --- | --- | --- |
| `BACKEND_DATABASE_URL` | `DATABASE_URL` | — |
| `LOCATION_DATABASE_URL` | — | `DATABASE_URL` |
| `LOCATION_TOKEN` | `LOCATION_MCP_AUTH_TOKEN` | `MCP_AUTH_TOKEN` |

`config/local-environment.json` declares native-process mappings. Prefix groups pass
through settings already unique to a service; `variables` entries bind destination
names to source names. `scripts/service_environment.py` applies the table without
reading an env file or starting a service. Docker performs its mappings in Compose.
Application libraries retain their existing runtime names and read only process env.
Optional empty Location URLs leave the existing `POSTGRES_*` fallback available.

Normal npm dev commands automatically load root `.env.local` and apply the service
mapping using `local-integration.py`. It preserves OS settings such as PATH,
ProgramFiles and DOCKER_HOST, while replacing application variables according to the
selected service. Export canonical source names to override file values. A generic
parent `DATABASE_URL` or `MCP_AUTH_TOKEN` cannot bypass the service mapping.
For a different file, use the startup command explicitly:

```sh
python scripts/local-integration.py location --env-file /absolute/path/team.env
# Custom command: everything after -- belongs to the child, including its own flags.
node scripts/python.mjs scripts/local-integration.py platform --env-file /absolute/path/team.env --cwd "Maps VN/LifeFlow/platform-api" -- node dist/server.js
```

The built-service shortcuts retain staging-only safety overrides. Custom commands
(after `--`, including npm dev scripts) use the configured values without those
scenario overrides. Missing files fail before startup. Keep file values literal;
there is no variable expansion inside the Python loader. URLs are explicit settings;
update the matching client URL when changing a service port.

### Unit tests versus live tests

`npm run test:python` and `npm run test:ts` do not load development configuration.
Unit tests supply fake settings or temporary environment variables. Mapping unit
tests pass fake dictionaries and assert both collision cases without starting any
service. Tests of file selection use temporary fixture files, never your `.env.local`.

Live test code also reads only its injected environment. The dedicated command loads
the selected file and applies test/client mappings, with explicit opt-in:

```sh
# Export RELOHOME_LIVE_CHECKS=1 plus the specific suite's RUN_* opt-in flag first.
npm run test:live -- python
npm run test:live -- python --env-file /absolute/path/team.env tests/test_llm_agents/test_integrated_live.py -v
npm run test:live -- python tests/test_api/test_viewing_live.py -v
npm run test:live -- moving
```

`live-test` is an explicit test-harness scope that includes provider configuration
needed by opt-in integration tests; it is never used by unit-test commands. Services
normally run separately. Tests that launch isolated dependencies still require their
own opt-in flags. Do not add dotenv loading to a test module or a global conftest.

### Migration and containers

Transfer existing values from root `.env`, `data/integration.env`, the old service
`.env`, and (if used) `.runtime/moving-secrets.json`. Rename backend `DATABASE_URL`
to `BACKEND_DATABASE_URL`, Location's token to `LOCATION_TOKEN`, and optional Location
connection overrides to `LOCATION_DATABASE_URL` / `LOCATION_ADMIN_DATABASE_URL` /
`LOCATION_INGEST_DATABASE_URL`. Keep shared values once; remove generic `MCP_AUTH_TOKEN`
from the source file. Preserve running database credentials and use the connection
preflight (`local-integration.py check`) before starting services.

```sh
make mcp-up
make agents-up
docker compose --env-file .env.local -f "Maps VN/LifeFlow/infra/compose.yaml" up -d postgis
```

Compose maps source values to container variables. Production/Coolify mappings,
production start commands and image env-file exclusions remain unchanged. Windows
bulk-start scripts retain default-port readiness checks. The same source value can
be mapped into multiple services without modifying their variable names.

## Đã nối những gì?

React (Frontend/) → gateway session → FastAPI → LangGraph: Intake LLM → Planner LLM → các task theo domain.
Moving giữ vòng gọi tool bằng LLM; Housing/Map/Flight/Payment có domain LLM riêng,
nhận mục tiêu và tự chọn thao tác đọc có giới hạn theo
[ADR-021](../adr/ADR-021-mission-driven-domain-tools.md). Adapter giữ dữ kiện nguồn
và kiểm tra tham số. Planner có thể sửa kế hoạch;
code kiểm schema, quyền gọi tool, dependency, giới hạn gọi và xác nhận giao dịch.

Housing/Map đọc snapshot thật của nhóm; Flight tìm bằng SerpApi;
Moving gọi AhaMove staging; trang thanh toán gọi ZaloPay sandbox thật.
Không dùng kết quả giả khi provider lỗi. API thiếu cấu hình thì không hứa có chức năng đó.

Flight and Payment run as dedicated HTTP services. The agent uses `FLIGHT_MCP_URL`
and `PAYMENT_MCP_URL` and never launches a provider process. Configure provider
credentials on their services; `FLIGHT_MCP_AUTH_TOKEN` and `PAYMENT_MCP_AUTH_TOKEN` are shared
only with the corresponding client. Missing URLs leave those domains unconfigured.
The old `*_MCP_STDIO` flags no longer enable a transport.

## Tổ chức thư mục

| Nơi | Trách nhiệm |
| --- | --- |
| `src/agents/` | Intake, Planner, graph, domain subagents |
| `src/services/adapters/` | MCP clients, approval, giao dịch, lưu trạng thái |
| `src/api/` | API hội thoại, xác nhận và demo thanh toán |
| `Frontend/` | React/Vite, gateway và lưu tài khoản/hội thoại |
| `src/ui/` | Giao diện Streamlit cũ, giữ để tham khảo |
| `src/mcp_servers/` | Flight/Payment MCP Python |
| `Maps VN/LifeFlow/` | Workspace TypeScript Housing/Map/Moving đã có; không di chuyển phá import |
| `scripts/` | Khởi tạo, nhập snapshot, restore, chạy local |
| `config/local-*.compose.yaml` | PostGIS và OSRM local, không phải deploy |
| `docs/specs/`, `docs/adr/`, `docs/runbooks/`, `eval/` | Yêu cầu, quyết định, vận hành, bằng chứng |
| `data/` | Dữ liệu/key/runtime riêng, không commit |

Các tài liệu teammate gửi ở gốc `docs/` được giữ nguyên; đây là tài liệu tham khảo,
không tự ghi đè spec hoặc coi mọi đề xuất trong đó là quyết định đã duyệt.

## Máy đang có dữ liệu

Existing installations: migrate existing values into root `.env.local` before starting services.
Keep the current database names, users, ports and passwords; initialization does not rotate them.
Start existing containers with `docker start` when appropriate; do not initialize a replacement database.

Các lệnh Compose/restore bên dưới dành cho bộ snapshot local riêng khi chưa có database Location.

Không chạy lại import/restore/init nếu đã có `.env.local` và DB.
Chạy từ gốc repo, sau khi Docker Desktop sẵn sàng:

```powershell
docker compose --env-file .env.local -f config/local-integration.compose.yaml up -d
docker compose -f config/local-routing.compose.yaml up -d
```

Build UI một lần: từ gốc repo chạy `npm ci`, `npm run build:web`.

### Khởi động nhanh trên Windows

Sau khi đã có cấu hình, DB và build TypeScript/UI, chạy từ gốc repo:

```powershell
.\scripts\start-local-mvp.ps1
```

Script khởi động các container local **đã tồn tại**, kiểm tra schema bằng tài khoản
ứng dụng, rồi mở tám service ẩn với log riêng trong `data/local-mvp-logs/`.
Không restore, không tự migrate, không reset DB hay bật giao dịch sandbox.
Nếu service thoát hoặc chưa ready, script dừng và chỉ rõ đường dẫn log; không báo
thành công chỉ vì `Start-Process` đã chạy. Nếu thiếu container, dùng các lệnh
Compose phía trên sau khi kiểm tra cấu hình, không khởi tạo lại DB đang dùng.

Kiểm tra schema riêng, không gọi LLM:

```powershell
.venv/Scripts/python.exe scripts/local-integration.py check
```

Script tái sử dụng service đã chạy và ready, **không tự nạp code/cấu hình mới**.
Sau khi pull code, đổi DB hoặc `.env.local`, dừng đúng process cũ rồi chạy lại; không
mở process thứ hai cùng cổng. Có thể dùng các terminal riêng bên dưới để dễ dừng.
Lệnh `Start-Process` cũ vẫn dùng được nhưng không có redirect log/readiness nên
khó biết service nào thoát sớm.

| Service | Cổng | Kiểm tra |
| --- | --- | --- |
| Location | 4300 | `/readyz` |
| Platform/Housing | 4100 | `/health` và preflight schema |
| Moving MCP | 4400 | `/ready` |
| Moving API | 4200 | `/ready` |
| Flight MCP | 8765 | `/health` |
| Payment MCP | 8766 | `/health` |
| Graph API | 8000 | `/health` |
| Frontend gateway | 8503 | `/health` (`service=siu-web`) |

Readiness không bảo đảm mọi API ngoài hoạt động hoặc key LLM còn credit.

Nếu snapshot chưa có bảng Moving hoặc thiếu schema POI aliases của nhánh
QuangDung (migrations `011`–`012`), chạy migration hiện có từ gốc repo:

```powershell
.venv/Scripts/python.exe scripts/local-integration.py migrate
```

Lệnh bỏ qua migration đã áp dụng. Kiểm tra `http://127.0.0.1:4200/ready` và
`http://127.0.0.1:4400/ready` đều 200 sau khi các process chạy; `/health` 200
chưa chứng minh schema đã sẵn sàng. Đợt 04/10 phát hiện thiếu 5 bảng Moving và
khắc phục bằng `008_moving_service.sql` có sẵn, không cần sửa code provider.

Mở từng terminal riêng (Ctrl+C dừng đúng process):

```powershell
.venv/Scripts/python.exe scripts/local-integration.py location
.venv/Scripts/python.exe scripts/local-integration.py platform
.venv/Scripts/python.exe scripts/local-integration.py moving
.venv/Scripts/python.exe scripts/local-integration.py moving-api
.venv/Scripts/python.exe scripts/local-integration.py flight
.venv/Scripts/python.exe scripts/local-integration.py payment
.venv/Scripts/python.exe scripts/local-integration.py api
.venv/Scripts/python.exe scripts/local-integration.py ui
```

Mở <http://127.0.0.1:8503>, tạo tài khoản local để lưu hội thoại. Xem [hướng dẫn frontend](../../Frontend/README.md). Mặc định chỉ đọc, tìm kiếm, báo giá.
Muốn demo giao dịch sandbox: dừng `moving`, `moving-api`, `api`, rồi chạy lại từng
lệnh với `--sandbox-writes`. Cờ không tự đặt xe/thanh toán; vẫn phải xác nhận trên form.
Không mở hai process trùng cổng. Chỉ một worker FastAPI cho bộ lưu local này.

## Thiết lập trên máy mới

1. Python 3.11+, Node 24+, Docker; tạo `.venv`, cài `requirements.txt`.
2. Chạy `npm run dev:init` để tạo `.env.local` và sinh token/mật khẩu nội bộ.
   Script từ chối ghi đè cấu hình đã tồn tại; không in secret.
3. Điền key provider trong `.env.local`: OpenAI, AhaMove staging, SerpApi và ZaloPay sandbox.
   Liên hệ báo giá phải là liên hệ thật được phép sử dụng.
4. Nhập ZIP bằng PowerShell:

```powershell
./scripts/import-teammate-snapshot.ps1 -ArchivePath '<duong-dan-ZIP-cua-nhom>'
```

5. Tại gốc repo, chạy `npm ci`, `npm run build:ts`.
6. Khởi động PostGIS bằng lệnh Compose ở trên, rồi
   `python scripts/restore-local-snapshot.py`. DB đích phải chưa tồn tại.
   Script kiểm checksum, chờ restore xong, chạy `ANALYZE` rồi mới migrate. Không drop DB cũ.
   `pg_restore` không mang theo thống kê của planner PostgreSQL; thiếu bước này thì tìm
   nhà quanh một điểm (center + bán kính) chạm statement timeout 8 s và graph báo
   `Database query timed out`. DB đã restore bằng bản script cũ: chạy một lần
   `docker compose --env-file .env.local -f config/local-integration.compose.yaml exec -T postgis psql -U <POSTGRES_ADMIN_USER> -d <POSTGRES_DB> -c ANALYZE`.
7. Khởi động OSRM và các process như phần trên.

Nếu restore thất bại, không chạy migrations chồng lên restore chưa xong.
Chọn DB đích mới trong cấu hình và điều tra lỗi; giữ DB cũ để kiểm tra.
Không chạy `docker compose down -v` nếu còn dữ liệu cần giữ.

### Đổi sang snapshot mới, giữ DB cũ

Chỉ làm khi đã duyệt việc đổi dữ liệu. Giải nén ZIP vào thư mục **mới**, xác minh
checksum, rồi restore bằng tên DB **chưa tồn tại**:

```powershell
.venv/Scripts/python.exe scripts/restore-local-snapshot.py --snapshot data/quangdung-snapshot-20261005 --database lifeflow_quangdung_20261005
```

Đây là ví dụ lần restore 05/10; DB đó hiện đã tồn tại nên **không chạy lại**.
Script từ chối ghi đè, copy đúng dump đã xác minh vào container (không dùng nhầm
dump cũ đang mount), restore, `ANALYZE` và migrate/grant cho DB mới. Tham số
`--database` không tự sửa cấu hình đang chạy. Nếu thất bại, giữ DB dở để điều tra;
không tự xóa DB hay volume.

Sau khi kiểm số lượng/nguồn, sửa **chỉ** `POSTGRES_DB` trong
`.env.local`, rồi khởi động lại sáu service. Ngày 05/10 đã chuyển từ
`lifeflow_verified` sang `lifeflow_quangdung_20261005`; DB cũ vẫn còn.
Muốn quay lại: đặt `POSTGRES_DB=lifeflow_verified` rồi restart service.
Không đổi key/mật khẩu trong `.env.local` chỉ để đổi tên DB.

ZIP mới không mang lịch sử quote/order Moving của DB cũ. Đổi lại DB cũ có thể
đọc lịch sử đó; việc chuyển DB không tự sao chép lịch sử. Không coi checkpoint
hội thoại còn lưu là bằng chứng một đơn tồn tại trong DB mới. Bộ OSRM đang chạy
được giữ nguyên; restore PostgreSQL không tự thay các graph OSRM.

## Thử demo

- Housing: hỏi tìm nhà theo thành phố, ngân sách, tiêu chí; kết quả rỗng là hợp lệ.
  Ví dụ đã kiểm thử: “tìm phòng có 2 phòng ngủ ở quận 1 thành phố Hồ Chí Minh”.
  Bộ lọc số phòng ngủ/quận được truyền xuống truy vấn, không chỉ hiển thị trong câu trả lời.
- Map: hỏi địa điểm/đường đi; dữ liệu routing local có HCM, Hà Nội, Đà Nẵng,
  không đồng nghĩa AhaMove bị giới hạn chỉ trong một thành phố.
  Ví dụ đã kiểm thử: “Tính đường đi bộ từ Dinh Độc Lập Cafe đến Takashimaya tại Thành phố Hồ Chí Minh”.
- Flight: hỏi tuyến bay và ngày tương lai; chỉ tìm chuyến thật, chưa xuất vé.
- Moving: nhắn yêu cầu hoặc bấm "Chuyển đồ tới đây"; form Thông tin chuyển đồ mở cạnh bản đồ, điền sẵn
  căn đã chọn. Ghim điểm (chọn gợi ý/chạm bản đồ) khi địa chỉ chưa đủ rõ, rồi "Xác nhận và lấy báo giá".
  AhaMove staging từ chối thời gian đặt quá 7 ngày; agent hỏi lại kèm lý do. Xem phí/điều kiện trước khi đặt.
- Xóa hội thoại: thùng rác ở header/Lịch sử; "Xóa tất cả và làm mới SIU" xóa mọi hội thoại và bộ nhớ sở thích từ chat.
- Đặt/hủy/cập nhật liên hệ Moving phải qua phương án và form xác nhận;
  đổi địa chỉ hoặc COD không thuộc form sửa liên hệ, phải đánh giá lại giá/đơn.
- ZaloPay sandbox độc lập vẫn có API backend và trang Streamlit cũ; frontend React chưa có form demo riêng. UI mới đọc yêu cầu thanh toán từ workflow và kiểm tra kết quả từ provider.

### Thanh toán trong app (nhánh `payment-design`)

Chạy `api` với `--payment-demo` (thay cho `--sandbox-writes`) và đặt danh sách tài khoản tester (id trong bảng
`users` của `data/siu-web.sqlite3`, cách nhau dấu phẩy):

```bash
PAYMENT_TESTER_USER_IDS=<id1>,<id2> .venv/bin/python scripts/local-integration.py api --payment-demo
```

Cờ bật `APP_PAYMENT_DEMO_ENABLED`, đặt vé mô phỏng (`FLIGHT_SIMULATION_ENABLED`) và nút "Đã thanh toán (tester)".
Thu tiền qua ZaloPay sandbox; không tạo đơn AhaMove, chuyển đồ chỉ ghi "đã duyệt". Vé máy bay cần hồ sơ người đặt ở
Tài khoản → Hồ sơ (lưu mã hóa, khóa ở `data/siu-web-traveler.key` hoặc `SIU_TRAVELER_KEY`). Khi chọn xong phương án,
chat hiện nút "Thanh toán"; tab Thanh toán trong Kế hoạch có tổng tiền, lịch xem nhà, thỏa thuận và báo đã trả chủ
nhà. Thiết kế: [payment-design.md](../review/payment-design.md).

Không có `--payment-demo`: Moving vẫn CASH qua form xác nhận như trước; thanh toán ZaloPay là demo riêng, không nối
với đơn AhaMove hay vé máy bay.

## An toàn và phục hồi

- `AGENT_API_TOKEN` chỉ giữ ở gateway; `X-User-Id` do gateway suy ra từ session HttpOnly.
  Đây chưa phải đăng nhập nhiều người dùng production; không expose các cổng ra Internet.
- Form chứa PII được mã hóa tại chỗ, TTL 30 phút; không gửi token/provider payload vào LLM.
- Checkpoint, ownership, approval và dấu giao dịch tồn tại sau restart.
  Giữ cả DB runtime lẫn key mã hóa; không commit/đưa vào log.
- Khi tạo đơn timeout/kết quả không rõ: **không đặt lại**. Tra tracking number,
  xác định duy nhất order ID, kiểm tra trạng thái rồi xử lý đúng đơn đó.
  Chưa có màn hình operator tự động xử lý mọi giao dịch bất định.
- Nếu LLM/API lỗi mạng: UI báo lỗi, không thay bằng dữ liệu mock.
- Không chạy lại test giao dịch chỉ để kiểm tra code; mỗi lần có thể tạo đơn thật
  trong sandbox và cần được người vận hành đồng ý.

## Kiểm tra không gọi API trả phí

```powershell
.venv/Scripts/python.exe -m ruff check src tests
.venv/Scripts/python.exe -m compileall -q src
.venv/Scripts/python.exe -m pytest tests/test_llm_agents/test_runtime_storage.py -q
```

Test checkpoint LLM sẽ skip khi chưa bật opt-in. Trên Windows nếu thư mục temp cũ
bị khóa, chọn `--basetemp=data/test-run-<ma-moi>` chưa tồn tại.
Live tests ở `tests/test_llm_agents/` có cờ opt-in; không tạo mock test mới.
Workflow `MVP local validation` chỉ lint/build/SQLite, không triển khai hoặc tạo đơn.
Xem [bằng chứng và giới hạn](../../eval/mvp-local-2026-09-30.md).
Đo Housing/Flight, đa lượt và UI sau cập nhật 05/10:
[read latency](../../eval/read-latency-2026-10-05.md).
