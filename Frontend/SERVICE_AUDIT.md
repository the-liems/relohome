# Kiểm tra frontend và từng tool dịch vụ

Ngày kiểm tra: **01/10/2026**. Phạm vi: source code service, schema đầu vào/đầu ra, adapter/graph, gateway và React. Không gọi LLM, không tạo đơn AhaMove, không tạo thanh toán thật trong đợt kiểm tra này.

## Kết luận hiện tại

**Frontend đáp ứng luồng MVP chính, chưa bao phủ mọi tool của service. Chưa thể kết luận chỉ cần gắn LLM là toàn bộ hệ thống chạy được.**

- Housing/Location: database có sẵn `lifeflow` tại 5433; đã xác minh 38.222 tin ở lượt trước. Đợt này gọi trực tiếp cả 9 tool đọc Location thành công.
- Routing: đã khởi động lại container có sẵn. 9 endpoint OSRM của 3 thành phố × 3 phương tiện phản hồi `Ok`; đã thử hai tool tính đường qua MCP với tọa độ tại HCM. Kiểm tra `nearest` ở các thành phố còn lại không thay thế kiểm thử mọi tuyến đường.
- AhaMove: form Thông tin chuyển đồ, card báo giá, lựa chọn, chi tiết phí, phê duyệt, biên nhận, giá/link theo dõi đã có. (01/10) **Đã báo giá thật trên AhaMove staging** qua Moving MCP (chỉ báo giá, không tạo đơn); lý do từ chối của provider (ví dụ đặt quá 7 ngày) được hỏi lại người dùng. Đặt/hủy đơn thật chưa kiểm chứng.
- Flight: form và card/chọn offer đã có; cần `FLIGHT_SERPAPI_API_KEY` để tìm thật. Xuất vé không được bật vì backend hiện chỉ có booking giả lập.
- Payment: có renderer trạng thái, link/QR workflow, kiểm tra thanh toán và biên nhận. Chưa có form tạo ZaloPay sandbox độc lập trong React; chưa có giao diện refund. Máy chưa có key ZaloPay.
- LLM: giao diện gửi hội thoại/form tới graph hiện tại. **Form tìm kiếm chuyển thành yêu cầu chat, vẫn cần Intake/Planner/subagent LLM để xử lý đầy đủ.** Fixture chỉ nằm trong test; app không thay dịch vụ lỗi bằng dữ liệu giả.

## Trang và tương tác người dùng

| Trang / màn hình | Có gì | Giới hạn |
| --- | --- | --- |
| Đăng nhập / đăng ký | Session HttpOnly; tài khoản lưu SQLite | Chưa có xác minh email, quên mật khẩu, SSO |
| `/ai` | Chào người dùng, 4 nhóm tác vụ, form, gợi ý, áp dụng sở thích | Tác vụ cần LLM; danh sách domain đăng ký chưa chứng minh provider đang khỏe |
| `/ai/:threadId` | Chat, hỏi bổ sung, kết quả dịch vụ, lịch sử, lựa chọn, chi phí, phê duyệt, biên nhận | Chờ theo lượt; chưa stream token/tool progress |
| Chi tiết nhà | Dialog có URL theo hội thoại/kết quả; ảnh, giá, nguồn, lưu/chọn/hỏi AI | Dữ liệu thiếu hiển thị chưa có; không tự nhận là tin còn trống |
| So sánh nhà | Tối đa 3 căn từ kết quả đã tải | Không so sánh toàn bộ DB |
| Bản đồ trong chat / mở rộng | Điểm nhà, cluster, POI, route, cảnh báo độ chính xác, mobile list/map | Khám phá viewport không áp dụng commute/bán kính; tin ngoài kết quả chưa chọn vào graph trực tiếp |
| Chuyển đồ | Điểm lấy/giao, pin phải xác nhận lại khi sửa, ngày/giờ, báo giá, phí, yêu cầu đặt/sửa/hủy qua chat | Chưa có form mọi special request/COD, danh sách đơn hàng riêng, lịch sử sự kiện chi tiết |
| Phê duyệt | Chi phí, thao tác, thời hạn, form liên hệ riêng, xác nhận/đổi/từ chối | Chỉ chấp nhận các thao tác Moving UI hỗ trợ; chưa có giao diện operator đối soát giao dịch bất định |
| Thanh toán workflow | Link provider, QR sinh tại máy chủ, kiểm tra trạng thái; link hết hạn bị khóa | Không tự coi callback/lời người dùng là đã trả tiền; chưa có trang tạo demo độc lập/refund |
| `/plans`, `/plans/:planId` | Danh sách, trạng thái task graph, chi phí tháng/một lần, biên nhận, trở về chat | Trạng thái tìm kiếm không phải tiến độ chuyển nhà ngoài đời; không có lịch/reminder riêng |
| `/account` | Tên, sở thích, nhà đã lưu, đăng xuất | Sở thích không tự áp dụng thay cho yêu cầu mới |

