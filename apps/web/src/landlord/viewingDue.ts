import type { ContactRequest } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** Calendar days from today to the viewing, in the owner's local time. */
export function daysUntil(slot: string, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = new Date(slot);
  const day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  return Math.round((day.getTime() - start.getTime()) / DAY);
}

const active = (row: ContactRequest) =>
  Boolean(row.viewing_slot) &&
  (row.viewing_status === "requested" || row.viewing_status === "confirmed");

/** Viewings still ahead today or tomorrow: the owner is reminded a day before. */
export function viewingReminders(rows: ContactRequest[], now = new Date()) {
  return rows
    .filter(
      (row) =>
        active(row) &&
        new Date(row.viewing_slot!).getTime() >= now.getTime() &&
        daysUntil(row.viewing_slot!, now) <= 1,
    )
    .sort(
      (a, b) =>
        new Date(a.viewing_slot!).getTime() -
        new Date(b.viewing_slot!).getTime(),
    );
}
