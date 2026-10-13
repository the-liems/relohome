# Chế độ bản đồ cho tìm nhà — 01/10/2026

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Phạm vi: MVP local (WSL), dữ liệu snapshot `Leader-LifeFlow-Updateable-2026-09-29`; thay đổi chưa commit
trên checkout `QuangDung@41d9511`. Chỉ đọc, tìm kiếm và báo giá; không tạo đơn hay thanh toán.
Phương án do chủ task chốt ngày 01/10; nguyên tắc chung: luật lấy từ dữ liệu/manifest hoặc kênh có cấu
trúc được code kiểm, không gắn cứng tên địa danh hay cụm từ.

## 1. Hành vi

- Lượt chat trả kết quả Housing thì trang chuyển sang **chế độ bản đồ**: danh sách bên trái, bản đồ ở giữa
  với thanh lọc, panel chi tiết trượt từ phải, khung chat nằm dưới bản đồ. Nút **Về hội thoại** quay lại
  dạng chat; **Mở bản đồ nhà ở** mở lại. Mobile: bản đồ toàn màn hình, danh sách là bottom sheet.
- **Danh sách theo vùng bản đồ**, mỗi lần kéo/zoom (debounce 350 ms, huỷ request cũ):
  1. `POST /v1/housing/map` (cùng bộ lọc) để đếm số căn trong vùng: tổng `cluster.count` + marker;
     phản hồi `truncated` nghĩa là vượt ngưỡng.
  2. Zoom < 13 hoặc hơn 500 căn → danh sách ghi số căn và mời phóng to; bản đồ hiện cụm có số.
  3. Ngược lại → `POST /v1/housing/search` với `bounding_box`, bộ lọc, sort; **10 căn mỗi trang**,
     "Xem thêm" theo cursor.
  Ngưỡng nằm trong [`mapWorkspace.ts`](../../Frontend/src/mapWorkspace.ts) (`MAP_WORKSPACE`).
- **Sort** do người dùng chọn: mới đăng (mặc định), giá thấp/cao, diện tích, mới xác minh.
- **Căn trùng toạ độ** (tin chỉ có vị trí gần đúng) hiện một marker "n căn"; bấm vào thì danh sách lọc theo
  điểm đó. Danh sách luôn liệt kê **từng căn** với địa chỉ (số nhà, đường, phường, quận khi nguồn có), nhãn
  "Vị trí gần đúng" và link **Chỉ đường** theo toạ độ nguồn. Panel chi tiết ghi toạ độ và độ chính xác;
  vị trí gần đúng thì nhắc xác nhận số nhà với người cho thuê.
- **Chat điều khiển bản đồ**: kết quả Housing có `map_context.viewport`; client `fitBounds` tới đó và áp
  bộ lọc của câu chat (từ `search_request`) thành chip. Khung chat luôn gửi `map_view` (bbox + zoom).
- **"Khu này"**: Intake dùng tham chiếu `near='current:map_view'`; node thay bằng `bounding_box` API đã
  kiểm, bỏ quận/địa danh cũ; nêu khu vực mới thì bỏ khung cũ. Planner gắn `bounding_box` bằng code.
- **Chọn ứng viên địa điểm**: câu hỏi "khớp nhiều nơi" có `Question.choices` (ID, nhãn, loại, toạ độ từ
  Location). Chế độ bản đồ hiện pin tím; chat thường hiện nút. Bấm chọn gửi `place_choice {field, place_id}`;
  API đọc lại `get_place` (ID giả → 422), node gắn `<field>_place_id`, Location dùng đúng ID đó.
- Lưu căn xem trên bản đồ (chưa nằm trong kết quả chat): gateway chụp bản ghi từ Location, không nhận dữ
  liệu client. "Chọn căn này" vào kế hoạch chỉ với căn thuộc kết quả chat; căn khác có "Hỏi AI về căn này".

## 2. Vì sao ngưỡng theo số lượng, không theo zoom

