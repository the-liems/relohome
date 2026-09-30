# Bàn giao tích hợp và sửa lỗi chat — 30/09/2026

## Các nhánh đã đối chiếu

Đã fetch lại GitHub thành công. `integration/langgraph-services@d5c438e`,
`QuangDung@7f9a9b2`, `Doan/api@f1d6eb9` đều nằm trong lịch sử nhánh `mvp`;
không có commit nào ở ba nhánh này còn thiếu sau lần fetch.
Không chỉ copy ba class LLM: runtime graph, contracts, service adapters, MCP,
data/query/routing của nhóm đều có trong repo tích hợp.

## Chức năng thực tế

| Thành phần | Đường chạy hiện tại | Giới hạn |
| --- | --- | --- |
| Intake | OpenAI → structured facts → grounding | Không đoán dữ kiện thiếu |
| Routing Orchestrator | Planner LLM + DAG + validator/replan + confirmation | Quyền giao dịch do code kiểm |
| Housing | Graph → Location MCP → PostGIS thật | Chất lượng/freshness theo snapshot |
| Map | Graph → resolve/nearby/entity routing MCP → OSRM thật | HCM/Hà Nội/Đà Nẵng; địa danh mơ hồ hỏi lại |
| Flight | Graph → Flight MCP → SerpApi thật | Tìm chuyến; không xuất vé mô phỏng |
| Moving | Graph → Moving LLM → AhaMove staging; ghi qua transaction/approval | Giao dịch tắt mặc định; create read-back fix chưa lặp tạo đơn |
| Payment | Form/API riêng → Payment MCP → ZaloPay sandbox thật | Chưa gắn thành thanh toán vé/đơn Moving CASH; chưa xác nhận đã trả tiền |

Vì vậy **không gọi toàn bộ project đã hoàn chỉnh mọi giao dịch**. Tìm kiếm/báo giá/
định tuyến được tích hợp; chức năng provider không cung cấp thật không được bật giả.
Không deploy trong đợt này.

## Lỗi trong ảnh và bản sửa

1. Node Intake trước đây bắt mọi exception thành “không hiểu được yêu cầu”.
   Đã phân biệt kết nối OpenAI, timeout, hạn mức, lỗi schema, lỗi nội bộ;
   không đổ lỗi câu hỏi người dùng và không in key/raw provider error.
2. Housing MCP có `min_bedrooms/max_bedrooms` nhưng graph chưa có. Đã nối các bộ
   lọc quận, số phòng ngủ, phòng tắm, diện tích và giá tối thiểu xuyên Intake,
   capability, Planner, adapter và truy vấn. Planner không được bỏ bộ lọc người dùng.
3. Prompt có ví dụ quận bị đưa vào `near`, trái quy tắc tìm trong khu vực.
   Đã sửa; số phòng ngủ không bị đổi thành số người hay loại bất động sản.
4. Snapshot có địa chỉ Quận 1 nhưng không có polygon Quận 1. Query cũ chỉ dùng
   polygon nên trả rỗng sai. Khi không có polygon tên đó, query dùng so sánh chính
   xác `address.district`, có parameter SQL; không tìm bằng substring `Quận 1`→`Quận 10`.
   Bộ lọc city vẫn áp dụng đồng thời; khi có polygon thì ưu tiên spatial filter.
5. Sửa prompt hỏi lại quá mức khi đã đủ thành phố; câu bổ sung theo lượt trước
   được xử lý refine, không buộc người dùng chọn quận nếu không yêu cầu.
6. Nối `calculate_route_between_entities` vào Map task độc lập; kiểm địa điểm thật,
   không dùng tâm vùng hành chính làm điểm xuất phát/đích, không phát sinh booking.

## Bằng chứng

- Lượt nghiệm thu cuối: **9/9 live integration đạt, 74,09 giây**; không thay provider
  bằng mock. Chạy riêng lại câu trong ảnh nhận ANSWER với 5 listing.
- Hai lỗi không ổn định ở lượt trung gian (hỏi thừa và fact sai kiểu) đã được sửa:
  gửi required fields/allowed keys vào Intake, trả lỗi field cụ thể cho lượt sửa,
  kiểm lại clarification khi đã đủ input và dùng temperature=0 cho model GPT-4.1/4o.
  Điều này giảm biến thiên, không phải cam kết LLM không bao giờ sai.
- Bộ live integration cũ mở rộng Housing regression: 8/8 đạt sau sửa Intake.
- Test graph tra đường đi bộ bằng OpenAI → MCP → OSRM: đạt riêng.
- Câu trong ảnh đã đi tới Housing query với `district=quận 1`,
  `min_bedrooms=max_bedrooms=2`, city Hồ Chí Minh.
- Truy vấn MCP trực tiếp sau sửa polygon trả 5 listing thật (giới hạn trang 5),
  tất cả có bedrooms=2 và địa chỉ Quận 1. Không chèn dữ liệu để đạt test.
- TypeScript toàn workspace build đạt; Python lint/compile đạt.
- Đơn sandbox duy nhất tồn từ đợt trước đã hủy: DELETE provider HTTP 200;
  GET kiểm tra lại HTTP 200, trạng thái CANCELLED. Không tạo đơn mới.
  Việc hủy qua API provider để cleanup **không thay thế** test graph create→cancel.

## Phần cần quyết định hoặc kiểm chứng tiếp

- Muốn xuất vé cần provider ticketing thật/sandbox: SerpApi chỉ là nguồn tìm kiếm.
- Muốn thu tiền cho dịch vụ phải chốt đơn nào được thu, phương thức thanh toán,
  đối soát và hoàn tiền; không gắn demo ZaloPay vào Moving CASH tùy tiện.
- Sau khi có thêm phép thử giao dịch: chạy lại graph create→cancel để xác nhận
  create acknowledgement/read-back fix; không tự tạo thêm đơn theo mỗi lần CI.
- Production identity, multi-worker, retention/observability đầy đủ và deploy
  chưa nằm trong phạm vi nghiệm thu local này.

Chạy demo: [runbook](../runbooks/local-mvp.md). Tests thật:
`RUN_LIVE_INTEGRATION=1 pytest tests/test_llm_agents/test_integrated_live.py`.
