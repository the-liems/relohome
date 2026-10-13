# ReloHome — Kiểm tra hệ thống sau Roommate frontend

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Ngày 2026-10-07, Asia/Saigon. Yêu cầu: khởi động và rà lại các service, UI, API, console và ảnh hưởng của Roommate. Không sửa application/business logic, API, scoring, database schema hoặc layout dịch vụ cũ trong lượt audit này.

## Hệ thống đang chạy

- Web build thật: **http://127.0.0.1:8503**; Agent API 8000.
- Location MCP 4300, Platform API 4100, Moving API 4200, Moving MCP 4400.
- Docker: `lifeflow-postgis` và 9 OSRM cho HCM/Hà Nội/Đà Nẵng × driving/walking/motorcycle.
- Docker/ứng dụng đều đang tắt lúc bắt đầu. Đã mở Docker Desktop và khởi động container có sẵn cùng các process qua `scripts/local-integration.py`; không import/migrate/reset dữ liệu hoặc khởi động container ngoài project.
- App chính giữ cấu hình hiện tại: `AGENT_SUBAGENTS=live`, provider staging, writes/sandbox-payment disabled, `ROOMMATE_ENABLED` mặc định false. Không sửa `.env` hoặc token. Các process chính được giữ chạy cho chủ sản phẩm test.

## Kết quả

| Nhóm kiểm tra | Bằng chứng | Kết quả |
| --- | --- | --- |
| Tool/health thật | `Frontend/scripts/check-services.py`: area, resolve location, housing search/detail, POI search/detail/nearby, 2 route tools, 4 health/readiness, 9 OSRM nearest | **22/22 đạt** |
| LLM/graph thật | HTTP → Intake/Planner/domain → MCP: tìm nhà, tìm chuyến bay, route đi bộ, hỏi bổ sung hai lượt | **4/4 đạt** |
| Moving thật | Catalog từ pickup HCM; chọn một service TRUCK được provider trả; typed quote qua graph/API staging, địa điểm công cộng | Catalog **29 gói**, HTTP 200, **1 báo giá**, 0 LLM calls, 0 lỗi domain; không đặt đơn |
| UI build thật + backend đang chạy | Auth DB/gateway tạm riêng trỏ API thật: tìm nhà → map viewport trả 200 và nonempty; Moving geocode A/B và catalog; Flight offer render | **3 luồng đạt qua hai lượt** (Housing/Moving 2, Flight 1); không có uncaught JS error được bắt trong các luồng |
| Roommate browser thật | Session gateway → routers/services → SQLite riêng: private intro/publish/pause/resume/delete, send/accept/contact/revoke | **2/2 đạt** |
| Roommate + LLM thật khi enabled | Runtime/graph và DB test riêng, không mock LLM/scoring/API. Intake/Planner hiểu tìm người tại Hà Nội; Agent trả ID candidate, không tên/intro | **1/1 đạt**; subagent `llm_calls=provider_calls=0` |
| Browser suite rộng | Các màn cũ, Roommate, camera MapLibre, responsive/theme/language/keyboard/axe và các guard form | **129 passed / 1 failed / 4 skipped** |
| Python suite rộng | `tests` + `Frontend/tests`, live opt-in tắt, temp DB riêng | **503 passed / 29 failed / 80 skipped** |
| Node workspaces | Contracts, housing query, moving service, MCP server và các workspaces có test | **102 passed / 34 skipped**; một số workspace chưa có test; không coi skip/no-tests là evidence live |

Số liệu của suite rộng ghi theo thời điểm chạy. Sau đó thêm các live opt-in tests audit và chạy riêng; không cộng chúng thành một lần chạy full suite hoặc giả định mọi test ở manifest hiện tại đều đã pass cùng lúc.

### Những lỗi còn lại

