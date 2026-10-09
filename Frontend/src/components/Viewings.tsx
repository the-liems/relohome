import { formatUi, t as uiText } from "../uiPreferences";
import { useMemo, useRef, useState } from "react";
import { CalendarClock, Check, Home, RotateCcw, X } from "lucide-react";
import { ApiError, api, money, requestId } from "../api";
import type { Data } from "../types";
import { Dialog } from "./Dialog";

// Choose several homes, schedule viewings, decide one (docs/review/housing-viewing-design.md).
// Limits, slot length and suggested deposit come from the server; nothing is fixed here.

const STATUS: Record<string, string> = {
  selected: "Chưa hẹn xem",
  viewing_scheduled: "Đã hẹn xem (chế độ thử)",
  visit_due: "Đã tới giờ xem, ghi kết quả",
  visited: "Đã gặp chủ nhà",
  backup: "Dự phòng",
  agreed: "Đã chốt (bạn tự báo)",
  reported_paid: "Đã báo trả chủ nhà (chưa xác minh)",
};
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

function SlotPicker({
  slots,
  busy,
  label,
  onPick,
}: {
  slots: string[];
  busy: boolean;
  label: string;
  onPick: (slot: string) => void;
}) {
  const days = useMemo(() => [...new Set(slots.map(dayOf))], [slots]);
  const [day, setDay] = useState(days[0] || ""),
    [slot, setSlot] = useState("");
  if (!days.length)
    return <p className="muted small">{uiText("Chưa có khung giờ trống.")}</p>;
  return (
    <div className="viewing-picker">
      <select
        aria-label={uiText("Ngày xem")}
        value={day}
        onChange={(e) => {
          setDay(e.target.value);
          setSlot("");
        }}
      >
        {days.map((d) => (
          <option key={d} value={d}>
            {dayLabel(d)}
          </option>
        ))}
      </select>
      <select
        aria-label={uiText("Giờ xem")}
        value={slot}
        onChange={(e) => setSlot(e.target.value)}
      >
        <option value="">{uiText("Chọn giờ")}</option>
        {slots
          .filter((s) => dayOf(s) === day)
          .map((s) => (
            <option key={s} value={s}>
              {hm(s)}
            </option>
          ))}
      </select>
      <button
        className="secondary"
        disabled={busy || !slot}
        onClick={() => onPick(slot)}
      >
        {uiText(label)}
      </button>
    </div>
  );
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
            {uiText("Tiền thuê/tháng (VND)")}
            <input
              type="number"
              min="1"
              disabled={busy || uncertain}
              value={rent}
              onChange={(e) => setRent(e.target.value)}
            />
          </label>
          <label>
            {uiText("Tiền cọc thực tế (VND)")}
            <input
              type="number"
              min="1"
              disabled={busy || uncertain}
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
            />
          </label>
          <label>
            {uiText("Ngày dọn vào")}
            <input
              type="date"
              disabled={busy || uncertain}
              value={moveIn}
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
}: {
  threadId: string;
  viewing: Data;
  onChanged: () => Promise<void> | void;
  onMovingForm?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deciding, setDeciding] = useState<Data | null>(null),
    [reporting, setReporting] = useState(false),
    [movingHint, setMovingHint] = useState("");
  const items: Data[] = viewing.items || [];
  const base = `/threads/${encodeURIComponent(threadId)}/viewings`;
  async function post(step: string, body: Data = {}) {
    setBusy(true);
    setError("");
    try {
      await api(`${base}/${step}`, "POST", body);
      await onChanged();
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  }
  const decided = items.find((i) =>
    ["agreed", "reported_paid"].includes(i.status),
  );
  return (
    <div className="viewing-panel">
      <p className="muted small">
        {formatUi(
          "Chọn tối đa {0} căn để hẹn xem. Lịch là chế độ thử: app chưa liên hệ chủ nhà. Chỉ chốt sau khi đã gặp chủ nhà.",
          [viewing.max_selected],
        )}
      </p>
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
        <section className="checkout-card viewing-item" key={item.listing_id}>
          <header>
            <Home size={17} />
            <strong>{item.title}</strong>
            <span className="muted small">
              {item.status === "visit_due" && viewing.test_visit_anytime
                ? uiText("Chế độ test: ghi kết quả ngay")
                : uiText(STATUS[item.status] || item.status)}
            </span>
          </header>
          <p className="small">
            {item.snapshot?.address}
            {item.snapshot?.price_vnd
              ? formatUi(" · {0}/tháng (tham khảo)", [
                  money(item.snapshot.price_vnd),
                ])
              : ""}
          </p>
          {item.snapshot?.location_accuracy &&
            item.snapshot.location_accuracy !== "rooftop" && (
              <p className="muted small">
                {uiText(
                  "Vị trí trên tin là gần đúng; hỏi địa chỉ chính xác trước khi đi.",
                )}
              </p>
            )}
          {item.viewing?.slot && (
            <p className="small">
              <CalendarClock size={13} />{" "}
              {formatUi("Lịch xem {0}", [when(item.viewing.slot)])}
              {item.viewing.travel?.from_previous
                ? formatUi(" · từ lịch trước: {0}", [
                    item.viewing.travel.from_previous,
                  ])
                : ""}
            </p>
          )}
          {item.status === "viewing_scheduled" && (
            <p className="muted small">
              {formatUi(
                "Từ {0}, ghi kết quả gặp chủ nhà tại đây; đã gặp và chủ nhà đồng ý thì mới chốt được.",
                [when(item.viewing?.slot)],
              )}
            </p>
          )}
          {item.status === "selected" && (
            <p className="muted small">
              {uiText(
                "Hẹn lịch xem trước; sau buổi gặp chủ nhà bạn ghi kết quả rồi mới chốt.",
              )}
            </p>
          )}
          {["selected", "viewing_scheduled", "backup"].includes(item.status) &&
            !(item.status === "backup" && item.backup_from === "visited") && (
              <SlotPicker
                slots={viewing.slots || []}
                busy={busy}
                label={item.viewing ? "Đổi lịch" : "Hẹn xem"}
                onPick={(slot) =>
                  void post("schedule", { listing_id: item.listing_id, slot })
                }
              />
            )}
          {(item.status === "visit_due" ||
            (item.status === "backup" &&
              item.viewing?.slot &&
              Date.parse(item.viewing.slot) <= Date.now())) && (
            <div className="viewing-outcome" role="group">
              <span className="small">{uiText("Kết quả buổi xem:")}</span>
              {[
                ["met_agreed", "Đã gặp, chủ nhà đồng ý"],
                ["met_undecided", "Đã gặp, còn phân vân"],
                ["met_rejected", "Không hợp"],
                ["missed", "Không đi được"],
              ].map(([outcome, label]) => (
                <button
                  key={outcome}
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void post("visit", {
                      listing_id: item.listing_id,
                      outcome,
                    })
                  }
                >
                  {uiText(label)}
                </button>
              ))}
            </div>
          )}
          {item.agreement && (
            <p className="small">
              {formatUi("Cần trả chủ nhà: cọc {0} + tháng đầu {1}", [
                money(item.agreement.deposit_vnd),
                money(item.agreement.first_month_vnd),
              ])}
              {item.agreement.move_in
                ? formatUi(" · dọn vào {0}", [item.agreement.move_in])
                : ""}
            </p>
          )}
          {item.reported_payment && (
            <p className="notice small">
              {formatUi("Đã báo trả {0} ngày {1} · chưa xác minh", [
                money(item.reported_payment.amount_vnd),
                item.reported_payment.paid_on,
              ])}
            </p>
          )}
          <div className="form-actions">
            {item.status === "visited" && !decided && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => setDeciding(item)}
              >
                <Check size={14} />
                {uiText(" Chốt căn này")}
              </button>
            )}
            {item.viewing &&
              ["viewing_scheduled", "backup"].includes(item.status) && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void post("cancel", { listing_id: item.listing_id })
                  }
                >
                  {uiText("Hủy lịch")}
                </button>
              )}
            {!["agreed", "reported_paid"].includes(item.status) && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void post("unselect", { listing_id: item.listing_id })
                }
              >
                <X size={13} />
                {uiText(" Bỏ chọn")}
              </button>
            )}
            {item.status === "agreed" && !reporting && (
              <button className="secondary" onClick={() => setReporting(true)}>
                {uiText("Báo đã trả chủ nhà")}
              </button>
            )}
            {item.status === "agreed" && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      uiText(
                        "Thỏa thuận không thành? Căn của kế hoạch sẽ bị gỡ và chuyển đồ tuần tự quay về chờ chốt.",
                      ),
                    )
                  )
                    void post("reopen");
                }}
              >
                <RotateCcw size={13} />
                {uiText(" Thỏa thuận không thành")}
              </button>
            )}
          </div>
          {item.status === "agreed" && reporting && (
            <form
              className="agreement"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = Object.fromEntries(
                  new FormData(e.currentTarget),
                ) as Data;
                await post("paid", {
                  amount_vnd: Number(f.amount_vnd),
                  paid_on: f.paid_on,
                });
                setReporting(false);
              }}
            >
              <div className="form-grid">
                <label>
                  {uiText("Số tiền đã trả (VND)")}
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
                  {uiText("Ngày trả")}
                  <input name="paid_on" type="date" required />
                </label>
              </div>
              <p className="muted small">
                {uiText("Bạn tự báo; app không xác minh khoản này.")}
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setReporting(false)}
                >
                  {uiText("Hủy")}
                </button>
                <button className="primary" disabled={busy}>
                  {uiText("Lưu")}
                </button>
              </div>
            </form>
          )}
        </section>
      ))}
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
