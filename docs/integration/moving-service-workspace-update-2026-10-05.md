# Moving: form dịch vụ và kiểm thử — 05/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


## Phạm vi được duyệt

Người dùng cho phép nối thêm trường qua Agent, **giữ nguyên quy trình xác nhận**.
Đợt này sửa React, gateway, schema và đường truyền Moving; không sửa thuật toán
OSRM, nghiệp vụ TypeScript của hãng, data, `.env`, migration hay write flags.
Local hiện tắt tạo đơn/thanh toán. Không có thay đổi yêu cầu tuổi: hợp đồng
Moving bắt buộc tên/SĐT của liên hệ, không bắt buộc tuổi.

## Tham khảo quy trình dịch vụ

- [AhaMove: hướng dẫn sử dụng](https://ahamove.com/faq): điểm lấy/giao, liên hệ,
  yêu cầu đặc biệt, COD, chỉ dẫn địa chỉ và lịch giao nhận.
- [Lalamove: hướng dẫn đặt giao hàng](https://www.lalamove.com/vi-vn/huong-dan-su-dung-ung-dung-lalamove):
  tuyến, loại xe, dịch vụ hỗ trợ và kiểm tra yêu cầu trước đặt.
- [AhaMove: payment flow](https://developers.ahamove.com/en/docs/payment-flow):
  các cách trả phí có điều kiện riêng. Tích hợp hiện giữ **CASH**, chưa nối ví,
  công nợ hoặc người nhận trả phí.

Từ đó bố trí ba bước **Thông tin → Báo giá → Xác nhận**. Phí, danh mục và
khả năng lựa chọn lấy từ provider; không sao chép giá/tải trọng từ hình minh họa
hoặc tự tính phí từ OSRM.

## Những gì người dùng có thể nhập

| Nhóm | Trường / hành vi |
| --- | --- |
| Tuyến | Hai ô A/B tìm gợi ý ngay trong ô hoặc ghim map; giữ dữ kiện căn đã chọn và lịch chuyển |
| Hàng hóa | Nhiều kiện, mô tả, trọng lượng kg và ba kích thước cm |
| Giá trị / thu hộ | `item_value`, `cod`; thu hộ tách riêng cước vận chuyển, kiểm COD limit theo xe |
| Gói xe | Catalog AhaMove tại tọa độ A; giữ chế độ Agent so sánh gói xe như trước |
| Dịch vụ thêm | Boolean, PER_UNIT, tier/option theo danh mục; không tự tạo request ID hoặc giá |
| Giao nhận | Ghi chú, promo, `require_pod`, `require_verification` |
| Liên hệ riêng | Tên/SĐT bắt buộc; tòa nhà, căn/tầng và chỉ dẫn tùy chọn ở form phê duyệt |
| Tiện dụng | Dùng liên hệ A cho B; sửa yêu cầu/báo giá lại; form và chat thu gọn trên mobile |

Add-on bị tắt hoặc đòi nhập tự do chưa có contract được vô hiệu hóa. Mã giảm
giá/POD/xác minh có được hãng chấp nhận hay không vẫn phụ thuộc provider; giao
diện không hứa áp dụng chỉ vì người dùng đã chọn.

## Liên kết và ràng buộc

1. `GET /web/api/moving/services` qua session gateway → Agent
   `GET /api/v1/ui/moving/services` qua token → MCP đọc danh mục tại A.
   Response bỏ toàn bộ `provider_data`, không lộ credentials.
2. Form gửi `moving_locations` và `moving_options` có schema riêng cùng lượt
   chat. Intake và Planner chỉ dùng options do người dùng gửi, bỏ options model
   tự dựng. Dữ kiện được giữ ở lượt bổ sung, xóa khi bắt đầu mục tiêu mới.
3. Moving kiểm lại service/request/tier/option/COD theo catalog hiện tại rồi
   áp vào `draft` và `services[].requests`. Hàng hóa/ghi chú chỉ qua đường có
   cấu trúc, không ghép vào câu chat.
4. Phương án báo giá và phê duyệt hiện yêu cầu đã báo giá cùng hai địa chỉ.
   Tên/SĐT/tòa nhà/tầng/chỉ dẫn riêng qua `pii_forms`, không ghi vào hội thoại.
5. Transaction giữ đối soát/idempotency → báo giá lại với liên hệ thật và đúng
   các tùy chọn đã chọn → kiểm khoảng giá đã đồng ý → approval server → tạo đơn.
   Không thêm đường đặt trực tiếp từ form hoặc tự bật write flags.

Đổi/bỏ ghim A làm mất gói/add-on/COD phụ thuộc danh mục; đổi gói cũng bỏ
add-on/COD. Lịch và kiện vẫn giữ. Đổi B cần xác nhận lại pin. Options không
được sửa trong lúc đang chờ phê duyệt; phải đổi/từ chối phương án theo flow cũ.
Ghi chú/mô tả báo giá che điện thoại/email; liên hệ chính xác nhập riêng.

## Kết quả kiểm tra

| Kiểm tra | Kết quả |
| --- | --- |
| Toàn bộ browser | **62 passed** trong một lượt; desktop 1440×960/mobile 390×844; API fixture, không LLM/provider |
| Liên hệ dùng chung | **2 passed** chạy bổ sung sau khi mở rộng assertion sao chép A→B |
| Ảnh form | Hai ca chạy lại đều qua; đã xem desktop/mobile, form cuộn riêng/nút báo giá cố định, không tràn ngang |
| Python có mục tiêu | **50 passed**: schema, request/tier/option/COD, intake/planner, LLM execution giả lập, adapter nền, gateway, phê duyệt/commit/kiểm giá |
| Kiểm tra rộng lúc đầu | **179 passed, 19 failed**; không kết luận toàn bộ Python sạch |
| Baseline trước sửa | HEAD `cc220c2d0da8072500fad25604b528dfe9c99c77`, cùng nhóm bỏ hai ca stdio/live: **157 passed, 17 failed**. Tập 17 tên lỗi trùng hoàn toàn với lượt mới |
| Ruff / TypeScript / Vite | Qua |
| Runtime | UI 8503, Agent 8000, Moving API 4200 và MCP 4400 health/ready 200; catalog endpoint mới 200, write flags false |

17 lỗi có sẵn gồm 3 Map/housing, 2 Moving fixture, 1 planning, 3 adapter cũ
và 8 HTTP API fixture thiếu startup/lifespan. Hai lỗi rộng còn lại là Flight
stdio không được spawn trong sandbox và flow Flight/Payment tích hợp chưa có
confirmation như fixture kỳ vọng. Không sửa các luồng đó trong đợt Moving.

### Hai báo giá provider thật được duyệt riêng

Không gọi LLM, create/update/cancel order hoặc payment. Dùng liên hệ báo giá hệ
thống được cấu hình và người dùng cho phép gửi tới **AhaMove staging**.

| Ca | Gói / tuyến | Phí vận chuyển | Phí thêm | Tổng |
| --- | --- | --- | --- | --- |
| Cơ bản | SGN-TRUCK-750; hai điểm công cộng nội thành TP.HCM, 1,99 km | 162.000đ | 0đ | **162.000đ** |
| Kiện + bốc xếp | Cùng tuyến/gói/lịch; kiện 12 kg, 50×40×30 cm; khai giá 300.000đ, COD 0, POD và ghi chú | 162.000đ | 75.000đ | **237.000đ** |

Provider không trả cảnh báo cho hai ca. Kết quả chứng minh payload có tùy chọn
bốc xếp đã được hãng tính phí; không chứng minh mọi trường bổ sung được hãng
hiển thị trên đơn thực hoặc đơn đã tạo thành công. Mức phí là tại thời điểm
test, không phải bảng giá cố định. Bằng chứng cục bộ nằm trong `logs/local/`,
không nằm trong data bàn giao.

## Nhận code và chạy

Pull đủ commit đợt này (React + Python plumbing + test/docs), build lại
`Frontend`, khởi động lại **Agent và gateway**. Không có data/migration mới.
Các service Moving/Location/OSRM tiếp tục chạy theo runbook hiện có.

```powershell
cd Frontend
npm run build
cd ..
.venv/Scripts/python.exe scripts/local-integration.py api
# Terminal khác
.venv/Scripts/python.exe scripts/local-integration.py ui
```

Mở http://127.0.0.1:8503/ai. Form vẫn cần Intake/Planner/Moving LLM để xử lý
hội thoại thật. Đặt đơn staging thực, cập nhật/hủy đơn, callback và đồng bộ
đa dịch vụ cần lượt test tích hợp riêng có cấu hình/cho phép ghi; chưa được
chạy trong đợt này. Nhiều điểm giao, quản lý danh sách đơn, timeline và rating
vẫn chưa có UI/flow đầy đủ.

## Kiểm tra tiếp: lỗi ghim B và độ trễ Moving/Flight

### Lỗi trong ảnh “Dữ liệu gửi chưa hợp lệ”

Lượt form trong hội thoại `th_d212815297cae9cfd3368b293a9d6045` bị Agent API
từ chối **422**, trước bước báo giá AhaMove. Gateway lưu lượt lỗi trong khoảng
**0,012 giây**. Đây không phải bằng chứng địa điểm/xe bị hãng từ chối.

Frontend từng so sánh `point.id === housePoint?.id`: khi chưa chọn căn và pin
thủ công không có ID, cả hai bằng `undefined`, khiến B bị hiểu thành căn đã
chọn. Payload vì thế thiếu địa chỉ B. Ngoài ra callback map được đăng ký lần
đầu giữ state cũ; khi đã có căn nhưng nhập B mới, chạm map có thể đổi lại căn.

Đã sửa trong `ServiceWorkspaces.tsx`: chỉ dùng căn khi căn tồn tại, so sánh ID
khi ID có giá trị, callback map đọc hàm/state hiện tại qua ref và kiểm tra địa
chỉ A/B trước gửi. Không thay quy trình xác nhận hay logic báo giá backend.
Test tái hiện trước sửa **4/4 lỗi**, sau sửa **4/4 qua**; nhóm Moving/Flight
desktop/mobile **32/32 qua**, build qua. Chưa replay hội thoại thật bằng LLM.

Nếu hãng không có gói tại A hoặc gói user chọn không thuộc danh mục tại A,
Moving hiện trả câu hỏi về dịch vụ/điểm lấy trước `estimate_move`. Nếu hãng
từ chối nội dung báo giá, `REQUEST_REJECTION_CODES` chuyển lý do cho vòng
LLM để hỏi lại/thử gói phù hợp chưa thử; lỗi mạng/cấu hình không được coi là
địa điểm không hỗ trợ. Chưa chạy thêm báo giá thật để kiểm tra địa điểm trong ảnh.

### Bằng chứng độ trễ Moving

Đọc SQLite runtime và lịch sử gateway bằng kết nối read-only; không sửa data.
Đối chiếu `request_id` trong `execution` của kết quả với usage của đúng lượt:

| Lượt | Chờ từ gửi đến phản hồi gateway | Riêng subagent Moving | LLM Intake/Planner | LLM Moving | Tool provider |
| --- | --- | --- | --- | --- | --- |
| `a677f4585cce414fb3df4e29eea7e564` (05/10) | 18,947 s | 12,641 s | 2 | 4 | 2 |
| `efd96e5a160f44c794ce53bf2ff1fff9` (04/10) | 18,874 s | khoảng 11,656 s | 2 | 4 | 2 |

Trace của hai lượt: `resolve_move_route → list_moving_services → estimate_move → finish`.
Mỗi bước cần một `responses.create` riêng, kể cả bước chỉ còn đúng một tool
hợp lệ; các lượt LLM chạy tuần tự. Tổng là **6 lượt LLM**, khác với gọi thẳng
API báo giá. Chọn 2–3 gói có thể thêm lượt provider; đọc chi tiết và xử lý từ
chối có thể thêm quyết định LLM. Cache Moving hiện chỉ trong một invocation.

Khoảng thời gian subagent gồm cả LLM, MCP và hãng. Usage hiện không ghi thời
gian từng request LLM/provider, nên chưa thể kết luận bao nhiêu phần trăm do
LLM. Chênh khoảng 6–7 giây ngoài subagent cũng gồm Intake/Planner và xử lý
graph/gateway, không được gọi toàn bộ là thời gian LLM.

### Bằng chứng và giới hạn Flight

Runtime hiện **không có usage subagent Flight**, nên chưa có số giây end-to-end
của Flight thật để so với API SerpApi. Wiring hiện bọc `FlightSubagent` bằng
`ReadLlmAgent`: luồng ngắn thường cần `search_flights → finish` (2 lượt LLM
subagent) cùng Intake/Planner (thường 2 lượt). Resolve sân bay, đọc offer và
đánh giá thêm có thể tăng số lượt. Đây là phân tích code, không phải số đo
của một lượt Flight thật.

Cấu hình local là `FLIGHT_MCP_STDIO=true`, không có URL HTTP Flight.
`McpToolClient.call()` mở session mới, khởi động process và initialize cho
**mỗi tool**, kể cả `search_airports` chỉ tra JSON catalog. Đo riêng ba lần
HAN/SGN/HAN, không LLM/SerpApi và không ghi database:

| Tra sân bay | Hàm catalog trong process | Qua MCP stdio hiện tại |
| --- | --- | --- |
| HAN lần 1 | 0,74 ms | 958,59 ms |
| SGN | 0,42 ms | 1.060,83 ms |
| HAN lần 2 | 0,47 ms | 1.022,08 ms |

Các mã trả về giống nhau. Tra hai sân bay rồi tìm chuyến theo adapter là ba
lần mở process; thời gian mạng tìm chuyến cộng riêng. SerpApi có SQLite cache
response (TTL mặc định 3.600 giây), nên chỉ so tốc độ API với cùng request và
cùng trạng thái cache. `get_offer` đọc cache local, không gọi SerpApi lại.

Gateway đợi graph hoàn thành và refresh state trước trả snapshot; kết quả
cuối không được stream dần. Điều này ảnh hưởng cảm nhận chờ, không chứng minh
render map là nguyên nhân chậm.

### Hướng tối ưu đề xuất, chưa triển khai

1. Ghi timing từng lần LLM/tool, cache hit và retry với metadata an toàn;
   không ghi contact, token hay raw provider payload. Có số đo rồi mới đặt mục tiêu.
2. Moving: thực hiện bằng code các bước chỉ có một lựa chọn hợp lệ (chuẩn bị
   tuyến đã xác nhận, lấy catalog); giữ LLM cho yêu cầu tự nhiên, so sánh xe và
   giải thích từ chối. Khi form đã đủ trường, giảm số quyết định LLM lặp.
3. Flight: duy trì process/session MCP hoặc dùng server HTTP chạy sẵn để giảm
   khởi động; có thể tra hai sân bay độc lập song song, vẫn hỏi nếu mơ hồ.
4. Tránh resolve/read offer lặp đã có kết quả và báo tiến trình sớm ở UI.
   Không cache giá AhaMove vô thời hạn, không bỏ bước xác nhận/tính lại giá.

Lượt này chỉ sửa lỗi frontend B và kiểm tra Moving/Flight; **chưa thay luồng
Agent để tối ưu**, không thêm request LLM/SerpApi/AhaMove có phí, không đặt
đơn/thanh toán, không sửa `.env` hoặc data.

Kiểm tra cuối lượt: đã build frontend mới, nhưng các cổng API/UI 8000/8503
và service local 4100/4200/4300/4400 không đang lắng nghe. Các ca trình duyệt
nêu trên dùng mock API trên Vite test, không chứng minh stack live đang hoạt
động. Cần khởi động stack trước khi thử lại hội thoại thật.

## Rà frontend tiếp theo: đã khởi động lại hệ thống

Theo yêu cầu mới, chỉ sửa React/CSS/test/docs; giữ nguyên backend, schema,
LLM/tool loop, `.env`, data và quy trình xác nhận. Đã khởi động lại các service
local và chín container OSRM hiện có; không restore/migrate/reimport data.

Các lỗi frontend đã xử lý:

- Mô tả kiện hàng bị xóa hoặc chỉ nhập khoảng trắng được bỏ khỏi JSON, tránh
  vi phạm `MovingPackage.description.min_length=1` dù đây là trường tùy chọn.
- Form Flight trim nơi đi/đến, chặn chuỗi trống và cặp giống nhau khi bỏ khác
  biệt chữ hoa/thường. Không tự resolve alias hay thay tuyến người dùng.
- Hook `Frontend/src/priceExpiry.ts` tự cập nhật UI khi giá hết hạn. Dùng chung
  trong workspace Moving/Flight, thẻ báo giá chat và dialog Flight; nút chọn
  khóa, nhãn hết hạn rõ và handler kiểm lại thời điểm trước gửi action.
- Danh mục Moving rỗng có thông báo/tải lại, không tự gọi báo giá hay suy rằng
  hãng chắc chắn không hỗ trợ khu vực. Lỗi API giữ nguyên tuyến/lịch/kiện/tùy chọn.
- Header Flight mobile dùng hai hàng, để nút quay về không ép tên hai nơi xuống
  nhiều dòng. Kiểm tra không tràn ngang, thu gọn form/chat và đóng/mở chi tiết.

Kiểm chứng:

| Kiểm tra | Kết quả |
| --- | --- |
| Trọn bộ browser tại 78 ca | **78/78 qua**, desktop/mobile |
| Sau thêm expiry ở thẻ chat/dialog | **16/16** ca liên quan qua |
| Sau sửa header Flight mobile | **2/2** qua, tên tuyến mẫu hiển thị một dòng |
| Gateway/UI contract Python | **6/6 qua**, TEMP test trong `logs/local/` |
| JSON Moving capture từ browser | **4/4** qua `ChatRequest.model_validate` |
| TypeScript/Vite | Build qua, 8503 phục vụ đúng JS/CSS mới |
| Visual build thực | Xem ảnh desktop/mobile; không page error/tràn ngang ở màn khảo sát, basemap công khai có tile PBF tải thành công |
| OSRM driving đúng cổng 5000/5001/5002 | HCM 47 điểm tuyến/1.748,3m; Hà Nội 120/3.959,5m; Đà Nẵng 41/1.193,6m; snap radius 100m |
| Health stack local | 8000, 8503, 4100, 4200, 4300, 4400 đều **200** |

Suite browser hiện có **82 ca**; không ghi rằng đã chạy lại cả 82 cùng một
lượt. Browser/visual smoke dùng fixture dịch vụ, basemap public thật; không
gọi thêm LLM, tìm SerpApi hoặc báo giá AhaMove có phí. Các ca không chứng minh
booking/payment end-to-end; không tạo đơn hay thanh toán. Helper/ảnh cục bộ ở
`logs/local/`, không thêm vào data bàn giao.

Ứng dụng hiện chạy tại **http://127.0.0.1:8503/ai**. Tải lại trang trước khi
test để dùng bundle mới; lịch sử/dữ liệu người dùng được giữ nguyên.