Theo thiết kế, Map/AhaMove/Flight xuất hiện trong hội thoại và dialog; sidebar giữ **Hệ thống AI – Kế hoạch – Tài khoản**, không tạo một menu riêng cho mỗi service.

## Đối chiếu 34 tool

**Có UI** = đã có đường tương tác/render phù hợp; không đồng nghĩa provider đã chạy thật. **Qua graph** = user yêu cầu bằng chat/form, LLM và code graph quyết định tool. **Một phần / chưa nối** = không nên quảng bá là tính năng hoàn chỉnh.

### Location / Housing / Map — 9 tool

Nguồn: `Maps VN/LifeFlow/mcp-server/src/tools/{location,housing,place,routing}-tools.ts`; schema trong `packages/contracts/src/`.

| Tool | Hợp đồng cần giữ | Đường tới frontend / mức đáp ứng |
| --- | --- | --- |
| `search_areas` | Tìm địa giới, trả ID/parent/center/bbox; không phải POI | Qua adapter tìm nhà. Form có thành phố/quận; chưa có picker địa giới chuyên biệt. **Một phần** |
| `resolve_location` | Có thể nhiều ứng viên; dùng ID/vị trí đã chọn, không tự lấy đầu | Picker địa điểm và graph. UI phân biệt khu hành chính, không cho dùng tâm quận như điểm dừng xe. Ứng viên mơ hồ trả `choices` (ID + toạ độ) để chọn bằng pin/nút; POI trùng trong 150 m gom làm một điểm đến cho Map/Housing (01/10). **Có UI** |
| `search_housing` | Bộ lọc cứng, cursor, nguồn, đơn vị tiền/chu kỳ; không tự xếp hạng | Card/list/map, phân trang, so sánh, empty/error; form các tiêu chí chính. Chế độ bản đồ gọi search theo `bounding_box` vùng đang xem, 10 căn/trang, sort chọn được (01/10). Commute/nearby/availability/nhiều filter nâng cao chủ yếu qua chat. **Có UI** |
| `get_housing` | Chính xác `listing_id` từ nguồn | Dialog gọi gateway → MCP; lưu/chọn giữ nguồn task/version. Chọn căn từ bản đồ: backend đọc lại tin bằng tool này trước khi ghi lựa chọn (01/10). **Có UI** |
| `search_places` | Text/category/spatial filter, cursor; không phải tìm nhà | Service chạy được nhưng UI chưa có trình duyệt POI độc lập/phân trang; picker hiện dùng resolve. **Chưa nối đầy đủ** |
| `get_place` | Một `place_id` chuẩn | API dùng để kiểm `place_choice` (ID người dùng chọn) và graph dùng cho `near_place_id`. Chưa có màn hình chi tiết POI riêng. **Một phần** |
| `find_nearby_places` | Điểm đã resolve; gần nhất từng category, khoảng cách đường thẳng | Card POI, map, nút yêu cầu tính đường, nhãn gần đúng. **Có UI qua graph** |
| `calculate_route` | Hai tọa độ; city/profile; trả GeoJSON + mét/giây | Renderer route dùng được; luồng người dùng ưu tiên tool entity bên dưới. **Qua adapter; không có nút gọi raw tool riêng** |
| `calculate_route_between_entities` | Housing/place ID hoặc coordinate; nguồn/độ chính xác/cảnh báo có cấu trúc | Form đường đi/chat → graph; vẽ tuyến và điểm đầu/cuối, km/phút, cảnh báo. **Có UI** |

API `POST /v1/housing/map` phục vụ khám phá viewport là REST bổ sung, không phải một trong 9 MCP tool. UI giữ bộ lọc tương thích, tách cluster khỏi listing, chặn mode khám phá khi filter không hỗ trợ.

