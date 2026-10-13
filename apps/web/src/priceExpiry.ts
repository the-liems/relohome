import { useEffect, useState } from "react";

export const priceExpired = (value?: string) =>
  !value ||
  !Number.isFinite(Date.parse(value)) ||
  Date.parse(value) <= Date.now();

// Update buttons when provider prices expire, including while the user stays on a screen.
export function usePriceExpiry(values: (string | undefined)[]) {
  const [now, setNow] = useState(Date.now);
  const expiryKey = JSON.stringify(values);
  useEffect(() => {
    const current = Date.now();
    const deadlines: (string | undefined)[] = JSON.parse(expiryKey);
    const next = Math.min(
      ...deadlines.map((v) => Date.parse(v || "")).filter((v) => v > current),
    );
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(next - current + 10, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [expiryKey, now]);
}
