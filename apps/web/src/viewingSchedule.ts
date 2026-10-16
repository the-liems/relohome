import type { Data } from "./types";
import { ApiError } from "./apiError";

export type ScheduleEntry = { listing_id: string; slot: string };
export type BatchRow = ScheduleEntry & {
  status:
    "saved" | "unchanged" | "failed" | "unknown" | "sync_pending" | "not_sent";
  message?: string;
  code?: string;
};
export const contactClosed = (item: Data) =>
  ["declined", "resolved"].includes(item.landlord?.request_status) ||
  item.landlord?.viewing_status === "cancelled";
export function scheduleEligible(item: Data): boolean {
  return (
    (["selected", "viewing_scheduled", "backup"].includes(item.status) ||
      (item.status === "visit_due" &&
        (contactClosed(item) ||
          item.landlord?.viewing_status === "declined"))) &&
    !(item.status === "backup" && item.backup_from === "visited")
  );
}
export const slotsFor = (viewing: Data, item?: Data): string[] =>
  Array.isArray(item?.available_slots)
    ? item.available_slots
    : viewing.slots || [];
export const batchLimit = (viewing: Data) => {
  const value = Number(viewing.max_selected ?? 3);
  return Number.isFinite(value)
    ? Math.min(3, Math.max(0, Math.floor(value)))
    : 0;
};
export const sameSlot = (a?: string, b?: string) =>
  Boolean(
    a && b && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b),
  );
export function scheduleIssues(
  viewing: Data,
  entries: ScheduleEntry[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (
    !entries.length ||
    entries.length > batchLimit(viewing) ||
    new Set(entries.map((e) => e.listing_id)).size !== entries.length
  )
    errors._selection =
      "Hãy chọn các căn cần đặt lịch trong giới hạn cho phép.";
  for (const e of entries) {
    const item = (viewing.items || []).find(
      (i: Data) => i.listing_id === e.listing_id,
    );
    if (!item || !scheduleEligible(item))
      errors[e.listing_id] =
        "Căn này không còn đủ điều kiện đặt lịch. Hãy xem lại danh sách.";
    else if (!e.slot) errors[e.listing_id] = "Chọn ngày và giờ cho căn này.";
    else if (
      !slotsFor(viewing, item).includes(e.slot) ||
      !Number.isFinite(Date.parse(e.slot))
    )
      errors[e.listing_id] = "Khung giờ không còn khả dụng. Hãy chọn lại.";
  }
  const minutes = Number(viewing.slot_minutes || 0);
  for (let a = 0; a < entries.length; a++)
    for (let b = a + 1; b < entries.length; b++) {
      const delta = Math.abs(
        Date.parse(entries[a].slot) - Date.parse(entries[b].slot),
      );
      if (delta === 0 || (minutes > 0 && delta < minutes * 60000)) {
        errors[entries[a].listing_id] = errors[entries[b].listing_id] =
          "Hai lịch bị trùng giờ. Hãy chọn giờ khác.";
      }
    }
  return errors;
}

/** One UI confirmation, serial legacy requests. No retries, rollback, or invented atomicity. */
export async function sendViewingBatch(
  viewing: Data,
  entries: ScheduleEntry[],
  schedule: (entry: ScheduleEntry) => Promise<Data>,
  onProgress?: (rows: BatchRow[], active?: string) => void,
  shouldContinue: () => boolean = () => true,
): Promise<BatchRow[]> {
  const rows: BatchRow[] = [...entries]
    .sort((a, b) => Date.parse(a.slot) - Date.parse(b.slot))
    .map((entry) => ({ ...entry, status: "not_sent" }));
  for (const row of rows) {
    if (!shouldContinue()) break;
    const original = (viewing.items || []).find(
      (i: Data) => i.listing_id === row.listing_id,
    );
    if (
      original &&
      sameSlot(original.viewing?.slot, row.slot) &&
      !contactClosed(original) &&
      original.landlord?.viewing_status !== "declined"
    ) {
      row.status =
        original.landlord?.sync === "failed" ? "sync_pending" : "unchanged";
      onProgress?.(rows.map((r) => ({ ...r })));
      if (row.status === "sync_pending") break;
      continue;
    }
    onProgress?.(
      rows.map((r) => ({ ...r })),
      row.listing_id,
    );
    try {
      const response = await schedule({
        listing_id: row.listing_id,
        slot: row.slot,
      });
      const item = (response.items || []).find(
        (i: Data) => i.listing_id === row.listing_id,
      );
      if (!item || !sameSlot(item.viewing?.slot, row.slot)) {
        row.status = "unknown";
        row.message =
          "Chưa xác định được kết quả. Kiểm tra trạng thái trước khi gửi lại.";
      } else if (
        response.landlord_unavailable ||
        item.landlord?.sync === "failed" ||
        contactClosed(item) ||
        item.landlord?.viewing_status === "declined"
      ) {
        row.status = "sync_pending";
        row.message =
          "Lịch đã lưu; yêu cầu với chủ nhà cần được kiểm tra hoặc gửi lại.";
      } else row.status = "saved";
    } catch (error) {
      const awaitingLogin = error instanceof ApiError &&
        (error.status === 401 || error.code === "authentication_required");
      if (awaitingLogin) row.code = "authentication_required";
      row.status = awaitingLogin ? "not_sent" :
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
          ? "failed"
          : "unknown";
      row.message = (error as Error).message || "Chưa nhận được phản hồi.";
    }
    onProgress?.(rows.map((r) => ({ ...r })));
    if (row.status !== "saved") break;
  }
  return rows;
}

/** Used to detect a changed consideration set/schedule before the user confirms. */
export const scheduleFingerprint = (item: Data) =>
  JSON.stringify([
    item.listing_id,
    item.title,
    item.snapshot?.address,
    item.status,
    item.viewing?.slot || null,
    item.landlord?.request_status,
    item.landlord?.viewing_status,
    item.landlord?.sync,
    item.available_slots,
    item.landlord?.viewing_options,
  ]);
