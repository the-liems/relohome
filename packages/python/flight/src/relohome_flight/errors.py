class FlightError(Exception):
    """Lỗi nghiệp vụ. Message được trả nguyên văn cho client MCP nên không chứa thông tin nhạy cảm."""


class InvalidRequestError(FlightError):
    """Tham số không hợp lệ (sân bay không hỗ trợ, ngày trong quá khứ, sai số khách...)."""


class ProviderUnavailableError(FlightError):
    """Nguồn dữ liệu chuyến bay (SerpApi) lỗi, hết lượt hoặc không kết nối được."""


class OfferNotFoundError(FlightError):
    """Offer không tồn tại hoặc đã hết hạn."""


class BookingNotFoundError(FlightError):
    """Không tìm thấy booking theo mã booking hoặc PNR."""


class BookingStateError(FlightError):
    """Thao tác không hợp lệ với trạng thái hiện tại của booking."""
