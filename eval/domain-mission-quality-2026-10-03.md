# Domain missions: kiểm chứng chất lượng sau thay đổi — 03/10/2026

## Kết luận

Có bằng chứng bản mới làm **đầy đủ nhiệm vụ hơn trong ca phân trang**, và giữ
ngữ cảnh khi chuyển Housing → Map → Moving. Không có bằng chứng nó nhanh/rẻ hơn
hay tốt hơn trên mọi yêu cầu. Đợt đánh giá này còn phát hiện một regression ở phạm
vi phản hồi: hạn chế của Map cũ kéo báo giá Moving mới sang `PARTIAL`.

Kết quả cuối theo tiêu chí riêng: **2 ca PASS, 1 ca FAIL thực sự**. Không coi test
FAIL, skip hoặc lỗi harness là pass. Chưa sửa logic sản phẩm trong đợt này; mục tiêu
là đo và đánh giá theo yêu cầu của người dùng. Không push/deploy.

## Phương pháp và giới hạn so sánh

- Baseline là code thật tại `b18fb4b944e2a9cacc34a3e73cd8ade7b055fdf9`.
  Test đọc bằng `git show` rồi nạp module riêng, không checkout/reset worktree.
- So sánh domain loop cũ/mới dùng cùng model cấu hình, key riêng, Location MCP,
  grounded adapter hiện hành và hard inputs. Đây là A/B **vòng domain agent**,
  không phải A/B toàn bộ hai phiên bản sản phẩm từ UI tới database.
- Các provider trả dữ liệu thật. Không mock SDK, MCP, giá, tọa độ, listing, quote
  hay hội thoại. Checkpoint đọc lại là kết quả các lượt đã chạy qua API/LLM thật.
- Model mặc định của ca A/B là `gpt-6-luna`; cùng cấu hình cho hai bên. Baseline
  giữ trần loop cũ 4 calls, bản mới giữ trần 6; không ép chạy hết trần.
- Chỉ một mẫu A/B cho mỗi chính sách. Không suy ra tỷ lệ chính xác tổng quát,
  mức tăng tốc hay chi phí trung bình từ mẫu nhỏ này.

Test: [test_mission_quality_live.py](../tests/test_llm_agents/test_mission_quality_live.py).
Yêu cầu: [SPEC-014/AC-24–29](../docs/specs/SPEC-014-domain-llm-agents.md).

## 1. Nhiệm vụ cần đọc trang tiếp — PASS

Task Housing: gần Đại học Bách khoa Hà Nội, dưới 5 triệu/tháng, page size 5.
Mục tiêu giao xuống: xem tối đa 10 căn, đọc trang tiếp nếu có, không nới ngân sách
hoặc đổi địa điểm. Hai bên dùng cùng query; PostGIS lọc không gian và giá.

| Quan sát | Vòng cũ | Vòng mới |
| --- | ---: | ---: |
| Căn thật trả về | 5 | 10 |
| Thao tác | search → finish | resolve → search → trang tiếp → finish |
| LLM calls | 2 | 4 |
| Provider calls | 3 | 4 |
| Cache hits riêng invocation | 0 | 2 |
| Input tokens | 3.733 | 17.742 |
| Output tokens | 155 | 459 |
| Thời gian đo | 5,62 giây | 19,69 giây |
| Đánh giá gửi Orchestrator | Không có assessment | fulfilled, có nhãn đánh giá model |

Assertions đã qua: query không đổi, ID có source refs, giá dữ kiện không vượt
hard budget, không thêm trang thứ ba, không phát sinh giao dịch.

Điểm cải thiện là tự hoàn tất việc đọc hai trang trong task được giao; không phải
“bản cũ không bao giờ tìm được 10 căn”. Bản cũ vẫn có thể dùng page size lớn hơn
hoặc nút tải thêm. Ca này cố định page size để kiểm quyền quyết định/khả năng đọc
trang tiếp và việc hiểu mục tiêu của domain agent.

Đánh đổi: tổng token của domain loop tăng từ 3.888 lên 18.201 trong ca này
(khoảng 4,7 lần). Đây không phải hệ số chi phí cho mọi câu hỏi.

## 2. Thêm nhiều lượt: đổi tiện ích → chuyển đồ từ căn đó — PASS

Tiếp tục thread thực đã có Housing, lựa chọn căn qua UI action và Map nhà thuốc.
Không trả tiền chạy lại tìm Housing đã qua.

Lượt mới thứ nhất:

> Chuyển sang xem siêu thị trong 800 mét quanh căn đó, vẫn giữ ngân sách tìm
> phòng trước đây. Không tìm lại nhà, không đặt dịch vụ.

Đã kiểm:

- Map nhận `supermarket`, radius 800 m và đúng selected listing ID.
- Housing cũ vẫn trong checkpoint, giữ search_request/fetched_at; không có call
  Housing mới trong usage meter của request này.
