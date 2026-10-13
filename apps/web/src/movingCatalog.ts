import type { Data } from "./types";

// Display grouping only. The provider service_id remains the selected/sent value.
export const vehicleFamilies = [
  { id: "truck", label: "Xe tải" },
  { id: "van", label: "Xe van" },
  { id: "bike", label: "Xe máy" },
  { id: "pickup", label: "Xe bán tải" },
  { id: "tricycle", label: "Xe ba gác" },
];
export function vehicleFamily(service: Data): string {
  const text = `${service.name || ""} ${service.service_id || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\bvan\b/.test(text)) return "van";
  if (/tricycle|ba gac/.test(text)) return "tricycle";
  if (/pickup|ban tai/.test(text)) return "pickup";
  if (/truck|xe tai|ban tai/.test(text)) return "truck";
  if (
    /bike|xe may/.test(text) ||
    /-(eco|pool)$/i.test(String(service.service_id || ""))
  )
    return "bike";
  return "other";
}
export function vehicleCapacity(service: Data): string {
  // Only a capacity explicitly stated in the provider name; never infer it from an ID.
  const text = String(service.name || "").toLowerCase();
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|tấn|tan|ton(?:ne)?s?)\b/u);
  if (!match) return "other";
  const amount = Number(match[1].replace(",", "."));
  return String(amount * (match[2] === "kg" ? 1 : 1000));
}
