import type { House } from "./types";

export const MAX_COMPARISON_HOMES = 4;

// Comparison is a local reading list, never a booking/selected-home action.
export function toggleComparison(homes: House[], home: House): House[] {
  if (homes.some((h) => h.id === home.id))
    return homes.filter((h) => h.id !== home.id);
  return homes.length < MAX_COMPARISON_HOMES ? [...homes, home] : homes;
}

export function validCoordinates(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export function locationErrorMessage(code: number): string {
  if (code === 1)
    return "Bạn chưa cấp quyền vị trí. Hãy cho phép vị trí trong trình duyệt rồi thử lại.";
  if (code === 3)
    return "Lấy vị trí quá thời gian. Kiểm tra định vị trên thiết bị rồi thử lại.";
  return "Thiết bị chưa xác định được vị trí. Không dùng vị trí giả; bạn có thể thử lại.";
}
