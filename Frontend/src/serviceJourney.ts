import type { Component, Thread } from "./types";

export type ServiceTarget = { c: Component; version: number };

/** Current plan results, not historical cards repeated in a later reply. */
export function serviceTargets(thread: Thread | null): ServiceTarget[] {
  if (!thread) return [];
  const tasks = thread.state.plan?.tasks || [];
  const items = thread.state.progress?.items || [];
  const active = new Set<string>([
    ...tasks.map((t: { id: string }) => t.id),
    ...items.map((i: { task_id: string }) => i.task_id),
  ]);
  const latest = new Map<string, ServiceTarget>();
  for (const message of thread.messages || []) {
    for (const c of message.content.ui?.components || []) {
      if (active.size && !active.has(c.task_id)) continue;
      if (!["property", "flight", "relocation", "map"].includes(c.type))
        continue;
      const status = thread.state.task_status?.[c.task_id];
      if (status && status !== "done") continue;
      latest.set(c.task_id, {
        c,
        version:
          thread.state.plan?.version || message.content.ui?.plan_version || 0,
      });
    }
  }
  const order = new Map<string, number>(
    tasks.map((t: { id: string }, i: number) => [t.id, i]),
  );
  return [...latest.values()].sort(
    (a, b) => (order.get(a.c.task_id) ?? 0) - (order.get(b.c.task_id) ?? 0),
  );
}

export function hasSelection(
  thread: Thread | null,
  target: ServiceTarget,
): boolean {
  const item = thread?.state.progress?.items?.find(
    (i: { task_id: string }) => i.task_id === target.c.task_id,
  );
  return !!item?.chosen && item.task_status !== "stale";
}

export function nextServiceTarget(
  thread: Thread | null,
  reviewed: ReadonlySet<string> = new Set(),
): ServiceTarget | undefined {
  return serviceTargets(thread).find(
    (t) =>
      (thread?.state.plan?.tasks || []).some(
        (task: { id: string }) => task.id === t.c.task_id,
      ) &&
      !t.c.data?.comparison &&
      !t.c.data?.order &&
      !hasSelection(thread, t) &&
      !reviewed.has(t.c.id),
  );
}
