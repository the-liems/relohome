# Kết nối backend cho luồng chủ nhà – người thuê trên Coolify

Hướng dẫn cho bản nâng cấp lịch xem, chat, đánh giá và xác nhận chuyển tiền.
Đối chiếu main `a65aca2` (đến PR #188, ngày 15/10/2026). Dùng cấu hình triển khai
hiện có trong [deploy/README.md](../../deploy/README.md) và
[compose.coolify.yaml](../../compose.coolify.yaml).
PR chỉ đưa code để review; người vận hành thực hiện rollout sau khi PR được
review, merge và CI main publish image. Chưa có xác nhận đã deploy bản này lên cloud.

## 1. Các kết nối phải đi cùng một release

| Nguồn → đích | Cấu hình trong Compose | Chức năng |
| --- | --- | --- |
| Browser → `web` | Domain HTTPS của `web`, target port **8503** | UI, cookie đăng nhập và `/web/api/*` |
| `web` → `backend` | `LIFEFLOW_API_BASE_URL=http://backend:8000/api/v1` | Kế hoạch, lịch xem, kết quả buổi xem và ledger báo chuyển tiền |
| `web` → `platform` | `SIU_PLATFORM_API_URL=http://platform:4100/v1` | Nhà/phòng/tin, kiểm duyệt, yêu cầu liên hệ, chat, đánh giá và quyết định nhận tiền |
| `backend` → `location` | `LOCATION_MCP_URL=http://location:3000/mcp` | AI/MCP Housing đọc nguồn tin công khai |
| `platform`, `location` → `postgis` | `POSTGRES_HOST=postgis`, `POSTGRES_PORT=5432`, cùng database và app role | Dữ liệu Housing và spatial query |

Các URL nội bộ trên đã được Compose khai báo; không đổi thành `localhost` trong
container hoặc cổng local 5544/4300. Browser chỉ gọi gateway cùng domain.
Platform/PostGIS/Agent/Location không cần domain public. Admin dùng
`https://<domain-web>/admin`; cổng **8504 chỉ là proxy để test local**.

`AGENT_API_TOKEN` phải cùng giá trị trên **web/backend/platform**.
`LOCATION_MCP_AUTH_TOKEN` ở backend phải trùng `MCP_AUTH_TOKEN` ở Location.
Gateway lấy ID người thao tác từ session; không nhập actor ID hoặc token vào
frontend. Cookie đăng nhập được lưu trong `web-data`, không phải PostGIS.

Giữ Web/gateway, Backend/Agent, Platform, Location và `location-migrate` cùng
Git SHA. Các image đã đóng gói shared packages; không deploy riêng frontend
trước backend/schema. Không thêm service hoặc Web replica cho thay đổi này.

## 2. Environment của Application Coolify

| Biến | Cần cấu hình |
| --- | --- |
| Web domain | Cấu hình domain HTTPS của service `web`; Coolify tự cấp `SERVICE_URL_WEB` làm public origin, không cần `APP_URL` |
| `AGENT_API_TOKEN` | Secret nội bộ chung cho web/backend/platform |
| `LOCATION_MCP_AUTH_TOKEN` | Secret nội bộ cho backend/location |
| `POSTGRES_DB`, `POSTGRES_APP_USER`, `POSTGRES_APP_PASSWORD` | Cùng database/app role ở Platform, Location và migration; giữ cấu hình database hiện có |
| `POSTGRES_ADMIN_USER`, `POSTGRES_ADMIN_PASSWORD` | Role admin cho PostGIS/seed/migration; không cấp role admin cho API |
| `POSTGRES_INGEST_USER`, `POSTGRES_INGEST_PASSWORD` | Role được migration runner thiết lập |
| `VIETMAP_API_KEY` | Chỉ truyền vào Platform; quyền Autocomplete v4 và Place v4 |
| `HOUSING_MODERATOR_IDS` | Các **account ID của cloud đích**, phân cách bằng dấu phẩy; giữ ID Admin cũ |
| `LANGFUSE_BASE_URL` | URL HTTPS của Langfuse tự host; Compose main hiện yêu cầu biến này dù tracing chưa bật |
| `LANGFUSE_TRACING_ENABLED` | Mặc định `false`; bật theo runbook observability khi đã cấu hình project keys và kết nối |
| `APP_ENV=staging`, `HOUSING_VIEWING_TEST_VISIT_ANYTIME=true` | Tùy chọn test lịch ngay; cờ chỉ truyền vào backend, không bỏ đặt lịch/xác nhận của chủ nhà |

Cờ bỏ chờ giờ mặc định `false`; tắt khi hết test. `APP_ENV=production` không
cho phép bypass thời gian dù cờ là `true`. Đây là báo cáo chuyển tiền thủ công và
xác nhận của chủ nhà, không phải tích hợp ngân hàng hay xác minh giao dịch.
Không cần bật Agent provider writes, Jev, Roommate hoặc payment tester để test Housing.

Toàn bộ stack còn cần secrets MCP/Moving/Flight/Payment, OpenAI và dữ liệu S3
như bảng **required variables** trong deploy runbook. Provisioner/routing/seed
phải chạy được để dependency chain sẵn sàng, kể cả khi chỉ test Housing.
Giữ secret trên Environment Variables của Application, không ghi vào Git,
Dockerfile, `VITE_*`, issue hoặc PR. Save rồi redeploy/recreate để nhận env mới;
restart container cũ không áp dụng env mới.

Main đã chuyển sang MCP SDK 2 và `langchain[mcp]`; dùng dependencies/image của
cùng release, không cài lại `langchain-mcp-adapters` hoặc MCP SDK 1 để khắc phục
lỗi kết nối. Cấu hình bearer token/URL MCP vẫn như bảng kết nối trên.

Telemetry hiện dùng launcher chính thức `opentelemetry-instrument` cho Python
và `--import @relohome/telemetry/register` cho Node. Giữ entrypoint/image của
main; không thêm middleware hoặc package `relohome_observability` cũ.
`OBSERVABILITY_ENABLED=false` không còn là công tắc tắt telemetry. Đối chiếu
`OTEL_EXPORTER_OTLP_ENDPOINT` với Collector mà Application truy cập được;
các biến OTEL/log exporter và Langfuse keys do người vận hành cấu hình theo
[runbook observability](observability.md). Housing không cần tự thêm Collector
hoặc dịch vụ observability vào Compose của Application.

## 3. Dữ liệu bền vững, backup và migration

| Volume | Nội dung cần giữ |
| --- | --- |
| `web-data:/app/data` | `siu-web.sqlite3` (accounts/session/ownership), `siu-web-traveler.key` hoặc secret `SIU_TRAVELER_KEY`, `housing-media` |
| `agent-data:/app/data` | `agent-runtime` (runtime/ledger, checkpoints và khóa PII) |
| `location-data:/var/lib/postgresql/data` | PostGIS: nhà/phòng/tin, quyền quản lý, lịch hẹn/contact, chat, review, payment reports, activity events |

Giữ cả các volume khác đang dùng. Web vẫn **một worker/replica** theo cấu hình
SQLite hiện tại. Không xóa volume, reset/reimport DB hoặc sao chép credentials
local vào cloud để xử lý lỗi. Theo [Housing cloud runbook](housing-cloud.md),
chụp bộ backup PostGIS + SQLite qua backup API + ảnh + keys; dừng ghi trong lúc
chụp bộ nhất quán, lưu bản sao ở storage private ngoài host và kiểm restore.

PR #168 đổi sang **Coolify Application** và Git-pinned deploy. Application mới
có volume mới; snapshot Location không tự mang accounts/Agent/media của Service
cũ sang. Nếu đang cutover từ Service cũ, đối chiếu resource/volume thật và chuyển
bộ state tương ứng theo kế hoạch migration riêng trước khi bàn giao. Không lấy
UUID Service staging cũ trong issue #140/#159 làm UUID Application hiện tại.

Startup: provisioner + PostGIS healthy → `location-seed` → `location-migrate`
→ Platform/Location → Backend/Web (cùng các dependency MCP hiện có).
Seed chỉ restore khi chưa có `public.lifeflow_schema_migrations`; database đã
khởi tạo được giữ lại và chạy migration. Kiểm history trước rollout; không xóa
history để ép seed lại.

Migration image của release tự chạy toàn bộ migrations theo thứ tự, dưới admin
role, có checksum/advisory lock và grants app role. Các migration thêm ở PR này:

- `024_housing_contact_handoff.sql`: báo cáo tiền, đề xuất giờ, archive yêu cầu.
- `025_housing_location_privacy_documents.sql`: giữ nguyên migration đã áp dụng
  trong bản test local. Storage/seed của thử nghiệm vị trí riêng tư hiện không
  được UI/API sử dụng; hiển thị địa chỉ/bản đồ đã trở về hành vi main. Không DROP
  hoặc sửa checksum migration cũ.
- `026_housing_activity_notifications.sql`: sự kiện lịch/tiền/kiểm duyệt và read
  state, trigger ghi cùng transaction; seed công việc đang mở một lần.

`location-migrate` phải exit **0** trước API. Platform `/health` trả **503
`migration_required`** nếu thiếu schema payment/activity. Không đánh dấu healthy
thủ công; kiểm đúng image SHA, database, log migration/grants/checksum.
Nếu rollback, dùng workflow và SHA main tương thích theo deploy runbook;
schema forward-only, rollback image không đảo payment hoặc khôi phục volume.

## 4. Cấp Admin ở đúng cloud

Trong terminal tương tác của **web** đang dùng volume account cloud đích:

```bash
python -m relohome_gateway.admin_provision --help
python -m relohome_gateway.admin_provision --email admin@gmail.com --name 'ReloHome Admin'
```

Nhập password 12–200 ký tự qua prompt kín. Nếu account đã có, dùng lệnh dưới
để lấy ID và giữ password/data hiện tại:

```bash
python -m relohome_gateway.admin_provision --email admin@gmail.com --existing
```

Tool không tự cấp role. Append ID trả về vào `HOUSING_MODERATOR_IDS`, giữ ID
cũ, Save và redeploy Application. Không dùng email làm ID. Login tại `/admin`,
bàn giao password qua kênh riêng. Tham khảo [issue #140](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/140)
và [issue #159 (Vietmap)](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/159),
nhưng đối chiếu Application mới theo PR #168 trước thao tác.

## 5. Kiểm kết nối và nghiệm thu

Từ terminal **web**, kiểm health nội bộ mà không in token hoặc toàn bộ env:

```bash
python - <<'PY'
from urllib.request import urlopen
for url in ('http://127.0.0.1:8503/health', 'http://backend:8000/health',
            'http://platform:4100/health', 'http://location:3000/healthz',
            'http://location:3000/readyz'):
    with urlopen(url, timeout=10) as response:
        print(url, response.status)
PY
```

Sau deploy: ghi Git SHA và blob pins; log `location-migrate` thành công,
Application `running:healthy`, các endpoint trên HTTP 200.
Không dùng `/health` public của Web để kết luận lỗi backend: Compose chặn route này.
Health chưa chứng minh quyền hay luồng nghiệp vụ; cần test đăng nhập thật.

Chạy [kịch bản test](../review/housing-local-test-scenario.md), thay URL local
bằng domain cloud cho cả ba role. Dùng ba profile trình duyệt tách biệt,
hai account tenant/landlord khác nhau và Admin khác chủ nhà:

1. Nhà mới và hai phòng TEST-A/TEST-B; hồ sơ chỉ nhập lần đầu. Admin duyệt hồ
   sơ/địa điểm/tin. Tin nháp/chờ duyệt chưa lên Search/Map/AI Housing.
2. Tenant đặt lịch. Landlord thấy số yêu cầu trên đúng Nhà/Phòng; chuông chỉ có
   chat theo người dùng. Cập nhật giờ hẹn nằm trong chat và mở đúng yêu cầu.
3. Landlord đề xuất giờ khác trong 7 ngày; tenant chỉ chọn được giờ đề xuất còn
   khả dụng. Chưa được landlord xác nhận thì không ghi kết quả, kể cả bật test.
4. “Đã gặp, không đồng ý” → đánh giá bắt buộc → tự bỏ chọn/hủy lịch; phòng còn
   trống. “Đã gặp, đồng ý” → đánh giá → chốt thuê/cọc → báo chuyển tiền.
5. Landlord từ chối báo cáo tiền có lý do hoặc xác nhận đã nhận tiền. Xác nhận
   làm yêu cầu hoàn tất và tin đã thuê rời Search/Map/MCP. Lịch sử vẫn còn.
6. Customer/Landlord không tự duyệt; account khác không sửa tin/chat/đọc lịch
   người khác; Admin không tự duyệt hồ sơ/tin mình quản lý.
7. Redeploy cùng release: accounts, ảnh, chat, lịch, báo cáo và read state còn
   nguyên. Ghi kết quả từng bước; không đóng issue chỉ vì deploy healthy.

Nếu bị lỗi: 401 upstream → kiểm cặp token/service; 403 → session/role/manager
đúng chưa; 503 migration → image/schema/grants; mất dữ liệu sau redeploy → đối
chiếu mount/volume/resource trước khi ghi tiếp. Không gửi token/cookie/keys hoặc
dump DB lên issue. Checklist bàn giao cần ghi SHA, thời điểm, bước test và kết quả.
