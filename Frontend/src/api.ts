export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/web/api" + path, {
    method,
    credentials: "same-origin",
    signal,
    headers: { "Content-Type": "application/json", "X-SIU-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof data.detail === "string"
        ? data.detail
        : "Không thể hoàn thành yêu cầu. Vui lòng thử lại.",
    );
  return data;
}
export const requestId = () => crypto.randomUUID();
export const money = (n: unknown, currency = "VND") =>
  typeof n === "number" && Number.isFinite(n)
    ? new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(n)
    : "Chưa có giá";
export const dateTime = (value?: string | number) =>
  value
    ? new Date(typeof value === "number" ? value * 1000 : value).toLocaleString(
        "vi-VN",
        {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        },
      )
    : "Chưa xác định";
export const safeUrl = (value: unknown) =>
  typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined;
export const periods: Record<string, string> = {
  month: "tháng",
  week: "tuần",
  day: "ngày",
  night: "đêm",
  year: "năm",
  total: "tổng",
};
export const housePrice = (h: any) =>
  h.price?.amount != null
    ? `${money(h.price.amount, h.price.currency)} / ${periods[h.price.period] || h.price.period}`
    : h.price_vnd != null
      ? `${money(h.price_vnd)} / tháng`
      : "Chưa có giá";
export const domainLabels: Record<string, string> = {
  property: "Tìm nhà",
  map: "Bản đồ & tiện ích",
  flight: "Chuyến bay",
  relocation: "Chuyển đồ",
  payment: "Thanh toán",
};
