import { useId } from "react";
import { RequiredMark } from "./RequiredMark";
import { t as uiText, formatUi } from "../uiPreferences";

export type SlotDraft = { day: string; slot: string };
// Same native day/time controls and server-provided ISO slots as the former per-card picker.
export function ViewingSlotPicker({
  slots,
  value,
  onChange,
  disabled,
  title,
  error,
}: {
  slots: string[];
  value: SlotDraft;
  onChange: (draft: SlotDraft) => void;
  disabled: boolean;
  title: string;
  error?: string;
}) {
  const id = useId();
  const days = [...new Set(slots.map((s) => s.slice(0, 10)))];
  const day = days.includes(value.day) ? value.day : days[0] || "";
  return (
    <div className="bulk-slot-fields">
      {error && (
        <p id={id + "error"} className="bulk-field-error" role="alert">
          <span className="notice-symbol" aria-hidden="true">!</span>{uiText(error)}
        </p>
      )}
      <label htmlFor={id + "day"}>
        <span className="field-label">{uiText("Ngày xem")}<RequiredMark /></span>
        <select
          id={id + "day"}
          aria-required="true"
          aria-label={formatUi("Ngày xem · {0}", [title])}
          disabled={disabled}
          value={day}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? id + "error" : undefined}
          onChange={(e) => onChange({ day: e.target.value, slot: "" })}
        >
          {!days.length && (
            <option value="">{uiText("Chưa có khung giờ trống.")}</option>
          )}
          {days.map((d) => (
            <option value={d} key={d}>
              {d.split("-").reverse().join("/")}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={id + "time"}>
        <span className="field-label">{uiText("Giờ xem")}<RequiredMark /></span>
        <select
          id={id + "time"}
          aria-required="true"
          aria-label={formatUi("Giờ xem · {0}", [title])}
          disabled={disabled || !days.length}
          value={
            slots.includes(value.slot) && value.slot.slice(0, 10) === day
              ? value.slot
              : ""
          }
          aria-invalid={Boolean(error)}
          aria-describedby={error ? id + "error" : undefined}
          onChange={(e) => onChange({ day, slot: e.target.value })}
        >
          <option value="">{uiText("Chọn giờ")}</option>
          {slots
            .filter((s) => s.slice(0, 10) === day)
            .map((s) => (
              <option key={s} value={s}>
                {s.slice(11, 16)}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}
