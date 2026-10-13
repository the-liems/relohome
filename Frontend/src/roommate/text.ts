import { uiPreferences } from "../uiPreferences";
export const rt = (vi: string, en: string) =>
  uiPreferences().locale === "en" ? en : vi;
export const cityName = (city?: string | null) =>
  ({
    hcm: rt("TP. Hồ Chí Minh", "Ho Chi Minh City"),
    hanoi: rt("Hà Nội", "Hanoi"),
    danang: rt("Đà Nẵng", "Da Nang"),
  })[city || ""] || rt("Chưa khai", "Not provided");
export const areaName = (id: string) =>
  id.startsWith("city:") ? rt("Toàn ", "All of ") + cityName(id.slice(5)) : id;
export function options(kind: string): [string, string][] {
  const labels: Record<string, [string, string, string][]> = {
    gender: [
      ["female", "Nữ", "Female"],
      ["male", "Nam", "Male"],
      ["non_binary", "Phi nhị nguyên", "Non-binary"],
      ["other", "Khác", "Other"],
    ],
    smoking: [
      ["non_smoker", "Không hút thuốc", "Non-smoker"],
      ["outdoors_only", "Chỉ hút ngoài nhà", "Outdoors only"],
      ["indoors", "Hút trong nhà", "Indoors"],
    ],
    tolerance: [
      ["no_smoking", "Không hút thuốc", "No smoking"],
      ["outdoors_only", "Chỉ ngoài nhà", "Outdoors only"],
      ["indoors_allowed", "Cho phép trong nhà", "Indoors allowed"],
    ],
    cleanliness: [
      ["daily", "Dọn hằng ngày", "Daily cleaning"],
      ["several_times_week", "Vài lần mỗi tuần", "Several times a week"],
      ["weekly", "Dọn mỗi tuần", "Weekly cleaning"],
    ],
    sociability: [
      ["mostly_private", "Ưu tiên riêng tư", "Mostly private"],
      ["balanced", "Cân bằng", "Balanced"],
      ["often_shared", "Hay dùng không gian chung", "Often shared"],
    ],
    boolean: [
      ["true", "Có", "Yes"],
      ["false", "Không", "No"],
    ],
  };
  return (labels[kind] || []).map(([value, vi, en]) => [value, rt(vi, en)]);
}
export const valueName = (kind: string, value?: string | boolean | null) =>
  options(kind).find(([key]) => key === String(value))?.[1] ||
  rt("Chưa khai", "Not provided");
export const factorName = (factor: string) =>
  ({
    areas: rt("Khu vực", "Area"),
    budget: rt("Ngân sách", "Budget"),
    move_in: rt("Ngày vào ở", "Move-in"),
    smoking: rt("Hút thuốc", "Smoking"),
    pets: rt("Thú cưng", "Pets"),
    pets_allowed: rt("Thú cưng", "Pets"),
    quiet_hours: rt("Giờ yên tĩnh", "Quiet hours"),
    cleanliness: rt("Dọn dẹp", "Cleaning"),
    sociability: rt("Không gian chung", "Shared space"),
    gender: rt("Giới tính", "Gender"),
  })[factor] || factor;
export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat(uiPreferences().locale === "en" ? "en-GB" : "vi-VN", {
    dateStyle: "medium",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value.length === 10 ? value + "T00:00:00+07:00" : value));
export const deadlineLabel = (value: string) =>
  new Intl.DateTimeFormat(uiPreferences().locale === "en" ? "en-GB" : "vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
export function reasonName(reason: string) {
  const [side, key, status] = reason.split(".");
  if (side === "housing_need")
    return rt("Nhu cầu chỗ ở chưa phù hợp", "Housing needs do not align");
  return (
    (side === "candidate"
      ? rt("Điều kiện của đối phương: ", "Their requirement: ")
      : rt("Tiêu chí của bạn: ", "Your criterion: ")) +
    factorName(key || side) +
    (status === "unknown"
      ? rt(" · chưa đủ dữ liệu", " · information missing")
      : rt(" · chưa đáp ứng", " · not met"))
  );
}
export const stateName = (state: string) =>
  ({
    pending: rt("Chờ phản hồi", "Awaiting reply"),
    accepted: rt("Đã đồng ý", "Accepted"),
    rejected: rt("Đã từ chối", "Declined"),
    withdrawn: rt("Đã rút", "Withdrawn"),
    expired: rt("Hết hạn", "Expired"),
    cancelled: rt("Đã đóng", "Closed"),
    draft: rt("Bản nháp", "Draft"),
    active: rt("Đang tìm", "Active"),
    paused: rt("Tạm dừng", "Paused"),
    resolved: rt("Đã tìm được", "Resolved"),
    deleted: rt("Đã xóa", "Deleted"),
    restricted: rt("Bị hạn chế", "Restricted"),
    revoked: rt("Đã thu hồi", "Revoked"),
    open: rt("Chờ xử lý", "Open"),
    reviewed: rt("Đã xem xét", "Reviewed"),
    approved: rt("Đã duyệt", "Approved"),
  })[state] || state;
