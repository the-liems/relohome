import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Data } from "./types";
import {
  batchLimit,
  slotsFor,
  contactClosed,
  scheduleEligible,
  scheduleFingerprint,
  scheduleIssues,
  sendViewingBatch,
  sameSlot,
  type BatchRow,
} from "./viewingSchedule";
import type { SlotDraft } from "./components/ViewingSlotPicker";

type Journal = {
  rows: BatchRow[];
  before: Record<string, { slot?: string; landlord: string }>;
};
const keyFor = (id: string) => "siu-viewing-batch-" + id;
const landlordStamp = (item?: Data) =>
  JSON.stringify([
    item?.landlord?.request_id,
    item?.landlord?.request_status,
    item?.landlord?.viewing_status,
  ]);
function journal(id: string): Journal {
  try {
    const value = JSON.parse(sessionStorage.getItem(keyFor(id)) || "null");
    if (
      Array.isArray(value?.rows) &&
      value.rows.length <= 3 &&
      value.before &&
      typeof value.before === "object" &&
      value.rows.every(
        (r: BatchRow) =>
          typeof r.listing_id === "string" &&
          typeof r.slot === "string" &&
          [
            "saved",
            "unchanged",
            "failed",
            "unknown",
            "sync_pending",
            "not_sent",
          ].includes(r.status) &&
          typeof value.before[r.listing_id]?.landlord === "string",
      )
    )
      return {
        ...value,
        rows: value.rows.map(({ listing_id, slot, status }: BatchRow) => ({
          listing_id,
          slot,
          status,
        })),
      };
  } catch {
    /* Optional session storage. */
  }
  return { rows: [], before: {} };
}
function saveJournal(id: string, value: Journal) {
  try {
    if (value.rows.some((r) => r.status === "unknown"))
      sessionStorage.setItem(
        keyFor(id),
        JSON.stringify({
          ...value,
          rows: value.rows.map(({ listing_id, slot, status }) => ({
            listing_id,
            slot,
            status,
          })),
        }),
      );
    else sessionStorage.removeItem(keyFor(id));
  } catch {
    /* The visible result remains available. */
  }
}

