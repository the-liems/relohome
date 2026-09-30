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

## Đợt tiếp theo: tham chiếu địa điểm và hội thoại dài

Đã kiểm thử thêm ba hội thoại bằng GPT-6 Luna qua OpenRouter, Housing/Map thật
và AhaMove staging. Không tạo đơn xe hoặc thanh toán. Test nằm tại
`tests/test_llm_agents/test_contextual_moving_live.py`.

| Hội thoại | Kết quả quan sát |
|---|---|
| 4 lượt: tìm nhà → chọn căn thứ hai → “chuyển từ chỗ đó… tầm chiều” → “15 giờ nhé” | Giữ đúng ID căn đã chọn, hỏi giờ cụ thể, tra đúng địa chỉ căn. Vì tọa độ căn chỉ xấp xỉ, yêu cầu xác nhận điểm lấy thay vì tự báo giá. |
| 5 lượt: ngày 31/11 → sửa 3/10 → đảo điểm lấy/giao → giờ 25:00 → sửa 15 giờ | Bắt ngày/giờ không hợp lệ; dùng lại đúng địa chỉ và tọa độ theo chiều mới; báo giá thật sau sửa, thời điểm trong draft cuối đúng 15:00 ngày 3/10/2026. |
| 3 lượt: “điểm đó về nhà tôi” khi chưa có ngữ cảnh → giao trong Quận 1 → “cứ lấy giữa quận” | Hỏi bổ sung; không tạo tọa độ giao giả, không trả báo giá từ tâm quận. |

Bằng chứng checkpoint local (không chứa key):

- `th_39871e81460a4505adb2bc8629951155`: ANSWER → ANSWER → CLARIFY → CLARIFY.
- `th_4509ba85d9c843f799f0d66e7e9ceb61`: CLARIFY → ANSWER → ANSWER → CLARIFY → ANSWER.
- `th_3cf9b926a41542fa839379fc07108bdf`: CLARIFY → CLARIFY → CLARIFY.

Các ca đã chạy thành công được đối chiếu lại từ checkpoint thật, không gọi LLM
lại. Đây là các lượt kiểm thử riêng sau sửa, không phải một lượt chạy toàn bộ
regression suite trên cùng một phiên bản.

Các lỗi đã sửa:

1. Moving trước đây geocode chuỗi nội bộ `selected:property` như địa chỉ.
   Nay dùng ID nhà đã chọn để tra `get_housing`, hỗ trợ cả điểm lấy và điểm giao;
   không bắt chạy lại tìm nhà. Validator đối chiếu ID với lựa chọn của user.
2. Khi đảo chiều, tái sử dụng tọa độ theo địa chỉ đã xác nhận. Backend gắn tọa độ
   vào task sau khi đối chiếu địa chỉ; Planner không thể chép nhầm tọa độ chiều cũ.
3. Câu hỏi sửa ngày/giờ không hợp lệ có đúng field để câu trả lời ngắn như
   “15 giờ nhé” thay thế giờ cũ, không bị coi là mâu thuẫn.
4. Moving kiểm tra tuyến và catalog trước khi hỏi thêm; tránh LLM hỏi chung chung
   dù task đã có đủ dữ liệu. LLM vẫn chọn dịch vụ và gọi tool báo giá.
5. Không hiển thị `selected:property` trong lời trả lời. Nếu task thất bại,
   response không còn tuyên bố ANSWER thành công với danh sách kết quả rỗng.

Giới hạn: hiểu đúng “chỗ đó” không làm tọa độ housing chính xác hơn dữ liệu nguồn.
Nếu vị trí chưa đủ chính xác, vẫn cần user xác nhận pin. Các câu hỏi mơ hồ có thể
cần nhiều lượt bổ sung; ba hội thoại này không chứng minh mọi cách diễn đạt đều đúng.

## Đợt kiểm tra Map liên kết Housing

Thử trực tiếp API với dữ liệu nhà và Map thật, không tạo đơn hoặc thanh toán:

| Lượt | Yêu cầu | Kết quả |
|---|---|---|
| 1 | Tìm nhà đúng 2 phòng ngủ ở Quận 1 dưới 10 triệu | Có danh sách nhà thật. |
| 2 | Chọn căn thứ hai | Lưu đúng ID căn đã chọn. |
| 3 | Tìm bệnh viện và nhà thuốc quanh căn, bán kính 1000 m | Trả các điểm gần căn đã chọn trong bán kính. |
| 4 | Đi bộ từ Takashimaya tới căn đó | Tạo task Map route riêng; trả khoảng cách tuyến đi bộ thật. |
| 5 | Không cần đường nữa; tìm siêu thị quanh căn trong 500 m | Chuyển về Map nearby, vẫn giữ đúng căn và bán kính mới. |

Thread kiểm chứng: `th_19e3ecbc4dca45e6b7d883aed04ae187`. Một ca khác
(`tests/test_llm_agents/test_map_cross_service_live.py`) xác nhận địa danh
“Bưu điện Trung tâm Sài Gòn” có nhiều kết quả thì hệ thống hỏi xác nhận,
không tự chọn tọa độ để vẽ tuyến. Sau các sửa lỗi, những lượt đã đạt được đối
chiếu trên cùng thread; **không chạy lại toàn bộ năm lượt** chỉ để tiết kiệm
LLM credit. Test live trong file trên có thể chạy lại khi cần kiểm định hồi quy.

Lỗi đã sửa: Planner bỏ mất task Housing đã hoàn tất dù lựa chọn căn còn hiệu
lực; Intake đưa `selected:property` vào trường địa chỉ `near`; Planner áp bộ
lọc nearby lên task route cũ (và ngược lại); Intake coi yêu cầu đổi chế độ Map
và bán kính là mâu thuẫn. Các thay đổi không gắn cứng tên căn hay tọa độ của
ca thử vào logic sản phẩm.

Phạm vi Map hiện có: Housing dùng Map tìm vị trí/tiện ích và tính đường;
Moving dùng pin/toạ độ được xác nhận cho báo giá; Flight dùng sân bay riêng;
Payment không cần Map. Vị trí nhà chỉ xấp xỉ theo nguồn, không được tự biến
thành điểm lấy/giao chính xác để đặt xe. Giao diện chọn pin còn giới hạn và
không thuộc đợt sửa này.