### AhaMove / Moving — 13 tool

Nguồn: `Maps VN/LifeFlow/moving-mcp-server/src/create-server.ts`, `packages/contracts/src/moving.ts`, `src/agents/subagents/services/moving_llm.py` và transaction adapter.

| Tool | Hợp đồng cần giữ | Đường tới frontend / mức đáp ứng |
| --- | --- | --- |
| `list_service_areas` | Danh sách thành phố thực tế từ provider | Chat catalog → danh sách khu vực có nút hỏi tiếp. **Có UI qua graph** |
| `list_moving_services` | Theo city/tọa độ, loại dịch vụ; có yêu cầu bổ sung | Graph dùng trước báo giá; danh sách dịch vụ hiển thị tên/mô tả. **Có UI cơ bản** |
| `get_moving_service` | Giới hạn, mô tả, special requests của service ID | Có yêu cầu xem thêm qua chat; chưa có form đầy đủ giới hạn trọng lượng/kích thước và lựa chọn special request. **Một phần** |
| `estimate_move` | Draft điểm lấy/giao, liên hệ, giờ, dịch vụ; quote có hạn và phí chi tiết | Form pin/ngày/giờ, báo giá, chi tiết phí, chọn. Liên hệ báo giá do cấu hình server. **Có UI; chưa thử provider thật** |
| `get_move_order` | ID đơn, trạng thái, phí, tracking; payload đầy đủ có PII | Graph rút gọn trước UI; card dùng `total_price`, `shared_link`. **Có UI trạng thái cơ bản** |
| `get_move_orders` | Tối đa 100 order ID | Tool được service/allowlist hỗ trợ; chưa có flow graph và màn hình quản lý nhiều đơn hoàn chỉnh. Renderer nhận `orders[]` chưa đủ để gọi tính năng hoàn chỉnh. **Chưa nối đầy đủ** |
| `find_move_orders_by_tracking_number` | Tracking đối tác; có thể nhiều đơn và khoảng thời gian | Qua chat; adapter hiện lấy một đơn. **Một phần**, chưa có UI chọn khi nhiều kết quả |
| `get_move_tracking_link` | Trả `shared_link` từ provider | Graph đọc link → nút mở theo dõi. **Có UI** |
| `get_move_order_events` | Lịch sử callback theo tracking number | Moving agent có thể gọi nhưng hiện chỉ ghi nhận đã kiểm tra, không trả timeline đầy đủ. **Chưa có UI lịch sử sự kiện** |
| `create_move_order` | Quote còn hạn + approval do server giữ, cost/hash/version đúng | Yêu cầu đặt qua chat → review → form riêng → xác nhận → biên nhận. **Có UI, write mặc định tắt** |
| `update_move_order` | Approval đúng đơn/thao tác, chỉ sửa trường được provider cho phép | Nút yêu cầu sửa → chat → review/form liên hệ, ghi chú và điểm cần sửa. **Có UI phạm vi liên hệ/ghi chú** |
| `cancel_move_order` | ID/tracking, approval, điều kiện/chi phí hủy | Nút yêu cầu hủy chỉ điền yêu cầu chat; cần phương án phê duyệt riêng. **Có UI qua graph** |
| `rate_move_driver` | Đơn hoàn thành, approval, rating flag | Chưa có commit kind/flow graph/UI đánh giá. **Chưa nối; mặc định tắt** |

Chuyển đồ hiện dùng **CASH**. Chi phí dự kiến là báo giá/ước tính; không thu ZaloPay cho đơn AhaMove để tránh thu trùng. API webhook `/ready` còn yêu cầu DB migration Moving và webhook secret đúng, ngoài API key.

### Flight — 7 tool

Nguồn: `src/mcp_servers/flights/tools.py`, `server.py`, schema, `src/agents/subagents/services/flight.py`.