1. **29 Python failures trùng chính xác baseline Roommate backend**. So sánh JUnit testcase IDs: không có failure ID mới. Các nhóm gồm assertions/mocks legacy Map/Moving/Flight, API fixture/lifespan, MCP subprocess/simulation expectation và Payment expiry field allowlist. Danh sách ở [backend checkpoint](roommate-backend-checkpoint.md#29-baseline-failures-hiện-còn).
2. **Mobile welcome overflow 19px**, test yêu cầu <=2px, vẫn tái hiện. Lượt frontend trước đã tháo riêng wiring Roommate và tái hiện cùng lỗi; không sửa layout cũ, không nới assertion hoặc skip để làm xanh. Đây không phải evidence Roommate làm mất chức năng.
3. Các test live mới ban đầu dùng selector `.ws-sidebar`/`.fw-workspace` không tồn tại và đọc nhầm Agent payload thay vì gateway Thread snapshot. Đã sửa **test** theo landmark và `messages[].content.ui.components` hiện có; không sửa UI/backend để chiều test. Test Housing chờ API viewport thật, không coi canvas vừa hiện là map/dữ liệu đã load xong.

## Roommate trên app chính: cấu hình khác với lỗi

App chính chưa bật Roommate, vì flag false mặc định và chưa có moderator cấu hình. `availability.enabled=false`; runtime không đăng ký Roommate vào Agent capabilities nên chat tìm người có thể trả `UNSUPPORTED`. Không diễn giải kết quả này là đã test positive discovery trên app chính.

Đã xác minh positive discovery với runtime enabled riêng và LLM thật, cùng browser/API/DB thật riêng. Hồ sơ synthetic, khai báo 18+/terms và consent chỉ thuộc fixtures, không trộn vào housing/auth/Roommate data của app chính. Để người dùng tự thử Roommate trên 8503 cần bật flag và cấu hình moderator/token theo [runbook](../runbooks/roommate.md); audit này giữ `.env` hiện tại.

## Thời gian đo được

- Moving catalog: khoảng **2,47s**; typed quote: khoảng **2,90s**, 0 LLM calls.
- HTTP graph thật: Housing **18,8s**, Flight **15,7s**, walking route **16,8s**, clarification hai lượt **23,2s**.
- Đây là các mẫu đo local, không phải SLA. Chênh lệch cho thấy typed quote không đi qua LLM nhanh hơn các lượt có Intake/Planner/domain tool loop; không quy toàn bộ độ trễ cho frontend.

## Phạm vi chứng minh và giới hạn

- Các luồng đọc chính Housing/Moving/Flight/map/chat đã hoạt động với provider/dữ liệu thật; Roommate được kiểm tra đầy đủ các luồng trọng tâm trong runtime test enabled.
- UI suite kiểm tra console/axe/responsive ở các ca đã định nghĩa; live browser bắt uncaught JS errors, không tuyên bố mọi ảnh/tile external luôn khả dụng hoặc console ở mọi màn/user đều sạch.
- Xác nhận/đặt xe/giữ chỗ/đặt vé/thanh toán thật **chưa thực hiện**. Main startup giữ writes false; các guard và luồng giao dịch dùng fixtures trong suite. Không dùng evidence HTTP 200/health để khẳng định đã có giao dịch thành công.
- Không sửa hoặc xóa các thay đổi frontend/housing đang có trước audit; chỉ thêm test/helper/config test và báo cáo. Release gates vẫn chưa xanh vì baseline failures và các mục ngoài scope trong [frontend handoff](../../Frontend/ROOMMATE_UI_HANDOFF.md).

## Evidence local và lệnh tái chạy

Reports nằm trong `logs/local` (ignored), gồm:

- `full-system-audit-20261007.xml/.txt`, `system-browser-audit-20261007.json/.txt`.
- `live-graph-audit-20261007.xml/.txt`, `moving-runtime-audit-20261007.json`.
- `runtime-browser-audit-20261007.txt` (Housing/Moving), `runtime-flight-browser-audit-20261007.txt` (Flight); JSON runtime browser bị ghi đè theo lượt lọc cuối, không dùng JSON cuối để nói cả ba ca chạy cùng lúc.
- `roommate-system-integration-20261007.txt`, `roommate-live-enabled-audit-20261007.xml/.txt`.
- `location-moving-node-audit-20261007.txt`, `data/frontend-service-audit.json` chỉ chứa status/count/configured booleans.
- Runtime startup logs: `logs/local/runtime-audit-20261007-194057-*.out.log/.err.log`; không đưa log thô/provider payload/credentials lên Git hoặc cloud data zip.

```powershell
# Từ gốc repo:
.venv/Scripts/python.exe Frontend/scripts/check-services.py
# Từ Frontend/; servers test riêng, không dừng hệ thống 8503:
npm.cmd exec -- playwright test --config playwright.system-audit.config.ts --workers=2
npm.cmd exec -- playwright test --config playwright.roommate.config.ts --workers=1
# Chỉ khi chủ động opt in đọc thật/LLM:
$env:RUN_RUNTIME_AUDIT='1'
npm.cmd exec -- playwright test --config playwright.runtime-audit.config.ts
```

Test runtime browser dùng auth DB tạm và server 18504 trỏ API 8000; Roommate fixture dùng server 18503/private DB riêng. Không có token trong TypeScript, test output hoặc lệnh CLI; secrets được load server-side từ cấu hình local hiện có.
