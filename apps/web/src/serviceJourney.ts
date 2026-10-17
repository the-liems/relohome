import type { Component, Message, Thread } from "./types";

export type ServiceTarget = { c: Component; version: number };

/** Keep an already open map as read-only context, never as a successful new search. */
export function retainHousingWorkspace(thread: Thread | null, previousThreadId?: string): boolean {
  if (!thread || thread.id !== previousThreadId) return false;
  const intake = thread.state.intake;
  const domains = intake?.intent?.domains ?? intake?.domains ?? [];
  const reply = [...thread.messages].reverse().find(m => m.role === "assistant")?.content.response;
  return ["change", "refine"].includes(intake?.kind) &&
    domains.length === 1 && domains[0] === "property" &&
    !["compare", "search_compare"].includes(intake?.constraints?.values?.housing_mode) &&
    ["ERROR", "CLARIFY"].includes(reply?.kind || "");
}

/** History is opened by its task ID, never silently substituted for a failed new search. */
export function currentHousingTarget(
  thread: Thread | null,
  taskId: string | null,
): ServiceTarget | undefined {
  const targets = serviceTargets(thread).filter((t) => t.c.type === "property");
  if (taskId) return targets.find((t) => t.c.task_id === taskId);
  return targets
    .reverse()
    .find(
      (t) =>
        thread?.state.plan?.tasks?.some(
          (task: { id: string }) => task.id === t.c.task_id,
        ) && thread?.state.task_status?.[t.c.task_id] === "done",
    );
}

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
      if (c.type === "property" && c.data?.comparison) continue;
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

/** Historical search is viewable, but an analysis task cannot accept a choice. */
export function canSelectServiceResult(
  thread: Thread | null,
  target: ServiceTarget,
): boolean {
  const task = thread?.state.plan?.tasks?.find(
    (t: any) => t.id === target.c.task_id,
  );
  return (
    !!task &&
    !target.c.data?.comparison &&
    !(task.agent === "property" && task.inputs?.housing_mode === "compare") &&
    thread?.state.task_status?.[task.id] === "done"
  );
}

/** Legacy comparisons overwrote backend search IDs. Offer the actual saved map
 * for browsing only; never reconstruct a valid quote or a confirmed cost. */
export function navigationProgress(thread: Thread | null) {
  const progress = thread?.state.progress || { items: [], totals: {} };
  const items = (progress.items || []).filter(
    (i: any) => i.inputs?.housing_mode !== "compare",
  );
  for (const target of serviceTargets(thread)) {
    const task = thread?.state.plan?.tasks?.find(
      (t: any) => t.id === target.c.task_id,
    );
    if (
      target.c.type !== "property" ||
      task?.inputs?.housing_mode !== "compare" ||
      items.some((i: any) => i.task_id === target.c.task_id)
    )
      continue;
    const request = target.c.data.search_request;
    if (!request) continue;
    items.push({
      task_id: target.c.task_id,
      agent: "property",
      historical_search: true,
      inputs: {
        city: target.c.data.area_name,
        district: request.district,
        max_price_vnd: request.max_price,
      },
      state: "reviewed",
      task_status: "done",
      chosen: null,
      after: [],
      level: 0,
    });
  }
  return { ...progress, items };
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

/** Uses authoritative goal/progress state, not a keyword rule on user text. */
export function pendingServiceInput(
  thread: Thread | null,
  agent: string,
  taskId?: string,
): boolean {
  return (thread?.state.progress?.items || []).some(
    (item: any) =>
      item.agent === agent &&
      (!taskId || item.task_id === taskId) &&
      (item.task_id.startsWith("pending:") ||
        (thread?.state.plan?.tasks || []).some(
          (t: any) => t.id === item.task_id,
        )) &&
      item.state === "waiting" &&
      !item.chosen &&
      ["pending", "blocked", "needs_input", "stale"].includes(item.task_status),
  );
}

export type PlanStep = {
  taskId: string;
  agent: string;
  kind: "input" | "result";
};

/** Agent intake owns the requested domains. Older threads fall back to current plan goals. */
export function hasMultipleRequestedServices(thread: Thread | null): boolean {
  if (!thread) return false;
  const requested = thread.state.intake?.intent?.domains ?? thread.state.intake?.domains;
  const domains = Array.isArray(requested) && requested.length
    ? requested
    : navigationProgress(thread).items
      .filter((item: any) => !item.historical_search && item.inputs?.housing_mode !== "compare")
      .map((item: any) => item.agent);
  return new Set(domains.filter((domain: string) =>
    ["property", "flight", "relocation", "map", "roommate"].includes(domain),
  )).size > 1;
}

/** Navigation only: a viewing basket may be reviewed, but is never a decided destination. */
export function nextPlanStep(
  thread: Thread | null,
  reviewed: ReadonlySet<string> = new Set(),
): PlanStep | null {
  if (!thread) return null;
  const targets = serviceTargets(thread);
  for (const item of navigationProgress(thread).items) {
    if (item.historical_search || item.inputs?.housing_mode === "compare")
      continue;
    if (
      !["property", "flight", "relocation", "map", "roommate"].includes(
        item.agent,
      )
    )
      continue;
    if (
      item.chosen ||
      ["confirmed", "completed", "cancelled"].includes(item.state)
    )
      continue;
    if (
      !item.task_id?.startsWith("pending:") &&
      !thread.state.plan?.tasks?.some((t: any) => t.id === item.task_id)
    )
      continue;
    const viewingChoice =
      item.agent === "property" &&
      (thread.state.viewing?.items || []).some(
        (v: any) =>
          v.task_id === item.task_id &&
          !["cancelled", "declined", "backup"].includes(v.status),
      );
    if (viewingChoice) continue;
    if (pendingServiceInput(thread, item.agent, item.task_id))
      return { taskId: item.task_id, agent: item.agent, kind: "input" };
    const target = targets.find((t) => t.c.task_id === item.task_id);
    if (target && !target.c.data?.order && !reviewed.has(target.c.id))
      return { taskId: item.task_id, agent: item.agent, kind: "result" };
  }
  return null;
}

/** Fold long result narratives after choice, keeping original text accessible. */
export function closedResultSummary(
  message: Message,
  thread: Thread | null,
): string | null {
  const components = message.content.ui?.components || [];
  if (
    !components.length ||
    components.some((c) => c.data?.comparison || c.data?.order)
  )
    return null;
  const selections = components.map((c) =>
    (thread?.state.progress?.items || []).find(
      (i: any) =>
        i.task_id === c.task_id && i.state === "confirmed" && i.chosen,
    ),
  );
  if (selections.some((i) => !i)) return null;
  return (
    "Đã chọn phương án: " +
    [...new Set(selections.map((i) => i.chosen.label))].join("; ") +
    ". Chi tiết và trạng thái được lưu trong Kế hoạch."
  );
}