| Tool | Hợp đồng cần giữ | Đường tới frontend / mức đáp ứng |
| --- | --- | --- |
| `search_airports` | Tên/IATA → sân bay nội địa | Graph chuẩn hóa đầu vào form. **Qua graph**, chưa autocomplete sân bay riêng |
| `search_flights` | Một chiều nội địa, tổng giá cho toàn bộ hành khách, offer có hạn | Form tuyến/ngày/người lớn, card giá/giờ/điểm dừng. **Có UI cơ bản**; chưa có form cabin/trẻ em/khứ hồi đầy đủ |
| `get_offer` | ID đã tìm; service còn kèm fare rules giả lập | Dialog và workspace chuyến bay (01/10) lấy dữ liệu chuyến thật qua gateway; không trình bày fare rules giả lập như điều kiện đã xác minh. **Có UI** |
| `hold_booking` | Giữ chỗ trước xác nhận, PII hành khách | Runtime MVP không quảng bá booking giả lập. **Không bật UI** |
| `confirm_booking` | Xác nhận xuất vé sau đồng ý | Chỉ có engine giả lập, không phải vé thật. **Không bật UI** |
| `get_booking` | Booking ID/PNR | Chưa có flow/UI quản lý vé thật. **Không bật UI** |
| `cancel_booking` | Xem phí trước, xác nhận sau | Chưa có nghiệp vụ vé thật. **Không bật UI** |

### Payment — 5 tool (4 nghiệp vụ + 1 mock)

Nguồn: `src/mcp_servers/payments/tools.py`, `server.py`, engine/gateway và `src/api/sandbox_payments.py`.

| Tool | Hợp đồng cần giữ | Đường tới frontend / mức đáp ứng |
| --- | --- | --- |
| `create_payment` | Mã đơn/khách vô danh, số nguyên VND, idempotency; không gửi PII | Backend có luồng sandbox riêng. React hiện **chưa có form tạo demo riêng**; chỉ render payment interrupt nếu workflow được phép tạo |
| `get_payment` | Kết quả provider mới quyết định PAID; kiểm tra ownership | Card trạng thái qua graph; payment workflow có nút kiểm tra, link/QR. **Có UI**, chưa thử provider thật |
| `cancel_payment` | Provider không hỗ trợ hủy thì giữ chờ/hết hạn | Gateway/backend có endpoint; chưa có review/nút hủy payment riêng trên React. Đã sửa graph không báo CANCELLED khi provider trả PENDING/timeout. **Một phần** |
| `refund_payment` | Preview số tiền với `confirm=false`, rồi người dùng xác nhận | Chưa có endpoint nghiệp vụ/flow graph/UI review refund tương ứng. **Chưa nối** |
| `simulate_payment_result` | Chỉ đăng ký trong mock | **Không đưa vào UI sản phẩm**; dùng trong test |

## Tính tiền và trạng thái đã kiểm tra

- Chi phí tháng và một lần tách riêng. Khoản chưa có số tiền không được biến thành 0 trên card.
- Chọn kết quả có kiểm tra owner, task, plan version, thời điểm fetch và expiry; đổi lựa chọn làm stale kết quả phụ thuộc.
- Tổng dự kiến không cộng lại khoản đã commit. Tiền thực tế hiển thị theo receipt, không suy từ nút chọn.
- Test riêng kiểm chứng 9.000.000 VND/tháng + 250.000 VND một lần; biên độ 5% khi được cấu hình là 262.500 VND, không tự bật biên độ ở runtime.
- Báo giá hết hạn/thiếu thời hạn bị chặn chọn ở các luồng cần expiry. Phê duyệt quá hạn/loại thao tác không hỗ trợ bị chặn.
- Liên hệ gửi riêng qua decision; không chèn vào tin nhắn chat. QR chỉ phục vụ cho user sở hữu hội thoại.
- Provider chưa trả kết quả hủy thanh toán chắc chắn thì tiếp tục chờ; không suy diễn thành hủy thành công.

## Bằng chứng kiểm tra

| Bộ kiểm tra | Kết quả / phạm vi |
| --- | --- |
| Build React/TypeScript | Thành công |
| Playwright desktop 1440×960 + mobile 390×844 | 18 ca (01/10 thêm chế độ bản đồ: danh sách theo vùng, địa chỉ + chỉ đường, bộ lọc chat, sort, `map_view`); 16 ca gốc: auth/navigation, nhà/lưu/chọn/reload/plan, pin, map warning, phí/order AhaMove, approval/PII/receipt, expiry/payment pending, giữ form khi lỗi. Dùng fixture API, không phải giao dịch thật |
| Gateway/graph + payment flow/approval/map/commit adapter | 36 passed; thêm test chi phí, quyền đọc QR và hủy thanh toán chưa chắc chắn |
| Bộ Python rộng hơn `tests/test_agents tests/test_api tests/test_mcp_payments Frontend/tests` | Lượt rà rộng: **153 passed, 17 failed** trước khi thêm 2 test UI-contract. Chưa coi toàn bộ suite sạch; xem nhóm lỗi bên dưới |
| Service local đọc thật | 9 tool Location thành công; platform/database và frontend HTTP 200; 9 OSRM nearest thành công. Không gọi LLM/provider giao dịch |

