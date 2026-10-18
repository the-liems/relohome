class FlightError(Exception):
    """Lỗi nghiệp vụ. Message được trả nguyên văn cho client MCP nên không chứa thông tin nhạy cảm.

    `code` và `retryable` đi cùng message trong lỗi MCP có cấu trúc `{code, message, retryable}`.
    """

    code = "FLIGHT_ERROR"
    retryable = False


class InvalidRequestError(FlightError):
    """Tham số không hợp lệ (sân bay không hỗ trợ, ngày trong quá khứ, sai số khách...)."""

    code = "INVALID_REQUEST"


class ProviderUnavailableError(FlightError):
    """Nguồn dữ liệu chuyến bay (SerpApi) lỗi, hết lượt hoặc không kết nối được."""

    code = "PROVIDER_UNAVAILABLE"
    retryable = True


class OfferNotFoundError(FlightError):
    """Offer không tồn tại hoặc đã hết hạn."""

    code = "OFFER_NOT_FOUND"


class BookingNotFoundError(FlightError):
    """Không tìm thấy booking theo mã booking hoặc PNR."""

    code = "BOOKING_NOT_FOUND"


class BookingStateError(FlightError):
    """Thao tác không hợp lệ với trạng thái hiện tại của booking."""

    code = "BOOKING_STATE"
