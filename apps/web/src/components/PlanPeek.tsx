import { formatUi } from "../uiPreferences";
import { t as uiText } from "../uiPreferences";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Target, X } from "lucide-react";
import type { Data, Thread } from "../types";
import { ConfirmedTotal, describePlanItem } from "./PlanProgress";
import { Receipts } from "./Transactions";
import { TabList } from "./TabList";
import { CheckoutPanel } from "./Checkout";
import { ViewingPanel } from "./Viewings";
import { useViewingScheduler } from "../useViewingScheduler";

function statusOf(item: Data) {
  if (item.historical_search)
    return { label: "Bản tìm nhà đã lưu", tone: "reviewed" };
  if (item.task_status === "stale")
    return { label: "Cần cập nhật", tone: "attention" };
  if (item.task_status === "failed")
    return { label: "Chưa hoàn tất", tone: "attention" };
  if (item.task_status === "needs_input" || item.task_status === "blocked")
    return { label: "Cần bổ sung", tone: "attention" };
  if (item.task_status === "skipped")
    return { label: "Đã bỏ qua", tone: "waiting" };
  if (item.state === "confirmed")
    return { label: "Đã chọn", tone: "confirmed" };
  if (item.state === "reviewed")
    return { label: "Có kết quả", tone: "reviewed" };
  if (item.task_status === "running")
    return { label: "Đang thực hiện", tone: "running" };
  return { label: "Chờ thực hiện", tone: "waiting" };
}