### Các test cũ còn lệch hợp đồng cần xử lý tiếp

17 lỗi của lượt rà rộng đã được đọc, không bị xóa hoặc skip để làm đẹp kết quả:

- 8 ca `test_api`: fixture khởi tạo theo default cũ/fake hoặc thiếu lifespan service; default hiện là live và yêu cầu gateway authentication nên trả 503. Cần fixture API tách biệt, cấu hình rõ và thêm assertions auth.
- 2 ca Flight MCP/graph: kỳ vọng hold/confirm từ mock trong khi simulation mặc định tắt và Flight adapter từ chối source mock. Cần tách kiểm thử simulation engine và runtime live; không bật booking giả lập trong sản phẩm để chiều test.
- 2 ca Moving: mock geocoder thiếu `get_housing` và metadata độ chính xác sau thay đổi lookup nhà chuẩn.
- 1 ca Moving price band: giả định default 5%; runtime hiện default 0. Test cần truyền cấu hình biên độ rõ ràng.
- 1 ca planner: kỳ vọng phụ thuộc tìm nhà lại dù đã có canonical selected ID; cần đối chiếu semantics lựa chọn đã xác nhận.
- 2 ca Flight adapter: fixture source mock/IATA lookup cũ không khớp read adapter hiện tại.
- 1 ca privacy Payment: allowlist trong test chưa gồm `expire_duration_seconds` mà gateway đã gửi; cần xác minh schema expiry và vẫn giữ assertions không lộ PII.

Đã bổ sung `fixtures/payment.json` còn thiếu để chạy được test graph dùng fake registry. Fixture không được dùng bởi application runtime live.

## Cần gì trước khi chạy end-to-end với user?

1. Giữ `data/integration.env` trỏ database nhà đang có; chạy Location 4300, Platform 4100, API 8000, gateway 8503 và OSRM theo nhu cầu.
2. Gắn LLM vào cấu hình server Intake/Planner/domain agents; chạy lại hội thoại đa lượt và hỏi bổ sung với dữ liệu thật. Đợt audit này chưa đánh giá chất lượng lập kế hoạch của LLM.
3. AhaMove staging: `AHAMOVE_USER_TOKEN` **hoặc** `AHAMOVE_API_KEY` + `AHAMOVE_MOBILE`; thêm `MOVING_QUOTE_CONTACT_NAME`, `MOVING_QUOTE_CONTACT_MOBILE`, cấu hình webhook và database schema Moving. Đây là cấu hình riêng với LLM.
4. Flight thật: `FLIGHT_SERPAPI_API_KEY`. Payment sandbox: `PAYMENT_ZALOPAY_APP_ID`, `PAYMENT_ZALOPAY_KEY1`, `PAYMENT_ZALOPAY_KEY2`. Không đưa key vào React/VITE hoặc commit.
5. Sau khi có credentials, thử đọc/báo giá trước. Đặt/sửa/hủy staging chỉ chạy theo review và xác nhận của người dùng; chưa có bằng chứng provider thật cho các thao tác đó trong đợt này.
6. Xử lý test cũ còn lệch và các tool chưa nối nếu chúng thuộc phạm vi bản phát hành; đừng coi phần UI có renderer là đã có flow nghiệp vụ hoàn chỉnh.

## Chạy lại kiểm tra local không dùng LLM

```powershell
# Từ gốc repo, chỉ gọi tool đọc và health; lưu trạng thái không chứa key vào data/
.venv/Scripts/python.exe Frontend/scripts/check-services.py

.venv/Scripts/python.exe -m pytest Frontend/tests tests/test_agents/test_payment_flow.py tests/test_agents/test_approval.py tests/test_agents/test_map_backend.py tests/test_agents/test_commit_adapter.py -q

cd Frontend
npm run build
npm run test:e2e
```

Script lưu báo cáo runtime tại `data/frontend-service-audit.json` (ignored); kết quả chỉ đúng thời điểm chạy. Không tự tạo đơn, thanh toán, import dữ liệu hay gọi LLM.
