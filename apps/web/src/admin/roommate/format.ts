import { rt } from "../../roommate/text";
import type { Profile } from "./types";
export const cityName = (city?: string | null) =>
  ({
    hcm: rt("TP. Hồ Chí Minh", "Ho Chi Minh City"),
    hanoi: rt("Hà Nội", "Hanoi"),
    danang: rt("Đà Nẵng", "Da Nang"),
  })[city || ""] || rt("Chưa cung cấp", "Not provided");
export const needName = (kind?: string) =>
  kind === "has_room"
    ? rt("Có phòng", "Has a room")
    : kind === "looking_together"
      ? rt("Cùng tìm phòng", "Looking together")
      : rt("Chưa cung cấp", "Not provided");
export function budgetName(profile: Profile) {
  const budget = profile.facts?.budget;
  if (!budget) return rt("Chưa cung cấp", "Not provided");
  const money = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
  return (
    (budget.min_vnd ? money(budget.min_vnd) + " – " : rt("Đến ", "Up to ")) +
    money(budget.max_vnd) +
    rt(" đ/người/tháng", " VND/person/month")
  );
}
export function timeName(value?: string | number | null) {
  if (!value) return "—";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(
        document.documentElement.lang === "en" ? "en-GB" : "vi-VN",
        { dateStyle: "medium", timeStyle: "short" },
      );
}
