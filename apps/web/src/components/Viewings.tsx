import { RequiredMark } from "./RequiredMark";
import { useSearchParams } from "react-router-dom";
import { formatUi, t as uiText } from "../uiPreferences";
import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  Home,
  MessageCircle,
  RotateCcw,
  Star,
  X,
} from "lucide-react";
import { ApiError, api, money, requestId } from "../api";
import type { Data } from "../types";
import { ConfirmDialog, Dialog } from "./Dialog";
import { useContactMessenger } from "./ContactMessenger";
import { ViewingPreparation } from "./ViewingPreparation";
import { ViewingScheduler } from "./ViewingScheduler";
import type { ViewingSchedulerState } from "../useViewingScheduler";
import { scheduleEligible, slotsFor } from "../viewingSchedule";
import { ViewingSlotPicker } from "./ViewingSlotPicker";

// Choose several homes, schedule viewings, decide one (docs/review/housing-viewing-design.md).
// Backend controls slots, duration and deposit; the grouped UI caps each round at three.

const STATUS: Record<string, string> = {
  selected: "Chưa hẹn xem",
  viewing_scheduled: "Đã hẹn xem (chế độ thử)",
  visit_due: "Đã tới giờ xem, ghi kết quả",
  visited: "Đã gặp chủ nhà",
  backup: "Dự phòng",
  agreed: "Đã chốt (chưa chuyển tiền)",
  reported_paid: "Đã báo trả chủ nhà (chưa xác minh)",
};
// Landlord answer for homes managed on ReloHome; other homes keep the test-mode label above.
const LANDLORD: Record<string, string> = {
  requested: "Đã gửi giờ hẹn, chờ chủ nhà xác nhận",
  confirmed: "Chủ nhà đã xác nhận",
  declined: "Chủ nhà không nhận giờ này",
};
const landlordClosed = (landlord: Data) =>
  ["declined", "resolved"].includes(landlord.request_status) ||
  landlord.viewing_status === "cancelled";
function statusLabel(item: Data, testVisit: boolean) {
  if (item.payment_report?.status === "confirmed")
    return "Chủ nhà đã xác nhận nhận tiền · hoàn tất";
  if (item.payment_report?.status === "pending")
    return "Chờ chủ nhà xác nhận nhận tiền";
  if (item.payment_report?.status === "rejected")
    return "Chủ nhà báo chưa nhận tiền";
  const landlord = item.landlord;
  if (landlord?.sync === "failed") return "Chưa gửi được giờ hẹn cho chủ nhà";
  // A closed or withdrawn request stays closed until the tenant books again (review PR #88).
  if (landlord && landlordClosed(landlord))
    return "Yêu cầu với chủ nhà đã đóng, đặt lại giờ để gửi lại";
  // Before the landlord confirms, their answer matters more than the test-mode visit label.
  if (
    landlord &&
    LANDLORD[landlord.viewing_status] &&
    (item.status === "viewing_scheduled" ||
      (item.status === "visit_due" && landlord.viewing_status !== "confirmed"))
  )
    return LANDLORD[landlord.viewing_status];
  if (item.status === "visit_due" && testVisit)
    return "Chế độ test: ghi kết quả ngay";
  return STATUS[item.status] || item.status;
}
const WARNING: Record<string, string> = {
  busy_day: "Ngày {0} có {1} lịch xem, khá dày.",
  cities_same_day: "Ngày {0} có lịch xem ở hai thành phố khác nhau.",
  before_arrival: "Một lịch xem trước giờ chuyến bay của bạn hạ cánh.",
  after_move_date: "Một lịch xem sau ngày chuyển đồ đã báo giá.",
};

// Slots are ISO strings in the server's configured time zone; show their own wall-clock parts.
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const dayOf = (iso?: string) => iso?.slice(0, 10) || "";
const hm = (iso?: string) => {
  const m = iso?.match(LOCAL);
  return m ? `${m[4]}:${m[5]}` : "";
};
const dayLabel = (day: string) => {
  const [y, mo, d] = day.split("-");
  return `${d}/${mo}/${y}`;
};
const when = (iso?: string) =>
  iso ? `${hm(iso)} ${dayLabel(dayOf(iso))}` : "";