export function useViewingScheduler(
  threadId: string,
  viewing: Data,
  onChanged: () => Promise<void> | void,
  onBusyChange?: (busy: boolean) => void,
  externalBusy = false,
  requireAccount?: () => boolean,
) {
  const initial = useRef(journal(threadId));
  const [step, setStep] = useState<"selection" | "review" | "result">(
    initial.current.rows.length ? "result" : "selection",
  );
  const [checked, setChecked] = useState<string[]>([]),
    [targets, setTargets] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SlotDraft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState("");
  const [rows, setRows] = useState<BatchRow[]>(initial.current.rows),
    [active, setActive] = useState<string>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false),
    alive = useRef(true);
  const before = useRef(initial.current.before),
    reviewed = useRef<Record<string, string>>({});
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const items: Data[] = viewing.items || [];
  const tones = useRef({ threadId, values: new Map<string, string>() });
  if (tones.current.threadId !== threadId) tones.current = { threadId, values: new Map() };
  const palette = [0, 1, 2, 3].map(index => "viewing-tone-" + index);
  for (const item of items) {
    if (!tones.current.values.has(item.listing_id)) {
      const used = items.map(home => tones.current.values.get(home.listing_id));
      tones.current.values.set(item.listing_id, palette.find(tone => !used.includes(tone)) || palette[0]);
    }
  }
  const toneFor = (id: string) => tones.current.values.get(id) || palette[0];
  const eligible = items.filter(scheduleEligible);
  const unresolved = rows
    .filter((r) => r.status === "unknown")
    .map((r) => r.listing_id);
  const selected = checked.filter(
    (id) =>
      eligible.some((i) => i.listing_id === id) && !unresolved.includes(id),
  );
  const limit = batchLimit(viewing);
  const entries = targets.map((listing_id) => ({
    listing_id,
    slot: drafts[listing_id]?.slot || "",
  }));
  function draftFor(id: string): SlotDraft {
    const item =
      items.find((item) => item.listing_id === id);
    const available = slotsFor(viewing, item);
    const original = item?.viewing?.slot || "";
    const slot = available.includes(original) ? original : "";
    return (
      drafts[id] || {
        day: slot.slice(0, 10) ||
          slotsFor(
            viewing,
            items.find((item) => item.listing_id === id),
          )[0]?.slice(0, 10) || "",
        slot,
      }
    );
  }
  function changeDraft(id: string, draft: SlotDraft) {
    if (
      busy ||
      externalBusy ||
      unresolved.length ||
      !eligible.some((item) => item.listing_id === id)
    )
      return;
    if (!selected.includes(id) && selected.length >= limit) return;
    setDrafts((old) => ({ ...old, [id]: draft }));
    if (!selected.includes(id)) setChecked([...selected, id]);
  }
  function toggle(id: string) {
    if (busy || externalBusy || unresolved.includes(id)) return;
    if (!eligible.some((item) => item.listing_id === id)) return;
    setChecked((old) => {
      const current = old.filter(
        (v) =>
          eligible.some((item) => item.listing_id === v) &&
          !unresolved.includes(v),
      );
      return current.includes(id)
        ? current.filter((v) => v !== id)
        : current.length < limit
          ? [...current, id]
          : current;
    });
  }
  function start(ids = selected) {
    if (
      busy ||
      externalBusy ||
      unresolved.length ||
      !ids.length ||
      ids.length > limit
    )
      return;
    setTargets(ids);
    setChecked(ids);
    setErrors({});
    setNotice("");
    setDrafts((old) => ({
      ...old,
      ...Object.fromEntries(
        ids.map((id) => {
          const item = items.find((i) => i.listing_id === id);
          const slot = old[id]?.slot || item?.viewing?.slot || "";
          return [
            id,
            old[id] || {
              day: slot.slice(0, 10) ||
                slotsFor(
                  viewing,
                  items.find((item) => item.listing_id === id),
                )[0]?.slice(0, 10) || "",
              slot,
            },
          ];
        }),
      ),
    }));
    setStep("selection");
  }
  function review() {
    if (busy || externalBusy) return;
    const nextEntries = selected.map((listing_id) => ({
      listing_id,
      slot: draftFor(listing_id).slot,
    }));
    const issues = scheduleIssues(viewing, nextEntries);
    setErrors(issues);
    setNotice("");
    if (Object.keys(issues).length) return;
    setTargets(selected);
    setDrafts((old) => ({
      ...old,
      ...Object.fromEntries(selected.map((id) => [id, draftFor(id)])),
    }));
    reviewed.current = Object.fromEntries(
      selected.map((id) => [
        id,
        scheduleFingerprint(items.find((i) => i.listing_id === id)!),
      ]),
    );
    setStep("review");
  }
  async function confirm() {
    if (lock.current || externalBusy) return;
    if (requireAccount && !requireAccount()) {
      setNotice("Đăng nhập xong, hãy xác nhận lại các lịch chưa gửi. Lịch đã chọn vẫn được giữ.");
      return;
    }
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setNotice("");
    try {
      const fresh = await api<Data>(
        `/threads/${encodeURIComponent(threadId)}/viewings`,
      );
      if (!alive.current) return;
      if (!Array.isArray(fresh.items) || !Array.isArray(fresh.slots))
        throw new Error(
          "Chưa tải được lịch hiện tại. Hãy kiểm tra rồi thử lại.",
        );
      const issues = scheduleIssues(fresh, entries);
      const changed = targets.some((id) => {
        const current = fresh.items.find((i: Data) => i.listing_id === id);
        return (
          !current || scheduleFingerprint(current) !== reviewed.current[id]
        );
      });
      if (changed || Object.keys(issues).length) {
        setErrors(issues);
        setNotice(
          "Danh sách hoặc lịch đã thay đổi. Hãy xem lại trước khi xác nhận.",
        );
        setStep("selection");
        await onChanged();
        return;
      }
      before.current = Object.fromEntries(
        targets.map((id) => {
          const item = fresh.items.find((i: Data) => i.listing_id === id);
          return [
            id,
            { slot: item?.viewing?.slot, landlord: landlordStamp(item) },
          ];
        }),
      );
      const result = await sendViewingBatch(
        fresh,
        entries,
        async (entry) => {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 45000);
          try {
            return await api<Data>(
              `/threads/${encodeURIComponent(threadId)}/viewings/schedule`,
              "POST",
              entry,
              controller.signal,
            );
          } finally {
            window.clearTimeout(timeout);
          }
        },
        (progress, activeId) => {
          saveJournal(threadId, {
            rows: progress.map((r) =>
              r.listing_id === activeId ? { ...r, status: "unknown" } : r,
            ),
            before: before.current,
          });
          if (alive.current) {
            setRows(progress);
            setActive(activeId);
          }
        },
        () => alive.current,
      );
      if (alive.current) {
        setRows(result);
        setActive(undefined);
        const awaitingLogin = result.some(r => r.code === "authentication_required");
        // No successful write: stay at review. A partially saved batch still shows
        // individual outcomes so signing in cannot replay successful entries.
        const noneSaved = result.every(r => ["not_sent", "unchanged"].includes(r.status));
        setStep(awaitingLogin && noneSaved ? "review" : "result");
        if (awaitingLogin)
          setNotice("Đăng nhập xong, hãy xác nhận lại các lịch chưa gửi. Lịch đã chọn vẫn được giữ.");
        try {
          await onChanged();
        } catch {
          setNotice(
            "Lịch đã được xử lý; chưa tải lại được kế hoạch. Hãy kiểm tra trạng thái.",
          );
        }
      }
    } catch (error) {
      if (alive.current) setNotice((error as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
      onBusyChange?.(false);
    }
  }
  async function check() {
    if (lock.current || externalBusy) return;
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setNotice("");
    try {
      const fresh = await api<Data>(
        `/threads/${encodeURIComponent(threadId)}/viewings`,
      );
      const reconciled = rows.map((row) => {
        if (row.status !== "unknown") return row;
        const item = fresh.items?.find(
          (i: Data) => i.listing_id === row.listing_id,
        );
        const old = before.current[row.listing_id];
        if (
          item &&
          sameSlot(item.viewing?.slot, row.slot) &&
          (!old ||
            !sameSlot(old.slot, row.slot) ||
            old.landlord !== landlordStamp(item))
        ) {
          return {
            ...row,
            status:
              item.landlord?.sync === "failed" ||
              fresh.landlord_unavailable ||
              contactClosed(item) ||
              item.landlord?.viewing_status === "declined"
                ? ("sync_pending" as const)
                : ("saved" as const),
            message: undefined,
          };
        }
        return row;
      });
      if (alive.current) {
        setRows(reconciled);
        saveJournal(threadId, { rows: reconciled, before: before.current });
        await onChanged();
        if (reconciled.some((r) => r.status === "unknown"))
          setNotice(
            "Kết quả vẫn chưa rõ. Không gửi lại lịch này; hãy kiểm tra sau.",
          );
      }
    } catch (error) {
      if (alive.current) setNotice((error as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
      onBusyChange?.(false);
    }
  }
  function finish() {
    if (busy) return;
    setChecked(
      rows
        .filter((r) => ["failed", "not_sent"].includes(r.status))
        .map((r) => r.listing_id),
    );
    setStep("selection");
    setNotice("");
    setErrors({});
  }
  function openSelection() {
    if (lock.current || externalBusy) return;
    // An uncertain write must be reconciled before any new round can be sent.
    if (unresolved.length) {
      setStep("result");
      return;
    }
    setChecked(
      eligible.filter((item) => !item.viewing?.slot)
        .slice(0, limit).map((item) => item.listing_id),
    );
    setStep("selection");
    setNotice("");
    setErrors({});
  }
  return {
    step,
    toneFor,
    setStep,
    selected,
    checked,
    eligible,
    limit,
    drafts,
    draftFor,
    changeDraft,
    targets,
    errors,
    notice,
    rows,
    active,
    busy,
    unresolved,
    blocked: externalBusy && !busy,
    toggle,
    start,
    review,
    confirm,
    check,
    finish,
    openSelection,
    setChecked,
  };
}
export type ViewingSchedulerState = ReturnType<typeof useViewingScheduler>;
