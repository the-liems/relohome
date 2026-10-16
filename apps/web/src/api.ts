import { normalizeHousingMedia } from "./housingMedia";
import { t, uiPreferences } from "./uiPreferences";
import { apiFailure } from "./apiError";
import { reportAuthFailure } from "./authEvents";
export { ApiError, apiFailure } from "./apiError";
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetch("/web/api" + path, {
    method,
    credentials: "same-origin",
    signal,
    headers: { "Content-Type": "application/json", "X-SIU-Request": "1",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let isJson = true;
  const data = await response.json().catch(() => {
    isJson = false;
    return null;
  });
  if (!response.ok || !isJson) {
    const error = apiFailure(response.status, data, isJson);
    reportAuthFailure(path, response.status, data, isJson);
    throw error;
  }
  return normalizeHousingMedia(data,window.location.origin);
}
export const requestId = () => crypto.randomUUID();
export const money = (n: unknown, currency = "VND") =>
  typeof n === "number" && Number.isFinite(n)
    ? new Intl.NumberFormat(
        uiPreferences().locale === "en" ? "en-US" : "vi-VN",
        {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        },
      ).format(n)
    : t("Chưa có giá");
export const dateTime = (value?: string | number) =>
  value
    ? new Date(typeof value === "number" ? value * 1000 : value).toLocaleString(
        uiPreferences().locale === "en" ? "en-GB" : "vi-VN",
        {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        },
      )
    : t("Chưa xác định");
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
    ? `${money(h.price.amount, h.price.currency)} / ${t(periods[h.price.period] || h.price.period)}`
    : h.price_vnd != null
      ? `${money(h.price_vnd)} / ${t("tháng")}`
      : t("Chưa có giá");
// Card price like map-app: "8,1 tr/tháng"; exact amount stays in the detail panel.
export const compactPrice = (h: any) => {
  const amount = h.price?.amount ?? h.price_vnd;
  if (typeof amount !== "number") return t("Chưa có giá");
  const period = t(periods[h.price?.period] || h.price?.period || "tháng");
  if (h.price?.currency && h.price.currency !== "VND") return housePrice(h);
  return amount >= 1_000_000
    ? `${(amount / 1_000_000).toLocaleString(uiPreferences().locale === "en" ? "en-US" : "vi-VN", { maximumFractionDigits: 1 })} ${uiPreferences().locale === "en" ? "M VND" : "tr"}/${period}`
    : `${Math.round(amount / 1000).toLocaleString("vi-VN")}k/${period}`;
};
export const domainLabels: Record<string, string> = {
  property: "Tìm nhà",
  map: "Đường đi",
  roommate: "Ở ghép",
  flight: "Chuyến bay",
  relocation: "Chuyển đồ",
  payment: "Thanh toán",
};
