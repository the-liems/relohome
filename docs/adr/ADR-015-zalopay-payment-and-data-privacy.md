# ADR-015: Payment MCP server dùng ZaloPay sandbox, dữ liệu cá nhân không rời máy nhóm

**Ngày:** 2026-09-26
**Trạng thái:** Proposed (chờ nhóm review trong PR; chuyển thành Accepted khi merge)
**Liên quan:** [ADR-013](ADR-013-flight-mcp-server-layout.md) ·
[ADR-014](ADR-014-containerized-mcp-servers.md) ·
[README payment MCP server](../../src/mcp_servers/payments/README.md) ·
[Ví dụ request/response](../api/examples/payments/README.md)

## Bối cảnh (Context)

Nhóm cần một dịch vụ thanh toán MVP cùng khuôn mẫu với flights (MCP server, Docker, giao diện demo),
dùng được với một cổng thật ở chế độ thử nghiệm để chứng minh đã kết nối API.

Tình trạng lấy key (09/2026, nhóm tự thử):

| Cổng | Kết quả |
|---|---|
| MoMo | Phải đăng ký hồ sơ doanh nghiệp M4B; nhóm chưa lấy được key. Một bộ key "công khai" lan truyền trên mạng đã bị server test của MoMo từ chối (`resultCode 11007`, chữ ký không hợp lệ) |
| VNPay | Có trang đăng ký sandbox, nhưng nhóm chưa lấy được key |
| Stripe / PayPal | Stripe không hỗ trợ tạo tài khoản ở Việt Nam; PayPal không hỗ trợ VND |
| **ZaloPay** | Trang tài liệu chính thức công khai bộ key sandbox (`app_id 2553`). Đã gọi thử: tạo đơn trả `return_code 1` kèm link + QR, tra cứu trả "chưa thực hiện", ký sai bị từ chối |

Bộ key sandbox công khai nghĩa là **merchant dùng chung cho mọi lập trình viên**: mọi thứ nhóm gửi lên đều
nằm trên hệ thống của ZaloPay và có thể trùng hoặc lẫn với đơn của người khác.

## Quyết định (Decision)

1. **Cổng thật là ZaloPay sandbox**, cổng **mock** offline chạy song song. Đổi bằng `PAYMENT_PROVIDER`.
   Thêm MoMo/VNPay sau này chỉ là thêm một file trong `gateways/` theo Protocol `PaymentGateway`.
2. **Dữ liệu cá nhân không bao giờ rời máy nhóm.** Mọi trường gửi cho cổng coi như công khai và chỉ lấy
   từ danh sách cho phép:

   | Trường ZaloPay | Giá trị gửi | Không bao giờ gửi |
   |---|---|---|
   | `app_trans_id` | `yymmdd_<tiền tố nhóm>_<8 hex ngẫu nhiên>`, ví dụ `260926_P044_2ad7bebc` | PNR, booking_id, tên, email, SĐT |
   | `app_user` | `HMAC-SHA256(muối cục bộ, customer_ref)` cắt 16 ký tự | Tên, email, SĐT thật |
   | `amount` | Số nguyên VND | — |
   | `description` | Mẫu cố định `"<tiền tố> demo <mã đơn>"` | Văn bản tự do, tên khách, tuyến bay |
   | `item` / `embed_data` | `"[]"` / chỉ `redirecturl` | Mọi dữ liệu người dùng |

3. **Tiền tố nhóm** `PAYMENT_ORDER_PREFIX` (mặc định `P044`, chỉ `[A-Za-z0-9]{2,8}`) nằm trong mọi mã đơn.
   Server **chỉ tra cứu mã có trong SQLite của nhóm**; mã lạ bị báo không tìm thấy mà không hỏi ZaloPay,
   nên không đọc được đơn của nhóm khác trên merchant chung.
4. **Chặn dữ liệu cá nhân ở server, không dựa vào LLM**: `order_ref`/`customer_ref` chỉ nhận
   `^[A-Za-z0-9_-]{1,30}$`, từ chối nếu có `@` hoặc dãy từ 9 chữ số (giống SĐT/CCCD). Tool không có tham
   số tên/email/SĐT. Không dùng ràng buộc Pydantic cho hai trường này vì lỗi validate của Pydantic in lại giá
   trị đầu vào; engine tự báo lỗi **không kèm giá trị**.
