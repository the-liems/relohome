# Kiểm thử hội thoại nhiều lượt và Map — 02/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Kết quả chính

Đã chạy **19 tương tác** trong một hội thoại qua gateway React/API thật, gồm
5 thao tác bằng Chromium/Playwright với giao diện đang chạy. Con số này gồm cả
các bước phát hiện lỗi trước khi sửa, **không phải tuyên bố 19 bước đều đạt ngay**.
Không mock HTTP/LLM/MCP, không tự tạo tin nhà hoặc tọa độ. Không xuất vé, đặt xe,
tạo thanh toán hay deploy. Dùng tài khoản QA riêng được tạo qua đăng ký thật.

Thread chính: `th_3e3d5543ae24d5feeee29e8b82642a98`.
Snapshot và ảnh nằm trong `data/` được gitignore. File snapshot có session cookie,
không commit hoặc gửi nguyên file cho người khác.

## Những luồng đã kiểm tra

| Luồng | Quan sát thực tế |
|---|---|
| Câu nguyên văn: “tìm phòng trọ dướ 5 triệu ở gần trường đại học bách khoa thành phố Hồ Chí Minh và đặt vé máy bay từ Hà Nội vào đó để tôi xem phòng.” | Hiểu ngân sách và lỗi gõ; suy ra điểm đến TP.HCM; hỏi ngày bay. Tên trường khác tên OSM chính thức nên cần chọn ứng viên thật, không đoán tọa độ. |
| Bấm chọn trường | `near_place_id` thật được gửi qua gateway, Housing tìm được tin trong phạm vi; ngân sách cũ giữ nguyên. |
| Phóng to Map, chọn căn không nằm trong 5 tin chat ban đầu | Backend đọc lại tin nhà; thêm candidate và lưu `selected:property`, `origin=map_workspace`. Chọn căn giá 3,5 triệu ở Tô Hiến Thành. |
| Chỉ trả lời ngày bay 12/10/2026 và một người lớn | Giữ căn đã chọn, ngân sách, HAN→SGN; trả các chuyến SerpApi thật. Không có booking. |
| “Quanh căn tôi vừa chọn” — nhà thuốc 500 m | Map nhận đúng listing ID, trả Pharmacity cách khoảng 450 m đường thẳng. Không dùng tâm trường thay căn nhà. |
| Đổi sang điểm Map độc lập, rồi quay về căn nhà — 700 m | Lựa chọn nhà không đổi; quay về thì `map_near` cũ được bỏ, task dùng đúng listing ID. Điểm Bưu điện chưa đủ dữ liệu để xác định an toàn. |
| Chuyển đồ tới căn đã chọn, thiếu giờ | Sau sửa, không còn hỏi chọn nhà lại; chỉ hỏi giờ. |
| “Khoảng 16 giờ nhé. Địa điểm và ngày giữ nguyên.” | Giữ ngày 13/10 và căn đã chọn; hỏi xác nhận đúng điểm lấy chưa phân giải được. |
| Đổi điểm lấy sang trường Bách khoa và bấm marker trên Map | Tọa độ đến từ ứng viên Location thật; không cần nhập lại ngày giờ. Xác nhận thêm pin căn nhà từ tin đã chọn. |
| Ngày 13/10 vượt lịch đặt trước của AhaMove | Provider từ chối; Moving giải thích và hỏi ngày thay thế. Quy định này lấy từ phản hồi provider, không hardcode ngày/tuyến vào app. |
| Chỉ đổi ngày sang 05/10 | Giữ hai pin và 16:00; trả báo giá staging thật cho hai dịch vụ: 121.000đ và 138.000đ. Đây là báo giá của provider, không cam kết xe chở vừa hoặc bao bốc xếp. |
| Nhập ngày sai 31/02/2027 | CLARIFY đúng field `move_date`, không nói đã báo giá cho ngày sai. |
| Sửa ngày, đổi giờ thành 17:00 | Báo giá lại; giữ nguyên hai tọa độ, ngày 05/10 và căn nhà. |
| Yêu cầu đặt vé cùng tra nhà thuốc | Giữ ý định đặt vé trong `unavailable_commit_requested`; không tạo commit action. Flight và Map vẫn DONE, phản hồi nói rõ chỉ tra cứu/chưa giao dịch. |

## Lỗi đã sửa

1. **Ẩn toàn bộ fuzzy matches:** `pick_place` vẫn không tự chọn fuzzy. Riêng câu hỏi
   Housing/Map trả gợi ý có similarity >=0.8 để user chủ động chọn. Khớp yếu bị loại,
   tránh gợi ý trường khác hoặc điểm ở thành phố khác vì trùng vài từ.