Đo trên dữ liệu thật, khung 1100×800 px:

| Khu vực | z13 | z14 | z15 | z16 |
|---|---|---|---|---|
| HCM Quận 1 | 23.627 | 8.926 | 2.148 | 319 |
| HCM Bình Chánh | 2.614 | 374 | 47 | 29 |
| Hà Nội Hà Đông | 3.566 | 978 | 196 | 64 |
| Đà Nẵng Hải Châu | 2.997 | 2.033 | 428 | 52 |

Mật độ chênh ~10 lần; Quận 1 ở z16 vẫn 319 căn nhưng chỉ 87 điểm (một điểm chồng 42 căn, 53% tin có vị trí
gần đúng). Không zoom cố định nào cho ~10 căn, nên dùng ngưỡng số lượng + trang 10 căn.

## 3. Sửa kèm theo

| Vấn đề | Sửa |
|---|---|
| POI trùng gần nhau làm route hỏi lại ("Cầu Rồng" hai trạm cách 82 m, "Chợ Hàn" way + area cách 35 m) | `pick_place`: các ứng viên khớp chính xác mà mọi cặp cách ≤ 150 m là một điểm đến, chọn bản ghi có hình học đầy đủ nhất (area > way > node theo phần tử OSM nguồn). Chỉ cho Map/Housing; điểm lấy/giao Moving vẫn hỏi lại. **Tin nhà không bao giờ bị gom** |
| `ReadLlmAgent.finish` trả thứ tự thiếu ID làm Housing thất bại dù đã có dữ liệu | Danh sách thiếu là ưu tiên đặt đầu; ID còn lại giữ thứ tự provider; vẫn không thêm ID lạ |
| "Hà Đông" ra 0 căn: tin lưu "Quận Hà Đông" (tên cũ), polygon mới là "Phường/Xã Hà Đông" | Location so khớp quận theo địa chỉ bỏ tiền tố loại đơn vị (Quận/Huyện/Thị xã/Thành phố) ở cả hai vế; tên vẫn phải khớp đủ ([housing-service.ts](../../Maps%20VN/LifeFlow/packages/housing-query/src/housing-service.ts)). `viewport` của quận bao cả polygon và các căn trả về |

## 4. Contract thay đổi

- `ChatRequest.map_view {bounding_box, zoom}` (bbox hợp lệ, rộng tối đa 3°), `ChatRequest.place_choice
  {field ∈ near|route_from|route_to, place_id}`; gateway `Turn` chuyển tiếp hai field.
- `Question.choices: LocationChoice[]`.
- Manifest: Housing nhận `bounding_box`, `near_place_id`; Map nhận `near_place_id`, `route_from_place_id`,
  `route_to_place_id`; output Housing `map_context.viewport`.
- Không thêm MCP tool; dùng `search_areas`, `resolve_location`, `get_place`, `search_housing` sẵn có và
  Platform API `/v1/housing/map`, `/v1/housing/search` qua gateway.

## 5. Kiểm chứng

| Bộ | Kết quả |
|---|---|
| Unit `tests/test_agents/test_map_workspace.py` | 7 passed: gom POI, ứng viên có cấu trúc, bbox, kiểm `map_view`/`place_choice`, Planner gắn giá trị tin cậy, xếp hạng thiếu ID |
| housing-query (PostGIS local, fixture rollback) | 38 passed, gồm ca quận có/không tiền tố và tên khác không khớp |
| Playwright desktop + mobile (Chromium kèm Playwright) | 18 passed, gồm ca mới: mở chế độ bản đồ, địa chỉ + link chỉ đường từng căn, bộ lọc chat vào request danh sách, sort, trang 10, chat gửi `map_view` |
| Live API | "dưới 10 triệu ở Hà Đông" → bay tới Hà Đông, 5 căn ≤ 10 triệu; "khu này" dùng đúng bbox; "Cầu Rồng → Chợ Hàn" ra tuyến 1,94 km; ứng viên mơ hồ → chọn bằng ID; ID giả → 422 |
| Live regression toàn bộ 7 file (28 ca) | 24 passed, 2 skipped (Payment cần giao dịch có sẵn), 2 failed lượt đầu: AhaMove staging `PROVIDER_UNAVAILABLE` và Intake `LLM_NO_RESULT`; chạy lại riêng hai ca: 2 passed |
| Offline rộng | Vẫn đúng 22 lỗi cũ có sẵn (xem `Frontend/SERVICE_AUDIT.md`), không lỗi mới |