// Displays existing plan data; mutations use the same guarded forms and callbacks as the chat.
export function PlanPeek({
  progress,
  threadId,
  thread,
  onCheckoutChanged,
  onMovingForm,
  house,
  busy = false,
  onOpenService,
  availableServices = [],
  onPrepare,
  onBatchBusyChange,
  requireAccount,
  viewingRequest = 0,
}: {
  progress?: Data;
  threadId?: string;
  thread?: Thread | null;
  writesEnabled?: boolean;
  onDecision: (body: Data) => Promise<void>;
  onPaymentCheck: () => Promise<void>;
  onCheckoutChanged?: () => Promise<void>;
  onMovingForm?: () => void;
  house?: Data;
  busy?: boolean;
  onOpenService?: (taskId: string, agent: string) => void;
  availableServices?: string[];
  onPrepare?: (service: string, item: Data) => void;
  onBatchBusyChange?: (busy: boolean) => void;
  requireAccount?: () => boolean;
  viewingRequest?: number;
}) {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("panel") === "plan");
  const [tab, setTab] = useState(params.get("planTab") === "pending" ? "progress" : params.get("planTab") || "progress");
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const state = thread?.state || {};
  const [viewingFooter, setViewingFooter] = useState<HTMLDivElement | null>(null);
  const scheduler = useViewingScheduler(
    threadId || "",
    state.viewing || {},
    async () => { await onCheckoutChanged?.(); },
    onBatchBusyChange,
    busy,
    requireAccount,
  );
  useEffect(() => {
    if (!viewingRequest) return;
    scheduler.openSelection();
    setOpen(true);
    setTab("viewing");
  }, [viewingRequest]);
  // Older conversations may only expose the task list; display its existing status without inventing results.
  const items: Data[] =
    progress?.items ||
    (state.plan?.tasks || []).map((task: Data) => ({
      task_id: task.id,
      agent: task.agent,
      inputs: task.inputs,
      after: task.depends_on || [],
      task_status: state.task_status?.[task.id],
      state: state.task_status?.[task.id] === "done" ? "reviewed" : "waiting",
    }));
  const chosen = items.filter((item) => item.state === "confirmed").length;

  useEffect(() => {
    if (params.get("panel") === "plan") {
      setOpen(true);
      if (params.get("planTab")) setTab(params.get("planTab") === "pending" ? "progress" : params.get("planTab")!);
    }
  }, [params.toString()]);

  function close() {
    if (scheduler.busy) return;
    setOpen(false);
    if (params.get("panel") === "plan") {
      const next = new URLSearchParams(params);
      next.delete("panel");
      next.delete("planTab");
      setParams(next, { replace: true });
    }
    button.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      // Login/checkout use a separate portal; interacting with them must not close the plan.
      if (document.querySelector("dialog[open]")) return;
      if ((event.target as Element).closest?.(".guest-signin")) return;
      if (
        !panel.current?.contains(event.target as Node) &&
        !button.current?.contains(event.target as Node)
      )
        close();
    }
    function escape(event: KeyboardEvent) {
      // A dialog opened from the panel (checkout) closes first.
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        event.stopPropagation();
        close();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, scheduler.busy]);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={button}
        data-tour="plan"
        className={"plan-peek-tab" + (open ? " active" : "")}
        aria-label={uiText("Xem nhanh kế hoạch")}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Target size={16} />{" "}
        <span className="plan-peek-label">{uiText("Kế hoạch")}</span>
        {items.length > 0 && (
          <span className="plan-peek-count">{items.length}</span>
        )}
        {open ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
      {open &&
        createPortal(
          <>
          {/* Dims and blurs the page so the open plan reads as the focus. */}
          <div className="plan-peek-backdrop" aria-hidden="true" />
          <section
            ref={panel}
            id={panelId}
            tabIndex={-1}
            className="plan-peek-panel"
            aria-label={uiText("Kế hoạch trong cuộc trò chuyện")}
          >
            <header className="plan-peek-header">
              <span className="plan-peek-target">
                <Target size={22} />
              </span>
              <div>
                <h3>{uiText("Kế hoạch của bạn")}</h3>
                <p>
                  {busy
                    ? uiText("ReloHome đang cập nhật yêu cầu…")
                    : items.length
                      ? formatUi("{0} mục tiêu · {1} phương án đã chọn", [
                          items.length,
                          chosen,
                        ])
                      : uiText("Cùng ReloHome sắp xếp từng bước")}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label={uiText("Đóng kế hoạch nhanh")}
                disabled={scheduler.busy}
                onClick={close}
              >
                <X size={17} />
              </button>
            </header>
            <TabList
              className="plan-panel-tabs"
              label={uiText("Nội dung kế hoạch")}
            >
              {[
                ["progress", "Tiến trình"],
                ["cost", "Chi phí"],
                ["viewing", "Xem nhà"],
                ["checkout", "Thanh toán"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  disabled={scheduler.busy}
                  id={panelId + key}
                  aria-selected={tab === key}
                  aria-controls={panelId + "content"}
                  onClick={() => setTab(key)}
                >
                  {uiText(label)}
                </button>
              ))}
            </TabList>
            <div
              className="plan-panel-content"
              id={panelId + "content"}
              role="tabpanel"
              aria-labelledby={panelId + tab}
            >
              {thread && tab !== "viewing" && <p className="plan-panel-title">{thread.title}</p>}
              {tab === "progress" && (
                <>
                  {items.length ? (
                    <ol className="plan-peek-steps">
                      {items.map((item, index) => {
                        const d = describePlanItem(item),
                          s = statusOf(item);
                        const parents = items.filter((p) =>
                          (item.after || []).includes(p.task_id),
                        );
                        const parallel = items.filter(
                          (p) =>
                            p.task_id !== item.task_id &&
                            p.level === item.level,
                        );
                        return (
                          <li
                            key={item.task_id}
                            className={"plan-peek-step " + s.tone}
                          >
                            <span className="plan-peek-number">
                              {s.tone === "confirmed" ? (
                                <Check size={14} />
                              ) : (
                                index + 1
                              )}
                            </span>
                            <span className={"plan-peek-service " + item.agent} data-service={item.agent}>
                              <d.icon size={18} />
                            </span>
                            <div className="plan-peek-body">
                              {onOpenService ? (
                                <button
                                  className="text-button plan-open-service"
                                  disabled={busy}
                                  onClick={() => {
                                    close();
                                    onOpenService(item.task_id, item.agent);
                                  }}
                                  aria-label={
                                    uiText("Mở dịch vụ") +
                                    ": " +
                                    uiText(d.title)
                                  }
                                >
                                  <strong>{uiText(d.title)}</strong>
                                  <ChevronRight size={14} />
                                </button>
                              ) : (
                                <strong>{d.title}</strong>
                              )}
                              {d.detail && <p>{d.detail}</p>}
                              {item.chosen && (
                                <p className="plan-peek-choice">
                                  {item.chosen.label}
                                </p>
                              )}
                              {parents.length > 0 ? (
                                <small>
                                  Sau:{" "}
                                  {parents
                                    .map((p) => describePlanItem(p).title)
                                    .join(", ")}
                                </small>
                              ) : (
                                parallel.length > 0 && (
                                  <small>
                                    {uiText("Song song với")}{" "}
                                    {parallel
                                      .map((p) =>
                                        describePlanItem(
                                          p,
                                        ).title.toLocaleLowerCase("vi"),
                                      )
                                      .join(", ")}
                                  </small>
                                )
                              )}
                            </div>
                            <span className={"plan-peek-status " + s.tone}>
                              <i />
                              {uiText(s.label)}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <div className="plan-peek-empty">
                      <Target size={28} />
                      <strong>
                        {uiText("Kế hoạch bắt đầu từ câu chuyện của bạn")}
                      </strong>
                      <p>
                        {uiText(
                          "Nhắn điều bạn muốn làm. Các bước sẽ xuất hiện ở đây khi ReloHome lập kế hoạch.",
                        )}
                      </p>
                    </div>
                  )}
                  <p className="plan-panel-note">
                    {uiText(
                      "Có kết quả hoặc đã chọn phương án chưa đồng nghĩa đã thuê nhà hay đặt dịch vụ.",
                    )}
                  </p>
                </>
              )}
              {tab === "cost" && (
                <div className="plan-panel-section">
                  <h4>{uiText("Tổng tiền đã chốt")}</h4>
                  <ConfirmedTotal progress={progress} />
                  <p className="muted small">
                    {uiText(
                      "Chỉ tính các phương án đã chọn. Đây chưa phải số tiền đã thanh toán.",
                    )}
                  </p>
                  <h4>{uiText("Biên nhận dịch vụ")}</h4>
                  {Object.keys(state.committed || {}).length ? (
                    <Receipts receipts={Object.values(state.committed || {})} />
                  ) : (
                    <p className="muted">
                      {uiText("Chưa có biên nhận dịch vụ.")}
                    </p>
                  )}
                </div>
              )}
              {tab === "viewing" && !state.viewing && <p className="muted">{uiText("Chọn căn nhà để bắt đầu hẹn xem.")}</p>}
              {tab === "checkout" && !state.checkout && <p className="muted">{uiText("Chưa có dịch vụ cần thanh toán.")}</p>}
              {tab === "viewing" && threadId && state.viewing && (
                <div className="plan-panel-section">
                  <ViewingPanel
                    threadId={threadId}
                    viewing={state.viewing}
                    scheduler={scheduler}
                    footerHost={viewingFooter}
                    onChanged={async () => {
                      await onCheckoutChanged?.();
                    }}
                    onMovingForm={onMovingForm}
                    availableServices={availableServices}
                    onPrepare={onPrepare ? (service, item) => { close(); onPrepare(service, item); } : undefined}
                  />
                </div>
              )}
              {tab === "checkout" && threadId && (
                <div className="plan-panel-section">
                  <CheckoutPanel
                    requireAccount={requireAccount}
                    hideHousing={!!state.viewing}
                    threadId={threadId}
                    checkout={state.checkout}
                    facts={state.intake?.user_confirmed_facts || {}}
                    house={house}
                    onChanged={async () => {
                      await onCheckoutChanged?.();
                    }}
                  />
                </div>
              )}

            </div>
            <footer className="plan-peek-footer">
              {tab === "viewing" ? (
                <div ref={setViewingFooter} className="bulk-footer-mount" />
              ) : (
                <>
                  <span>{uiText("Kế hoạch và chat dùng chung lựa chọn của bạn.")}</span>
                  <button className="text-button" onClick={close}>
                    {uiText("Về chat ")}
                    <ChevronRight size={14} />
                  </button>
                </>
              )}
            </footer>
          </section>
          </>,
          document.body,
        )}
    </>
  );
}
