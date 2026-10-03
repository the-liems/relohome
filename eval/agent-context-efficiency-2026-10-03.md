# Context efficiency và 3 ca mới — 03/10/2026

## Kết luận

Giữ Intake LLM, Planner LLM và domain LLM. Không dùng keyword router hoặc một
classifier để bỏ Planner. Có giảm token ở các lượt đối chiếu được, và sửa được
các lỗi chọn điểm/multiturn thực. Không đủ mẫu để khẳng định mọi câu đều nhanh
hơn, hoặc mọi luồng sẽ dưới 20 giây.

## Phương pháp và phạm vi

- Baseline là bản working tree ngay trước đợt tối ưu, được Copy-Item vào
  `data/mission-efficiency-before-20261003/src`; không phải commit cũ bắt buộc
  một primary tool. Snapshot giữ cả thay đổi mission-driven đang chưa commit.
- API benchmark riêng, cùng môi trường/key/model và các MCP thật đang chạy;
  mỗi run có runtime SQLite, actor và thread riêng. Không sửa `.env`, UI, deploy
  hay push. Không tạo mock/provider giả, đặt xe, thu tiền hoặc xuất vé.
- Đo wall time của HTTP POST `/chat`, cùng usage thực toàn graph từ SQLite,
  không dùng thời gian pytest thay cho độ trễ người dùng. Token gồm input+output,
  không quy đổi tiền hoặc suy giá cached token qua OpenRouter.
- Một số ca trước tối ưu bị chặn bởi lỗi chọn điểm, nên không có full-flow
  baseline thành công để tính speedup trọn ca. Khi sửa lỗi, tiếp tục thread thật
  thay vì chạy lại bước đã qua. Những lần tiếp tục có lịch sử khác nhau và không
  được coi là paired benchmark sạch. Thời gian provider/LLM có dao động.

## Ba kịch bản mới (đã qua từng bước thực)

### 1. Nhà gần Đại học Xây dựng → chọn điểm/căn → cà phê quanh căn

Yêu cầu: tối đa 8 nhà, dưới 6 triệu/tháng, bán kính 2,5 km quanh Đại học Xây dựng
Hà Nội. Provider trả nhiều cơ sở: chọn ứng viên thật ở Phường Bạch Mai qua
`place_choice`, không tự chọn tọa độ trong code.

- Housing: 8 ID thật; giá và bán kính đúng; giữ viewport, nguồn và dữ liệu đầy
  đủ trong API. Domain `search_housing → finish`, không gọi LLM cho từng trang.
- Chọn căn qua endpoint UI action, hỏi cà phê trong 700 m quanh căn đó.
- Map gắn đúng `selected_listing_id`, category `cafe`, radius 700; kết quả nhà
  giữ nguyên `fetched_at`, không tìm lại Housing.
- PASS: run `after-count-final`; thread
  `th_07e557103dea4dc59f8f7097ca9027bf`.
- Thời gian từng POST cuối: 7,334 s hỏi/chọn địa điểm; 21,538 s tiếp tục sau
  chọn địa điểm; 11,823 s hỏi Map. Tổng xử lý 40,695 s, chưa gồm thời gian người
  dùng chọn trên map. Không tuyên bố cả ca chỉ 7 giây.
- Housing/Map trả `PARTIAL` khi assessment nguồn chưa đủ, không biến dữ liệu
  chưa xác minh thành chắc chắn. Các bước đã hoàn tất nhưng dữ liệu có giới hạn.

### 2. Map quanh Hồ Hoàn Kiếm || Flight Đà Nẵng → Hà Nội

Yêu cầu: bệnh viện trong 1,2 km quanh Hồ Hoàn Kiếm và chuyến bay ngày 17/10/2026
cho một người lớn, chỉ tra cứu. Map có lựa chọn địa điểm thật; Flight đã trả
5 offer SerpApi khi Map còn cần user chọn điểm. Sau chọn điểm, giữ Flight và
chỉ chạy Map.

- PASS: hai task độc lập, không `depends_on` giả; execution timestamps chồng
  nhau thật, không chỉ cùng tầng DAG.
- Map: `09:12:53.412974 → 09:12:55.682325 UTC`.
- Flight: `09:12:53.412974 → 09:13:00.137561 UTC`.
- Sau chọn điểm Map: `find_nearby_places → finish`, không tìm chuyến lại.
- POST đầu 13,300 s; chọn điểm 10,880 s. Tổng xử lý 24,180 s, chưa gồm user
  chọn điểm. Thread `th_d2e8e90f856149f0b64b28b3bcad2239`.

### 3. Từ căn đã chọn → Bảo tàng Dân tộc học → pin → báo giá

Tiếp tục cuộc hội thoại Housing/Map thật, chuyển ngày 07/10/2026 lúc 10:30.
Moving giữ căn đã chọn và ngày giờ; không suy tọa độ từ trí nhớ. Khi điểm giao
chưa rõ, hỏi chọn map. Test đọc `/map/search` thật và xác nhận hai pin bằng
`moving_locations`; không tự coi điểm gần đúng là rooftop.

- PASS sau sửa logic và retry riêng lượt LLM timeout. Run `after-pins-retry`,
  thread `th_e24fcbefca524a8b8a9fa3031a49702b`.
- AhaMove staging trả 3 phương án báo giá thật; `ANSWER`, không confirmation,
  đơn hàng hoặc thanh toán.