5. **Lưu trữ tối thiểu**: SQLite chỉ có mã, số tiền, trạng thái, thời gian; không lưu `customer_ref`. Bản ghi
   cũ hơn `PAYMENT_RETENTION_DAYS` (mặc định 30) bị xóa khi tạo đơn mới.
6. **Bí mật**: `key1`/`key2` chỉ trong `.env` (bị `.gitignore` và `.dockerignore`), truyền vào container lúc
   chạy; `.env.example` để trống, có test chặn commit key. Message lỗi và log không chứa key, `mac` hay token
   của ZaloPay; nhật ký trên giao diện và file tải về che `mac`/`key*`/`token`.
7. **Đồng bộ trạng thái bằng polling** (`get_payment` gọi `/v2/query` khi đơn còn PENDING) thay cho
   callback, để chạy được trên máy dev không có URL công khai.
8. **Không có đường tắt với cổng thật**: tool `simulate_payment_result` chỉ được đăng ký khi
   `PAYMENT_PROVIDER=mock`. Hủy và hoàn tiền ZaloPay chưa hỗ trợ trong MVP và báo lỗi rõ ràng, không giả vờ.

## Lý do (Rationale)

- ZaloPay là cổng nội địa duy nhất nhóm dùng được ngay, không cần giấy tờ doanh nghiệp.
- Với merchant dùng chung, "không gửi dữ liệu cá nhân" an toàn hơn "gửi nhưng mã hóa/che": không có gì
  để lộ. Định danh giả danh vẫn giữ được khả năng nhận ra cùng một khách trong dữ liệu của nhóm.
- Đặt các quy tắc trong engine (nơi duy nhất tạo request cho cổng) giúp mọi đường gọi (agent, UI, test)
  đều bị kiểm soát như nhau.

## Hệ quả (Consequences)

- Chưa xác minh được cách **thanh toán xong** một đơn sandbox (có thể cần app ZaloPay bản sandbox). Bằng chứng
  kết nối là đơn thật + QR + tra cứu; vòng đời đầy đủ (đã trả, hoàn tiền) demo bằng mock.
- Chỉ có sandbox, không có tiền thật. Lên production phải có hợp đồng merchant riêng và làm lại ADR này
  (key riêng, callback có URL công khai, chính sách lưu trữ theo quy định).
- Payment chưa nối vào đặt vé: `confirm_booking` chưa yêu cầu đã thanh toán.
- Merchant dùng chung có thể bị giới hạn hoặc thu hồi key bất kỳ lúc nào; khi đó chuyển về `mock`.

## Cập nhật 2026-10-07: tester đánh dấu đã thanh toán (Draft, chưa code)

Thiết kế thanh toán đa dịch vụ ([payment-design.md](../review/payment-design.md) D5, §7) cần demo trọn luồng vé và
chuyển đồ, trong khi chưa xác minh được cách thanh toán xong một đơn ZaloPay sandbox (xem Hệ quả). Vì vậy thêm một
**ngoại lệ hẹp** cho quy tắc 8, quyết định 07/10/2026:

- Đơn vẫn được tạo thật trên ZaloPay sandbox và hiện QR như bình thường; "Kiểm tra thanh toán" vẫn tra cổng.
- Cạnh QR có nút **"Đã thanh toán"** để nhóm test. Nút này **không gọi ZaloPay** và không dùng
  `simulate_payment_result`; app chỉ ghi đơn thanh toán là đã trả với `paid_via = tester_marked`.
- Rào chắn:
  - chỉ hiện khi bật một cờ cấu hình riêng (đề xuất `PAYMENT_TESTER_CONFIRM_ENABLED`), **mặc định tắt** trong code;
    môi trường demo và test của nhóm bật cờ này;
  - ghi người bấm và thời điểm;
  - mọi nơi hiển thị gắn nhãn **"đánh dấu bởi tester"**, không trình bày như ZaloPay đã xác nhận;
  - **không bao giờ bật trên môi trường production**; cấu hình production phải từ chối cờ này.
- Thanh toán ZaloPay xác nhận thật (`paid_via = zalopay_verified`) vẫn là đường chuẩn; quy tắc 8 giữ nguyên với
  mọi đường còn lại.
