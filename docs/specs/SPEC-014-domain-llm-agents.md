# SPEC-014 — Domain LLM agents trong LangGraph

Status: Draft (implemented local; chờ nhóm review).

Ngày: 2026-09-30. Cập nhật: 2026-10-03. Quyết định hiện hành:
[ADR-021](../adr/ADR-021-mission-driven-domain-tools.md) (thay ADR-020).
Phạm vi: runtime tích hợp local, không deploy. Bổ sung cho ADR-016/018/019;
không thay MCP contract của teammate.

## Hành vi và tiêu chí chấp nhận

| ID | Yêu cầu |
|---|---|
| SPEC-014/AC-01 | Intake/Planner phân task trong một graph; Housing, Map, Flight, Moving, Payment đăng ký capability riêng. `/api/v1/status` công bố implementation và uses_llm thực tế. |
| SPEC-014/AC-02 | Housing/Map/Flight/Payment dùng LLM thật để chọn thao tác trong namespace domain. Không fallback dữ liệu giả. Tối đa 6 LLM calls/invocation và chịu budget chung của graph; không bắt dùng hết budget. |
| SPEC-014/AC-03 | Không có tool đầu do code chọn bắt buộc. LLM chọn preparation/search/details/pagination/ask/finish/replan; tool arguments phải là field/ID/cursor được cấp hoặc đã quan sát. Không sửa hard filters/ngày/giá/tọa độ; adapter giữ normalization và dữ kiện thật. |
| SPEC-014/AC-04 | Housing/Flight chỉ được đọc chi tiết ID đã nhận từ provider; finish không thêm/bớt ID (thứ tự thiếu ID được bổ sung theo thứ tự provider, AC-11). Khi đổi thứ tự, quote và missing_fields vẫn trỏ đúng option. Map/Payment không có thao tác sắp xếp option. |
| SPEC-014/AC-05 | Kết quả giữ nguồn, dữ kiện, agent_trace và usage. Không sinh SQL hoặc thực thi code do LLM viết. Không khẳng định fare rules tĩnh là dữ kiện live. |
| SPEC-014/AC-06 | Payment chỉ tra ID có bản ghi ownership thuộc user được API xác thực. Kiểm tra trước LLM/MCP; không nhận user_id từ tool args. User khác không đọc được giao dịch. |
| SPEC-014/AC-07 | Không tool tạo/thu/hoàn tiền hoặc tự approve trong domain loop. Giao dịch đi qua luồng xác nhận riêng. Không bật xuất vé mô phỏng. Moving CASH không tự ghép ZaloPay. |
| SPEC-014/AC-08 | Giữ luồng selected housing → Map của teammate. Giữ bộ nhớ hội thoại, invalidate tọa độ cũ khi địa chỉ thay đổi, và hỏi lại khi vị trí mơ hồ. |
| SPEC-014/AC-09 | Timeout/provider lỗi trả thất bại có phân loại, không nói đã có kết quả/thanh toán thành công. Đóng LLM clients khi app shutdown. |
| SPEC-014/AC-11 | (01/10) Housing trả `map_context.viewport` từ dữ liệu Location. `map_view` và `place_choice` chỉ đến từ API đã kiểm; Planner gắn `bounding_box`/`*_place_id` bằng code. POI khớp chính xác trong 150 m là một điểm đến cho Map/Housing (không áp dụng Moving). Câu hỏi chọn địa điểm có `choices` với ID và toạ độ thật. `finish` thiếu ID là ưu tiên đặt đầu, không làm task thất bại, vẫn không thêm ID lạ. Căn chọn từ bản đồ chỉ được ghi `selected:property` sau khi backend đọc lại bằng `get_housing`. |
| SPEC-014/AC-10 | (01/10) Field `city` của Housing/Map phân giải bằng cấu trúc kết quả `search_areas` (cấp cao nhất, khớp tên không fuzzy, ranh giới bao các vùng cùng tên), không bằng danh sách tên cố định. "Hà Nội", "Đà Nẵng" không còn bị hỏi lại; khớp chính xác vẫn ưu tiên; vùng rời nhau vẫn hỏi lại. |
| SPEC-014/AC-12 | (01/10) Moving: lỗi do yêu cầu từ provider (`PROVIDER_REJECTED`, `VALIDATION_ERROR`, `PROVIDER_NOT_FOUND`, `PROVIDER_CONFLICT`, `QUOTE_EXPIRED`, không retryable) được đưa lại cho LLM; sau đó chỉ được `ask_user` hoặc thử dịch vụ catalog chưa thử. Lỗi transport/retryable vẫn làm task thất bại. Câu hỏi chọn điểm có `choices` từ ứng viên Location thật. |
| SPEC-014/AC-13 | (01/10) Moving: endpoint có toạ độ người dùng đã xác nhận (`moving_locations`) được Planner gắn bằng code cả địa chỉ lẫn toạ độ, kể cả khi model giữ marker `selected:property`; model không thể thay bằng địa chỉ khác. `/chat/{id}/state` trả `selections` từ `task_results`, không từ client. |
| SPEC-014/AC-14 | Bộ nhớ sở thích Housing chỉ được cập nhật từ task Housing đã dùng dữ kiện đó. Một lượt Map/Flight không được tự trở thành phạm vi tìm nhà của lượt sau. |
| SPEC-014/AC-15 | Intake hỗ trợ `moving_mode=catalog`; Planner chuyển thành task `mode=catalog`. Tra phạm vi không cần địa chỉ/ngày giờ. Runtime chỉ đọc không quảng bá commit capability; ý định ghi không khả dụng được giữ riêng và giải thích rõ, không sinh action hay chặn tác vụ tra cứu hợp lệ khác. |
| SPEC-014/AC-16 | Đổi lựa chọn nhà vô hiệu hoá cả task tham chiếu trực tiếp `selected_listing_id`/`listing_ids` và task phụ thuộc, kể cả khi không có cạnh `depends_on` tới Housing. Không tự thay đổi dịch vụ đã đặt. |
| SPEC-014/AC-17 | Cờ chất lượng nguồn Housing đi qua `quality_flags`. Giá bị gắn cờ `price_*` vẫn giữ nguyên để minh bạch nhưng không được dùng làm quote tính ngân sách; không thay thế căn user chọn bằng căn khác để tính tiền. |
| SPEC-014/AC-18 | Map độc lập dùng fact `map_near`/`map_city`; không làm hẹp phạm vi Housing. Nhà được chọn có tọa độ gần đúng phải cung cấp lựa chọn pin để xác nhận, không tự biến thành điểm dừng xe chính xác. |
| SPEC-014/AC-19 | Thêm nhà từ phân trang hoặc Map phải đồng bộ candidate, source_refs, missing_fields và quote. Kiểm kết quả cũ theo thời điểm ISO có timezone, không so sánh cách viết `Z` với `+00:00`. |
| SPEC-014/AC-20 | Chuyển lĩnh vực nhưng tham chiếu `selected:*` đã xác nhận là tiếp tục mục tiêu, không xóa lựa chọn do LLM gán `new_goal`. Mục tiêu mới độc lập vẫn reset. |
| SPEC-014/AC-21 | Housing/Map không tự nhận tọa độ từ fuzzy match. Khi similarity đủ mạnh (>=0.8), trả ứng viên thật cho user chọn; khớp yếu không được quảng bá thành lựa chọn hợp lệ. Moving vẫn phải xác nhận điểm dừng phù hợp. |
| SPEC-014/AC-22 | Câu hỏi cùng ngày bay dùng `flight.date` và `flight.flight_date` được chuẩn hóa thành một câu `flight.flight_date`, không gộp với ngày chuyển đồ. |
| SPEC-014/AC-23 | Bước LLM xem lại conflict phải dùng cả confirmed facts của các lượt trước. `selected:property` hợp lệ cho phép adapter đọc địa chỉ thật; Intake không bắt user gõ lại địa chỉ chỉ vì fact không được trích lại trong lượt mới. |
| SPEC-014/AC-24 | Contract 1.1 giao `goal` và `user_request` đã giới hạn/redact cùng inputs/hints/upstream. Goal không cấp quyền ghi hay thay dữ kiện; request 1.0 không có hai field vẫn tương thích. |
| SPEC-014/AC-25 | Tool preparation dùng MCP thật, cache riêng từng invocation và bind chỉ vị trí không fuzzy đủ rõ. Tọa độ/pin đã xác nhận không bị resolve lại thành địa điểm khác. |
| SPEC-014/AC-26 | Housing phân trang chỉ bằng cursor provider đã trả; giữ nhà/quote/nguồn/missing_fields/viewport của các trang đã đọc. Provider budget đếm cả preparation và details; không dùng LLM duyệt database. |
| SPEC-014/AC-27 | `agent_assessment` là đánh giá model, tách khỏi dữ kiện provider. Khi agent báo `limited`, phản hồi đọc là `PARTIAL` và nêu rõ đây là đánh giá chưa xác minh, không che hạn chế bằng thông báo hoàn tất. `request_replan` gửi đề nghị có nguồn về Validator/Planner; không tự thêm domain, thay filter hoặc kích hoạt lặp do kết quả cũ. |
| SPEC-014/AC-28 | Lọc nhà gần loại tiện ích dùng Housing `nearby_*`; khám phá quanh địa danh/căn đã chọn/các căn tìm được dùng Map `map_categories`/`map_radius_m`. Không biến Map exploration thành tìm lại nhà hay xóa lựa chọn. |
| SPEC-014/AC-29 | Tìm nhà quanh địa danh dùng `search_radius_m` đã nêu hoặc default được thông báo; khoảng cách đường thẳng không được mô tả như thời gian/quãng đường di chuyển. |
| SPEC-014/AC-30 | Intake/Planner/domain vẫn suy luận bằng LLM; context projection chỉ bỏ trường render/trace và dữ liệu trùng, không bỏ ID, ràng buộc, nguồn, hạn dùng hoặc dữ kiện chưa biết. Dữ liệu đầy đủ giữ trong state/API/UI. |
| SPEC-014/AC-31 | LLM chọn số kết quả Housing trong giới hạn `limit` đã xác nhận; composite search resolve an toàn và phân trang tối đa ba trang trong provider budget, không đổi hard filters. Mơ hồ phải hỏi; lỗi trang sau giữ trang trước và báo hạn chế. |
| SPEC-014/AC-32 | Chọn địa điểm đã được API xác minh gắn tên chuẩn và ID vào cùng fact/input, không sinh conflict vì nhãn hiển thị khác tên query. Map quanh căn đã chọn không được nhận anchor tìm nhà cũ thay cho căn đó. |
| SPEC-014/AC-33 | Assessment limited của task optional từ lượt trước không làm hạ mức đáp ứng của task mới đã xong. Task required được tái dùng vẫn phải kiểm hạn chế; khi không có task mới, không che hạn chế của kết quả đang dùng. |
| SPEC-014/AC-34 | Housing/Flight có thao tác search-and-return để LLM chọn khi chỉ cần dữ kiện theo bộ lọc đã xác nhận. Không có bộ phân loại keyword chọn hộ tool. Dữ kiện dùng cùng adapter và giữ nguồn, hard filters, ambiguity, missing_fields; `agent_completion.model_assessed=false` không phải assessment/xếp hạng. Normal search/details/finish/replan vẫn có cho nhiệm vụ cần đánh giá. |

