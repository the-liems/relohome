import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Target, X } from "lucide-react";
import type { Data, Thread } from "../types";
import { ConfirmedTotal, describePlanItem } from "./PlanProgress";
import { Approval } from "./Forms";
import { PendingPayment, Receipts } from "./Transactions";

function statusOf(item: Data) {
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
  writesEnabled = false,
  onDecision,
  onPaymentCheck,
  busy = false,
}: {
  progress?: Data;
  threadId?: string;
  thread?: Thread | null;
  writesEnabled?: boolean;
  onDecision: (body: Data) => Promise<void>;
  onPaymentCheck: () => Promise<void>;
  busy?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("panel") === "plan");
  const [tab, setTab] = useState("progress");
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const state = thread?.state || {};
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
  const pending = state.pending;
  const questions =
    [...(thread?.messages || [])].reverse().find((m) => m.role === "assistant")
      ?.content.response?.questions || [];

  useEffect(() => {
    if (params.get("panel") === "plan") {
      setOpen(true);
    }
  }, [params.toString()]);

  function close() {
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
      if (
        !panel.current?.contains(event.target as Node) &&
        !button.current?.contains(event.target as Node)
      )
        close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
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
  }, [open]);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={button}
        className={"plan-peek-tab" + (open ? " active" : "")}
        aria-label="Xem nhanh kế hoạch"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Target size={16} /> <span className="plan-peek-label">Kế hoạch</span>
        {items.length > 0 && (
          <span className="plan-peek-count">{items.length}</span>
        )}
        {open ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
      {open &&
        createPortal(
          <section
            ref={panel}
            id={panelId}
            tabIndex={-1}
            className="plan-peek-panel"
            aria-label="Kế hoạch trong cuộc trò chuyện"
          >
            <header className="plan-peek-header">
              <span className="plan-peek-target">
                <Target size={22} />
              </span>
              <div>
                <h3>Kế hoạch của bạn</h3>
                <p>
                  {busy
                    ? "SIU đang cập nhật yêu cầu…"
                    : items.length
                      ? `${items.length} mục tiêu · ${chosen} phương án đã chọn`
                      : "Cùng SIU sắp xếp từng bước"}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Đóng kế hoạch nhanh"
                onClick={close}
              >
                <X size={17} />
              </button>
            </header>
            <div
              className="plan-panel-tabs"
              role="tablist"
              aria-label="Nội dung kế hoạch"
            >
              {[
                ["progress", "Tiến trình"],
                ["cost", "Chi phí"],
                ["pending", "Cần phản hồi"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  id={panelId + key}
                  aria-selected={tab === key}
                  aria-controls={panelId + "content"}
                  onClick={() => setTab(key)}
                >
                  {label}
                  {key === "pending" && pending && <i />}
                </button>
              ))}
            </div>
            <div
              className="plan-panel-content"
              id={panelId + "content"}
              role="tabpanel"
              aria-labelledby={panelId + tab}
            >
              {thread && <p className="plan-panel-title">{thread.title}</p>}
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
                            <span className={"plan-peek-service " + item.agent}>
                              <d.icon size={18} />
                            </span>
                            <div className="plan-peek-body">
                              <strong>{d.title}</strong>
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
                                    Song song với{" "}
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
                              {s.label}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <div className="plan-peek-empty">
                      <Target size={28} />
                      <strong>Kế hoạch bắt đầu từ câu chuyện của bạn</strong>
                      <p>
                        Nhắn điều bạn muốn làm. Các bước sẽ xuất hiện ở đây khi
                        SIU lập kế hoạch.
                      </p>
                    </div>
                  )}
                  <p className="plan-panel-note">
                    Có kết quả hoặc đã chọn phương án chưa đồng nghĩa đã thuê
                    nhà hay đặt dịch vụ.
                  </p>
                </>
              )}
              {tab === "cost" && (
                <div className="plan-panel-section">
                  <h4>Tổng tiền đã chốt</h4>
                  <ConfirmedTotal progress={progress} />
                  <p className="muted small">
                    Chỉ tính các phương án đã chọn. Đây chưa phải số tiền đã
                    thanh toán.
                  </p>
                  <h4>Biên nhận dịch vụ</h4>
                  {Object.keys(state.committed || {}).length ? (
                    <Receipts receipts={Object.values(state.committed || {})} />
                  ) : (
                    <p className="muted">Chưa có biên nhận dịch vụ.</p>
                  )}
                </div>
              )}
              {tab === "pending" && (
                <div className="plan-panel-section">
                  {pending?.type === "confirmation_required" ? (
                    <Approval
                      pending={pending}
                      enabled={writesEnabled}
                      busy={busy}
                      onDecision={onDecision}
                    />
                  ) : pending?.type === "payment_required" && threadId ? (
                    <PendingPayment
                      pending={pending}
                      threadId={threadId}
                      busy={busy}
                      onCheck={onPaymentCheck}
                    />
                  ) : (
                    <>
                      <h4>
                        {questions.length
                          ? "SIU cần bạn bổ sung"
                          : "Không có xác nhận đang chờ"}
                      </h4>
                      <p className="muted">
                        Bạn có thể tiếp tục trả lời ngay trong chat.
                      </p>
                      {questions.map((q: Data, i: number) => (
                        <p key={i} className="notice">
                          {q.text}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
            <footer className="plan-peek-footer">
              <span>Kế hoạch và chat dùng chung lựa chọn của bạn.</span>
              <button className="text-button" onClick={close}>
                Về chat <ChevronRight size={14} />
              </button>
            </footer>
          </section>,
          document.body,
        )}
    </>
  );
}
