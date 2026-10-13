# Bàn giao nhánh QuangDung — 08/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Phạm vi bàn giao

Nhánh `QuangDung` chứa các commit Roommate backend/API/Agent đã có trước đợt này, cùng phần frontend, Cẩm nang, giao diện ReloHome, sửa tiến trình kế hoạch và công cụ chuẩn hóa tọa độ Housing đang chờ commit. Đây là bàn giao mã nguồn để review và tiếp tục phát triển, chưa phải xác nhận phát hành production.

| Khu vực | Nơi bắt đầu đọc | Trạng thái |
| --- | --- | --- |
| Frontend ReloHome | [Frontend/README.md](../../Frontend/README.md), [UI audit](../../Frontend/PRODUCTION_UI_AUDIT.md) | Trang giới thiệu, chat, map, Housing, Moving, Flight, kế hoạch, tài khoản, sáng/tối và VI/EN. Logo robot đã bỏ; favicon dùng nhà. |
| Roommate | [Product spec](../ideas/roommate-service.md), [technical design](../design/roommate-discovery.md), [runbook](../runbooks/roommate.md), [frontend handoff](../../Frontend/ROOMMATE_UI_HANDOFF.md) | Backend/API/Agent và luồng frontend tìm hồ sơ, hồ sơ cá nhân, lưu, yêu cầu kết nối và consent đã có. Chưa đạt mọi release gate trong `tasks/todo.md`. |
| Cẩm nang | [Guides README](../../Frontend/src/guides/README.md) | 10 bài biên tập trong app; nguồn nghiên cứu crawl nằm ở `data/` và không đưa vào Git/bundle. |
| Housing tọa độ | [Runbook](housing-geocode-runbook.md), [checkpoint](housing-geocode-checkpoint-2026-10-05.md) | Script pilot, batch, apply và tests được giữ để tiếp tục từ cache. Dữ liệu crawl/cache/export/DB nằm ngoài Git. |
| Kế hoạch hội thoại | [Agent progress](../../src/agents/progress.py), [repair script](../../scripts/repair_plan_history.py) | Có kiểm thử giữ task/lựa chọn giữa các service. Script repair là thao tác thủ công, mặc định dry-run; chỉ dùng `--apply` sau khi kiểm tra thread/backup. |

## Rà file dư và quyết định giữ/bỏ

- Đã bỏ 5 PNG nháp `Frontend/ChatGPT Image Sep 30, 2026, ...png` ở gốc frontend: không có import hoặc liên kết tài liệu. Git history vẫn có thể phục hồi.
- Đã gộp hai cặp ảnh sơ đồ trùng byte: giữ `docs/architecture/images/architecture-v4.png` và `architecture-baseline.png`, sửa liên kết ở hai tài liệu kiến trúc, bỏ bản sao ở gốc `docs/architecture/`.
- Đã bỏ `.thumbnail` do bản xuất mẫu giao diện sinh ra và thêm vào `.gitignore`.
- Giữ thư mục `Frontend MVP planning questions/` vì README/audit dùng làm mẫu tham khảo; HTML, `support.js` và screenshot là tài liệu thiết kế, không được frontend import hoặc deploy. Giữ cả `siu-home-hero.png` vì CSS vẫn tham chiếu; `relohome-hero-home.png` là ảnh bìa hiện tại.
- Các cấu hình Playwright riêng cho mock Roommate, tích hợp API thật và runtime audit đều được test/runbook tham chiếu. `Robot.tsx` đã xóa sau khi bỏ mọi chỗ render logo robot.
- `data/`, `.env`, `logs/`, SQLite, bản build, `node_modules/` và báo cáo test là dữ liệu cục bộ được ignore; không stage/push. Không có migration hoặc chỉnh DB trong đợt dọn file.

## Chạy và kiểm tra

Từ gốc repo, cài Python dependencies theo `requirements.txt`; frontend dùng `npm ci` trong `Frontend/`. Cấu hình qua `.env.example` và [runbook local](../runbooks/local-mvp.md). Build web bằng `npm run build` trong `Frontend/`; gateway/Agent chạy theo `Frontend/README.md` và runbook local. Các lệnh kiểm thử:

```powershell
cd Frontend
npm run build
npx playwright test --workers=2
cd ..
.\.venv\Scripts\python.exe -m pytest tests/test_agents/test_intake.py tests/test_agents/test_progress.py tests/test_api/test_thread_state.py tests/test_agents/test_roommate_live.py tests/test_housing_geocode.py Frontend/tests/test_actions.py -q
```

| Kiểm tra ngày 08/10 | Kết quả |
| --- | --- |
| TypeScript + Vite production build | Đạt |
| Python nhóm Agent/plan/API/Roommate/geocode/actions | 55 đạt, 1 skip |
| Playwright toàn bộ UI, desktop/mobile | 142 đạt, 10 skip; lỗi tràn trên mobile welcome phát hiện ở lượt đầu đã sửa và kiểm tra lại. |
| Playwright Roommate qua gateway/API/SQLite thật | 2 đạt. |
| Python toàn bộ `tests` + `Frontend/tests` | 506 đạt, 29 lỗi, 81 skip. 29 lỗi trùng đúng danh sách baseline trong [roommate backend checkpoint](roommate-backend-checkpoint.md); chưa coi suite là xanh. |

Các browser tests mock service được tách khỏi `roommate.integration.spec.ts` (gateway + API + SQLite thật) và `runtime-audit.live.spec.ts` (opt-in provider/LLM). Lệnh browser thông thường không chứng minh đã giao dịch, đặt xe, đặt vé hay thanh toán thật.

## Điều kiện vận hành và việc còn lại

- `ROOMMATE_ENABLED` mặc định `false` trong code; `.env` trên máy hiện bật `true` để thử local nhưng file này không được push. Môi trường khác phải cấu hình moderator, key và state riêng theo runbook. Không tự tạo hồ sơ thật hoặc suy ra consent.
- Roommate chưa có đầy đủ các mục quản trị/media và release gates G7–G9; xem `tasks/todo.md` và frontend handoff trước khi công bố. Không đóng issue #65 chỉ vì backend và UI lõi đã có.
- Lỗi tràn ở mobile welcome đã sửa bằng cách thu gọn nội dung tại chiều cao màn hình thấp; kiểm tra lại trong bộ Playwright desktop/mobile đạt. 29 Python failures vẫn tồn tại đúng baseline đã ghi, cần xử lý riêng trước release.
- Thay API key hoặc dữ liệu Housing trên máy cần tuân thủ quota và quy trình inspect/dry-run/backup trong runbook. Không đẩy API key, tọa độ nguồn hoặc export cache vào repo.
- Issue theo dõi chính: [#65 Roommate](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/65). Các thay đổi UI và Moving liên quan [#40](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/40) và [#52](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/52); trạng thái issue cần phản ánh đúng phần đã kiểm tra, không tự đánh dấu hoàn tất toàn bộ phạm vi.
