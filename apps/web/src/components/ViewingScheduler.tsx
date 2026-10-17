import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  Check,
  RefreshCw,
} from "lucide-react";
import { formatUi, t as uiText } from "../uiPreferences";
import type { Data } from "../types";
import type { ViewingSchedulerState } from "../useViewingScheduler";

const states = {
  saved: "Đã lưu lịch",
  unchanged: "Giữ lịch hiện tại",
  failed: "Chưa lưu được",
  unknown: "Chưa rõ kết quả",
  sync_pending: "Đã lưu, cần xử lý với chủ nhà",
  not_sent: "Chưa gửi",
};
const when = (slot: string) =>
  slot
    ? `${slot.slice(11, 16)} · ${slot.slice(0, 10).split("-").reverse().join("/")}`
    : "";
export function ViewingScheduler({
  viewing,
  scheduler: s,
  footerHost,
  statusOf,
  disabled = false,
}: {
  viewing: Data;
  scheduler: ViewingSchedulerState;
  footerHost: HTMLElement | null;
  statusOf: (item: Data) => string;
  disabled?: boolean;
}) {
  const focus = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (s.step !== "selection") {
      focus.current?.scrollIntoView({ block: "start" });
      focus.current?.focus({ preventScroll: true });
    }
  }, [s.step]);
  const items: Data[] = viewing.items || [];
  const itemFor = (id: string) => items.find((i) => i.listing_id === id);
  const remaining = s.rows.filter((r) =>
    ["failed", "not_sent"].includes(r.status),
  );
  return (
    <section
      className="viewing-scheduler"
      aria-label={uiText("Đặt lịch xem theo nhóm")}
      aria-busy={s.busy}
    >
      {s.step !== "selection" && (
        <h4 ref={focus} tabIndex={-1}>
          {uiText(
            s.step === "review"
              ? "Xem lại lịch trước khi gửi"
              : "Kết quả đặt lịch",
          )}
        </h4>
      )}
      {s.notice && (
        <p className="notice amber small" role="alert">
          {uiText(s.notice)}
        </p>
      )}
      {s.errors._selection && (
        <p className="notice error small" role="alert">
          {uiText(s.errors._selection)}
        </p>
      )}
      {s.step === "review" && (
        <>
          <p className="muted small">
            {uiText(
              "Tin do chủ nhà quản lý sẽ gửi yêu cầu xác nhận; tin nguồn khác chỉ lưu lịch thử.",
            )}
          </p>
          <ul className="bulk-review-list">
            {s.targets.map((id) => (
              <li key={id} className={s.toneFor(id)}>
                <strong>
                  {itemFor(id)?.title ||
                    uiText("Căn không còn trong danh sách")}
                </strong>
                <span>{itemFor(id)?.snapshot?.address}</span>
                <b>
                  <CalendarCheck size={15} aria-hidden="true" />
                  {when(s.drafts[id]?.slot || "")}
                </b>
              </li>
            ))}
          </ul>
          {s.busy && (
            <p role="status" className="notice small">
              {s.active
                ? formatUi("Đang lưu lịch: {0}", [
                    itemFor(s.active)?.title || s.active,
                  ])
                : uiText("Đang kiểm tra lịch hiện tại…")}
            </p>
          )}
        </>
      )}
      {s.step === "result" && (
        <>
          <p className="muted small">
            {uiText(
              "Kết quả được ghi riêng cho từng căn. Lịch đã lưu không bị hủy nếu căn khác lỗi.",
            )}
          </p>
          <ul className="bulk-result-list">
            {s.rows.map((row) => (
              <li key={row.listing_id} className={"bulk-result " + row.status + " " + s.toneFor(row.listing_id)}>
                <strong>
                  {itemFor(row.listing_id)?.title || row.listing_id}
                </strong>
                <span>{when(row.slot)}</span>
                <b>
                  {["saved", "unchanged"].includes(row.status) && (
                    <Check size={14} aria-hidden="true" />
                  )}
                  {uiText(states[row.status])}
                </b>
                {["saved", "unchanged"].includes(row.status) &&
                  itemFor(row.listing_id) && (
                    <p>{uiText(statusOf(itemFor(row.listing_id)!))}</p>
                  )}
                {row.message && <p>{uiText(row.message)}</p>}
              </li>
            ))}
          </ul>
          {s.rows.some((r) => r.status === "sync_pending") && (
            <p className="notice amber small">
              {uiText(
                "Bấm Xem danh sách căn để gửi lại cho chủ nhà. Không đặt lại lịch đã lưu.",
              )}
            </p>
          )}
        </>
      )}
      {footerHost && (s.step !== "selection" || s.eligible.length > 0) &&
        createPortal(
          <div className="bulk-footer">
            {s.step === "selection" ? (
              <>
                <span>
                  {formatUi("Đã chọn {0}/{1} căn cho lượt này", [
                    s.selected.length,
                    s.limit,
                  ])}
                </span>
                <button
                  className="primary"
                  disabled={
                    !s.selected.length ||
                    s.busy ||
                    s.blocked ||
                    disabled ||
                    s.unresolved.length > 0
                  }
                  onClick={s.review}
                >
                  {uiText("Đi tiếp")}
                  <ArrowRight size={16} />
                </button>
              </>
            ) : s.step === "review" ? (
              <>
                <button
                  className="secondary"
                  disabled={s.busy || s.blocked || disabled}
                  onClick={() => s.setStep("selection")}
                >
                  <ArrowLeft size={15} />
                  {uiText("Sửa giờ")}
                </button>
                <button
                  className="primary"
                  disabled={s.busy || s.blocked || disabled}
                  onClick={() => void s.confirm()}
                >
                  {s.busy
                    ? uiText("Đang lưu lịch…")
                    : formatUi("Xác nhận {0} lịch", [s.targets.length])}
                </button>
              </>
            ) : (
              <>
                <button
                  className="secondary"
                  disabled={s.busy || s.blocked || disabled}
                  onClick={s.finish}
                >
                  {uiText("Xem danh sách căn")}
                </button>
                {s.rows.some((r) => r.status === "unknown") ? (
                  <button
                    className="primary"
                    disabled={s.busy || s.blocked || disabled}
                    onClick={() => void s.check()}
                  >
                    <RefreshCw size={15} />
                    {uiText("Kiểm tra trạng thái")}
                  </button>
                ) : remaining.length ? (
                  <button
                    className="primary"
                    disabled={s.busy || s.blocked || disabled}
                    onClick={() => s.start(remaining.map((r) => r.listing_id))}
                  >
                    {uiText("Sửa các lịch chưa gửi")}
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={s.busy || s.blocked || disabled}
                    onClick={s.finish}
                  >
                    {uiText("Xong")}
                    <Check size={15} />
                  </button>
                )}
              </>
            )}
          </div>,
          footerHost,
        )}
    </section>
  );
}
