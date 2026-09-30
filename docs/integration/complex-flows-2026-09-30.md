# Kiểm thử yêu cầu nhiều dịch vụ — 30/09/2026

Bản trước đã push `mvp` tại `567d378`. Đợt này kiểm thử HTTP → Intake LLM →
Planner LLM → LangGraph domain agents → MCP/provider thật → validator/response.
Không mock, không tạo đơn xe hoặc thanh toán. Các mốc giờ dưới đây là UTC.

## Lỗi phát hiện và sửa

1. Graph có fan-out nhưng khóa LLM bao toàn bộ invocation, khiến agent chạy tuần
   tự. Chuyển sang executor chia ngân sách riêng cho mỗi task trước fan-out;
   tổng cấp trong một đợt không vượt phần ngân sách còn lại. Task chờ đợt sau
   khi chưa đủ phần cấp; sau fan-in tính lại theo usage thực tế.
2. Planner có thể dùng ID task Housing làm `selected_listing_id`. Cung cấp rõ
   origin binding `upstream_property`/`selected_property`/`explicit_near`;
   ID không được user chọn vẫn bị validator từ chối, không tự sửa thành ID giả.
3. `map_mode=nearby` là default hợp lệ nhưng kiểm tra grounding chưa cho phép
   khi user không nói field này tường minh. Bổ sung default khớp capability.
4. Flight không nhận tên đầy đủ “Thành phố Hồ Chí Minh” vì catalog dùng “TP.”.
   Chuẩn hóa tiền tố hành chính khi đối chiếu catalog thật; không tự bịa mã IATA.
5. Intake nhầm origin/destination giữa Flight/Moving/Map hoặc trích trùng fact.
   Làm rõ namespace; duplicate cùng giá trị giữ bằng chứng hợp lệ đầu tiên,
   khác giá trị vẫn yêu cầu sửa/hỏi lại.
6. “Nhà có 2 phòng ngủ” bị hiểu thành `min_bedrooms=2` nên lọt nhà 3–7 phòng.
   Chuẩn hóa equality `[2,2]` từ một bound đã có bằng chứng và cụm từ chính xác;
   không dùng cho range/phủ định, không ghi đè bound mâu thuẫn. Thiếu/sai tiếp
   thì repair có giới hạn hoặc hỏi lại, không âm thầm nới điều kiện.

## Ca 1: song song rồi có phụ thuộc

“Tìm nhà có 2 phòng ngủ tại Quận 1, Thành phố Hồ Chí Minh dưới 10 triệu mỗi tháng,
tìm bệnh viện quanh các căn trong 1500 m; đồng thời tìm chuyến bay Hà Nội →
Thành phố Hồ Chí Minh ngày 15/11/2026 cho 2 người lớn. Không đặt gì.”

Thread `th_fa91bda07bf64cb3812f3402e1dbbc29`:

| Task | Bắt đầu | Kết thúc | Phụ thuộc |
|---|---|---|---|
| Housing | 08:12:09.890 | 08:12:13.365 | Không |
| Flight | 08:12:09.890 | 08:12:15.239 | Không |
| Map nearby | 08:12:15.241 | 08:12:18.538 | Housing |

Đạt: Housing và Flight chồng thời gian; Map chạy sau Housing, dùng dữ liệu căn
nhà thực; tất cả căn trả về có đúng 2 phòng ngủ; Flight có offer thật.
Ba domain sử dụng tổng cộng 6 LLM calls.

## Ca 2: ba việc độc lập

Báo giá chuyển đồ giữa hai điểm thật đã được người dùng cho phép trong cấu hình,
ngày mai 09:00; tìm chuyến Hà Nội → Đà Nẵng ngày 15/11/2026 cho 1 người;
tính đường đi bộ Dinh Độc Lập Cafe → Takashimaya tại HCM. Không đặt/thu tiền.

Thread `th_5f4a74cfe0374c0082de2ba002f55d90`:

| Task | Bắt đầu | Kết thúc | Phụ thuộc |
|---|---|---|---|
| Moving | 08:12:31.068 | 08:12:38.452 | Không |
| Flight | 08:12:31.068 | 08:12:36.652 | Không |
| Map route | 08:12:31.068 | 08:12:34.717 | Không |

Đạt: cả ba cặp task chồng thời gian, có báo giá AhaMove staging, offer SerpApi
và khoảng cách OSRM thật. Tổng cộng 8 LLM calls của domain agents.

## Bằng chứng và cách chạy lại

`tests/test_llm_agents/test_complex_flows_live.py`: **2 passed / 37,39 giây**
sau sửa. Kiểm tra response, nguồn kết quả, không commit, grant/call count,
thời điểm từng dependency và thời gian chồng nhau; không chỉ nhìn DAG do LLM vẽ.
Các lần chạy trước đã fail và được dùng để sửa các lỗi nêu trên.
Thêm 4 kiểm tra hàm thuần/catalog thật đạt, không dùng service giả.

```powershell
$env:RUN_LIVE_INTEGRATION='1'
$env:RUN_LIVE_API_URL='http://127.0.0.1:18000/api/v1'
.venv/Scripts/python -m pytest tests/test_llm_agents/test_complex_flows_live.py -q -s
```

Response mỗi task có `data.execution`: started_at, finished_at, elapsed_ms,
request_id, depends_on và allocated_llm_calls. Trace không chứa API key/liên hệ.

## Giới hạn cần nói rõ

- Chạy song song **theo từng đợt LangGraph**. Ca 1 Map chờ fan-in của cả đợt
  Housing+Flight, chưa bắt đầu ngay khi riêng Housing xong. Đúng dependency,
  nhưng chưa tối ưu kiểu scheduler khởi chạy liên tục theo từng task hoàn tất.
- Hai ca này là full luồng **đọc/báo giá**, không kiểm thử đặt xe/thu tiền.
- Hai mẫu thành công không có nghĩa mọi câu phức tạp đều hoàn hảo; vẫn có lỗi
  trích xuất LLM, mất mạng, giới hạn data/provider. Không deploy trong đợt này.

## Kiểm thử hai lượt với GPT-6 Luna

- Đã đổi mặc định của Intake, Planner và năm domain agent sang `gpt-6-luna`.
  Key `sk-or-v1-` được gửi tới OpenRouter và dùng model slug `openai/gpt-6-luna`;
  key OpenAI vẫn dùng endpoint/model OpenAI. Không ghi key vào repository.
- Housing → chọn căn số 1, Map tính đường từ căn đã chọn và Flight tìm chuyến:
  **đạt hai lượt** với LLM thật, DB/Map/SerpApi thật; không đặt vé.
- Moving báo giá → sửa 09:00 thành 10:00 và tra giao dịch Payment sandbox đã
  thuộc user: phát hiện Intake coi câu sửa rõ ràng là conflict khi đồng thời
  thêm domain; đã sửa. Tiếp tục trên thread báo giá thành công: cả Moving và
  Payment `done`, giờ mới là 10:00, không tạo đơn/thanh toán mới.
- Một lần chạy lại độc lập bị `PROVIDER_UNAVAILABLE` từ AhaMove staging ở
  bước quote đầu, nên không tính ca độc lập ấy là pass. Đây là giới hạn
  upstream cần theo dõi; bài test live vẫn giữ assert nghiêm ngặt.
