// Uploaded photos belong to the gateway volume. Restored snapshots can still
// contain the old local origin; use the current app origin without changing
// canonical data or external provider photos.
export function normalizeHousingMedia<T>(value: T, origin: string): T {
  if (typeof value === "string") {
    const match = value.match(
      /^https?:\/\/[^/]+(\/web\/media\/housing\/[a-f0-9]{40}\.png)$/i,
    );
    return (match ? origin.replace(/\/$/, "") + match[1] : value) as T;
  }
  if (Array.isArray(value))
    return value.map((item) => normalizeHousingMedia(item, origin)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeHousingMedia(item, origin),
      ]),
    ) as T;
  }
  return value;
}
