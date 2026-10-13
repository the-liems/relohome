# Kiểm thử luồng và sửa luật nhiều lượt — 01/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Phạm vi: MVP local (WSL, snapshot `Leader-LifeFlow-Updateable-2026-09-29`), nhánh `QuangDung@41d9511`
cộng các thay đổi chưa commit dưới đây. Chỉ đọc, tìm kiếm và báo giá; không tạo đơn hay thanh toán.
Nguyên tắc sửa: không gắn cứng tên địa danh hay cụm từ người dùng. Luật lấy từ manifest của capability,
cấu trúc dữ liệu Location trả về, hoặc kênh có cấu trúc cho LLM, và đều được code kiểm.

## 1. Lỗi phát hiện và cách sửa

| # | Hiện tượng | Nguyên nhân | Sửa |
|---|---|---|---|
| 1 | Hỏi "ở Hà Nội", "tại Đà Nẵng", "Hồ Chí Minh" (không có chữ "Thành phố") luôn bị hỏi lại "khớp nhiều nơi" | `search_areas` trả cả "Trung tâm Hà Nội" và "Thành phố Hà Nội"; không có kết quả `exact`, điểm gần nhau nên `pick_clear` không chọn | `pick_city_area` cho field `city` ([location.py](../../src/agents/subagents/services/location.py)): giữ ưu tiên `exact`; trong các vùng khớp tên (không fuzzy) ở cấp cao nhất (`parent` rỗng), vùng duy nhất có ranh giới bao các vùng còn lại là vùng người dùng gọi tên. Vùng rời nhau vẫn hỏi lại |
| 2 | Đang xem tiện ích quanh căn, hỏi tiếp "tính đường đi bộ từ … đến căn đó" thì nhận CLARIFY "map_mode: trước đó là 'nearby', giờ là 'route'" | `ground_facts` coi mọi fact đổi giá trị ở lượt `REFINE` là mâu thuẫn; trước đó node chỉ vá bằng regex cho vài cụm từ | `operation_selector_keys` đọc từ `input_schema` của manifest các khoá được ghim `const` trong nhánh `anyOf`/`oneOf`/`if` (hiện là `map_mode`). Khoá chọn thao tác được thay, không thành mâu thuẫn. Bỏ `map_mode` khỏi regex `explicitly_changed_fact`. Câu hỏi mâu thuẫn thật dùng nhãn tiếng Việt (`FACT_LABELS`) |
| 3 | "Cứ lấy giữa quận làm điểm giao" → ERROR `PLAN_INVALID … Missing runnable requested domain: relocation` | Code thấy đủ field nên bắt buộc có task; Planner LLM (đúng) không lập task với địa chỉ cấp quận; hai lượt đều bị từ chối | Planner có `needs_input {domain, field, question}` ([planner_llm.py](../../src/agents/planner_llm.py)). Code chỉ nhận domain được yêu cầu, field có trong `input_schema`, không kèm task mới cùng domain. `PlannerOutput.questions` → orchestrator `ASK_USER` (plan rỗng) hoặc kết quả kèm câu hỏi. Prompt nói rõ: độ chính xác địa chỉ do subagent kiểm, không phải lý do bỏ domain |
| DB | Tìm nhà quanh một điểm (center + bán kính) luôn timeout, graph báo `Database query timed out` | `pg_restore` không có thống kê planner; `catalog.places` chưa từng `ANALYZE` | `restore-local-snapshot.py` chạy `ANALYZE` sau restore. Truy vấn mẫu 8,5 s (504) → 0,5 s |

Kèm theo: `PlanDraft.needs_input` có mặc định rỗng để provider không ép strict schema không làm hỏng
plan; log vị trí field sai khi `LLM_INVALID_OUTPUT` và lý do cố định khi domain loop lỗi (không log giá trị).

Tài liệu đã cập nhật: [agent-graph.md](../architecture/agent-graph.md) §6.1, §6.2, §13.2;
SPEC-001/AC-11, SPEC-003/AC-14, SPEC-014/AC-10; ghi chú ADR-018; [runbook](../runbooks/local-mvp.md);
[src/agents/README.md](../../src/agents/README.md).

## 2. Kiểm chứng

| Bộ | Kết quả |
|---|---|
| Unit mới `tests/test_agents/test_turn_rules.py` | 8 passed (selector từ manifest, mâu thuẫn thật vẫn hỏi, city scope, deferral hợp lệ/không hợp lệ) |
| Bộ offline rộng (`tests/test_agents`, `test_api`, `test_mcp_*`, `Frontend/tests`, `test_llm_agents`) | Cùng 22 lỗi có sẵn trước thay đổi (fixture/hợp đồng cũ, xem `Frontend/SERVICE_AUDIT.md`), không lỗi mới |
| Live: 3 ca từng lỗi logic (`test_map_cross_service_live.py` ×2, Moving địa chỉ cấp quận) | 3/3 passed; lượt 4–5 Map nearby ↔ route đều ANSWER; Moving lượt 3 hỏi `relocation.to_address` qua `needs_input` |
| Live: toàn bộ 7 file (28 ca) sau sửa | 24 passed, 2 skipped (Payment cần giao dịch có sẵn), 2 failed: một do mục 3.2, một `LLM_INVALID_OUTPUT` của Planner không lặp lại sau khi chạy lại 2 lần |
| Kịch bản bổ sung: Housing ở Hà Nội sau câu hỏi lại; Flight + Housing song song | Đạt; hai task chồng thời gian |

## 3. Còn mở (chưa sửa trong đợt này)

> Cập nhật cùng ngày: mục 1 và 2 đã xử lý trong [chế độ bản đồ](map-workspace-2026-10-01.md) §3.

1. **Địa điểm trùng gần nhau.** "Cầu Rồng" là hai trạm xe buýt cách 82 m; "Chợ Hàn" là way + area cách 35 m;
   "Văn Miếu" hai node cách 7 m; "Chợ Bến Thành" có trạm xe buýt + 3 bản ghi chợ. Route giữa địa danh
   phổ biến vì vậy vẫn hỏi lại. Hướng đề xuất: luật gom các ứng viên khớp chính xác trong cùng bán kính nhỏ
   thành một đích cho Map route (vẫn hỏi lại với điểm lấy/giao Moving), hoặc Location gộp bản ghi trùng.
2. **`ReadLlmAgent.finish` thiếu ID.** LLM đôi khi trả thứ tự chỉ gồm một phần ID đã quan sát; code báo
   `Cannot add or drop observed options` và cả task Housing thất bại dù đã có dữ liệu (1/4 lần chạy).
   Hướng đề xuất: ép bằng schema tool (đủ ID hoặc rỗng) hoặc giữ ID còn lại theo thứ tự provider.
3. Kết nối mạng tới OpenAI/SerpApi/AhaMove staging có lúc lỗi; lỗi được báo đúng mã, không tính là pass.
4. Dữ liệu housing có ít tin giá parse sai (78 tin < 1 triệu/tháng, ví dụ tiêu đề "5.5TR" lưu 500.000đ),
   nổi lên đầu khi xếp theo giá.