function errorOf(e: unknown) {
  return (e as Error).message || uiText("Có lỗi xảy ra. Hãy thử lại.");
}

function DecideDialog({
  threadId,
  item,
  others,
  depositMonths,
  onClose,
  onDone,
}: {
  threadId: string;
  item: Data;
  others: Data[];
  depositMonths: number;
  onClose: () => void;
  onDone: (result: Data) => void;
}) {
  const rentDefault = item.snapshot?.price_vnd || "";
  const [rent, setRent] = useState<string>(String(rentDefault)),
    [deposit, setDeposit] = useState<string>(
      rentDefault ? String(Math.round(rentDefault * depositMonths)) : "",
    ),
    [moveIn, setMoveIn] = useState(""),
    [keep, setKeep] = useState<string[]>([]),
    [ack, setAck] = useState(false),
    [needsAck, setNeedsAck] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(requestId());
  const signature = useRef<string | null>(null);
  async function submit() {
    const payload = {
      listing_id: item.listing_id,
      rent_vnd: Number(rent),
      deposit_vnd: Number(deposit),
      move_in: moveIn || null,
      keep_listing_ids: [...keep].sort(),
    };
    const nextSignature = JSON.stringify(payload);
    if (signature.current && signature.current !== nextSignature) {
      if (uncertain) return; // Retry the same intent until its outcome is known.
      key.current = requestId();
    }
    signature.current = nextSignature;
    setBusy(true);
    setError("");
    try {
      const result = await api<Data>(
        `/threads/${encodeURIComponent(threadId)}/viewings/decide`,
        "POST",
        {
          ...payload,
          decision_key: key.current,
          acknowledge_paid_moving: ack,
        },
      );
      onDone(result);
    } catch (e) {
      if ((e as Data).code === "moving_paid_elsewhere") setNeedsAck(true);
      setUncertain(!(e instanceof ApiError) || e.status >= 500);
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={formatUi("Chốt {0}", [item.title])} onClose={onClose}>
      <div className="viewing-decide">
        <p className="muted small">
          {uiText(
            "Chốt nghĩa là bạn đã thỏa thuận với chủ nhà. Tiền nhà trả trực tiếp cho chủ nhà, ngoài app.",
          )}
        </p>
        <div className="form-grid">
          <label>
            <span className="field-label">{uiText("Tiền thuê/tháng (VND)")}<RequiredMark /></span>
            <input
              type="number"
              min="1"
              disabled={busy || uncertain}
              value={rent}
              aria-required="true"
              onChange={(e) => setRent(e.target.value)}
            />
          </label>
          <label>
            <span className="field-label">{uiText("Tiền cọc thực tế (VND)")}<RequiredMark /></span>
            <input
              type="number"
              min="1"
              disabled={busy || uncertain}
              value={deposit}
              aria-required="true"
              onChange={(e) => setDeposit(e.target.value)}
            />
          </label>
          <label>
            <span className="field-label">{uiText("Ngày dọn vào")}<RequiredMark /></span>
            <input
              type="date"
              disabled={busy || uncertain}
              value={moveIn}
              aria-required="true"
              onChange={(e) => setMoveIn(e.target.value)}
            />
          </label>
        </div>
        {others.length > 0 && (
          <fieldset className="viewing-others" disabled={busy || uncertain}>
            <legend>{uiText("Các căn còn lại")}</legend>
            {others.map((o) => {
              const kept = keep.includes(o.listing_id);
              return (
                <div key={o.listing_id} className="viewing-other">
                  <strong>{o.title}</strong>
                  <small className="muted">
                    {o.viewing?.slot
                      ? formatUi("Lịch xem {0}", [when(o.viewing.slot)])
                      : uiText(STATUS[o.status] || o.status)}
                  </small>
                  <label className="checkbox">
                    <input
                      type="radio"
                      name={"keep-" + o.listing_id}
                      checked={!kept}
                      onChange={() =>
                        setKeep(keep.filter((id) => id !== o.listing_id))
                      }
                    />
                    {uiText(" Hủy lịch và bỏ chọn")}
                  </label>
                  <label className="checkbox">
                    <input
                      type="radio"
                      name={"keep-" + o.listing_id}
                      checked={kept}
                      onChange={() => setKeep([...keep, o.listing_id])}
                    />
                    {uiText(" Giữ lại làm dự phòng")}
                  </label>
                </div>
              );
            })}
          </fieldset>
        )}
        {needsAck && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>
              {uiText(
                "Giữ nguyên chuyển đồ đã thanh toán tới địa chỉ cũ; app không tự đổi hay hoàn tiền.",
              )}
            </span>
          </label>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {uncertain && (
          <p className="notice amber small">
            {uiText(
              "Chưa xác định được kết quả chốt. Gửi lại cùng thông tin để kiểm tra trước khi sửa yêu cầu.",
            )}
          </p>
        )}
        <div className="form-actions">
          <button className="secondary" onClick={onClose}>
            {uiText("Để sau")}
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              !(Number(rent) > 0) ||
              !(Number(deposit) > 0) ||
              (needsAck && !ack)
            }
            onClick={() => void submit()}
          >
            <Check size={15} />
            {uiText(" Xác nhận chốt")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function ViewingPanel({
  threadId,
  viewing,
  onChanged,
  onMovingForm,
  availableServices = [],
  onPrepare,
  scheduler,
  footerHost,
}: {
  threadId: string;
  viewing: Data;
  onChanged: () => Promise<void> | void;
  onMovingForm?: () => void;
  availableServices?: string[];
  onPrepare?: (service: string, item: Data) => void;
  scheduler: ViewingSchedulerState;
  footerHost: HTMLElement | null;
}) {
  const [routeParams] = useSearchParams();
  const messenger = useContactMessenger();
  const [reviewing, setReviewing] = useState<{
    item: Data;
    outcome: "met_agreed" | "met_rejected";
  } | null>(null);
  const [rating, setRating] = useState(0),
    [reviewBody, setReviewBody] = useState("");
  const [reviewError, setReviewError] = useState("");
  const reportKey = useRef(requestId());
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    const refresh = () => void changed.current();
    window.addEventListener("housing-contact-update", refresh);
    return () => window.removeEventListener("housing-contact-update", refresh);
  }, []);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scheduler.step === "selection")
      panel.current
        ?.querySelector<HTMLSelectElement>('select[aria-invalid="true"]')
        ?.focus();
  }, [scheduler.errors, scheduler.step]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deciding, setDeciding] = useState<Data | null>(null),
    [reporting, setReporting] = useState(false),
    [confirming, setConfirming] = useState<{ kind: "paid" | "reopen"; body?: Data } | null>(null),
    [movingHint, setMovingHint] = useState("");
  const items: Data[] = viewing.items || [];
  useEffect(() => {
    const id = routeParams.get("listing");
    if (id)
      requestAnimationFrame(() => {
        const card = document.getElementById("viewing-home-" + id);
        card?.scrollIntoView({ block: "center" });
        card?.focus({ preventScroll: true });
      });
  }, [routeParams, viewing]);
  const base = `/threads/${encodeURIComponent(threadId)}/viewings`;
  async function post(step: string, body: Data = {}) {
    setBusy(true);
    setError("");
    try {
      await api(`${base}/${step}`, "POST", body);
      await onChanged();
      return true;
    } catch (e) {
      setError(errorOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const decided = items.find((i) =>
    ["agreed", "reported_paid"].includes(i.status),
  );
  const prepared = scheduler.rows
    .filter((row) => ["saved", "unchanged"].includes(row.status))
    .map((row) => items.find((item) => item.listing_id === row.listing_id))
    .find(Boolean);
  return (
    <div className="viewing-panel" ref={panel}>
      {scheduler.step === "selection" && (
        <>
          {scheduler.eligible.length > 0 && <div className="bulk-selection-tools">
            <label className="bulk-all">
              <input
                type="checkbox"
                aria-label={uiText("Chọn tất cả")}
                checked={
                  scheduler.eligible.length > 0 &&
                  scheduler.selected.length === scheduler.eligible.length
                }
                ref={(el) => {
                  if (el)
                    el.indeterminate =
                      scheduler.selected.length > 0 &&
                      scheduler.selected.length < scheduler.eligible.length;
                }}
                disabled={
                  busy ||
                  scheduler.busy ||
                  scheduler.blocked ||
                  !scheduler.eligible.length ||
                  scheduler.eligible.length > scheduler.limit ||
                  scheduler.unresolved.length > 0
                }
                onChange={(e) =>
                  scheduler.setChecked(
                    e.target.checked
                      ? scheduler.eligible.map((i) => i.listing_id)
                      : [],
                  )
                }
              />
              {uiText("Chọn tất cả")}
            </label>
            <span className="muted small">
              {formatUi("Tối đa {0} căn/lượt", [scheduler.limit])}
            </span>
          </div>}
          {scheduler.unresolved.length > 0 && (
            <p className="notice amber small" role="status">
              {uiText(
                "Có lịch chưa rõ kết quả. Kiểm tra trạng thái trước khi đặt lại.",
              )}
              <button
                className="text-button"
                onClick={() => scheduler.setStep("result")}
              >
                {uiText("Kiểm tra trạng thái")}
              </button>
            </p>
          )}
          {viewing.legacy_chosen && (
            <section className="checkout-card">
              <header>
                <Home size={17} />
                <strong>{uiText("Căn đã chọn trước đây")}</strong>
              </header>
              <p className="small">
                {uiText(
                  "Căn này được chọn trước khi có lịch xem; kế hoạch đang dùng nó như căn đã chốt.",
                )}
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void post("reopen")}
              >
                <RotateCcw size={14} />
                {uiText(" Mở lại để chọn và hẹn xem")}
              </button>
            </section>
          )}
          {(viewing.landlord_withdraw_pending || []).length > 0 && (
            <div className="notice amber small" role="status">
              {uiText(
                "Chưa báo được chủ nhà rằng bạn đã hủy hoặc bỏ một lịch xem. ReloHome sẽ thử lại ở thao tác tiếp theo.",
              )}{" "}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void post("landlord-retry")}
              >
                {uiText("Thử lại ngay")}
              </button>
            </div>
          )}
          {viewing.landlord_unavailable && (
            <p className="notice amber small" role="status">
              {uiText(
                "Chưa tải được phản hồi của chủ nhà lúc này; trạng thái xác nhận có thể chưa mới nhất.",
              )}
            </p>
          )}
          {(viewing.warnings || []).map((w: Data, i: number) => (
            <p key={i} className="notice amber small">
              {formatUi(WARNING[w.code] || w.code, [
                w.day ? dayLabel(w.day) : "",
                w.count ?? "",
              ])}
            </p>
          ))}
          {!items.length && !viewing.legacy_chosen && (
            <p className="muted">
              {uiText(
                'Chưa chọn căn nào. Bấm "Chọn căn này" trên bản đồ hoặc thẻ nhà để thêm.',
              )}
            </p>
          )}
          {items.map((item) => (
            <section
              id={"viewing-home-" + item.listing_id}
              tabIndex={-1}
              className={"checkout-card viewing-item " + scheduler.toneFor(item.listing_id) + (scheduleEligible(item) ? "" : " after-viewing")}
              key={item.listing_id}
            >
              <header>
                {scheduleEligible(item) && <label className="bulk-card-toggle">
                  <input
                    type="checkbox"
                    className="bulk-card-checkbox"
                    aria-label={formatUi("Đặt lịch cho {0}", [item.title])}
                    checked={scheduler.selected.includes(item.listing_id)}
                    disabled={
                      busy ||
                      scheduler.busy ||
                      scheduler.blocked ||
                      !scheduleEligible(item) ||
                      scheduler.unresolved.includes(item.listing_id) ||
                      (!scheduler.selected.includes(item.listing_id) &&
                        scheduler.selected.length >= scheduler.limit)
                    }
                    onChange={() => scheduler.toggle(item.listing_id)}
                  />
                </label>}
                <strong>{item.title}</strong>
                <span
                  className={
                    "muted small viewing-status " +
                    (item.payment_report?.status || (item.status === "agreed" ? "agreed" : "")) +
                    (item.landlord && !["agreed", "reported_paid"].includes(item.status)
                      ? ` viewing-landlord ${item.landlord.viewing_status}`
                      : "")
                  }
                >
                  {uiText(
                    statusLabel(item, Boolean(viewing.test_visit_anytime)),
                  )}
                </span>
              </header>
              <p
                className="small bulk-card-meta"
                title={item.snapshot?.address}
              >
                <span className="bulk-card-price">
                  {item.snapshot?.price_vnd
                    ? formatUi("{0}/tháng (tham khảo)", [
                        money(item.snapshot.price_vnd),
                      ])
                    : uiText("Chưa có giá")}
                </span>
                <span className="bulk-card-address">
                  {item.snapshot?.address}
                </span>
              </p>
              {item.viewing?.slot && (
                <p className="small bulk-card-slot">
                  <CalendarClock size={14} />
                  {formatUi("Lịch xem {0}", [when(item.viewing.slot)])}
                </p>
              )}
              {scheduleEligible(item) && (
                <ViewingSlotPicker
                  title={item.title}
                  slots={slotsFor(viewing, item)}
                  value={scheduler.draftFor(item.listing_id)}
                  disabled={
                    busy ||
                    scheduler.busy ||
                    scheduler.blocked ||
                    scheduler.unresolved.length > 0 ||
                    (!scheduler.selected.includes(item.listing_id) &&
                      scheduler.selected.length >= scheduler.limit)
                  }
                  onChange={(draft) =>
                    scheduler.changeDraft(item.listing_id, draft)
                  }
                  error={scheduler.errors[item.listing_id]}
                />
              )}
              {item.snapshot?.location_accuracy &&
                item.snapshot.location_accuracy !== "rooftop" && (
                  <p className="muted small">
                    {uiText(
                      "Vị trí trên tin là gần đúng; hỏi địa chỉ chính xác trước khi đi.",
                    )}
                  </p>
                )}
              {item.viewing?.travel?.from_previous && (
                <p className="small">
                  {formatUi(" · từ lịch trước: {0}", [
                    item.viewing.travel.from_previous,
                  ])}
                </p>
              )}
              {item.landlord?.sync === "failed" && item.viewing?.slot && (
                <div className="notice amber small" role="status">
                  {uiText(
                    "ReloHome chưa gửi được giờ hẹn này tới chủ nhà (hệ thống tạm lỗi). Lịch của bạn vẫn được giữ; bấm gửi lại hoặc thao tác tiếp, ReloHome sẽ thử gửi lại.",
                  )}{" "}
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void post("landlord-retry")}
                  >
                    {uiText("Gửi lại cho chủ nhà")}
                  </button>
                </div>
              )}
              {item.landlord && landlordClosed(item.landlord) && (
                <p className="notice amber small">
                  {uiText(
                    "Yêu cầu đã đóng. Chọn lại ngày/giờ để gửi lịch mới.",
                  )}
                </p>
              )}
              {item.landlord?.viewing_status === "declined" &&
                !landlordClosed(item.landlord) && (
                  <p className="notice amber small">
                    {uiText(
                      "Chủ nhà không nhận giờ này. Lịch chỉ hiển thị các giờ chủ nhà đề xuất; chọn một giờ để gửi lại.",
                    )}
                  </p>
                )}
              {item.landlord?.request_id && (
                <button
                  className="text-button"
                  onClick={() =>
                    messenger.open(
                      item.landlord.request_id,
                      item.title,
                      "tenant",
                    )
                  }
                >
                  <MessageCircle size={14} /> {uiText("Nhắn chủ nhà")}
                  {item.landlord.unread > 0 && (
                    <span className="unread-badge">{item.landlord.unread}</span>
                  )}
                </button>
              )}
              {(!item.landlord ||
                (item.landlord.viewing_status === "confirmed" &&
                  !landlordClosed(item.landlord))) &&
                (item.status === "visit_due" ||
                  (item.status === "backup" &&
                    item.viewing?.slot &&
                    Date.parse(item.viewing.slot) <= Date.now())) && (
                  <div className="viewing-outcome" role="group">
                    <span className="small">{uiText("Kết quả buổi xem:")}</span>
                    {(
                      [
                        ["met_agreed", "Đã gặp, đồng ý"],
                        ["met_rejected", "Đã gặp, không đồng ý"],
                      ] as const
                    ).map(([outcome, label]) => (
                      <button
                        key={outcome}
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setReviewing({ item, outcome });
                          setRating(item.visit_review?.rating || 0);
                          setReviewBody(item.visit_review?.body || "");
                          setReviewError("");
                        }}
                      >
                        {uiText(label)}
                      </button>
                    ))}
                  </div>
                )}
              {item.agreement && !item.reported_payment && !item.payment_report && (
                <p className="notice amber viewing-payment-due">
                  <span className="notice-symbol" aria-hidden="true">!</span>
                  <span>
                  {formatUi("Cần trả chủ nhà: cọc {0} + tháng đầu {1}", [
                    money(item.agreement.deposit_vnd),
                    money(item.agreement.first_month_vnd),
                  ])}
                  {item.agreement.move_in
                    ? formatUi(" · dọn vào {0}", [item.agreement.move_in])
                    : ""}
                  </span>
                </p>
              )}
              {item.reported_payment && (
                <div className={"viewing-payment-report small " + (item.payment_report?.status || "")} role="status">
                  {item.payment_report?.status === "rejected" && <span className="notice-symbol" aria-hidden="true">!</span>}
                  <p>
                    {formatUi("Đã báo trả {0} ngày {1}", [
                      money(item.reported_payment.amount_vnd),
                      item.reported_payment.paid_on,
                    ])}
                  </p>
                  <p>
                    {uiText(
                      item.payment_report?.status === "confirmed"
                        ? "Chủ nhà đã xác nhận nhận tiền. Hoàn tất."
                        : item.payment_report?.status === "rejected"
                          ? "Chủ nhà chưa xác nhận khoản tiền này:"
                          : item.payment_report?.status === "pending"
                            ? "Đã gửi cho chủ nhà, đang chờ xác nhận nhận tiền."
                            : item.payment_sync === "failed"
                              ? "Chưa gửi được báo cáo cho chủ nhà. Khoản đã báo vẫn được giữ."
                              : "Khoản tiền do bạn tự báo, chưa có xác nhận.",
                    )}
                  </p>
                  {item.payment_report?.reason && (
                    <blockquote className="viewing-landlord-note"><strong>{uiText("Chủ nhà nhắn")}</strong><p>“{item.payment_report.reason}”</p></blockquote>
                  )}
                  {item.payment_sync === "failed" && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void post("payment-retry")}
                    >
                      {uiText("Gửi lại báo cáo cho chủ nhà")}
                    </button>
                  )}
                </div>
              )}
              <div className="form-actions">
                {item.status === "visited" && !decided && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      if (item.visit_review) setDeciding(item);
                      else {
                        setReviewing({ item, outcome: "met_agreed" });
                        setRating(0);
                        setReviewBody("");
                        setReviewError("");
                      }
                    }}
                  >
                    <Check size={14} />
                    {uiText(" Chốt căn này")}
                  </button>
                )}
                {!["agreed", "reported_paid"].includes(item.status) && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void post("unselect", { listing_id: item.listing_id })}
                  >
                    <X size={13} />
                    {uiText(item.viewing && item.landlord?.viewing_status !== "declined"
                      ? "Hủy lịch & bỏ chọn" : "Bỏ chọn")}
                  </button>
                )}
                {item.payment_report?.status === "rejected" && !reporting && (
                  <button className="secondary" disabled={busy} onClick={() => setConfirming({ kind: "reopen" })}>
                    {uiText("Thỏa thuận không thành")}
                  </button>
                )}
                {(item.status === "agreed" ||
                  item.payment_report?.status === "rejected") &&
                  !reporting && (
                    <button
                      className={item.payment_report?.status === "rejected" ? "primary" : "secondary"}
                      onClick={() => {
                        reportKey.current = requestId();
                        setReporting(true);
                      }}
                    >
                      {uiText(item.payment_report?.status === "rejected" ? "Phản hồi lại" : "Báo đã trả chủ nhà")}
                    </button>
                  )}
              </div>
              {(item.status === "agreed" ||
                item.payment_report?.status === "rejected") &&
                reporting && (
                  <form
                    className="agreement"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = Object.fromEntries(
                        new FormData(e.currentTarget),
                      ) as Data;
                      setConfirming({ kind: "paid", body: {
                        request_id: reportKey.current,
                        amount_vnd: Number(f.amount_vnd),
                        paid_on: f.paid_on,
                      } });
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        <span className="field-label">{uiText("Số tiền đã trả (VND)")}<RequiredMark /></span>
                        <input
                          name="amount_vnd"
                          type="number"
                          min="1"
                          required
                          defaultValue={
                            (item.agreement?.deposit_vnd || 0) +
                              (item.agreement?.first_month_vnd || 0) || ""
                          }
                        />
                      </label>
                      <label>
                        <span className="field-label">{uiText("Ngày trả")}<RequiredMark /></span>
                        <input name="paid_on" type="date" required />
                      </label>
                    </div>
                    <p className="muted small">
                      {uiText(
                        "Báo cáo được gửi cho chủ nhà để xác nhận đã nhận tiền.",
                      )}
                    </p>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => setConfirming({ kind: "reopen" })}
                      >
                        {uiText("Thỏa thuận không thành")}
                      </button>
                      <button className="primary" disabled={busy}>
                        {uiText(item.payment_report?.status === "rejected" ? "Phản hồi lại" : "Xác nhận")}
                      </button>
                    </div>
                  </form>
                )}
              {onPrepare && !viewing.landlord_unavailable && (
                <ViewingPreparation item={item} available={availableServices}
                  disabled={busy || scheduler.busy || scheduler.blocked} onOpen={onPrepare} />
              )}
            </section>
          ))}
        </>
      )}
      <ViewingScheduler
        viewing={viewing}
        scheduler={scheduler}
        footerHost={footerHost}
        disabled={busy}
        statusOf={(item) =>
          statusLabel(item, Boolean(viewing.test_visit_anytime))
        }
      />
      {scheduler.step === "result" &&
        prepared &&
        onPrepare &&
        !viewing.landlord_unavailable && (
          <>
            <p className="muted small">
              {formatUi("Chuẩn bị cho căn: {0}", [prepared.title])}
            </p>
            <ViewingPreparation
              item={prepared}
              available={availableServices}
              disabled={busy || scheduler.busy || scheduler.blocked}
              onOpen={onPrepare}
            />
          </>
        )}
      {movingHint && (
        <div className="notice">
          <p>{uiText(movingHint)}</p>
          {onMovingForm && (
            <button className="secondary" onClick={onMovingForm}>
              {uiText("Mở form chuyển đồ")}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {confirming && (
        <ConfirmDialog title={uiText(confirming.kind === "paid"
          ? "Bạn có chắc chắn xác nhận đã chuyển tiền?" : "Bạn có chắc chắn thỏa thuận không thành?")}
          action={uiText("Đồng ý")} cancelLabel={uiText("Quay lại")} destructive={false}
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            const saved = await post(confirming.kind, confirming.body || {});
            if (!saved) throw new Error(uiText("Chưa lưu được. Hãy thử lại."));
            setReporting(false);
          }}>
          <p>{uiText(confirming.kind === "paid"
            ? "Báo cáo được gửi cho chủ nhà để xác nhận đã nhận tiền."
            : "Căn của kế hoạch sẽ bị gỡ và chuyển đồ tuần tự quay về chờ chốt.")}</p>
        </ConfirmDialog>
      )}
      {reviewing && (
        <Dialog
          title={uiText("Đánh giá sau buổi xem")}
          onClose={() => {
            if (!busy) setReviewing(null);
          }}
        >
          <form
            className="viewing-review-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setReviewError("");
              try {
                await api(
                  `/threads/${encodeURIComponent(threadId)}/viewings/visit-review`,
                  "POST",
                  {
                    listing_id: reviewing.item.listing_id,
                    outcome: reviewing.outcome,
                    rating,
                    body: reviewBody,
                  },
                );
                const selected = reviewing;
                setReviewing(null);
                await onChanged();
                if (selected.outcome === "met_agreed")
                  setDeciding(selected.item);
              } catch (cause) {
                setReviewError(errorOf(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              <strong>{reviewing.item.title}</strong>
            </p>
            <p>
              {uiText(
                reviewing.outcome === "met_agreed"
                  ? "Đánh giá trải nghiệm trước khi chốt căn và báo chuyển tiền."
                  : "Sau khi gửi đánh giá, căn này sẽ được bỏ chọn và lịch hẹn được đóng.",
              )}
            </p>
            <fieldset disabled={busy}>
              <legend>{uiText("Đánh giá trải nghiệm (bắt buộc)")}<RequiredMark /></legend>
              <div className="viewing-review-stars">
                {[1, 2, 3, 4, 5].map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="visit-rating"
                      required
                      value={value}
                      checked={rating === value}
                      onChange={() => setRating(value)}
                    />
                    <Star
                      size={24}
                      aria-hidden="true"
                      fill={value <= rating ? "currentColor" : "none"}
                    />
                    <span>{formatUi("{0} sao", [value])}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              {uiText("Nhận xét (không bắt buộc)")}
              <textarea
                maxLength={2000}
                rows={3}
                value={reviewBody}
                disabled={busy}
                onChange={(event) => setReviewBody(event.target.value)}
              />
            </label>
            {reviewError && (
              <p role="alert" className="notice error">
                {reviewError}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setReviewing(null)}
              >
                {uiText("Quay lại")}
              </button>
              <button className="primary" disabled={busy || !rating}>
                {uiText(
                  reviewing.outcome === "met_agreed"
                    ? "Gửi đánh giá và tiếp tục"
                    : "Gửi đánh giá và bỏ chọn",
                )}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {deciding && (
        <DecideDialog
          threadId={threadId}
          item={deciding}
          others={items.filter((i) => i.listing_id !== deciding.listing_id)}
          depositMonths={viewing.deposit_suggested_months ?? 1}
          onClose={() => setDeciding(null)}
          onDone={async (result) => {
            setDeciding(null);
            setMovingHint(
              result.moving_impact === "different_unpaid"
                ? "Chuyển đồ đang báo giá tới địa chỉ khác căn vừa chốt. Bạn có thể đổi điểm giao sang căn này hoặc giữ địa chỉ cũ."
                : result.moving_impact === "same"
                  ? "Chuyển đồ đã báo giá đúng tới căn vừa chốt."
                  : result.moving_impact === "different_paid"
                    ? "Chuyển đồ đã thanh toán tới địa chỉ cũ được giữ nguyên."
                    : "Đã chốt. Bạn có thể báo giá chuyển đồ tới căn này.",
            );
            await onChanged();
          }}
        />
      )}
    </div>
  );
}
