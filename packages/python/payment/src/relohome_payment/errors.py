class PaymentError(Exception):
    """Lỗi nghiệp vụ. Message được trả nguyên văn cho client MCP nên không được chứa key, chữ ký hay dữ liệu cá nhân.

    `code` và `retryable` đi cùng message trong lỗi MCP có cấu trúc `{code, message, retryable}`.
    """

    code = "PAYMENT_ERROR"
    retryable = False


class InvalidRequestError(PaymentError):
    """Tham số không hợp lệ (mã tham chiếu chứa dữ liệu cá nhân, số tiền sai...)."""

    code = "INVALID_REQUEST"


class GatewayUnavailableError(PaymentError):
    """Cổng thanh toán (ZaloPay) lỗi, từ chối đơn hoặc không kết nối được."""

    code = "GATEWAY_UNAVAILABLE"
    retryable = True


class PaymentNotFoundError(PaymentError):
    """Không tìm thấy giao dịch của nhóm theo mã đã cho."""

    code = "PAYMENT_NOT_FOUND"


class PaymentStateError(PaymentError):
    """Thao tác không hợp lệ với trạng thái hiện tại của giao dịch hoặc không được cổng hỗ trợ."""

    code = "PAYMENT_STATE"
