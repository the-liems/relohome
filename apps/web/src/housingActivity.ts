import { dateTime, money } from "./api";
import { formatUi, t } from "./uiPreferences";
import type { Data } from "./types";
export function activityText(event: Data) {
  const p = event.payload || {};
  const labels: Record<string, string> = {
    contact_requested: "Người thuê muốn trao đổi về căn này.",
    viewing_requested:
      "Người thuê đề nghị xem nhà lúc {0}. Vui lòng xác nhận hoặc đề xuất giờ khác.",
    viewing_confirmed: "Chủ nhà đã xác nhận lịch xem lúc {0}.",
    viewing_proposed:
      "Chủ nhà đã gửi những giờ xem thay thế. Hãy chọn giờ phù hợp.",
    viewing_cancelled: "Người thuê đã hủy lịch xem căn này.",
    request_closed: "Yêu cầu liên hệ đã được xử lý.",
    payment_reported:
      "Người thuê báo đã chuyển {0}. Vui lòng kiểm tra và xác nhận nhận tiền.",
    payment_confirmed: "Chủ nhà đã xác nhận nhận tiền. Thỏa thuận đã hoàn tất.",
    payment_rejected: "Chủ nhà cần bạn kiểm tra lại khoản chuyển tiền: {0}",
    listing_submitted: "Tin đăng mới đang chờ Admin duyệt.",
    listing_published: "Admin đã duyệt tin đăng của bạn.",
    listing_rejected: "Admin yêu cầu sửa tin đăng: {0}",
    host_submitted: "Hồ sơ người đăng mới đang chờ xác minh.",
    host_pending: "Người đăng đã cập nhật hồ sơ chờ xác minh.",
    host_verified: "Admin đã xác minh hồ sơ người đăng của bạn.",
    host_needs_info: "Hồ sơ cần bổ sung thông tin: {0}",
    property_submitted: "Địa điểm mới đang chờ Admin xác minh.",
    property_active: "Admin đã xác minh địa điểm của bạn.",
    property_revoked: "Quyền quản lý địa điểm đã thay đổi.",
  };
  const value =
    event.kind === "payment_reported"
      ? money(p.amount_vnd)
      : event.kind.includes("rejected") || event.kind === "host_needs_info"
        ? p.reason || t("Xem chi tiết")
        : p.slot
          ? dateTime(p.slot)
          : t("giờ đã chọn");
  return formatUi(labels[event.kind] || "Có cập nhật mới về căn này.", [value]);
}
export function activityDestination(event: Data) {
  if (event.audience === "admin")
    return event.listing_id
      ? `/admin?listing=${encodeURIComponent(event.listing_id)}`
      : `/admin?identity=${encodeURIComponent(event.property_id || event.subject_user_id || "")}`;
  if (event.audience === "landlord") {
    if (event.contact_id)
      return `/landlord?request=${encodeURIComponent(event.contact_id)}`;
    if (event.listing_id)
      return `/landlord?listing=${encodeURIComponent(event.listing_id)}&property=${encodeURIComponent(event.property_id)}`;
    return `/landlord?${event.property_id ? "property=" + encodeURIComponent(event.property_id) : "profile=1"}`;
  }
  return event.thread_id
    ? `/ai/${encodeURIComponent(event.thread_id)}?panel=plan&planTab=viewing&listing=${encodeURIComponent(event.listing_id || "")}`
    : null;
}
/** Work waiting for the owner, counted per item: each viewing to confirm,
 * each reported transfer and each unread message adds one. */
export function attentionItems(items: Data[]) {
  const open = (row: Data) =>
    ["new", "contacted", "viewing"].includes(row.status);
  const viewings = items.filter(
    (row) => open(row) && row.viewing_status === "requested",
  ).length;
  const payments = items.filter(
    (row) => row.payment_report?.status === "pending",
  ).length;
  const unread = items.reduce((sum, row) => sum + Number(row.unread || 0), 0);
  return { viewings, payments, unread, total: viewings + payments + unread };
}

export function attentionCount(items: Data[]) {
  return items.filter(
    (row) =>
      row.unread > 0 ||
      row.update_unread ||
      row.payment_report?.status === "pending" ||
      (["new", "contacted", "viewing"].includes(row.status) &&
        row.viewing_status === "requested"),
  ).length;
}
