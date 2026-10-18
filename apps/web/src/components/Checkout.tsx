import { RequiredMark } from "./RequiredMark";
import { formatUi, t as uiText } from "../uiPreferences";
import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  CreditCard,
  Home,
  Plane,
  RefreshCw,
  Truck,
} from "lucide-react";
import { api, dateTime, money, requestId, safeUrl } from "../api";
import type { Data } from "../types";
import { Dialog } from "./Dialog";

// In-app payment (payment-design §7–§10): one transaction per service, sandbox QR, typed calls only.

const TX_STATUS: Record<string, string> = {
  selected: "Chưa thanh toán",
  price_changed: "Giá đã đổi, cần xác nhận lại",
  payment_processing: "Đang chuẩn bị thanh toán",
  awaiting_payment: "Chờ thanh toán",
  paid_processing: "Đã thanh toán, đang hoàn tất",
  ticketed: "Đã xuất vé (mô phỏng)",
  approved: "Đã duyệt",
  paid_unfulfilled: "Đã thanh toán nhưng chưa hoàn tất, cần xử lý",
  viewing_scheduled: "Đã đặt lịch xem (chế độ thử)",
  agreed: "Đã thỏa thuận thuê (bạn tự báo)",
  not_agreed: "Không chốt căn này",
  reported_paid: "Đã báo trả chủ nhà (chưa xác minh)",
};
const OUTCOME: Record<string, string> = {
  processing: "Đang xử lý",
  awaiting_payment: "Chờ bạn thanh toán",
  needs_reconciliation: "Đang đối soát với cổng thanh toán",
  paid_verified: "Cổng xác nhận đã thanh toán",
  paid_simulated: "Đã thanh toán · đánh dấu bởi tester",
  not_paid: "Chưa thanh toán (đã hết hạn)",
  cancelled: "Đã dừng",
};
const STEPS = [
  ["summary", "Xem lại"],
  ["pay", "Thanh toán"],
  ["verify", "Xác minh"],
  ["done", "Hoàn tất"],
];
const DONE = new Set(["ticketed", "approved"]);

function stepOf(tx?: Data) {
  const outcome = tx?.attempt?.outcome;
  if (tx && DONE.has(tx.status)) return STEPS.length;
  if (outcome === "paid_verified" || outcome === "paid_simulated") return 2;
  if (outcome === "awaiting_payment" || outcome === "needs_reconciliation")
    return 1;
  return 0;
}

export function CheckoutSteps({ tx }: { tx?: Data }) {
  const at = stepOf(tx);
  return (
    <ol className="checkout-steps" aria-label={uiText("Các bước thanh toán")}>
      {STEPS.map(([key, label], i) => (
        <li
          key={key}
          className={i < at ? "done" : i === at ? "current" : ""}
          aria-current={i === at ? "step" : undefined}
        >
          <span>{i < at ? <Check size={12} /> : i + 1}</span>
          {uiText(label)}
        </li>
      ))}
    </ol>
  );
}

const vnTime = (value?: string) =>
  value
    ? new Date(value).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

function errorOf(e: unknown) {
  return (e as Error).message || uiText("Có lỗi xảy ra. Hãy thử lại.");
}

// The booker is an adult passenger (12+); the browser picker stops at that date.
const adultMax = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 12);
  return d.toISOString().slice(0, 10);
})();