- Budget nhà vẫn 5 triệu; bán kính tìm nhà cũ vẫn 2 km. Không chuyển bán kính Map
  800 m thành bộ lọc Housing.
- Provider trả siêu thị thật, khoảng cách khoảng 336 m đường thẳng, có giới hạn
  nearest-per-category và trạng thái chưa xác minh. Phản hồi Map là PARTIAL đúng
  đánh giá nguồn/coverage, không giả vờ đã duyệt toàn bộ tiện ích.

Lượt mới thứ hai:

> Tôi muốn chuyển đồ từ căn đó đến Đại học Bách khoa Hà Nội ngày 2026-10-05 lúc
> 16 giờ. Chỉ báo giá, chưa đặt.

Đã kiểm:

- Intake giữ căn đã chọn, `from_address=selected:property`, ngày 05/10 và 16:00;
  không hỏi lại các field này.
- Moving hoàn thành `resolve_move_route → list_moving_services → estimate_move
  → finish`; báo giá AhaMove staging thật.
- Quote 500 kg: 105.000đ; quote 1.000 kg: 143.000đ. Đây là snapshot báo giá của
  lần test, không phải cam kết giá cho lần sau hoặc lựa chọn xe của người dùng.
- Không confirmation, không tạo đơn, không thu tiền.

Usage ghi trong runtime cho hai lượt:

| Lượt | LLM calls, gồm Intake/Planner/domain | Input | Output |
| --- | ---: | ---: | ---: |
| Đổi Map sang siêu thị | 4 | 18.657 | 426 |
| Moving từ căn đã chọn | 6 | 23.084 | 603 |

Harness ban đầu sai ở hai chỗ: giả định response Map phải hiển thị lại Housing,
và đọc `status` từ view kết quả thay vì canonical TaskResult. Đã sửa harness để
kiểm checkpoint thật; resume các lượt đã chạy, không gọi lại LLM/provider. Điều
này không phải sửa sản phẩm hoặc nới yêu cầu để che lỗi logic.

## 3. Phạm vi assessment trong phản hồi — FAIL

Trên cùng checkpoint thật sau lượt Moving:

- Moving của request mới có status DONE, báo giá provider hợp lệ.
- Map là task optional giữ từ request cũ, có assessment limited.
- So sánh hai hàm compose trên cùng dữ liệu: cũ `ANSWER`, mới `PARTIAL`.
- Bản mới đưa `map_1` cũ vào `limited_tasks`, khiến câu trả lời báo giá mới nói
  chưa xác minh đủ yêu cầu và lặp cảnh báo siêu thị dù lượt mới chỉ hỏi chuyển đồ.

Test `test_old_optional_review_does_not_downgrade_fresh_completed_request` tái
hiện bằng checkpoint thật, **không gọi thêm LLM/provider** và đang FAIL.

Nguyên nhân: khối `limited` trong `src/agents/nodes/respond.py` duyệt mọi task
DONE còn trong plan mà không phân biệt assessment của việc mới chạy và task
optional đã hoàn thành trước đó.

Hướng sửa đề xuất (chưa triển khai trong đợt đánh giá):

1. Giữ cảnh báo nguồn cũ để có thể xem lại, không xóa dữ kiện hoặc assessment.
2. Quyết định ANSWER/PARTIAL theo phạm vi yêu cầu hiện tại và các task bắt buộc
   còn ảnh hưởng mục tiêu; không chỉ theo mọi assessment có trong plan.
3. Không dùng tên domain hay câu test để hardcode ngoại lệ. Dùng request/execution
   identity, required/dependency và context của lượt.
4. Kiểm lại cả hai phía: hạn chế của task **mới** vẫn phải hiện PARTIAL; hạn chế
   của dependency bắt buộc không được vô tình bỏ qua.

Đây là vấn đề thông điệp/phạm vi hoàn thành, không phải báo giá Moving bị giả
hoặc không hiểu điểm xuất phát. Tuy vậy cần sửa trước khi coi đợt thay đổi đã hoàn
thiện cho hội thoại nhiều lượt.

## Tổng chi phí ghi nhận và phạm vi chưa kiểm

A/B domain + hai lượt API mới: 16 LLM calls, 63.216 input tokens và 1.643 output
tokens. Đây là usage ghi nhận, không quy đổi ra tiền/credit và không bao gồm các
đợt kiểm thử trước. Các lần sửa harness/replay checkpoint không thêm LLM calls.

Không chạy lại Map || Flight hoặc Payment đã qua ở đợt trước. Không test tạo/hủy
đơn, trả/hoàn tiền, xuất vé, deploy hay tương tác trình duyệt mới. Chưa đo end-to-end
Planner LLM semantic replan, chất lượng mọi yêu cầu mơ hồ, hay benchmark lớn.

Lint và collection test mới qua. Kết quả chức năng có FAIL được ghi rõ ở trên;
không thể dùng lint/build hoặc hai ca PASS để tuyên bố tất cả đã ổn.
