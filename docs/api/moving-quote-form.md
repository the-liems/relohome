# Báo giá Moving từ form đã xác nhận

Issue: [#52](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/52).
Quyết định đang chờ review: [ADR-022](../adr/ADR-022-confirmed-moving-form-intent.md).

Nguồn chuẩn: `src/models/schemas.py::MovingQuoteForm`, kế thừa
`ConfirmedLocation` và `MovingOptions`. Không sao chép JSON Schema thành nguồn thứ hai.

| Kênh | Endpoint / quyền |
| --- | --- |
| Browser | `POST /web/api/threads/{thread}/moving/quote`: session cookie, CSRF guard, owner, `request_id` chống gửi lặp |
| Trusted gateway | `POST /api/v1/ui/chat/{thread}/moving/quote`: Bearer `AGENT_API_TOKEN`, gateway-verified `X-User-Id` |

Body bắt buộc: `plan_version` của state hiện tại (0 cho thread mới), `pickup` và
`destination` gồm address/lat/lng/confirmed=true, `move_date` ISO và `move_time` HH:mm.
`moving_options` giữ nguyên addon/package/remarks/promo của form; `service_id` tùy chọn.
`destination_listing_id` nếu có phải khớp căn nhà đã chọn trong checkpoint.
Browser thêm `request_id`; gateway không chuyển trường đó thành quyền đặt đơn.
Không nhận contact, approval, amount hay mode ghi. Trường lạ bị từ chối.

## Thực thi

Hai pin đã xác nhận → typed intent → kiểm version/owner/trạng thái/ngày giờ →
Planner helper → Moving node qua policy chung → kiểm kết quả → cost/progress/respond →
cùng checkpoint. Không gọi Intake hoặc Planner LLM.

- Người dùng chọn gói xe: kiểm catalog hiện tại + estimate thật, 0 LLM.
- Catalog đọc thật được giữ tối đa 45 giây trong RAM của cùng Moving client;
  khóa theo đúng tọa độ/city/delivery type, không làm tròn tọa độ. UI và agent dùng
  chung catalog; endpoint/credential đổi sẽ bỏ cache. Không cache giá, quote hoặc
  giao dịch giữa các request. Đổi ngày giờ/điểm giao/tùy chọn vẫn estimate mới.
- UI đọc catalog mặc định và TRUCK song song, gộp theo ID provider để không mất
  các xe tải. `GET /ui/moving/services?lat=...&lng=...&refresh=true` bỏ cache của
  điểm lấy, gồm các biến thể delivery type; nút tải lại sử dụng đường này.
- Provider từ chối estimate hoặc addon không khớp sẽ bỏ catalog cache; không tự
  đổi xe/ngày giờ hay lấy giá cũ để che lỗi.
- SIU chọn xe: catalog thật → Moving LLM quyết định → estimate thật; không thêm lượt
  model chỉ để trả kết quả. Không dùng danh sách mã xe cố định hoặc lấy N xe đầu.
- Thiếu pin: frontend giữ đường chat thông thường và hỏi làm rõ, không vào endpoint này.

Response dùng `ChatResponse` và kết quả Moving hiện có, gồm quotes, source refs,
expiry, route, warnings, unknown fields, usage và timing. Giá/phí thiếu không thành 0.
`agent_completion.model_assessed=false`: chưa có lượt model đánh giá lại sau estimate.

## Đồng bộ và an toàn

Plan tăng version. Quote cũ và lựa chọn Moving cũ không còn dùng được; downstream
stale. Housing/Flight và lựa chọn không bị ảnh hưởng giữ trong checkpoint. Không tự
chạy các task khác hoặc tiếp tục commit cũ. Muốn đặt phải yêu cầu và xác nhận riêng.
Khóa một lượt/thread dùng chung với chat, không có kho hội thoại thứ hai.

| Mã | Ý nghĩa |
| --- | --- |
| 401 / 403 / 404 | Không xác thực / CSRF sai / sai owner |
| 409 | Version cũ, lựa chọn nhà đổi, nhiều task quote, thread busy hoặc luồng giao dịch chưa xong |
| 422 | Schema/pin/ngày giờ không hợp lệ; phải cách hiện tại ít nhất 30 phút |
| 429 | Hết ngân sách gọi dịch vụ của thread |
| 503 | Moving form agent chưa được nối |

Provider từ chối nội dung → câu hỏi có lý do an toàn; lỗi hạ tầng → kết quả failed,
không sinh giá giả và không đặt đơn. Gateway replay cùng `request_id`/payload trả
snapshot, không gọi provider lại; reuse mã với payload khác trả 409. Direct endpoint
không có idempotency key riêng: version mới sau thành công chặn replay version cũ;
nếu mất phản hồi, đọc state trước khi thử lại.

## Kiểm thử thật

`tests/test_llm_agents/test_moving_form_live.py` mặc định skip. Operator phải cấp
`RUN_LIVE_MOVING_FORM=1`, `MOVING_FORM_LIVE_INPUTS` trong `.env.test` (tuyến được phép thử,
ngày giờ tương lai, gói xe thật đã chọn từ catalog) và token Moving MCP staging đang chạy.
Chạy `npm run test:live -- python tests/test_llm_agents/test_moving_form_live.py -v -s --moving-mcp-token <token>`.
Backend gateway chạy thật qua ASGI; Moving đi qua HTTP MCP thật, lưu quote thật và
gọi AhaMove staging. Không mock provider, không gọi LLM, không đặt/hủy/thu tiền.
Không đưa contact/key vào body test, log hoặc git.

Ca SIU-auto có chi phí riêng: thêm `RUN_LIVE_MOVING_FORM_LLM=1` và chỉ chạy
`test_real_siu_vehicle_suggestion_at_most_two_model_calls` sau khi operator duyệt.
Test đặt trần 2 lượt LLM; không tự chạy lại khi hết budget. Các ca khác giữ key
Moving trống trong test để không gọi model.

Ca browser riêng: build frontend trước (`npm run build --prefix Frontend`), cài
Chrome và thêm `RUN_LIVE_MOVING_BROWSER=1`. Chạy riêng
`test_real_browser_form_stays_open_and_retains_inputs`: backend/gateway chạy qua
socket thật trên port tạm, web/state DB riêng; Playwright chỉ chạy
`Frontend/playwright.live.config.ts`, không dùng route interception/fixture provider.
Hai ca trên tuyến thật Chợ Bến Thành → Bưu điện Trung tâm Sài Gòn (nguồn trong eval):
thread mới → pin từ Location thật → xe TRUCK từ AhaMove → báo giá; và backend
từ chối lịch dưới 30 phút → giữ pin/ngày giờ/gói xe → sửa lịch → báo giá. Không
gọi model, đặt xe hoặc thanh toán. Không chạy bộ browser fixture cũ để thay thế.
