# Kiểm tra chất lượng hội thoại và Map dùng chung

Phạm vi: local MVP trên nhánh `mvp`, không deploy, không tạo dữ liệu giả,
không thực hiện đặt/hủy đơn hoặc thanh toán mới trong đợt kiểm tra này.

## Lỗi tái hiện và thay đổi

1. **Mất ngữ cảnh khi bổ sung địa chỉ:** Intake có lúc coi câu trả lời cho câu hỏi
   đang chờ là mục tiêu mới. Bổ sung ngữ cảnh mục tiêu/câu hỏi đang chờ, bỏ trường
   `kind` cũ khỏi đầu vào LLM để tránh sao chép phân loại của lượt trước.
2. **Đổi mục tiêu vẫn giữ dữ kiện cũ:** bổ sung chỉ dẫn bỏ mục tiêu cũ khi người dùng
   yêu cầu rõ; xóa kế hoạch/chi phí hiển thị cũ khi mục tiêu mới còn thiếu thông tin.
3. **Hỏi lại dữ kiện đã biết:** bỏ qua các fact LLM nhắc lại nhưng không thay đổi;
   giữ fact gốc đã có bằng chứng. Trả lời chi tiết địa chỉ đang chờ được phép thay
   địa chỉ vùng rộng trước đó. Không bỏ kiểm tra bằng chứng của dữ kiện mới.
4. **Thông báo Moving quá chung:** hỏi riêng từng điểm lấy/giao còn mơ hồ, nêu
   dữ kiện đã ghi nhận, phân biệt thiếu địa chỉ với thiếu khả năng định vị địa chỉ.
5. **Chọn căn số 2:** đối chiếu ID thật trong kết quả trước, tập trung phần trả lời
   vào căn đã chọn và ghi các ID thực sự hiển thị cho tham chiếu ở lượt sau.
6. **Moving gọi tool vòng vo:** chỉ cung cấp tool có đủ điều kiện theo tiến độ;
   có báo giá thì chỉ kết thúc/hỏi lại, không quay lại danh mục. Giới hạn hai lượt
   đọc chi tiết dịch vụ trước báo giá; vẫn giữ ngân sách tổng, không tự tăng vô hạn.
7. **Tọa độ cũ đi theo địa chỉ mới:** vô hiệu tọa độ khi đổi địa chỉ; không để pin
   sidebar của địa chỉ cũ ghi đè câu sửa địa chỉ của người dùng.
   Đổi thành phố cũng bỏ quận/địa điểm/tọa độ cũ không được nhắc lại, giữ các
   điều kiện không phụ thuộc địa lý như ngân sách và số phòng ngủ.
8. **Lượt tiếp tục ở bước xác nhận:** cấp `request_id` mới cho lượt resume để không
   dùng ngân sách của lượt trước. Không bỏ xác nhận/kiểm tra quyền giao dịch.
9. **Định dạng fact thiếu rõ ràng:** mô tả kiểu dữ liệu ngay tại schema LLM,
   đưa contract route/nearby vào ngữ cảnh và ghi log lỗi field không chứa giá trị
   người dùng. Housing tự dùng Map; không yêu cầu task Map độc lập chỉ vì tìm nhà
   “gần” một địa danh.

## Map liên kết với dịch vụ

- `GET /api/v1/map/search?text=...`: endpoint có xác thực, gọi `resolve_location`
  của Location MCP hiện có, trả ứng viên và nguồn thật; không tạo tọa độ bằng LLM.
- Demo cho chọn ứng viên, xem tọa độ và bản đồ. Chọn địa điểm không đồng nghĩa
  xác nhận điểm dừng xe; tâm phường/quận không dùng làm điểm lấy/giao.
- `POST /api/v1/chat` nhận `housing_location` tùy chọn, cùng kiểu địa điểm xác nhận
  như Moving: `address`, `lat`, `lng`, `confirmed: true`. API kiểm tra biên tọa độ.
