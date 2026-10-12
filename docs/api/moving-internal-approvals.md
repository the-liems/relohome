# Moving: đăng ký approval từ backend

Schema chuẩn: `RegisterMovingApprovalRequestSchema` và `MovingApprovalPayloadSchema`
trong `packages/contracts/src/moving.ts`. Tài liệu này chỉ mô tả
ngữ nghĩa; không thay thế schema. Liên quan SPEC-004/AC-19, ADR-003.

## Endpoint và quyền

`POST /v1/internal/moving/approvals` trên Moving API, port 4200.
Header: `Authorization: Bearer <MOVING_APPROVAL_TOKEN>`.

Đây là API backend-to-backend, không phải MCP tool tự duyệt. Backend phải kiểm
người dùng, thread, lựa chọn, giá và sự đồng ý trước khi gọi. Moving tin cậy
backend sở hữu token này; không tự chứng minh được người dùng đã nhấn xác nhận.
Không cấp token cho frontend, LLM hoặc subagent. Chỉ expose trên mạng riêng/TLS;
public webhook ingress phải chặn đường này. Token độc lập, ít nhất 32 ký tự.

## Request

- `approval_id`: UUID ổn định, có thể UUID5 từ approval/action/step của graph.
- `action_type`: `create`, `update`, `cancel`; thêm `rate` cho tool rating hiện có
  (rating vẫn bị khóa mặc định).
- `payload`: đúng payload approval của tool; `action` phải khớp `action_type`.
- `approved_by`: định danh user đã xác thực bởi backend, không lấy từ prompt.
- `expires_at`: ISO 8601 có timezone, tương lai và không quá 30 phút.

Payload create: `action`, `quote_id`, `quote_fingerprint`, `service_id`,
`total_price`, `workflow_id`, `action_id`. Fingerprint là `request_fingerprint`
của quote được dùng để đặt. Graph dùng `workflow_id=lifeflow:<thread_id>` và
`action_id` ổn định. Backend tính lại giá/quote thì phải giữ nguyên ý định đã được
duyệt; giá đổi cần xin xác nhận mới, không tự cho phép tăng 5%/20.000đ.

Payload cancel: `action: cancel`, đúng một trong `order_id`/`tracking_number`,
và `comment`. Payload update/rate theo schema canonical nêu trên, bỏ `approval_id`
và thêm `action`. Không truyền secrets trong payload.

Moving tính hash từ payload đã validate. Endpoint đăng ký không tạo/hủy đơn,
không kiểm quote còn tồn tại và không gọi provider; tool ghi kiểm quote, trạng
thái và approval tại thời điểm thực thi. Gửi `approval_id` vừa đăng ký cho tool ghi.

## Response và retry

| HTTP | Ý nghĩa |
|---|---|
| 200 `{approval_id}` | Đăng ký hoặc lặp lại chính xác bản ghi cũ |
| 400 `VALIDATION_ERROR` | Sai schema/action hoặc hạn quá 30 phút |
| 401 `NOT_AUTHORIZED` | Sai/thiếu credential |
| 409 `APPROVAL_CONFLICT` | Cùng ID nhưng khác action/payload/owner/expiry |
| 422 `APPROVAL_EXPIRED` | Hạn đã qua |
| 503 `APPROVAL_NOT_CONFIGURED` | API chưa được cấp token approval |

Đăng ký lại không đổi expiry và không xóa `consumed_at`. Bản ghi hết hạn không
được tái sử dụng. Khi HTTP không rõ kết quả, gửi lại đúng request với cùng ID;
không tự sinh approval mới để bỏ qua trạng thái đã consumed.

MCP giữ lỗi JSON `{code,message,retryable}` trong error content. Client cần đọc
`retryable` thay vì đoán từ câu chữ. Lỗi thao tác ghi không đồng nghĩa được gọi lại:
phải đối soát kết quả trước, theo ADR-003.
