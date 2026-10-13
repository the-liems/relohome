export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "",
    public fields: Record<string,string> = {},
  ) {
    super(message);
  }
}

/** Keep proxy/HTML failures distinguishable without displaying their raw body. */
export function apiFailure(
  status: number,
  data: unknown,
  isJson = true,
): ApiError {
  const body =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (!isJson) {
    const message =
      status === 403
        ? "Yêu cầu bị chặn tại cổng truy cập (HTTP 403). Hãy tải lại trang rồi thử lại."
        : status >= 500
          ? `Cổng kết nối dịch vụ đang lỗi (HTTP ${status}). Hãy thử lại sau.`
          : `Máy chủ chưa trả dữ liệu hợp lệ (HTTP ${status}). Hãy tải lại trang.`;
    return new ApiError(
      status,
      message,
      status === 403 ? "ACCESS_BLOCKED" : "INVALID_RESPONSE",
    );
  }
  return new ApiError(
    status,
    typeof body.detail === "string"
      ? body.detail
      : `Không thể hoàn thành yêu cầu (HTTP ${status}). Vui lòng thử lại.`,
    typeof body.code === "string" ? body.code : "",
  );
}
