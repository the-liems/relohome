import { RequiredMark } from "./RequiredMark";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Plane, ShieldCheck } from "lucide-react";
import { t as uiText } from "../uiPreferences";
import {
  flightDefaults,
  flightRequest,
  vietnamToday,
  type FlightDraft,
} from "../serviceRequest";
import type { Data } from "../types";
import { FlightRouteFields } from "./FlightRouteFields";
import "./serviceRequest.css";

export function FlightSearchForm({
  known = {},
  continuation = false,
  disabled = false,
  onSubmit,
  onClose,
  onBusyChange,
  questions = [],
}: {
  known?: Data;
  continuation?: boolean;
  disabled?: boolean;
  onSubmit: (text: string) => Promise<void>;
  onClose?: () => void;
  onBusyChange?: (busy: boolean) => void;
  questions?: Data[];
}) {
  const [draft, setDraft] = useState<FlightDraft>(() => flightDefaults(known));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sending = useRef(false),
    errorRef = useRef<HTMLParagraphElement>(null);
  const id = useId(),
    today = vietnamToday();
  const initial = flightDefaults(known);
  const correctionKeys: Record<string, keyof FlightDraft> = {
    origin: "from",
    destination: "to",
    date: "date",
    flight_date: "date",
    return_date: "returnDate",
  };
  const corrections = questions.filter((q) => {
    const key =
      correctionKeys[
        String(q.field || "")
          .split(".")
          .at(-1)!
      ];
    return key && initial[key];
  });
  const update = (key: keyof FlightDraft, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending.current || disabled) return;
    setError("");
    try {
      const message = flightRequest(draft, today, continuation);
      sending.current = true;
      setBusy(true);
      onBusyChange?.(true);
      await onSubmit(message);
      onClose?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      noValidate
      className="service-request flight-request"
      data-service="flight"
      aria-label={uiText("Thông tin tìm chuyến bay")}
      aria-busy={busy}
    >
      <div className="request-intro">
        <span className="request-symbol" aria-hidden="true">
          <Plane size={24} />
        </span>
        <div>
          <h3>
            {uiText(
              continuation
                ? "Hoàn thiện hành trình của bạn"
                : "Chuyến đi tiếp theo bắt đầu ở đây",
            )}
          </h3>
          <p>
            {uiText(
              continuation
                ? "Thông tin đã nói được điền sẵn. Bổ sung phần còn thiếu rồi tìm chuyến."
                : "Chọn hành trình, ReloHome sẽ tìm các chuyến để bạn so sánh.",
            )}
          </p>
        </div>
      </div>
      {corrections.length > 0 && (
        <div className="notice" role="status">
          {corrections.map((q, i) => (
            <p key={i}>{q.text}</p>
          ))}
        </div>
      )}
      <fieldset className="request-trip" disabled={busy || disabled}>
        <legend className="sr-only">{uiText("Loại hành trình")}</legend>
        {[
          ["one_way", "Một chiều"],
          ["round_trip", "Khứ hồi"],
        ].map(([value, label]) => (
          <label key={value} className={draft.trip === value ? "selected" : ""}>
            <input
              type="radio"
              name={id + "trip"}
              value={value}
              checked={draft.trip === value}
              onChange={() => update("trip", value)}
            />
            {uiText(label)}
          </label>
        ))}
      </fieldset>
      <fieldset className="request-fields" disabled={busy || disabled}>
        <legend className="sr-only">{uiText("Chi tiết hành trình")}</legend>
        <FlightRouteFields
          id={id}
          draft={draft}
          onChange={update}
          onSwap={() => setDraft((d) => ({ ...d, from: d.to, to: d.from }))}
        />
        <div className="request-date-grid">
          <label htmlFor={id + "date"}>
            <span>
              <CalendarDays size={15} aria-hidden="true" />
              {uiText("Ngày bay")}
            <RequiredMark /></span>
            <input
              id={id + "date"}
              name="date"
              type="date"
              min={today}
              value={draft.date}
              onChange={(e) => update("date", e.target.value)}
              required
            />
          </label>
          {draft.trip === "round_trip" && (
            <label htmlFor={id + "return"}>
              <span className="field-label">{uiText("Ngày về")}<RequiredMark /></span>
              <input
                id={id + "return"}
                type="date"
                min={draft.date || today}
                value={draft.returnDate}
                onChange={(e) => update("returnDate", e.target.value)}
                required
              />
            </label>
          )}
          <label htmlFor={id + "adults"}>
            <span id={id + "adult-label"}>{uiText("Người lớn")}<RequiredMark /></span>
            <select
              id={id + "adults"}
              aria-labelledby={id + "adult-label"}
              name="adults"
              aria-required="true"
              value={draft.adults}
              onChange={(e) => update("adults", e.target.value)}
            >
              {Array.from({ length: 9 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
      {error && (
        <p className="notice error" role="alert" tabIndex={-1} ref={errorRef}>
          {uiText(error)}
        </p>
      )}
      <div className="request-footer">
        <p>
          <ShieldCheck size={17} aria-hidden="true" />
          {uiText("Chỉ tìm kiếm. Bạn chọn chuyến và xác nhận sau.")}
        </p>
        <div className="form-actions">
          {onClose && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onClose}
            >
              {uiText("Hủy")}
            </button>
          )}
          <button className="primary" disabled={busy || disabled}>
            {busy ? uiText("Đang tìm chuyến…") : uiText("Tìm chuyến bay")}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </form>
  );
}
