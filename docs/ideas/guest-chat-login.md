# ReloHome — Chat không cần đăng nhập, đăng nhập theo thao tác

Ngày: 14/10/2026. Trạng thái: **Đã triển khai guest chat và kiểm tra local; rollout cloud/CI cần xác nhận riêng.** Bằng chứng và cấu hình thực tế: [bàn giao](../integration/guest-chat-2026-10-14.md).

## 1. Mục tiêu

Người mới mở `/ai` có thể chat và khám phá dịch vụ ngay. Chỉ yêu cầu đăng nhập khi thao tác cần tài khoản, dữ liệu cá nhân hoặc giao dịch. Đăng nhập không làm mất hội thoại, bản đồ, form hoặc lựa chọn đang làm.

Giữ các luồng của người đã đăng nhập, thuật toán Roommate, quyền chủ nhà/Admin, agent orchestration và API nghiệp vụ hiện có. Đợt triển khai này cần mở rộng xác thực và authorization ở backend; chỉ bỏ màn hình Login ở frontend sẽ không đủ và không an toàn.

## 2. Tham khảo ChatGPT

[OpenAI — The ChatGPT home page](https://help.openai.com/en/articles/9125172-the-chatgpt-home-page), đối chiếu ngày 14/10/2026:

- Có thể bắt đầu chat trước khi tạo tài khoản tại các khu vực được hỗ trợ.
- Khách chưa đăng nhập chỉ có một cuộc trò chuyện đang hoạt động trong phiên trình duyệt; khả năng lưu gắn với tài khoản.
- Tài khoản mở thêm khả năng quản lý hội thoại và cá nhân hóa.

Áp dụng cho ReloHome: cho dùng thử trước, hỏi đăng nhập tại thời điểm có lý do cụ thể. TTL 24 giờ và các quyền dịch vụ dưới đây là **đề xuất riêng của ReloHome**, không phải mô tả chính sách ChatGPT. Không bổ sung danh sách lịch sử chat trên UI; quyết định trước đây giữ lịch sử backend cho tài khoản vẫn được giữ.

## 3. Audit trước khi triển khai

| Khu vực | Hiện trạng đã xác nhận | Việc cần bổ sung |
| --- | --- | --- |
| `apps/web/src/App.tsx` | `/ai` render Login khi `user` rỗng; Context/Chat đang cần `User` | Session khách có kiểu rõ ràng; route chat công khai; các route riêng vẫn có guard |
| `apps/web/src/roommate/RoommateGuest.tsx` | Có trang giới thiệu Roommate cho khách | Giữ trang giới thiệu; yêu cầu tài khoản trước khi vào workspace/profile/search thực tế |
| `apps/browser-gateway/src/relohome_gateway/server.py` | `user(request)` trả 401; chat/status/thread/map/saved/checkout dùng identity từ cookie | Resolver cho guest chat; giữ `require_account` ở thao tác riêng; policy theo thao tác |
| `apps/browser-gateway/src/relohome_gateway/store.py` | SQLite có users/sessions/threads/messages/runs; session hash token, HttpOnly; threads có owner | Bảng guest session/expiry/claim additive; không tạo user giả với email/password giả |
| `apps/agent-api/src/relohome_agent/api/routes.py` | Live API yêu cầu bearer nội bộ và `X-User-Id` đã xác thực; chặn identity chung `anonymous`; graph checkpoint kiểm owner | Identity guest riêng do gateway cấp; enforce capabilities ở API và trước khi gọi tool |
| `apps/browser-gateway/src/relohome_gateway/roommate_gateway.py` | Chỉ availability công khai; endpoint khác dùng user đăng nhập | Giữ consent/eligibility và quyền hiện có; không mở contact/profile riêng cho guest |
| Xóa hội thoại | Gateway đã gọi Agent xóa checkpoint/memory trước khi xóa store local | Dùng cơ chế này cho cleanup guest, có retry khi Agent không sẵn sàng |
| Housing media, Guides | Đã có truy cập public có kiểm soát và cẩm nang công khai | Tái sử dụng; không public hóa file nháp/media riêng |

Không có guest session hay ownership transfer an toàn giữa guest và account trong code đã audit. Agent không phải endpoint public: vẫn giữ bearer service-to-service và không đưa token lên browser.

## 4. Quyền đề xuất

| Chức năng | Khách chưa đăng nhập | Khi cần đăng nhập |
| --- | --- | --- |
| Chat AI, câu gợi ý, form hướng dẫn | Có, trong phiên guest và hạn mức | Hết hạn mức guest hoặc thao tác yêu cầu tài khoản |
| Tìm nhà, xem thông tin public/ảnh published, filter, map, tính chi phí, so sánh | Có | Lưu yêu thích lâu dài, dữ liệu riêng |
| Chọn căn để so sánh/xem lại trong phiên | Có, chỉ lựa chọn tạm | Gửi/hủy/đổi lịch hẹn; liên hệ chủ nhà; thỏa thuận; cọc; đánh giá |
| Flight | Tra cứu, xem giá/kết quả, chọn tạm trong phiên | Thông tin hành khách, giữ chỗ, đặt vé, checkout/thanh toán |
| Map/routing, tiện ích xung quanh | Có | Không yêu cầu tài khoản chỉ vì tính đường đi; GPS vẫn cần quyền trình duyệt |
| Moving | Mở form, xem loại xe và tính đường đi | Gửi báo giá có thông tin liên hệ, lưu hồ sơ giao nhận, đặt/hủy/sửa đơn, thanh toán |
| Báo giá Moving không có PII | Chỉ mở nếu adapter/provider hiện có thật sự hỗ trợ; không giả giá | Nếu provider cần contact, yêu cầu đăng nhập trước khi gửi thông tin; khảo sát riêng trong task GC-02 |
| Roommate | Trang giới thiệu/availability | Workspace, hồ sơ, tìm người thật, kết nối, tin nhắn/contact, upload, report; tiếp tục giữ consent/eligibility |
| Landlord/Admin | Trang giới thiệu | Toàn bộ workspace; Admin còn cần quyền Admin, đăng nhập thông thường không cấp quyền |
| Cẩm nang | Có | Chỉ nội dung cá nhân hóa nếu bổ sung sau |

Phân loại theo **ý nghĩa thao tác**, không theo HTTP method: tìm kiếm có thể dùng POST nhưng vẫn là đọc; "Chọn căn" có thể tạo viewing draft ở backend nên phải tách quyền draft tạm khỏi gửi lịch thực tế. Không thay policy bằng kiểm tra tên nút.

## 5. Trải nghiệm người dùng

1. Mở Landing → vào không gian AI → chat/form dùng ngay. Header giữ ReloHome; góc phải có Đăng nhập/Đăng ký và nhãn phiên khách nhỏ.
2. Kết quả, map và các gợi ý dịch vụ hoạt động như hiện tại. Khách có một hội thoại active; thêm hội thoại mới phải thông báo phiên trước sẽ bị thay thế.
3. Bấm chức năng riêng, ví dụ Hẹn xem: mở yêu cầu đăng nhập ngay trong ngữ cảnh hiện tại. Copy nêu lợi ích cụ thể: "Đăng nhập để gửi lịch xem tới chủ nhà". Có thể đóng và tiếp tục khám phá.
4. Form/draft, map camera và lựa chọn được giữ khi mở/hủy đăng nhập. Không lưu email/password/PII vào localStorage để giữ draft.
5. Đăng nhập thành công → server nhận quyền sở hữu phiên guest hiện tại → quay lại đúng thao tác/form. Với lịch hẹn, gửi liên hệ, đặt vé, đặt xe và thanh toán: **vẫn có bước xác nhận riêng; không tự gửi do vừa login**.
6. Login thất bại, account bị hạn chế hoặc claim lỗi: giữ phiên guest, báo lỗi có thể thử lại; không hiển thị đã nhận quyền/lưu lịch khi chưa thành công.
7. Logout đóng quyền đọc thread của tài khoản; lần dùng guest tiếp theo tạo phiên mới. Không dùng account thread làm thread khách.

Một câu yêu cầu nhiều dịch vụ: phần tra cứu được phép tiếp tục; phần cần tài khoản hiện CTA đăng nhập ở đúng bước. Không bắt người dùng đăng nhập lại chỉ để xem kết quả công khai đã tìm được.

## 6. Kiến trúc tối thiểu

### Session và giới hạn

- Gateway tạo `guest_<random>` riêng cho từng phiên. Cookie guest opaque, token lưu dạng hash, HttpOnly, SameSite, Secure trên cloud. Không nhận owner/role/capabilities từ client.
- Một guest session có một active thread, hạn dùng **24 giờ cố định** kể từ lúc tạo; reload không làm mất phiên còn hạn. Không biến TTL thành gia hạn vô hạn.
- Browser chỉ giữ ID/expiry/draft không nhạy cảm; server expiry là nguồn kiểm tra quyền. Account session 14 ngày hiện có không đổi.
- `session/status` trả thông tin guest/capabilities bằng schema additive; không dùng một object User giả để lách các guard Roommate/Landlord.
- Guest không được truy cập account thread bằng cách thay URL/ID. Mỗi API đều kiểm owner và session còn hạn.
- Proposed initial quota: 10 lượt chat/30 phút và 30 lượt/24 giờ theo guest; giới hạn bổ sung theo IP, tổng chi phí provider và một request đang chạy/guest. Đây là mức khởi đầu cần đo và cấu hình, không hardcode vào UI hay hứa đã có trong code.
- Dùng persistence hiện có cho quota; cookie mới không được reset quota IP. Chưa thêm Redis/database/service. Khi chạy nhiều gateway replica phải dùng shared persistence hiện có trước khi mở public.
- Phân biệt quota guest (429) với provider thiếu credit/sự cố (503): đăng nhập không được trình bày như cách sửa lỗi provider.

### Quyền backend

- Thêm `GuestPrincipal`/`AccountPrincipal` và capability policy dùng chung cho request gate. API private vẫn dùng account resolver cũ.
- Gateway forward identity guest đã kiểm cùng service bearer. Agent nhận trusted guest scope; không tin header từ browser và không nới `authenticate` để chấp nhận `anonymous` chung.
- Chat vẫn chạy qua graph hiện có. Code kiểm quyền ở điểm thực thi/tool boundary: prompt yêu cầu "đặt vé", "liên hệ", "tìm roommate" không thể vượt quyền dù planner/LLM sinh task đó.
- Tách draft tạm khỏi action có tác động bên ngoài. Guest bị chặn ở checkout, viewing request, contact, Roommate và quản lý nhà; không chỉ ẩn nút frontend.

### Đăng nhập và giữ hội thoại

- Claim **chỉ active guest thread lấy từ cookie**, không nhận danh sách thread hoặc owner từ payload.
- Không chỉ `UPDATE threads.owner`: Agent checkpoint có `user_id`, memory và các store lựa chọn riêng. Chỉ đổi SQLite sẽ khiến lượt chat tiếp theo 404 hoặc giữ quyền của guest cũ.
- Dùng internal claim operation có idempotency, thread lock và journal trong store hiện có; cấm claim khi đang chạy một turn. Guest mới claim không có giao dịch/lịch thật vì policy đã chặn từ trước.
- Trình tự: đánh dấu claiming → Agent chuyển owner và dữ liệu lựa chọn tạm được phép bằng API checkpointer hiện có → gateway commit owner/account binding → vô hiệu cookie guest. Có retry/reconcile nếu một phía lỗi. Không mô tả hai datastore như một transaction nguyên tử.
- Từ trạng thái claiming, mọi request dùng owner cũ bị khóa; chỉ replay cùng operation key được chạy. Cookie guest cũ bị thu hồi sau hoàn tất. Không tự chuyển profile/payment/contact; các store phụ phải được inventory và kiểm chứng trước triển khai.
- Nếu không thể chuyển nguyên trạng một store phụ, giữ lỗi có thể retry; không "sửa" bằng cách reset kế hoạch hay tự chạy lại giao dịch.

### Cleanup và dữ liệu

- Hết TTL: từ chối truy cập ngay. Cleanup có batch giới hạn, retry, xóa checkpoint/memory qua cơ chế delete hiện có rồi xóa messages/runs/thread/guest token.
- Lịch/account data cũ không nằm trong cleanup guest. Guest đã claim trở thành account thread và tuân retention account hiện có.
- Không đưa nội dung chat, email, số điện thoại hay guest cookie vào analytics/log. Backup retention của guest phải có chính sách riêng, không hứa dữ liệu biến mất ngay khỏi backup.

## 7. Kế hoạch và tiêu chí nghiệm thu

Kế hoạch theo task: [tasks/guest-chat/plan.md](../../tasks/guest-chat/plan.md); checklist: [todo.md](../../tasks/guest-chat/todo.md).

Ưu tiên: policy/identity → guest chat xuyên UI/API → gate chức năng riêng → ownership claim → trở lại thao tác → quota/cleanup → staging.

Trước khi mở cloud phải chứng minh:

- Guest A không đọc/chỉnh thread B; account cũng không đọc thread người khác.
- Không bypass quyền bằng prompt, endpoint trực tiếp, ID giả, cookie hết hạn hoặc gọi action/checkout riêng.
- Reload trong 24 giờ giữ phiên; hết hạn không đọc được; bắt đầu mới và logout không trộn identity.
- Login/hủy/login sai không mất map/draft; claim concurrent/retry/Agent offline không rò thread hoặc gửi lịch/thanh toán hai lần.
- Toàn bộ luồng account hiện có và Roommate consent vẫn pass; UI VI/EN/light/dark/mobile/keyboard đạt.
- Quota có concurrency/shared persistence và cost cap; cleanup thật xóa dữ liệu ở gateway + Agent.
- CI hiện có xanh; không sửa workflow để lách gate. Rollback qua feature flag tắt guest; account vẫn hoạt động, không drop schema additive.

## 8. Kết quả triển khai

Đã mở rộng authorization của gateway/Agent, thêm session/quota/journal trong SQLite hiện có, tích hợp đăng nhập trong ngữ cảnh và cleanup. Không thêm database/service, không thay thuật toán ghép trọ, không sửa CI. Các thay đổi UI welcome/gợi ý của task trước được giữ nguyên. Bảng audit và quyền phía trên ghi thiết kế ban đầu; [bàn giao](../integration/guest-chat-2026-10-14.md) là nguồn về trạng thái/cấu hình thực tế.

### Môi trường test đã bật ngày 14/10/2026

- Docker Desktop đã chạy; PostGIS healthy và chín OSRM container Hà Nội/HCM/Đà Nẵng (driving/walking/motorcycle) trả nearest HTTP 200/Ok.
- Tám dịch vụ Location, Housing/Platform, Moving MCP/API, Flight MCP, Payment MCP, Agent và Web gateway đều qua readiness HTTP 200.
- PostGIS/OSRM chạy trong Docker; tám dịch vụ ứng dụng dùng `scripts/start-local-mvp.ps1` trên host theo runbook hiện có, không mô tả chúng là tám container.
- Khắc phục môi trường sau refactor bằng setuptools/wheel và cài lại editable package local trong `.venv`; không đổi source backend, mật khẩu, key hoặc restore/reset database.
- Web tại <http://127.0.0.1:8503/ai> đang phục vụ build welcome/gợi ý mới. Log launcher: `data/local-mvp-logs/`.
- Chạy chế độ đọc/tra cứu của launcher. Chưa bật giao dịch sandbox và chưa gọi provider/LLM để chứng minh hạn mức API. Readiness không bảo đảm key có credit.
- Bật guest bằng `RELOHOME_GUEST_ENABLED=true` ở gateway; mặc định template/Compose vẫn tắt để rollout có kiểm soát. Account session và lịch sử backend được giữ; không bổ sung nút lịch sử.
