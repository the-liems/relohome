import type { Data } from "./types";

/** Only trusted IDs/aliases establish equality. Same-name buildings/stops remain separate. */
export function mergePlaceCandidates(
  rows: Data[],
  selected?: string | Data,
): Data[] {
  const selectedId = typeof selected === "string" ? selected : selected?.id;
  const canonical = new Map<string, string>();
  for (const row of rows) {
    if (!row.id) continue;
    canonical.set(row.id, row.id);
    for (const id of row.alias_ids || []) canonical.set(id, row.id);
  }
  // Re-apply alias mappings after all self-IDs: old choices may follow fresh search rows.
  for (const row of rows)
    for (const id of row.alias_ids || []) canonical.set(id, row.id);
  const unique = new Map<string, Data>();
  for (const row of rows) {
    const key = canonical.get(row.id) || row.id;
    if (!key) continue;
    const previous = unique.get(key);
    if (
      !previous ||
      row.id === selectedId ||
      (previous.id !== selectedId && row.id === key)
    )
      unique.set(key, row);
  }
  if (selected && typeof selected !== "string") {
    const key = canonical.get(selected.id) || selected.id;
    if (unique.has(key)) unique.set(key, { ...unique.get(key), ...selected });
  }
  return [...unique.values()];
}