- Housing truyền `near_coordinate` đã xác nhận qua Planner xuống `search_housing`
  (center + bán kính 3 km), không geocode lại tên đã chọn. Đổi `near` thì bỏ pin cũ.
- Moving nhận qua `moving_locations.pickup/destination`. Nút lấy điểm trên Map
  chỉ điền form; người dùng kiểm tra cổng/điểm dừng rồi mới xác nhận.
- Liên kết Housing → Map tìm tiện ích và Housing đã chọn → Moving vẫn đi qua
  dependency/upstream của graph; chỉ dùng tọa độ listing đủ độ chính xác cho Moving.

## Kiểm thử

Các kịch bản thật trong `tests/test_llm_agents/test_multiturn_live.py` và
`test_integrated_live.py`: nhiều lượt Moving, đổi giờ/ngày, bổ sung ngân sách,
đổi hoàn toàn mục tiêu, chọn căn số 2, Housing + tiện ích, route OSRM, Flight
SerpApi, báo giá AhaMove staging, Map → Housing, tọa độ sai, quyền truy cập.
Không đổi assert để chấp nhận ERROR hoặc thay provider bằng mock.

Trong quá trình chạy đã gặp cả lỗi logic và hai lỗi môi trường độc lập:
cổng 8000 bị ứng dụng khác chiếm; kết nối OpenAI có lúc bị lỗi.
Các lần test bị ảnh hưởng không được tính là pass.

Quan sát DNS: log SDK có `ConnectError: [Errno 11001] getaddrinfo failed`;
`Resolve-DnsName api.openai.com -Type A` báo `DNS server failure`, trong khi truy vấn
đọc tới resolver `1.1.1.1` trả bản ghi A. Chưa sửa DNS hệ điều hành, hosts, proxy
hay hard-code IP vào ứng dụng. Cần kết nối ổn định để xác nhận lại trọn bộ.

Lệnh chạy ở cổng riêng, PowerShell:

```powershell
.venv/Scripts/python.exe scripts/local-integration.py api --port 18000
# Terminal khác:
$env:RUN_LIVE_INTEGRATION='1'
$env:RUN_LIVE_API_URL='http://127.0.0.1:18000/api/v1'
$testDir = Join-Path (Get-Location) ('data/test-run-'+[guid]::NewGuid().ToString('N'))
.venv/Scripts/python.exe -m pytest tests/test_llm_agents/test_multiturn_live.py tests/test_llm_agents/test_integrated_live.py -q --basetemp=$testDir
```

Demo nếu API không dùng cổng mặc định:

```powershell
$env:LIFEFLOW_API_BASE_URL='http://127.0.0.1:18000/api/v1'
.venv/Scripts/python.exe scripts/local-integration.py ui
```

## Chưa nên tuyên bố hoàn thiện sản phẩm

- Dữ liệu bản đồ không bảo đảm có mọi số nhà/cổng; tọa độ tâm khuôn viên không
  bảo đảm xe đến đúng cổng. Cần xác nhận điểm dừng cho giao dịch.
- Một số tin Housing có dấu hiệu mâu thuẫn giữa tiêu đề và giá/kỳ thuê canonical
  (ví dụ tiêu đề “theo tuần” nhưng dữ liệu period là month). Cần chủ dữ liệu đối
  soát provenance; không tự sửa giá theo phỏng đoán hoặc gọi đây là giá đã xác minh.
- Chưa có phân trang hội thoại hoàn chỉnh; đã bỏ lời mời “xem thêm” gây hiểu nhầm.
- Không cam kết mọi biến thể ngôn ngữ đều hiểu đúng. Bộ live regression phải chạy
  lại khi đổi prompt/model/contract, nhất là thay địa chỉ và đổi mục tiêu.
- Kết nối API ngoài và dữ liệu đủ coverage là điều kiện chạy, không phải logic
  có thể thay bằng dữ liệu giả. Giao dịch sandbox và deploy không được thử lại
  trong đợt kiểm thử chỉ đọc này.