## 6. Giới hạn

- Danh sách vùng bản đồ là dữ liệu Location đọc trực tiếp, không qua LLM; chỉ căn thuộc kết quả chat mới
  "chọn vào kế hoạch" được. Bộ lọc commute không áp dụng cho vùng bản đồ.
- Tin có vị trí gần đúng vẫn gần đúng: link chỉ đường dẫn tới toạ độ nguồn, không phải cổng nhà.
- Giá parse sai trong snapshot (ví dụ tiêu đề "5.5TR" lưu 500.000đ) vẫn còn; sort mặc định "mới đăng".
- Chưa stream; khung chat chờ cả lượt. Bản đồ mobile cuộn ngang thanh lọc.

## 7. Cập nhật chiều 01/10: chọn từ bản đồ, giao diện, workspace dịch vụ khác

| Yêu cầu | Đã làm |
|---|---|
| Bấm một căn trong danh sách bản đồ thì AI hiểu là đã chọn căn đó | Mọi căn (kể cả căn chỉ thấy trên bản đồ, chưa có trong kết quả chat) có nút **Chọn căn này**. `/ui/chat/{id}/action` đọc lại tin bằng `get_housing`, thêm vào kết quả Housing (đánh dấu `origin: map_workspace`, có quote) rồi ghi `selected:property`; ID không đọc được → 409. Phản hồi kèm gợi ý bước tiếp theo từ `next_step_suggestions` (cùng luật với câu trả lời chat) |
| Bản đồ đẹp hơn, ít nhất như map-app | Chuyển phần hiển thị của map-app sang [`mapStyle.ts`](../../Frontend/src/mapStyle.ts): pill giá (thường/hover/đã chọn), icon tiện ích theo nhóm, cụm theo màu, basemap tinh chỉnh. Pill thường nhường chỗ khi chồng nhau, pill hover/đã chọn luôn hiện. Bộ đếm "N chỗ ở · M tiện ích", lớp **Tiện ích** (`/v1/places/map` theo vùng, từ zoom 14), panel chi tiết có ô diện tích/phòng ngủ/phòng tắm, tiện nghi, "Tiện ích xung quanh", Chỉ đường / Chọn căn này / Xem tin gốc; card giá gọn "8,1 tr/tháng" |
| Chốt nhà xong thì ẩn bản đồ, về khung chat | Chọn thành công → workspace đóng, chat hiện "Đã chọn: …" + "Chuyển đồ tới đây"; nút "Mở bản đồ nhà ở" mở lại. Căn chọn từ bản đồ vẫn hiện tên sau khi tải lại (lấy từ `cost_summary`) |
| Khung chat ẩn/hiện khi xem bản đồ | Nút **Ẩn chat**; khi ẩn còn nút nổi "Chat với SIU" |
| UI riêng cho dịch vụ khác | [`ServiceWorkspaces.tsx`](../../Frontend/src/components/ServiceWorkspaces.tsx): **Chuyến bay** (sắp xếp giá/giờ đi/thời gian bay/điểm dừng, lọc hãng, xem hành trình, Chọn chuyến này; giờ theo giờ địa phương sân bay từ offset của provider) và **Chuyển đồ** (bản đồ điểm A/B, phương án AhaMove, chi phí chi tiết, Chọn phương án; không mở khi kết quả đã là đơn hàng). Chọn xong cũng về chat. Thanh toán giữ card trạng thái trong chat |