export function TravelerProfileForm() {
  const [profile, setProfile] = useState<Data | null | undefined>(undefined),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    api<Data>("/profile/traveler")
      .then((r) => setProfile(r.traveler))
      .catch(() => setProfile(null));
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const r = await api<Data>("/profile/traveler", "PUT", f);
      setProfile(r.traveler);
      setSaved(true);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(uiText("Xóa thông tin người đặt vé?"))) return;
    await api("/profile/traveler", "DELETE");
    setProfile(null);
  }
  if (profile === undefined)
    return <p className="muted">{uiText("Đang tải…")}</p>;
  return (
    <section className="surface traveler-profile">
      <h3>{uiText("Người đặt vé máy bay")}</h3>
      <p className="muted small">
        {uiText(
          "Dùng làm hành khách thứ nhất và liên hệ khi thanh toán vé trong app. Lưu mã hóa, chỉ bạn xem được. Không cần CCCD hay hộ chiếu (chặng nội địa).",
        )}
      </p>
      <form key={JSON.stringify(profile)} onSubmit={submit}>
        <div className="form-grid">
          <label>
            {uiText("Danh xưng")}
            <select name="title" defaultValue={profile?.title || "MR"}>
              <option value="MR">{uiText("Ông (MR)")}</option>
              <option value="MS">{uiText("Cô (MS)")}</option>
              <option value="MRS">{uiText("Bà (MRS)")}</option>
            </select>
          </label>
          <label>
            <span className="field-label">{uiText("Họ")}<RequiredMark /></span>
            <input
              name="last_name"
              required
              maxLength={50}
              defaultValue={profile?.last_name || ""}
              placeholder="NGUYEN"
            />
          </label>
          <label>
            <span className="field-label">{uiText("Tên đệm và tên")}<RequiredMark /></span>
            <input
              name="first_name"
              required
              maxLength={50}
              defaultValue={profile?.first_name || ""}
              placeholder="VAN AN"
            />
          </label>
          <label>
            <span className="field-label">{uiText("Ngày sinh")}<RequiredMark /></span>
            <input
              name="date_of_birth"
              type="date"
              required
              max={adultMax}
              defaultValue={profile?.date_of_birth || ""}
            />
          </label>
          <label>
            <span className="field-label">{uiText("Email nhận vé")}<RequiredMark /></span>
            <input
              name="email"
              type="email"
              required
              maxLength={180}
              defaultValue={profile?.email || ""}
            />
          </label>
          <label>
            <span className="field-label">{uiText("Số điện thoại")}<RequiredMark /></span>
            <input
              name="phone"
              required
              inputMode="tel"
              maxLength={20}
              defaultValue={profile?.phone || ""}
              placeholder="0901234567"
            />
          </label>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="notice" role="status">
            {uiText("Đã lưu thông tin người đặt vé.")}
          </p>
        )}
        <div className="form-actions">
          {profile && (
            <button type="button" className="secondary" onClick={remove}>
              {uiText("Xóa")}
            </button>
          )}
          <button className="primary" disabled={busy}>
            {uiText("Lưu người đặt vé")}
          </button>
        </div>
      </form>
    </section>
  );
}

type Person = {
  type: string;
  title: string;
  last_name: string;
  first_name: string;
  date_of_birth: string;
};

function companionSlots(counts?: Data): Person[] {
  const c = counts || { adults: 1 };
  const people: Person[] = [];
  const blank = (type: string, title: string) => ({
    type,
    title,
    last_name: "",
    first_name: "",
    date_of_birth: "",
  });
  for (let i = 1; i < (c.adults || 1); i++) people.push(blank("adult", "MR"));
  for (let i = 0; i < (c.children || 0); i++)
    people.push(blank("child", "MSTR"));
  for (let i = 0; i < (c.infants || 0); i++)
    people.push(blank("infant", "MISS"));
  return people;
}

const TYPE_LABEL: Record<string, string> = {
  adult: "Người lớn",
  child: "Trẻ em (2–11 tuổi)",
  infant: "Em bé (dưới 2 tuổi)",
};
const TITLES: Record<string, string[]> = {
  adult: ["MR", "MS", "MRS"],
  child: ["MSTR", "MISS"],
  infant: ["MSTR", "MISS"],
};

