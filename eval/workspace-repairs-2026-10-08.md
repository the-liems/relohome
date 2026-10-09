# Issue #70 — bằng chứng kiểm thử ngày 08/10/2026

Đối tượng: bản sửa workspace/map/Housing comparison trên nền QuangDung,
local Windows, PostGIS snapshot mới, AhaMove staging và Flight/LLM thật.
Không chạy transaction, không mock provider hoặc tạo người ở cùng giả.

## Kết quả đã đo

| Kiểm tra | Kết quả |
|---|---|
| Frontend TypeScript + Vite build | Pass |
| `ruff check src tests Frontend/server.py` | Pass |
| Models/Intake/progress/Roommate contract thuần | 99 passed |
| Local gateway health opt-in, production/off/remote không công khai | 4 passed, real SQLite/ASGI |
| MCP thật: đọc lại đúng 4 ID nhà, không tìm thay thế | Pass, 4 `get_housing`, 0 LLM |
| Chat thật: tìm nhà → so sánh 3 căn | Pass nghiệp vụ; PARTIAL vì thiếu dữ liệu nguồn; lượt so sánh 17,454 s |
| Chat thật: chọn nhà → so sánh 3 → thêm căn thứ tư | Lượt 3: 13,899 s; mở rộng 4 sau sửa: 12,742 s; giữ ID đã chọn, không commit |
| Browser thật Housing + Flight | Pass, 18,3 s toàn ca; có cả hai dịch vụ, ghim đỏ, vùng tìm, chọn nhà tự chuyển Flight, mở lại nhà từ plan |
| Browser thật Moving + route | Pass, 5,6 s toàn ca; form không unmount, quote 2,122 s; OSRM 200 LineString |

Timing quote cùng một request: `total_ms=2047`, `llm_ms=0`,
`estimate_move=2041 ms`, 2 lượt đọc catalog cache hit. Thời gian browser
2,122 s gồm gateway/network/render. Không suy ra phần trăm cải thiện so với
API gọi tay trên tuyến/gói xe khác. Không cache giá để tạo kết quả nhanh giả.

Test hover đo 8 lần, độ lệch vị trí nút chat dưới 1 pixel. Test Moving dùng
actual ID trường đại học đã resolve, actual catalog TRUCK và quote staging.
Gateway test dùng database đăng nhập tách riêng; không seed dữ liệu nhà/
Roommate, không intercept API trả payload giả.

## Lỗi đã bắt trong test và xử lý

- OSRM đang dừng: trước khởi động trả 503 `OSRM_OFFLINE`; sau khởi động route
  Hà Nội thật trả 200, 6.016,6 m / 629,9 s. Sửa startup và giải thích fallback.
- Hover reset transform căn giữa: sửa CSS, kiểm chứng browser.
- Selector test cũ kỳ vọng combobox Flight/xe: sửa harness theo UI thật của
  teammate, không đổi UI để ép test pass.
- Test chọn `.place.first()` có thể chọn fuzzy POI sai: sửa test dùng ID thật
  và category trường đại học; không tạo mapping địa danh cố định.
- So sánh thêm căn thứ tư bị conflict `listing_ids`: chỉ cho cập nhật tập đọc
  đã grounding trong mode so sánh; chạy tiếp checkpoint thật đã pass phần 3,
  không lặp paid search đã xong. Ca mở rộng 4 đã pass và giữ lựa chọn nhà.

## CI: không xanh toàn repo

Chạy toàn suite với UTF-8, APP_ENV=test và basetemp trong workspace:
**31 failed, 541 passed, 83 skipped** (có subtests). Baseline
`QuangDung@374d38c`: **29 failed, 506 passed, 81 skipped**.

Đối chiếu JUnit theo tên testcase: 28 failing functions trùng baseline.
Hai failing functions khác baseline liên quan thay đổi có từ trước issue #70:

- Fixture selection trong `test_thread_state` không có plan/task DONE nhưng
  vẫn kỳ vọng selection hiện hành. Guard mới từ review QuangDung từ chối;
  không nới guard để qua test. Cần cập nhật test contract bởi chủ graph.
- `test_prompt_hooks` redaction custom home trên Windows thuộc phần log ở
  nhánh integration/main; không đưa thay đổi log đó vào PR workspace này.

Một baseline failure price-band Moving không còn fail trên nhánh local.
Số test tăng do các contract tests trước đó và test live opt-in mới; không
coi chênh lệch tổng số passed là chứng minh không regression.

Bản publication đã tách khỏi main/integration, build ra cùng asset hash với
bản local. Toàn suite publication: **30 failed, 532 passed, 84 skipped** trước
4 test local health mới (4/4 đã chạy riêng và pass). Toàn bộ 29 failing
testcases của baseline vẫn còn, thêm fixture selection thiếu plan/DONE như
nêu trên. Ruff trên các file Python thay đổi pass; Ruff toàn publication
còn 24 lỗi có sẵn ở `tests/test_housing_geocode.py`. Không đưa một đợt format
geocode lớn hoặc thay đổi CI vào PR này để che các vấn đề đó.

Chạy ban đầu với Temp mặc định còn lỗi permission Windows; số ở trên dùng
basetemp có quyền ghi, không che lỗi bằng bỏ test hoặc đổi policy an toàn.
Các lỗi cũ gồm Flight booking mô phỏng bị vô hiệu hóa, API readiness/config,
fake-client fixture không khớp contract hiện hành và ZaloPay fields.

PR phải giữ draft/chưa merge cho đến khi các owner xử lý hoặc triage được
CI theo đúng branch đích. Workflow PR hiện nhắm main nên PR nối tiếp vào
QuangDung có thể không có Actions check; “không có check” không phải CI xanh.

## Chạy test đã thêm

API 8000 và MCP/OSRM/DB thực phải đang chạy bản source cần kiểm tra.

```powershell
$env:RUN_WORKSPACE_REPAIRS_LIVE='1'
.\.venv\Scripts\python.exe -m pytest tests/test_llm_agents/test_workspace_repairs_live.py -q -s

cd Frontend
npm run build
$env:RUN_WORKSPACE_REPAIRS_BROWSER='1'
npx playwright test --config playwright.workspace-repairs.config.ts
```

Các lệnh trên dùng dịch vụ/LLM thật và có thể tốn credit. Mặc định live tests
skip. Có thể resume đúng checkpoint của ca này bằng
`WORKSPACE_REPAIRS_RESUME_THREAD`; không dùng conversation của người khác.
Log/SQLite/screenshots ở thư mục local ignored, không push thông tin phiên.

## Giới hạn

- Roommate active profiles = 0; không nghiệm thu matchmaking có người dùng.
- POI “Bưu điện Trung tâm Sài Gòn” không có exact match trong snapshot này.
- Bảng 2–4 căn là so sánh dữ kiện được yêu cầu, không xếp hạng toàn thị trường;
  thiếu phí/giá chất lượng kém được nói rõ.
- Chưa kiểm chứng compare commute cho 4 căn, production/deploy, mọi persona
  hoặc giao dịch. Không gọi toàn bộ hệ thống “hoàn tất” từ 2 browser cases.