Sửa thêm: khung nhìn quận chỉ dùng kết quả `search_areas` khớp tên (bỏ fuzzy). Snapshot không có polygon "Quận 3" nên trước đó bản đồ bay nhầm sang một xã ở Đồng Nai; giờ dùng vùng bao các căn trả về. Chip thành phố hiện tên vùng thay cho ID.

Kiểm chứng đợt này: Playwright **24/24** (thêm chọn căn từ danh sách → về chat, ẩn/hiện chat, workspace chuyến bay, workspace chuyển đồ; desktop + mobile); unit `test_map_workspace.py` 8 passed (thêm ca quận chỉ khớp fuzzy); `Frontend/tests` thêm ca chọn căn từ bản đồ chỉ qua bản ghi provider; offline rộng vẫn 22 lỗi cũ. Chạy thật trên stack local: Quận 3 → bản đồ đúng khu, 170 căn trong vùng, 226 tiện ích ở zoom 15.5; chọn căn → về chat với gợi ý; tìm chuyến HAN → SGN mở workspace chuyến bay.

## 8. Cập nhật 01/10: chat theo ngữ cảnh, khoanh vùng khi mơ hồ, gợi ý sau khi chọn

Phản hồi: khung chat liệt kê sẵn các căn và gợi ý dịch vụ khác trong khi danh sách bên trái chỉ mời
phóng to; gợi ý xuất hiện khi chưa có căn nào được chọn.

| Thay đổi | Cách làm (không gắn cứng câu hay địa danh) |
|---|---|
| Câu mơ hồ → khoanh vùng; câu cụ thể → danh sách | Phân biệt theo **số căn khớp** trong vùng: ≤ 50 (`specificMax`) thì liệt kê ngay ở mọi mức zoom; nhiều hơn thì bản đồ khoanh vùng, mời phóng to hoặc nói thêm tiêu chí (zoom ≥ 13 và ≤ 500 căn vẫn liệt kê) |
| Chat không lặp lại kết quả | Khi câu trả lời cuối chính là kết quả workspace đang hiện, khung chat tóm tắt đúng trạng thái bản đồ/danh sách (khu vực, số căn, việc cần làm tiếp). Áp dụng cả workspace chuyến bay và chuyển đồ |
| Gợi ý dịch vụ khác chỉ sau khi chốt căn | Luật `quote:relocation` và `search:flight` trong `suggestions.py` yêu cầu đã có `selected:property` (đúng với câu chữ "tới phòng mình chọn"). Chọn căn → về chat kèm gợi ý → người dùng chọn dịch vụ → UI của dịch vụ đó mở khi có kết quả |
| "Tìm ở Cầu Giấy" bị lẫn "gần Bách Khoa" của lượt trước (bản đồ về Bạch Mai) | Hai nguồn: gộp dữ kiện qua lượt và tự điền từ bộ nhớ. Node `intake`: phạm vi mới thay phạm vi cũ (`SEARCH_SCOPE_KEYS`, `SCOPE_DEPENDENTS`). Bộ nhớ: `PREFILL_ANCHORS["near"] = (city, district)` |
| Ô giá không hiện mức của câu chat; "Chỉ đường" bị cắt | Ô giá thêm đúng mức từ chat; link chỉ đường thành nút icon có nhãn |

Kiểm chứng: unit thêm ca phạm vi mới thay phạm vi cũ qua graph; test gợi ý cập nhật (chưa chọn → không gợi ý,
chọn → có `quote:relocation`, từ chối → không); offline vẫn 22 lỗi cũ; Playwright 24/24. Chạy thật: "Mình muốn
tìm căn ở Cầu Giấy Hà Nội" → bản đồ khoanh Cầu Giấy, 500+ căn, chat mời phóng to/bổ sung tiêu chí, không gợi ý;
"dưới 6 triệu, 1 phòng ngủ" → 52 căn hiện ngay; chọn căn → về chat với "Báo giá chuyển đồ", "Xem tiện ích quanh phòng".

