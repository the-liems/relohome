# SPEC-019 — So sánh nhà độc lập với tìm/chọn nhà

Status: Draft (chờ review yêu cầu).
Owner: Khoa. Reviewers đề nghị: QuangDung (Housing/Maps/UI), chủ graph và backend.
Issue: [#75](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/75).
Dependencies: SPEC-014, SPEC-016, SPEC-018 và PR #74/#71/#42.

## Vấn đề và phạm vi

So sánh 2–4 listing đã quan sát là phân tích chỉ đọc, không phải tìm nhà mới,
chọn/thuê/đặt cọc nhà hay thay địa chỉ chuyển đồ. Bảng so sánh nằm trong chat;
Kế hoạch và nút Tìm nhà vẫn mở kết quả tìm kiếm/map ban đầu.

Ngoài phạm vi: đặt phòng/đặt cọc, thay provider, sửa lịch sử chat/checkpoint của
người dùng, tự tìm listing thay thế mà chưa rõ yêu cầu, deploy và Redis.

## Luồng và ranh giới

1. Intake dùng LLM hiểu các căn được nhắc tới. Listing ID phải từ danh sách đã
   quan sát; yêu cầu chưa rõ căn nào cần hỏi lại, không tự lấy các căn đầu.
2. Planner dùng LLM tạo task Housing compare có ID riêng, không đổi task search
   thành compare. Sửa cùng bảng giữ ID compare; trở lại search không dùng ID đó.
3. Housing agent đọc đúng từng listing thật. Bảng gồm giá/cọc/diện tích/tiện nghi,
   khoản thuê tháng đầu + cọc biết được và khoản chưa xác minh. Thiếu phí không là 0.
4. Respond dẫn ngắn, không lặp toàn bộ bảng/nhận xét. Nhận xét LLM đầy đủ giữ trong
   payload và mục mở rộng, ghi rõ không phải xác nhận từ chủ nhà.
5. Bảng không có hành động chọn/đặt. Map cũ mở từ Kế hoạch; xem lại không gọi LLM.

Ngân sách hoặc khu vực được dùng để đánh giá bảng không sửa input task tìm kiếm
ban đầu, selected:property, goal_selections hoặc điểm giao Moving. So sánh không
làm nguồn giao dịch, không tự chọn căn đầu cho Cost Summary và không học ngân sách
so sánh như sở thích tìm nhà mới. Dịch vụ khác chỉ tiếp tục khi thực sự được yêu
cầu, không vì người dùng nói "giữ nguyên phương án chuyển đồ".

Nếu giá biết được nằm ngoài min/max được yêu cầu, trả ID vi phạm có căn cứ và
cảnh báo; giá có quality flag vẫn là chưa xác minh. Phân tích không cam kết có
listing đáp ứng mọi điều kiện hay tự đổi danh sách để đạt yêu cầu.

## Contract chuẩn và an toàn

Không duy trì DTO khác trong Markdown. Nguồn chuẩn:

- `apps/agent-api/src/relohome_agent/agents/models.py`: Task, TaskResult, IntakeResult.
- `apps/agent-api/src/relohome_agent/agents/subagents/capabilities.py`: schema Housing compare/listing_ids.
- `apps/agent-api/src/relohome_agent/agents/housing_operations.py`: phân biệt operation search và compare.
- `apps/agent-api/src/relohome_agent/agents/subagents/services/location.py`: bảng dữ kiện và kiểm min/max.
- `apps/agent-api/src/relohome_agent/api/web_actions.py`: kiểm ownership/version/fetched_at, từ chối chọn bảng.
- `apps/web/src/serviceJourney.ts`: target map và khả năng chọn kết quả.

Quyền chọn nhà vẫn bị backend kiểm; ẩn nút UI không thay thế kiểm quyền. Không nhận
ID/tọa độ/giá LLM bịa. Không thêm transaction hay mở approval từ kết quả so sánh.

## Hội thoại cũ đã bị ghi đè

UI có thể mở **map tìm nhà đã lưu trong message thật** và bộ lọc của map đó,
dưới dạng chỉ đọc. Không lấy bảng làm map; không phục dựng báo giá hay tuyên bố
lựa chọn/cost cũ còn hợp lệ. Không sửa checkpoint hoặc viết lại tin nhắn cũ.
Thay lựa chọn ở kết quả cũ không còn là task search hoạt động cần yêu cầu tìm lại.

## Acceptance criteria

- AC-01: Search và compare không dùng cùng ID; validator chặn chuyển operation
  bằng cách ghi đè ID, kể cả khi Planner sinh sai.
- AC-02: So sánh 3 rồi 4 căn giữ nhà đã chọn, input search, goal history và điểm
  giao Moving; không tạo thêm bước Tìm nhà hoặc thay choice trong Kế hoạch.
- AC-03: Compare không là nguồn commit, lựa chọn UI, Cost Summary hoặc preference
  mới. Request chọn bảng bị backend từ chối.
- AC-04: Tìm nhà mở map cũ, kể cả sau reload và với hội thoại legacy; bảng vẫn
  là nội dung riêng trong chat. Map legacy không cho chọn với token/result mới.
- AC-05: Với lượt chỉ so sánh thành công/một phần, text tối đa 65 từ; bảng và
  nhận xét chi tiết vẫn truy cập được, không lặp cảnh báo sandbox từ task cũ.
- AC-06: Yêu cầu không xác định các căn cần được làm rõ; không coi yêu cầu
  "3 căn ở khu X, giá A–B" là chỉ định ba ID đầu của danh sách cũ.
- AC-07: Dữ kiện giá ngoài min/max bị cảnh báo; giá chưa xác minh không dùng như
  giá chắc chắn, khoản thiếu không là 0, không tuyên bố đáp ứng đủ.
- AC-08: Kiểm chứng bằng state/plan contracts và LLM/MCP/PostGIS/browser thật;
  không thêm provider mock, đặt xe/thanh toán hay thay dữ liệu người dùng để qua test.

## Review và bằng chứng

Review domain semantics, nhận xét/cảnh báo cần giữ, navigation legacy chỉ đọc và
quyền chọn nhà. Xem [bàn giao #75](../integration/housing-comparison-isolation-2026-10-08.md).