export function CheckoutDialog({
  threadId,
  domain,
  tester,
  onClose,
  onChanged,
}: {
  threadId: string;
  domain: "flight" | "relocation";
  tester: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [tx, setTx] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [agree, setAgree] = useState(false),
    [traveler, setTraveler] = useState<Data | null | undefined>(undefined),
    [people, setPeople] = useState<Person[]>([]),
    [now, setNow] = useState(Date.now());
  const key = useRef(requestId());
  const attempt: Data = tx?.attempt || {};
  async function load() {
    setBusy(true);
    setError("");
    setCode("");
    try {
      const summary = await api<Data>(
        `/threads/${encodeURIComponent(threadId)}/checkout/summary`,
        "POST",
        { domain },
      );
      if (domain === "flight") {
        const profile = await api<Data>("/profile/traveler");
        setTraveler(profile.traveler || null);
      }
      setTx(summary);
      setPeople((old) =>
        old.length ? old : companionSlots(summary.passenger_counts),
      );
    } catch (e) {
      setError(errorOf(e));
      setCode((e as Data).code || "");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  // Status changes only through the user's check or the background job; poll lightly while waiting.
  useEffect(() => {
    if (
      !attempt.attempt_id ||
      !["paid_verified", "paid_simulated"].includes(attempt.outcome) ||
      DONE.has(tx?.status)
    )
      return;
    const timer = setTimeout(() => void check(true), 4000);
    return () => clearTimeout(timer);
  }, [attempt.attempt_id, attempt.outcome, tx?.status, tx?.job?.status]);

  async function call(path: string, body?: Data) {
    setBusy(true);
    setError("");
    setCode("");
    try {
      const r = await api<Data>(path, "POST", body);
      setTx({ ...r.transaction, attempt: r.attempt });
      await onChanged();
      return r;
    } catch (e) {
      setError(errorOf(e));
      setCode((e as Data).code || "");
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    if (!tx) return;
    await call(`/checkout/${encodeURIComponent(tx.transaction_id)}/pay`, {
      payload_hash: tx.payload_hash,
      request_key: key.current,
      ...(domain === "flight" ? { companions: people } : {}),
    });
  }
  async function check(silent = false) {
    if (!attempt.attempt_id) return;
    if (silent) {
      try {
        const r = await api<Data>(
          `/checkout/attempts/${encodeURIComponent(attempt.attempt_id)}/check`,
          "POST",
        );
        setTx({ ...r.transaction, attempt: r.attempt });
        if (DONE.has(r.transaction?.status)) await onChanged();
      } catch {
        // A manual check shows the error.
      }
      return;
    }
    await call(
      `/checkout/attempts/${encodeURIComponent(attempt.attempt_id)}/check`,
    );
  }
  async function testerPaid() {
    if (
      !window.confirm(
        uiText(
          "Chỉ dùng khi đã thanh toán thử trên ZaloPay sandbox mà cổng chưa cập nhật. Đánh dấu đã thanh toán?",
        ),
      )
    )
      return;
    await call(
      `/checkout/attempts/${encodeURIComponent(attempt.attempt_id)}/tester-paid`,
    );
  }

  const expiresAt = Date.parse(attempt.expires_at || "");
  const live =
    attempt.outcome === "awaiting_payment" &&
    Number.isFinite(expiresAt) &&
    expiresAt > now;
  const left = live ? Math.max(0, Math.round((expiresAt - now) / 1000)) : 0;
  const paid = ["paid_verified", "paid_simulated"].includes(attempt.outcome);
  const reopenable =
    !attempt.outcome || ["not_paid", "cancelled"].includes(attempt.outcome);
  const peopleOk =
    domain !== "flight" ||
    (traveler &&
      people.every((p) => p.last_name && p.first_name && p.date_of_birth));
  const Icon = domain === "flight" ? Plane : Truck;
  return (
    <Dialog
      title={
        domain === "flight"
          ? uiText("Thanh toán vé máy bay")
          : uiText("Thanh toán chuyển đồ")
      }
      onClose={onClose}
      wide
    >
      <div className="checkout">
        <CheckoutSteps tx={tx || undefined} />
        {!tx && !error && (
          <p role="status">{uiText("Đang lấy tóm tắt và giá…")}</p>
        )}
        {tx && (
          <section className="checkout-summary">
            <header>
              <span
                className={
                  "service-icon " + (domain === "flight" ? "blue" : "peach")
                }
              >
                <Icon size={20} />
              </span>
              <div>
                <h3>{tx.title}</h3>
                <p className="muted small">
                  {uiText(TX_STATUS[tx.status] || tx.status)}
                </p>
              </div>
            </header>
            <ul className="checkout-lines">
              {(tx.lines || []).map((l: Data, i: number) => (
                <li key={i}>{l.label}</li>
              ))}
            </ul>
            <p className="price price-large">{money(tx.price_vnd)}</p>
            <p className="muted small">
              {formatUi("Giá tham khảo lúc {0} · nguồn: {1}", [
                dateTime(tx.price_read_at || tx.updated_at),
                tx.price_source || "",
              ])}
              {tx.price_scope?.kind === "round_trip"
                ? uiText(" · tổng cả chiều đi và chiều về")
                : ""}
              {tx.passenger_counts
                ? formatUi(" · cho {0} khách", [
                    Object.values(tx.passenger_counts as Data).reduce(
                      (a: number, b) => a + Number(b || 0),
                      0,
                    ),
                  ])
                : ""}
            </p>
            <p className="muted small">
              {uiText("Người nhận tiền: ")}
              {tx.payee}
            </p>
            {(tx.reminders || []).map((r: string, i: number) => (
              <p key={i} className="notice amber">
                {r}
              </p>
            ))}
          </section>
        )}
        {tx && domain === "flight" && reopenable && (
          <section className="checkout-people">
            <h4>{uiText("Hành khách")}</h4>
            {traveler === undefined ? (
              <p className="muted">{uiText("Đang tải hồ sơ…")}</p>
            ) : traveler ? (
              <p>
                <strong>
                  1. {traveler.last_name} {traveler.first_name}
                </strong>{" "}
                <span className="muted small">
                  {uiText("· người đặt (từ hồ sơ) · sinh ")}
                  {traveler.date_of_birth}
                  {uiText(" · liên hệ: ")}
                  {traveler.email}
                </span>
              </p>
            ) : (
              <p className="notice amber">
                {uiText(
                  "Chưa có hồ sơ người đặt vé. Vào Tài khoản → Hồ sơ để điền trước khi thanh toán.",
                )}
              </p>
            )}
            {people.map((p, i) => (
              <fieldset key={i} className="form-grid companion">
                <legend>
                  {i + 2}. {uiText(TYPE_LABEL[p.type])}
                </legend>
                <label>
                  {uiText("Danh xưng")}
                  <select
                    value={p.title}
                    onChange={(e) =>
                      setPeople(
                        people.map((x, j) =>
                          j === i ? { ...x, title: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {TITLES[p.type].map((title) => (
                      <option key={title}>{title}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {uiText("Họ")}
                  <input
                    value={p.last_name}
                    maxLength={50}
                    onChange={(e) =>
                      setPeople(
                        people.map((x, j) =>
                          j === i ? { ...x, last_name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  {uiText("Tên đệm và tên")}
                  <input
                    value={p.first_name}
                    maxLength={50}
                    onChange={(e) =>
                      setPeople(
                        people.map((x, j) =>
                          j === i ? { ...x, first_name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  {uiText("Ngày sinh")}
                  <input
                    type="date"
                    value={p.date_of_birth}
                    onChange={(e) =>
                      setPeople(
                        people.map((x, j) =>
                          j === i ? { ...x, date_of_birth: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
              </fieldset>
            ))}
            <p className="muted small">
              {uiText(
                "Thông tin hành khách chỉ dùng cho lần đặt này, lưu mã hóa và tự xóa sau 30 phút. Không có hành lý ký gửi hay chọn ghế.",
              )}
            </p>
          </section>
        )}
        {tx && reopenable && (
          <section className="checkout-confirm">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
              />
              <span>
                {domain === "flight"
                  ? uiText(
                      "Tôi đã kiểm tra hành trình, giá và hành khách. Vé là mô phỏng; tiền thanh toán qua ZaloPay sandbox.",
                    )
                  : uiText(
                      "Tôi đã kiểm tra lộ trình, xe và giá. Không tạo đơn AhaMove; sau khi thanh toán (sandbox) phương án được ghi là đã duyệt.",
                    )}
              </span>
            </label>
            <div className="form-actions">
              <button className="secondary" onClick={onClose}>
                {uiText("Để sau")}
              </button>
              <button
                className="primary"
                disabled={busy || !agree || !peopleOk}
                onClick={() => void pay()}
              >
                <CreditCard size={15} />
                {busy
                  ? uiText(" Đang tạo thanh toán…")
                  : formatUi(" Thanh toán {0}", [money(tx.price_vnd)])}
              </button>
            </div>
          </section>
        )}
        {attempt.attempt_id && !reopenable && (
          <section className="checkout-attempt">
            <h4>{uiText(OUTCOME[attempt.outcome] || attempt.outcome)}</h4>
            <p className="muted small">
              {formatUi("Mã lần thanh toán {0} · {1}", [
                attempt.attempt_id,
                money(attempt.amount_vnd),
              ])}
            </p>
            {live && attempt.has_qr && (
              <div className="checkout-qr">
                <img
                  className="qr-image"
                  src={`/web/api/checkout/attempts/${encodeURIComponent(attempt.attempt_id)}/qr.svg`}
                  alt={uiText("Mã QR ZaloPay sandbox")}
                />
                {safeUrl(attempt.pay_url) && (
                  <a
                    className="text-button"
                    href={safeUrl(attempt.pay_url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {uiText("Mở trang thanh toán ZaloPay sandbox")}
                  </a>
                )}
                <p>
                  {formatUi(
                    "Quét bằng app ZaloPay sandbox. Còn {0} phút {1} giây.",
                    [Math.floor(left / 60), left % 60],
                  )}
                </p>
              </div>
            )}
            {attempt.outcome === "needs_reconciliation" && (
              <p className="notice amber">
                {uiText(
                  "Chưa chắc chắn kết quả thanh toán. App sẽ hỏi lại cổng sau hạn; đừng trả lần nữa cho tới khi có kết quả.",
                )}
              </p>
            )}
            {paid &&
              !DONE.has(tx?.status) &&
              tx?.status !== "paid_unfulfilled" && (
                <p role="status">
                  {domain === "flight"
                    ? uiText("Đang xuất vé (mô phỏng)…")
                    : uiText("Đang ghi nhận đã duyệt…")}
                </p>
              )}
            {tx?.status === "ticketed" && (
              <p className="notice">
                {formatUi("Đã xuất vé mô phỏng · mã đặt chỗ {0}", [
                  tx.details?.ticket?.pnr || "",
                ])}
              </p>
            )}
            {tx?.status === "approved" && (
              <p className="notice">
                {uiText(
                  "Đã duyệt chuyển đồ. Chưa tạo đơn với AhaMove (bản demo).",
                )}
              </p>
            )}
            {tx?.status === "paid_unfulfilled" && (
              <p className="notice amber">
                {uiText(
                  "Đã nhận thanh toán nhưng chỗ giữ đã hết hạn. Giao dịch được giữ lại để xử lý hoàn tiền; không trả thêm.",
                )}
              </p>
            )}
            {attempt.outcome === "paid_simulated" && (
              <p className="muted small">
                {uiText(
                  "Đánh dấu bởi tester; khác với trạng thái từ cổng thanh toán.",
                )}
              </p>
            )}
            <div className="form-actions">
              {!DONE.has(tx?.status) && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void check()}
                >
                  <RefreshCw size={14} />
                  {uiText(" Kiểm tra thanh toán")}
                </button>
              )}
              {tester && live && (
                <button
                  className="secondary tester"
                  disabled={busy}
                  onClick={() => void testerPaid()}
                >
                  {uiText("Đã thanh toán (tester)")}
                </button>
              )}
              {DONE.has(tx?.status) && (
                <button className="primary" onClick={onClose}>
                  {uiText("Xong")}
                </button>
              )}
            </div>
          </section>
        )}
        {error && (
          <div className="notice error" role="alert">
            <p>{error}</p>
            {(!tx || code === "authentication_required") && (
              <button className="secondary" disabled={busy} onClick={() => void load()}>
                {uiText("Thử lại")}
              </button>
            )}
            {code === "price_changed" && (
              <button className="secondary" onClick={() => void load()}>
                {uiText("Xem giá mới")}
              </button>
            )}
            {code === "uncertain" && attempt.attempt_id && (
              <button className="secondary" onClick={() => void check()}>
                {uiText("Kiểm tra")}
              </button>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function HousingSteps({
  threadId,
  tx,
  slots,
  house,
  onChanged,
}: {
  threadId: string;
  tx?: Data;
  slots: string[];
  house?: Data;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [slot, setSlot] = useState(""),
    [agreeing, setAgreeing] = useState(false),
    [reporting, setReporting] = useState(false);
  const status = tx?.status || "selected";
  const agreement: Data = tx?.details?.agreement || {};
  const rent = agreement.monthly_rent_vnd || tx?.price_vnd || house?.price_vnd;
  const days = [...new Set(slots.map((s) => s.slice(0, 10)))];
  const [day, setDay] = useState(days[0] || "");
  async function post(step: string, body: Data) {
    setBusy(true);
    setError("");
    try {
      await api(
        `/threads/${encodeURIComponent(threadId)}/housing/${step}`,
        "POST",
        body,
      );
      await onChanged();
      return true;
    } catch (e) {
      setError(errorOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="housing-steps">
      <p className="muted small">
        {uiText(
          "Tiền nhà trả trực tiếp cho chủ nhà, ngoài app. App chỉ ghi lại để nhắc và cộng chi phí.",
        )}
      </p>
      {["selected", "viewing_scheduled", "not_agreed"].includes(status) && (
        <div className="viewing">
          <h5>
            <CalendarClock size={14} />
            {status === "viewing_scheduled"
              ? formatUi(" Lịch xem: {0}", [vnTime(tx?.details?.viewing?.slot)])
              : uiText(" Đặt lịch xem nhà (chế độ thử)")}
          </h5>
          <div className="form-grid">
            <label>
              {uiText("Ngày")}
              <select value={day} onChange={(e) => setDay(e.target.value)}>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {vnTime(d + "T12:00:00+07:00")
                      .replace(/\d{2}:\d{2}/, "")
                      .trim()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {uiText("Giờ")}
              <select value={slot} onChange={(e) => setSlot(e.target.value)}>
                <option value="">{uiText("Chọn giờ")}</option>
                {slots
                  .filter((s) => s.startsWith(day))
                  .map((s) => (
                    <option key={s} value={s}>
                      {s.slice(11, 16)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <button
            className="secondary"
            disabled={busy || !slot}
            onClick={() => void post("viewing", { slot })}
          >
            {status === "viewing_scheduled"
              ? uiText("Đổi lịch xem")
              : uiText("Đặt lịch xem")}
          </button>
        </div>
      )}
      {["viewing_scheduled", "not_agreed", "agreed"].includes(status) &&
        !agreeing && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setAgreeing(true)}
          >
            {status === "agreed"
              ? uiText("Sửa thỏa thuận")
              : uiText("Báo kết quả xem nhà")}
          </button>
        )}
      {agreeing && (
        <form
          className="agreement"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget)) as Data;
            const agreed = f.result === "yes";
            const ok = await post("agreement", {
              agreed,
              deposit_vnd: agreed ? Number(f.deposit_vnd) : null,
              rent_vnd: agreed ? Number(f.rent_vnd) : null,
              move_in: agreed && f.move_in ? f.move_in : null,
            });
            if (ok) setAgreeing(false);
          }}
        >
          <fieldset>
            <legend>{uiText("Kết quả xem nhà")}</legend>
            <label className="checkbox">
              <input type="radio" name="result" value="yes" defaultChecked />
              {uiText(" Đã thỏa thuận thuê")}
            </label>
            <label className="checkbox">
              <input type="radio" name="result" value="no" />
              {uiText(" Không chốt căn này")}
            </label>
          </fieldset>
          <div className="form-grid">
            <label>
              {uiText("Tiền thuê/tháng (VND)")}
              <input
                name="rent_vnd"
                type="number"
                min="1"
                defaultValue={rent || ""}
              />
            </label>
            <label>
              {uiText("Tiền cọc thực tế (VND)")}
              <input
                name="deposit_vnd"
                type="number"
                min="1"
                defaultValue={agreement.deposit_vnd || rent || ""}
              />
              <small className="muted">
                {uiText("Gợi ý 1 tháng tiền thuê; nhập đúng mức chủ nhà báo.")}
              </small>
            </label>
            <label>
              {uiText("Ngày dọn vào")}
              <input
                name="move_in"
                type="date"
                defaultValue={agreement.move_in || ""}
              />
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setAgreeing(false)}
            >
              {uiText("Hủy")}
            </button>
            <button className="primary" disabled={busy}>
              {uiText("Lưu kết quả")}
            </button>
          </div>
        </form>
      )}
      {status === "agreed" && (
        <p>
          {formatUi("Cần trả chủ nhà: cọc {0} + tháng đầu {1}", [
            money(agreement.deposit_vnd),
            money(agreement.first_month_vnd),
          ])}
          {agreement.move_in
            ? formatUi(" · dọn vào {0}", [agreement.move_in])
            : ""}
        </p>
      )}
      {status === "agreed" && !reporting && (
        <button className="secondary" onClick={() => setReporting(true)}>
          {uiText("Báo đã trả chủ nhà")}
        </button>
      )}
      {reporting && (
        <form
          className="agreement"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget)) as Data;
            const ok = await post("paid", {
              amount_vnd: Number(f.amount_vnd),
              paid_on: f.paid_on,
            });
            if (ok) setReporting(false);
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
                  (agreement.deposit_vnd || 0) +
                    (agreement.first_month_vnd || 0) || ""
                }
              />
            </label>
            <label>
              <span className="field-label">{uiText("Ngày trả")}<RequiredMark /></span>
              <input
                name="paid_on"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
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
      {status === "reported_paid" && (
        <p className="notice">
          {formatUi("Đã báo trả {0} ngày {1} · chưa xác minh", [
            money(tx?.details?.reported_payment?.amount_vnd),
            tx?.details?.reported_payment?.paid_on || "",
          ])}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Plan-panel tab: one card per selected service, totals computed by the server from payments.
export function CheckoutPanel({
  threadId,
  checkout,
  facts,
  house,
  hideHousing = false,
  onChanged,
  requireAccount,
}: {
  threadId: string;
  checkout?: Data;
  facts: Data;
  house?: Data;
  // Housing steps live in the "Xem nhà" tab when several homes can be viewed.
  hideHousing?: boolean;
  onChanged: () => Promise<void> | void;
  requireAccount?: () => boolean;
}) {
  const [open, setOpen] = useState<"flight" | "relocation" | null>(null);
  if (!checkout)
    return (
      <p className="muted">
        {uiText("Thanh toán trong app chưa bật trên máy chủ này.")}
      </p>
    );
  const txs: Data[] = checkout.transactions || [];
  const totals: Data = checkout.totals || {};
  const byDomain = (domain: string) =>
    [...txs].reverse().find((t) => t.domain === domain);
  const services: [
    string,
    "flight" | "relocation" | "property",
    typeof Plane,
  ][] = [
    ["Nhà ở", "property", Home],
    ["Chuyển đồ", "relocation", Truck],
    ["Vé máy bay", "flight", Plane],
  ];
  return (
    <div className="checkout-panel">
      <dl className="checkout-totals">
        <div>
          <dt>{uiText("Đã thanh toán qua app")}</dt>
          <dd>
            {money(totals.paid_vnd || 0)}
            {totals.paid_tester_vnd ? (
              <small>
                {formatUi(" (trong đó {0} đánh dấu bởi tester)", [
                  money(totals.paid_tester_vnd),
                ])}
              </small>
            ) : null}
          </dd>
        </div>
        {totals.pending_vnd > 0 && (
          <div>
            <dt>{uiText("Đang chờ thanh toán")}</dt>
            <dd>{money(totals.pending_vnd)}</dd>
          </div>
        )}
        <div>
          <dt>{uiText("Cần trả chủ nhà (ngoài app)")}</dt>
          <dd>{money(totals.due_landlord_vnd || 0)}</dd>
        </div>
        {totals.reported_landlord_vnd > 0 && (
          <div>
            <dt>{uiText("Đã báo trả chủ nhà (chưa xác minh)")}</dt>
            <dd>{money(totals.reported_landlord_vnd)}</dd>
          </div>
        )}
        {totals.monthly_vnd > 0 && (
          <div>
            <dt>{uiText("Tiền thuê hằng tháng")}</dt>
            <dd>{money(totals.monthly_vnd)}</dd>
          </div>
        )}
      </dl>
      {services
        .filter(([, domain]) => !(hideHousing && domain === "property"))
        .map(([label, domain, Icon]) => {
          const tx = byDomain(domain);
          const chosen = facts["selected:" + domain]?.value;
          if (!chosen && !tx) return null;
          const outcome = tx?.attempt?.outcome;
          const status =
            outcome &&
            !DONE.has(tx?.status) &&
            tx?.status !== "paid_unfulfilled"
              ? OUTCOME[outcome]
              : TX_STATUS[tx?.status || "selected"];
          return (
            <section className="checkout-card" key={domain}>
              <header>
                <Icon size={17} />
                <strong>{uiText(label)}</strong>
                <span className="muted small">{uiText(status || "")}</span>
              </header>
              {tx?.title && <p className="small">{tx.title}</p>}
              {domain === "property" ? (
                <HousingSteps
                  threadId={threadId}
                  tx={tx}
                  slots={checkout.viewing_slots || []}
                  house={house}
                  onChanged={onChanged}
                />
              ) : (
                <>
                  {tx?.price_vnd != null && (
                    <p className="price">{money(tx.price_vnd)}</p>
                  )}
                  {(tx?.reminders || []).map((r: string, i: number) => (
                    <p key={i} className="notice amber small">
                      {r}
                    </p>
                  ))}
                  <button
                    className={DONE.has(tx?.status) ? "secondary" : "primary"}
                    onClick={() => {
                      if (!requireAccount || requireAccount()) setOpen(domain);
                    }}
                  >
                    <CreditCard size={14} />
                    {DONE.has(tx?.status)
                      ? uiText(" Xem thanh toán")
                      : outcome && !["not_paid", "cancelled"].includes(outcome)
                        ? uiText(" Tiếp tục thanh toán")
                        : uiText(" Thanh toán")}
                  </button>
                </>
              )}
            </section>
          );
        })}
      {!txs.length &&
        !["flight", "relocation", "property"].some(
          (d) => facts["selected:" + d],
        ) && (
          <p className="muted">
            {uiText(
              "Chọn phương án nhà, chuyển đồ hoặc vé máy bay trước; mỗi dịch vụ thanh toán riêng.",
            )}
          </p>
        )}
      {open && (
        <CheckoutDialog
          threadId={threadId}
          domain={open}
          tester={!!checkout.tester}
          onClose={() => setOpen(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