## 9. Cập nhật 01/10: luồng chuyển đồ (AhaMove) mượt hơn

Phản hồi: hỏi báo giá chuyển đồ ngày 10/10 chỉ nhận lỗi chung; câu hỏi chọn điểm còn nhắc mục Streamlit cũ.

| Vấn đề | Nguyên nhân | Cách làm (không gắn cứng, vẫn gọi AhaMove thật) |
|---|---|---|
| Báo giá thất bại không rõ lý do | AhaMove staging trả lý do từng dịch vụ (ví dụ `INVALID_FUTURE_ORDER_TIME`: thời gian đặt không quá 7 ngày), mapper bỏ qua và chỉ báo "không có phương án" | `splitQuoteOptions()` tách phương án có giá và phương án bị từ chối, làm sạch chuỗi lý do. Không còn phương án nào → lỗi `PROVIDER_REJECTED` "AhaMove từ chối báo giá: <lý do> (<mã>)"; còn ít nhất một phương án → lý do của phần bị từ chối thành cảnh báo |
| Agent dừng hẳn khi provider từ chối | `MovingLlmAgent` coi mọi `ToolCallError` là lỗi task | Lỗi do yêu cầu (`REQUEST_REJECTION_CODES`: `PROVIDER_REJECTED`, `VALIDATION_ERROR`, `PROVIDER_NOT_FOUND`, `PROVIDER_CONFLICT`, `QUOTE_EXPIRED`, không retryable, không phải lỗi transport) được trả lại cho LLM dưới dạng `provider_rejected`. Sau đó chỉ còn `ask_user` (hỏi đúng field, nói lý do của provider) và `estimate_move` nếu còn dịch vụ trong catalog chưa thử. Lỗi hạ tầng vẫn làm task thất bại như cũ |
| Chỉ một phương án, tên xe là mã | Prompt không yêu cầu so sánh; `vehicle` lấy mã dịch vụ | Prompt yêu cầu 2–3 dịch vụ phù hợp khác nhau; `vehicle` lấy `name` trong catalog AhaMove khi provider không trả tên |
| Câu hỏi chọn điểm nhắc Streamlit, không có lựa chọn | Văn bản cũ từ giao diện Streamlit | Câu hỏi mới "Bạn chọn đúng điểm … trên bản đồ (bấm một gợi ý hoặc chạm vào vị trí)" kèm `choices` là các ứng viên Location thật (ID, toạ độ, địa chỉ) |
| Không có chỗ chọn điểm trên bản đồ trong React | Chưa có workspace | `MovingPinWorkspace` (§10: gộp vào `MovingRequestWorkspace`; [`ServiceWorkspaces.tsx`](../../Frontend/src/components/ServiceWorkspaces.tsx)): mỗi điểm cần xác nhận lấy từ câu hỏi, hiện ứng viên Location, ô tìm, chạm để đặt pin; **Xác nhận điểm và báo giá** gửi `moving_locations` (backend vẫn kiểm như form pin cũ). Có kết quả báo giá → workspace Chuyển đồ (A/B, các phương án, phí chi tiết) |

Kiểm chứng trên AhaMove staging thật (chỉ báo giá, không tạo đơn): 10/10 → agent hỏi lại `move_date` với lý do
"thời gian đặt không được quá một tuần"; đổi sang 3/10 → có báo giá (HAN-BIKE 49.000đ, HAN-ECO 44.000đ). Trình duyệt:
điểm giao mơ hồ → mở workspace chọn điểm với 3 ứng viên Location → chọn, xác nhận → 3 báo giá AhaMove (Tiêu chuẩn
500 kg 169.000đ, 750 kg 195.000đ, 1000 kg 222.000đ; 8,51 km) trên bản đồ A→B, chat gợi ý "Đặt xe với báo giá này".
Không dùng fixture giả lập payload AhaMove: `tests/live.staging.test.ts` của moving-service thêm ca gọi staging thật với giờ đặt
10 ngày tới và kiểm tra lý do từ chối được giữ lại (bật bằng `RUN_AHAMOVE_STAGING_INTEGRATION=1` + tuyến `AHAMOVE_TEST_*`).

