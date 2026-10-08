# Bàn giao: so sánh nhà độc lập với tìm/chọn nhà — 08/10/2026

Owner: Khoa. Issue: [#75](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/75).
Yêu cầu: [SPEC-019 (Draft)](../specs/SPEC-019-housing-comparison-isolation.md).
[PR #76](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/76) nối tiếp PR #74,
không bao gồm ancestry riêng của nhánh integration local.
Không tự merge/deploy; review bởi Housing/Maps/UI và graph/backend.

## Lỗi gốc, không chỉ presentation

Planner buộc giữ ID của task cũ chỉ vì cùng domain Property. Chuyển search thành
compare đã ghi đè TaskResult/input search, làm mất chosen trong progress và khiến
UI lấy bảng làm target Tìm nhà. Cost Summary còn có thể lấy quote căn đầu của
bảng như một phương án nhà. Ghi nhận selected:property còn trong Intake không
đủ chứng minh toàn bộ kế hoạch vẫn đúng — test cũ chỉ kiểm fact này nên bỏ sót lỗi.

## Thay đổi

- Planner LLM vẫn lập kế hoạch; code kiểm identity search/compare riêng, phản hồi
  sửa plan khi dùng sai ID. NEW_GOAL nhận reserved task IDs để không ghi đè lịch sử.
- Intake LLM phân biệt giữ nguyên dịch vụ cũ với yêu cầu chạy dịch vụ đó. Yêu cầu
  so sánh có evidence từ tin hiện tại; không bị âm thầm đổi thành tìm mới khi
  chưa xác định ID. ID so sánh phải được xác định cho lượt này, không kế thừa
  tùy tiện listing_ids cũ. Chưa rõ thì hỏi một câu, không render lại bảng cũ.
- Housing đọc đúng ID thật, không tìm nhà khác thay thế. Compare không trả quote
  vận hành, không thành nguồn transaction/selection/cost/preferences.
- Progress giữ search/chosen và dịch vụ khác; không thêm bước Tìm nhà cho bảng.
- Service targets bỏ bảng. Map cũ giữ viewport/search_request, selected ID và
  phân biệt kết quả hoạt động với lịch sử chỉ đọc. Yêu cầu chọn bảng bị API chặn.
- Chat chỉ dẫn ngắn; nhận xét domain agent đầy đủ nằm trong mục mở rộng dưới bảng.
  Cảnh báo nguồn không lặp sandbox từ Moving đã chạy ở lượt trước. Bảng nêu rõ
  phí thiếu không là 0 và cảnh báo giá biết được ngoài min/max yêu cầu.
- Hội thoại legacy trong ảnh mở map đã lưu được mà không phục dựng quote hay sửa
  checkpoint. Nhãn bản tìm nhà đã lưu không tuyên bố cost/choice đó còn hợp lệ.

Không có classifier theo keyword/city hoặc căn/giá cố định. Điều kiện theo mode,
schema, ID đã quan sát, evidence, state và số tiền provider trả; LLM vẫn hiểu
ngôn ngữ, chọn nhiệm vụ, công cụ và viết đánh giá chuyên môn.

## Bằng chứng kiểm chứng thật

- 42 kiểm tra Python về identity/format/progress/memory: pass. Các kiểm tra mới
  là hàm thuần/state contracts, không triển khai provider/LLM giả.
- 5 frontend contracts: pass; TypeScript/Vite build pass.
- Actual MCP/PostGIS: đọc đúng ID so sánh, không search thay thế, không quote
  chọn nhà; ca giá Cầu Giấy có **3/3 căn ngoài 5–7 triệu** được đánh dấu đúng,
  không cần LLM trong ca adapter này.
- Chrome + LLM + backend/MCP thật: tìm 4 căn, chọn nhà, so sánh 3 rồi thêm căn thứ
  tư; ID compare riêng và giữ qua lượt mở rộng, search/chosen/budget/Moving
  endpoint vẫn còn; reload → Kế hoạch → Tìm nhà mở đúng map, Back về bảng; API
  từ chối chọn bảng với 409. Case hoàn tất tăng dần trên một test conversation,
  không chạy lại search đã xong chỉ để có số đo mới.
- Chính hội thoại người dùng báo lỗi trong ảnh: Chrome mở map cũ thành công;
  không POST chat/action/transaction. Không chỉnh sửa hội thoại này để qua test.
- Yêu cầu so sánh ở Hoàn Kiếm 2–3 triệu sau danh sách Cầu Giấy 5–7 triệu: LLM
  hỏi lại **một** câu, không lấy ID cũ làm bảng mới, giữ nhà đã chọn, không giao dịch.
- Text so sánh thực tế sau sửa: "Đã so sánh 4 căn trong bảng dưới. Nhà bạn đã chọn
  không thay đổi. Một số tiêu chí chưa được xác minh; xem nhận xét dưới bảng."

Vòng đầu còn hỏi ngày/giờ Moving khi chỉ nói giữ nguyên phương án; đã sửa và
kiểm lại chính phần lỗi. Có hai lỗi ở harness browser (chờ render, locator trùng
bảng lịch sử), đã sửa locator/readiness, không thay backend hay data để qua test.
Một assertion ban đầu buộc hỏi lại dù danh sách ngay trước đã có đúng ba căn,
đúng Cầu Giấy/5–7 triệu là oracle quá chặt; nhận định được sửa lại. Ca đổi khu
và mức giá thật mới chứng minh yêu cầu làm rõ, không dùng việc trả ANSWER như lỗi
nếu ngữ cảnh đã xác định đúng các căn.

## Lệnh kiểm tra

Backend/DB/MCP thật phải chạy source hiện tại, chỉ read-only:

```powershell
& scripts/start-local-mvp.ps1
.venv/Scripts/python.exe -m pytest tests/test_agents/test_housing_comparison_identity.py tests/test_agents/test_progress.py tests/test_agents/test_memory.py -q
$env:RUN_WORKSPACE_REPAIRS_LIVE='1'
.venv/Scripts/python.exe -m pytest tests/test_llm_agents/test_workspace_repairs_live.py::test_comparison_reports_actual_prices_outside_a_requested_band -q -s
cd Frontend
npm run build
npx playwright test --config=playwright.contracts.config.ts
$env:RUN_HOUSING_COMPARISON_BROWSER='1'
$env:ROOM_SCOPE_RESUME_RUN='issue75-browser-<unique-run>'
npx playwright test --config=playwright.search-scope.config.ts housing-comparison.live.spec.ts scope-contracts.spec.ts
```

Browser tạo identity riêng `@example.invalid`, đọc provider thật; không intercept
hoặc replay provider. `HOUSING_COMPARISON_RESUME_THREAD` chỉ tiếp tục test identity
đã được kiểm tên/namespace/email, không nhận thread người dùng. Riêng kiểm legacy
chỉ opt-in `HOUSING_COMPARISON_LEGACY_THREAD` được cung cấp rõ và duyệt read-only.
Test scope-clarification Python cần `HOUSING_COMPARISON_VERIFY_THREAD` của harness
trên để không can thiệp hội thoại người dùng.

## CI và giới hạn

Các kiểm tra feature đã qua không có nghĩa toàn bộ CI của repository xanh.
So sánh **đúng clean publication base/head**, cùng env và private basetemp:

| Revision | Pass | Fail | Skip |
|---|---:|---:|---:|
| PR #74 base `5f622d2` | 527 | 30 | 87 |
| Delta #75 | 534 | 30 | 89 |

Danh sách 30 failure IDs trùng hoàn toàn; thêm 7 pure contracts đã qua, hai
live opt-in mới không tự chạy trong CI. Không tuyên bố toàn bộ CI xanh.
Frontend clean publication `npm ci`/TypeScript/Vite đã build; pure contracts dùng
config riêng không khởi động gateway. Config live cần `.venv`/env/backend local.
Suite local tích hợp còn có lỗi baseline và lỗi hook redaction riêng Windows;
Windows default pytest temp còn có permission errors, nên CI-like so sánh phải
dùng `--basetemp` mới trong `logs/` private và tắt tự load `.env` bằng
`PYTHON_DOTENV_DISABLED=1`, `LANGSMITH_TRACING=false`, `ROOMMATE_DEMO_ENABLED=false`.
Không thay fixture giả/approval/access checks để che lỗi baseline.

PR là stacked trên #74/#71/#42: cần review đúng delta và sau đó retarget/rebase
theo maintainer khi dependency merge. CI hiện chỉ tự chạy PR vào main; không tự
coi thiếu check trên stacked base là pass. Tin nhắn cũ giữ nguyên nội dung dài;
phản hồi mới ngắn hơn, không rewrite lịch sử. Kết quả cũ chỉ để xem lại khi không
còn task search hoạt động; muốn thay lựa chọn phải yêu cầu tìm lại. Bảng không
phải đặt phòng/thuê nhà hay đã thanh toán. Không mở giao dịch hoặc deploy.