2. **Hỏi ngày bay hai lần:** chuẩn hóa alias `flight.date` → `flight.flight_date`
   trước khi dựng text/questions. Không gộp ngày bay với ngày chuyển đồ.
3. **Đổi sang Moving làm mất căn đã chọn:** khi draft `new_goal` tham chiếu selection
   thật đã xác nhận, backend chuyển thành continuation trước khi gộp facts. Mục tiêu
   mới không tham chiếu selection vẫn giữ hành vi reset.
4. **Intake hỏi lại địa chỉ đã có:** bước kiểm conflict của LLM nay tính cả facts đã
   xác nhận trước đó; không coi selection cũ là thiếu chỉ vì lượt mới không trích lại.
5. **Booking chưa hỗ trợ chặn mọi việc:** tách ý định không khả dụng khỏi danh sách
   executable actions; giữ ý định để giải thích, cho read tasks hợp lệ tiếp tục.

Không thay UI sản phẩm trong đợt này; chỉ thêm browser harness. Không thêm danh sách
tên trường/địa chỉ, tọa độ hoặc đáp án cố định vào code nghiệp vụ.

## Bằng chứng và cách kiểm lại

- `scripts/test-map-dialogue-live.py`: gateway thật; chế độ `verify` chỉ kiểm snapshots
  đã ghi, không gọi LLM hay replay dữ liệu vào app.
- `Frontend/scripts/map-dialogue-live.mjs`: browser thật, không `page.route` hay fixtures.
- `tests/test_llm_agents/test_limitations_rules.py`: 8 kiểm tra contract/policy thuần,
  không mock clients hoặc câu trả lời provider.
- `tests/test_llm_agents/test_location_quality_live.py`: 2 kiểm tra nguồn/pin đã có và
  2 kiểm tra mới với MCP/PostGIS thật: strong fuzzy có choices, weak fuzzy không choices.
  Các ca đạt được chạy riêng; không tính lần lỗi harness đảo tham số constructor là pass.
- Ruff, Python compile và `git diff --check` được kiểm sau sửa.

```powershell
# Đọc và kiểm bằng chứng đã có; không tốn lượt model:
.venv/Scripts/python.exe scripts/test-map-dialogue-live.py verify
.venv/Scripts/python.exe -m pytest tests/test_llm_agents/test_limitations_rules.py -q

# MCP/DB thật, không LLM:
$env:RUN_LIVE_INTEGRATION='1'
.venv/Scripts/python.exe -m pytest tests/test_llm_agents/test_location_quality_live.py -q

# Các lệnh sau tốn credit thật; chỉ chạy bước cần kiểm lại trên hội thoại QA:
.venv/Scripts/python.exe scripts/test-map-dialogue-live.py turn --case nearby
node Frontend/scripts/map-dialogue-live.mjs inspect
```

Usage app ghi cho đợt này (thread chính, thread thử trước sửa và lần harness bị
PowerShell làm hỏng Unicode): **82 LLM calls; 442.279 input tokens; 14.938 output tokens**.
Bao gồm ca lỗi/retest, không phải chi phí của một câu hỏi thông thường. Không suy ra
hóa đơn hay cached-token discount từ con số này. Đã dừng gọi model sau khi các bước
mục tiêu đạt; dùng kiểm snapshots và contract để kiểm cuối.

## Giới hạn còn lại

- Không khẳng định mọi địa danh có trong snapshot. Với “Bưu điện Trung tâm Sài Gòn”,
  resolver chưa trả một điểm đủ tin cậy; user cần chọn điểm hoặc ghim cổng thực tế.
- Trường có bản ghi way/area gần nhau. Housing/Map có thể chọn một địa danh theo
  quy tắc đã có; Moving vẫn cần xác nhận điểm xe đến, không coi tâm khuôn viên là cổng.
- Chưa có provider xuất vé thật; Flight chỉ tìm chuyến, không bật booking giả.
- Không kiểm đặt/hủy xe hoặc thanh toán trong đợt này; không tuyên bố transaction E2E đạt.
- Hội thoại đã mất selection trước khi sửa không được tự sửa checkpoint. Đã chọn lại
  căn qua UI thật để kiểm lại lỗi; dữ liệu của người dùng khác không bị xóa/chỉnh.
- Một lần gửi test ngay khi API đang restart trả 502. Không dùng lần đó làm bằng chứng
  lỗi xử lý yêu cầu; harness nay kiểm `/status` trước khi gửi.

Liên kết tiêu chí: [SPEC-014](../specs/SPEC-014-domain-llm-agents.md), AC-20 đến AC-23
(Draft, cần nhóm review).