## Kiểm chứng

`tests/test_llm_agents/test_integrated_live.py`: Housing/Flight/Map thực và trace,
multiturn, Moving báo giá; không tạo giao dịch.
`test_multiturn_live.py`: bảo toàn/sửa ngữ cảnh và liên kết tọa độ.
`test_domain_missions_live.py`: Location thật + tool policy (không gọi LLM),
Housing gần địa danh → chọn → Map exploration, và Map || Flight thật.
`test_payment_agent_live.py`: tra giao dịch sandbox **đã tồn tại** và chặn user khác;
skip nếu chưa có giao dịch thật, không tự tạo dữ liệu thay thế.

Test live opt-in bằng `RUN_LIVE_INTEGRATION=1`; API đang chạy truyền bằng
`--live-api-url http://127.0.0.1:18000/api/v1 --live-api-token <token>`.
Các test phụ thuộc API/LLM/MCP thật; không coi skip hoặc lỗi mạng là pass.

`scripts/measure-read-latency.py`: `--live-llm` opt-in chạy đúng năm lượt đọc thật;
`--catalog` đối chiếu catalog Flight với MCP thật, không gọi LLM;
`--ui-report` kiểm thao tác UI trên các thread đo riêng, không gửi chat.
[Bằng chứng 05/10](../../eval/read-latency-2026-10-05.md) kiểm AC-02/03/05/34
trên các ca liệt kê đơn giản, đa lượt và task độc lập song song; không chứng minh
toàn bộ các AC hoặc mọi tình huống đánh giá phức tạp.

## Giới hạn rõ ràng

Payment chat hiện tra trạng thái, chưa tạo/hoàn tiền qua hội thoại.
Flight hiện tìm chuyến; chưa có provider xuất vé thật.
Các tool là thao tác đọc có giới hạn; model chọn thao tác và entity được cấp,
không được tùy ý sửa mọi tham số MCP. Composite search và preparation đều có thể dùng.
Housing/Map dùng chung Location MCP theo thiết kế teammate, nhưng domain agent riêng.
Chất lượng dữ liệu housing và coverage địa điểm vẫn phụ thuộc snapshot/provider.
