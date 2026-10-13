import type { House } from "./types";

export const MAX_COMPARISON_HOMES = 4;
export const DEVICE_ROUTE_SNAP_M = 100;
export const CONSENTED_ROUTE_SNAP_M = 500;

// Typed provider outcomes, not landmark keywords or a fabricated route fallback.
export function deviceRouteErrorMessage(code: string): string {
  if (code === "NO_ROUTE")
    return "Đã lấy được vị trí, nhưng chưa tìm được đường ô tô nối hai điểm trong phạm vi cho phép. Kiểm tra điểm GPS trên bản đồ; vị trí laptop hoặc dữ liệu đường có thể chưa đủ chính xác.";
  if (code === "OUTSIDE_ROUTING_AREA")
    return "Vị trí của bạn hoặc căn nhà nằm ngoài vùng dữ liệu đường hiện có.";
  if (code === "OSRM_OFFLINE")
    return "Dịch vụ chỉ đường hiện không kết nối được. Vị trí đã lấy được; hãy thử lại sau.";
  if (code === "TIMEOUT")
    return "Dịch vụ tuyến đường quá thời gian. Bạn có thể thử lại.";
  return "Chưa tính được tuyến đường. Vị trí đã lấy được; bạn có thể thử lại.";
}

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
