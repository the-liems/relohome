# Moving form — kiểm chứng thật cho issue #52

Ngày: 2026-10-05. Nền: `QuangDung@07f23b6` (PR #42 chưa merge tại lúc thực hiện).
Chỉ nhánh `fix/52-moving-quote-form`, không đưa các sửa đổi local khác vào PR.

## Thay đổi đã kiểm

Form có cả hai pin và ngày giờ gửi typed intent, không qua Intake/Planner LLM.
Gói xe đã chọn được kiểm bằng catalog AhaMove thật rồi estimate trực tiếp.
Nếu chưa chọn xe, LLM Moving vẫn chọn dịch vụ. Chủ task đã duyệt riêng đúng một ca
SIU-auto, tối đa 2 lượt LLM; ca đó đã qua và không chạy lại sau khi dùng đủ ngân sách.

Hướng giảm lượt gọi nối tiếp theo
[OpenAI latency guide](https://developers.openai.com/api/docs/guides/latency-optimization);
không đổi model, không phân loại câu đơn giản bằng keyword.

## Môi trường và nguồn

- Backend FastAPI và gateway thật qua ASGI transport, không stub/mock application.
- HTTP Moving MCP thật trên localhost, AhaMove **staging**, PostgreSQL thật.
- DB mới `lifeflow_quangdung_20261005`; DB cũ giữ nguyên, không restore/reset thêm.
- State/chat/web DB riêng cho test, không sửa thread của người dùng.
- Tuyến được chủ task cho phép trước đó: Chợ Bến Thành → Bưu điện Trung tâm Sài Gòn;
  tọa độ có nguồn trong [eval cũ](llm-agents-2026-09-29.md). Đây là kiểm quote,
  không phải xác nhận cổng xe tải có thể vào.
- Gói dùng test `SGN-TRUCK-ECO-500` lấy từ catalog thật tại điểm lấy. Đây là lựa chọn
  của operator test, **không phải mã xe cố định trong sản phẩm**.
- Ngày 2026-10-06, 10:00; test báo giá lại đổi 11:00. Không đặt xe, thanh toán, hủy đơn.
- Contact từ cấu hình thật, không ghi vào repo/log. Moving agent key trống trong
  test; ledger xác nhận không gọi LLM. Không dùng dữ liệu giả để thay provider.

## Kết quả

`tests/test_llm_agents/test_moving_form_live.py`: **3 passed**, 20,72 s cho cả suite
(gồm khởi tạo/đóng runtime, nhiều request và báo giá thật; không phải latency mỗi câu).

| Ca | Đã kiểm chứng |
| --- | --- |
| Quote → chọn → quote lại | Giá/ID/nguồn thật; version tăng; bỏ lựa chọn quote cũ; không có commit action/receipt |
| Kiểm đầu vào | Sai owner 404, thiếu auth 401, version cũ 409; ngày quá hạn, pin chưa xác nhận, approval field lạ, binding căn sai bị chặn; ledger không tăng |
| Gateway | Đăng nhập/session thật, CSRF 403, quote thật; replay cùng request không gọi provider lại; đổi payload cùng request 409 |
| Giữ Housing | Dùng một kết quả Housing đọc thật qua Location làm state chuẩn bị; sau Moving, task/result/selection Housing giữ nguyên |

Đo lượt **đã chọn gói xe** của suite cuối:

| Thành phần | Thời gian |
| --- | --- |
| Endpoint trực tiếp, kể cả checkpoint | 4.271 ms |
| Agent | 4.209 ms |
| Catalog mặc định | 954 ms |
| Catalog TRUCK | 1.352 ms |
| Estimate qua MCP | 1.902 ms |
| LLM | **0 lượt, 0 token input/output** |

Lần kiểm trước cùng loại ca: 4.565 ms, cũng 0 LLM. Các timing MCP gồm transport,
backend, DB/provider; **không** phải phép đo HTTP AhaMove riêng.

Ca **SIU-auto** chạy riêng sau khi được duyệt: **1 passed**, suite 9,76 s;
endpoint 9.083 ms, agent 9.022 ms, trong đó LLM 4.372 ms. Có **2 lượt LLM**,
12.267 token input + 58 output = **12.325 token**. Trace:
`resolve_move_route → list_moving_services → get_moving_service → estimate_move`.
Model thực sự chọn đọc chi tiết rồi estimate; không có lượt LLM `finish`, Intake
hay Planner. Báo giá có nguồn/giá thật, không commit/receipt. MCP catalog 1.376 ms,
detail 445 ms, estimate 2.724 ms. Không hứa SIU-auto mọi lần đều 2 lượt; test này
đặt trần 2, runtime thông thường vẫn có budget hiện có.

Baseline thực tế của người dùng: 25.612 ms, 6 lượt LLM, 20.752 token. Baseline để
SIU đề xuất nhiều xe; phép đo mới đã chọn một gói xe và dùng tuyến/thời điểm khác.
Do đó **không kết luận phần trăm speedup A/B** hoặc hứa mọi form đều 4 giây.

## Lỗi tìm được và sửa trong quá trình kiểm

Catalog không truyền `delivery_type` có thể mặc định INSTANT, không có xe tải đã
chọn. Agent kiểm thêm catalog TRUCK nếu lựa chọn không thấy ở catalog mặc định,
không đoán loại xe bằng prefix ID. Test ban đầu không qua vì lỗi này; suite cuối
đã qua sau sửa. Hai lỗi đầu môi trường pytest temp path được khắc phục bằng
`--basetemp` mới riêng trong `data/`, không xóa thư mục temp của người dùng.

## Kiểm tĩnh và giới hạn

- Ruff các file Python thay đổi: sạch; frontend `tsc -b && vite build`: thành công.
- `git diff --check`: sạch.
- `ruff check .`: còn **9 lỗi có sẵn** trên nền QuangDung ở `Frontend/__init__.py`
  và scripts AI log; không trộn sửa CI/logger của teammate vào PR Moving.
- Không chạy/khẳng định toàn bộ `pytest` xanh; test staging mặc định skip nếu chưa opt-in.
- Lần đầu chưa dùng browser tự bấm/đo thời gian render UI. Follow-up bên dưới bổ
  sung Chrome E2E thật; không gọi phép đo ASGI ở trên là browser E2E.
- Test giữ Housing chuẩn bị checkpoint bằng **kết quả nguồn thật**, không đi qua
  Housing LLM/chat; không chứng minh hiểu tham chiếu hội thoại bằng model.
- SIU-auto đã qua đúng một ca thật, chưa phải bằng chứng cho mọi yêu cầu tự chọn xe.
- Chưa chạy addon/COD đầy đủ, provider outage, pending
  approval/payment/uncertain order, hoặc booking sau form; code giữ các guard nhưng
  các nhánh đó cần reviewer/UAT. Không tạo giao dịch chỉ để lấp checklist.
- Fix đang trong worktree/PR riêng; chưa thay vào code demo ở workspace gốc.

## Bàn giao review

Đọc [ADR-022](../docs/adr/ADR-022-confirmed-moving-form-intent.md) và
[API](../docs/api/moving-quote-form.md). Review kỹ owner/version/quote expiry,
selection/downstream, quyền ghi state và đường SIU-auto. PR nối tiếp lấy QuangDung
làm base; sau #42 merge main thì kiểm diff và retarget main. Không tự approve/merge.

## Follow-up: giữ form, catalog và context (cùng issue #52 / PR #53)

- Giữ cùng form/pin/ngày giờ/gói xe trong lúc tạo thread và chờ báo giá; không để
  effect theo thread/reply đóng form sớm. Lỗi HTTP hoặc làm rõ vẫn ở form; chỉ
  quote thành công mở bước chọn xe. Người dùng vẫn được thoát/chuyển hội thoại.
- Cache tối đa 45 giây / 64 query thật, RAM của một Moving client; endpoint/token
  đổi bỏ cache, query tọa độ chính xác và delivery type tách biệt. Không dùng cache
  giữa request cho estimate/giá/booking. Refresh bỏ các catalog tại điểm lấy;
  provider từ chối estimate hoặc addon không khớp bỏ cache. Không cache lỗi/rỗng.
- UI catalog không còn chỉ nhận INSTANT mặc định: đọc mặc định + TRUCK thật song
  song, deduplicate theo ID. Form đã tải gói xe thì agent dùng cùng catalog trong
  hạn, không bắt LLM chọn lại gói đã xác nhận và không hardcode mã xe.
- Context chi tiết bỏ icon và nhãn đa ngôn ngữ lặp, giữ các request/options/giới
  hạn và dữ kiện provider thực sự cung cấp. Không đổi tool schema, model hoặc
  quyền quyết định của SIU-auto. Record đầy đủ ở backend không bị sửa.

Kiểm thật sau sửa: **4 test backend passed**, gồm 3 ca trước và thêm scope/copy/
expiry/refresh/projection; LLM test skip, không chạy lại. Browser thêm **2 ca Chrome
passed** qua wrapper opt-in, socket backend/gateway thật, auth/session, Location
và AhaMove staging thật; không interception hoặc fixture provider. Fresh thread
và lỗi 422 rồi sửa lịch đều không mất form/remount, quote đúng nguồn và không
commit; usage ledger xác nhận 0 Intake/Planner/domain LLM. Xe trong browser được
operator chọn từ dòng `delivery_type=TRUCK` thật, không suy ra từ prefix ID.
Browser từ click đến render quote lần cuối: **2.177 ms** (fresh thread) và
**1.755 ms** (sửa lịch sau 422). Backend/gateway/DB đều riêng cho test, không phải
đo tải đồng thời nhiều người dùng hoặc giao dịch đặt đơn.

Đo backend cold selected service: **4.359 ms**, 2 catalog read + estimate.
Requote đổi giờ, cùng điểm lấy, catalog còn hạn: **1.005 ms**, chỉ **1 provider call**
(estimate mới), 2 cache hit, quote ID mới và bỏ selection cũ, **0 LLM/token**.
Đây là cold/warm cùng runtime, không hứa mọi request đạt 1 giây; cold, provider
chậm hoặc cache hết hạn vẫn cần đọc catalog.

Model JSON của một detail thật trước/sau: **32.022 → 17.568 byte UTF-8**, giảm khoảng
45%; giữ 15 request. Payload provider đầy đủ khoảng 90 KB nhưng `provider_data`
đã bị loại trước khi gửi model ở bản cũ; không coi 90 KB là input LLM cũ.
Đây là số byte, **không phải số token/credit đã đo**, và không chạy SIU-auto lại
sau projection vì ngân sách test trả phí trước đã dùng hết. Không suy ra tốc độ
hay chất lượng LLM mới từ phép đo này.

Build frontend/TypeScript và Ruff `src/` + test/gateway thay đổi sạch. Chưa có CI
trên PR base QuangDung, chưa full pytest, chưa merge/deploy hoặc thay demo gốc.