## 10. Cập nhật 01/10: form chuyển đồ nhận căn đã chọn, mở khi chat về chuyển đồ

Phản hồi: đã chốt phòng nhưng bấm "Chuyển đồ tới đây" thì form chuyển đồ để trống điểm giao; muốn khi chat về
chuyển đồ thì hiện phần nhập/xác nhận thông tin chuyển đồ.

| Vấn đề | Nguyên nhân | Cách làm |
|---|---|---|
| Form không nhận căn đã chọn | Căn chọn trên bản đồ chỉ có trong state của graph (web action thêm vào kết quả Housing), không có trong tin nhắn chat; form chỉ tìm trong tin nhắn nên chỉ biết ID và tên | `GET /chat/{id}/state` trả thêm `selections`: với mỗi fact `selected:<domain>`, bản ghi provider khớp ID trong `task_results` (không lấy từ client). UI lấy địa chỉ, toạ độ, độ chính xác của căn từ đây |
| Câu hỏi chuyển đồ chỉ là chữ trong chat | Chỉ câu hỏi chọn điểm (`from_address`/`to_address` có ứng viên) mới mở bản đồ | `MovingRequestWorkspace` thay modal form cũ và workspace chọn điểm: điểm lấy/giao (gõ địa chỉ, chọn ứng viên Location, tìm, chạm bản đồ), ngày, giờ. Mở khi: câu trả lời mới nhất hỏi một field chuyển đồ (`relocation.*` của intake hoặc field của Moving agent), bấm "Chuyển đồ tới đây", hoặc thẻ "Chuyển đồ". Điền sẵn từ fact người dùng đã nói, `known_request` của Moving và căn đã chọn; câu hỏi của agent hiện ngay tại ô liên quan. Không gửi gì cho tới khi bấm **Xác nhận và lấy báo giá** |
| Ghim cổng căn đã chọn → `PLAN_INVALID ... to_address not grounded` | Pin đã xác nhận ghi `to_address` = địa chỉ pin, còn Planner LLM giữ marker `selected:property` | Planner gắn bằng code: endpoint có toạ độ đã xác nhận thì địa chỉ + toạ độ lấy từ state, kể cả khi model giữ marker. Model vẫn không thể tự đặt địa chỉ khác |

Quy tắc giữ nguyên: đổi địa chỉ thì pin của điểm đó bị bỏ, phải ghim lại; pin là tuỳ chọn (không ghim thì Moving tự
tìm theo địa chỉ, mơ hồ thì hỏi lại kèm ứng viên trong cùng form); kiểm tra ngày giờ ở UI chỉ là "trong tương lai",
giới hạn của AhaMove do provider trả về (§9).

Kiểm chứng: unit `selections` của `/state`, Planner gắn pin thay marker; Playwright 28/28 (thêm: căn chỉ có trong
state điền sẵn điểm giao, không gửi khi thiếu thông tin; câu hỏi chuyển đồ mở form, đổi địa chỉ phải ghim lại);
offline vẫn 22 lỗi cũ. Chạy thật: tìm phòng Cầu Giấy → chọn căn từ danh sách bản đồ → "Chuyển đồ tới đây" hiện
"Phòng đã chọn" + địa chỉ → nhập điểm lấy, ngày, giờ → AhaMove hỏi lại điểm giao (vị trí tin đăng gần đúng) trong
cùng form → bấm vị trí căn → 3 báo giá AhaMove thật (174.000đ / 201.000đ / 229.000đ, 9 km). Chat "Mình muốn thuê xe
chuyển đồ từ ký túc xá Bách khoa sang Cầu Giấy" → form mở, điền sẵn hai điểm, hỏi ngày và giờ tại ô tương ứng.