- Domain: `resolve_move_route → list_moving_services → estimate_move → finish`.
- POST báo giá cuối: **16,787 s**, 6 LLM calls toàn graph, 21.125 input + 519
  output token, 2 MCP provider calls. Domain riêng khoảng 9,750 s.
- Không đưa 16,787 s làm tổng thời gian từ tìm nhà đến báo giá; đó là một lượt
  sau khi user đã xác nhận điểm. Một lượt trước timeout mất 58,431 s và thất bại.

## Số đo trước/sau đối chiếu được

| POST cùng yêu cầu ban đầu | Trước: giây / token | Sau: giây / token | Token giảm |
| --- | --- | --- | --- |
| Housing, còn cần chọn cơ sở | 22,454 / 16.088 | 7,334 / 10.502 | 34,7% |
| Map + Flight, Map còn cần chọn điểm | 20,070 / 15.268 | 13,300 / 14.100 | 7,6% |

Trong hai lần đo này độ trễ giảm 67,3% và 33,7%. Chỉ một mẫu mỗi biến thể,
không có p50/p95 và không tách được hết ảnh hưởng cache/network/provider.
Không dùng tỷ lệ này làm SLA hay khẳng định nguyên nhân chỉ do giảm token.

Baseline Housing chọn điểm trả `ERROR` (17,493 s / 33.768 token); bản cuối
trả 8 nhà (21,538 s / 16.887 token). Token thấp hơn nhưng thời gian cao hơn
và kết quả khác nhau: đây là sửa chất lượng/logic, không so speedup đồng chất.

Baseline Moving trên bản sao checkpoint Map thật trả `ERROR` sau xác nhận pin
(19,652 s / 63.344 token); bản mới lấy báo giá (16,787 s / 21.644 token).
Lịch sử các lần tiếp tục không hoàn toàn giống nhau, vì vậy không công bố
"giảm 66% cho mọi Moving" từ cặp này.

## Lỗi đã phát hiện và sửa

1. Planner nhận output schema đầy đủ và toàn bộ render/trace các kết quả cũ:
   bỏ output schema khỏi prompt, giữ mọi input schema/capability; projection
   bỏ trường render/trace, giữ dữ kiện, nguồn, giá, unknown, expiry và ID.
2. Domain gửi snapshot search trùng trong lịch sử: thay snapshot bị cập nhật
   bằng marker, vẫn giữ mọi cặp function_call/output và reasoning item.
3. Housing tìm số phương án nhỏ phải suy luận lại khi phân trang: search nhận
   count do LLM chọn trong bound, resolve an toàn và đọc tối đa ba trang trong
   budget; không đổi hard filters, lỗi trang sau giữ dữ liệu trước và báo hạn chế.
4. Chọn place bị mismatch tên chuẩn/label của model: tên/ID API-verified gắn
   cùng nhau; không ground lại như mâu thuẫn bằng free text.
5. Intake chưa nhận `cafe` dù provider/UI đã hỗ trợ: đồng bộ vocabulary loại
   POI với Location `poi-normalization.ts`; không dò phrase theo testcase.
6. Map dùng pin tìm nhà cũ thay căn đã chọn: Map nearby chỉ dùng named anchor
   riêng `map_near`, hoặc ID nhà; không chép Housing `near_place_id` sang Map.
7. Pin Moving bị hỏi lại/hoãn task dù có tọa độ: Intake nhận context pin đã
   kiểm, backend đồng bộ địa chỉ/fact; Planner thấy confirmed bindings và
   không được defer endpoint đã có tọa độ hợp lệ. Giữ gate chống pin cũ khi
   user thật sự thay địa chỉ.
8. Assessment limited của Map optional cũ làm hạ kết quả Moving mới: scope
   assessment theo task mới/required. Không che hạn chế required hoặc lượt chỉ
   tái dùng dữ liệu.

## Kiểm hồi quy không tốn LLM

- 2 PASS: Location tool policy thực + compose từ checkpoint regression cũ.
- 2 PASS: projection trên checkpoint thật giữ dữ kiện/nguồn/freshness, không
  mutate state; Housing batch 8 nhà thật + đọc chi tiết, 3 provider calls,
  0 LLM calls. Đây là regression bổ sung, không được tính thêm thành ca mới.
- Ruff agents + tests mới, compile Python, `git diff --check`: PASS.

## Usage toàn đợt này

SQLite ghi **23 POST trả phí có usage, 99 LLM calls, 471.525 input + 15.388
output = 486.913 token**, 34 provider calls. Gồm baseline, các bản đang sửa,
lượt thất bại, timeout và retry. Không phải chi phí của chỉ ba lượt thành công.
Không đếm trùng usage được sao chép từ checkpoint seed sang baseline runtime;
đếm đủ các placeholder usage rows đại diện lượt repair của graph.

Các lỗi test harness (chọn lại căn đã chọn, resume nhầm câu hỏi Moving để chọn
Housing) được sửa mà không cần LLM. Không che các lần lỗi ứng dụng/provider.
Đã dừng paid tests sau khi ba kịch bản qua; không chạy lại ca full đã qua chỉ
để tạo bảng đẹp hơn. File log/snapshot/runtime chứa dữ liệu local ở `data/`
được gitignore. Không push/deploy trong đợt này.

## Tài liệu API dùng khi sửa

[OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
được dùng để giữ giao thức lời gọi/kết quả khi thu gọn history.
[Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)
phân biệt giảm token, giảm lượt nối tiếp và độ trễ; bản này không thêm LLM
classifier/summary, không đổi model hoặc hứa caching giống nhau qua gateway.
