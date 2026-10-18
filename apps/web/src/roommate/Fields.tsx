import { RequiredMark } from "../components/RequiredMark";
import { useId } from "react";
import type { Budget, MoveIn, QuietHours } from "./types";
import { rt } from "./text";
import { FormDisclosure } from "./FormDisclosure";
export function SelectField({
  label,
  value,
  choices,
  change,
  required = false,
  placeholder,
}: {
  label: string;
  value?: string | null;
  choices: [string, string][];
  change: (value: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id}>
      <span id={id + "-label"}>
        {label}
        <RequiredMark required={required} />
      </span>
      <select
        id={id}
        aria-labelledby={id + "-label"}
        value={value || ""}
        onChange={(e) => change(e.target.value)}
        required={required}
      >
        <option value="">
          {placeholder ||
            rt("Chưa khai / không chọn", "Not provided / no preference")}
        </option>
        {choices.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
export function BudgetFields({
  value,
  change,
  required = false,
}: {
  value?: Budget | null;
  change: (value: Budget | null) => void;
  required?: boolean;
}) {
  const id = useId();
  const set = (patch: Partial<Budget>) =>
    change({ min_vnd: 0, max_vnd: 0, fee_basis: null, ...value, ...patch });
  return (
    <div className="rm-fields rm-budget-fields">
      <label>
        <span className="field-label">
          {rt("Đến · VND/người/tháng", "Up to · VND/person/month")}
          <RequiredMark required={required || Boolean(value)} />
        </span>
        <input
          type="number"
          min={Math.max(1, value?.min_vnd || 0)}
          step="1"
          value={value?.max_vnd || ""}
          required={required || Boolean(value)}
          onChange={(e) =>
            e.target.value
              ? set({ max_vnd: Number(e.target.value) })
              : change(null)
          }
          inputMode="numeric"
        />
      </label>
      <SelectField
        label={rt("Cơ sở chi phí", "Cost basis")}
        value={value?.fee_basis}
        required={required}
        choices={[
          ["rent_only", rt("Chỉ tiền thuê", "Rent only")],
          ["including_fees", rt("Đã gồm phí", "Including fees")],
        ]}
        change={(v) => set({ fee_basis: (v as Budget["fee_basis"]) || null })}
      />
      <FormDisclosure
        title={rt("Thêm mức tối thiểu", "Add a minimum budget")}
        defaultOpen={Boolean(value?.min_vnd)}
      >
        <label htmlFor={id + "min"}>
          {rt("Từ · VND/người/tháng", "From · VND/person/month")}
          <input
            id={id + "min"}
            type="number"
            min="0"
            max={value?.max_vnd || undefined}
            step="1"
            value={value?.min_vnd ?? ""}
            onChange={(e) => set({ min_vnd: Number(e.target.value) })}
            inputMode="numeric"
          />
        </label>
      </FormDisclosure>
      {!required && value && (
        <button
          className="text-button"
          type="button"
          onClick={() => change(null)}
        >
          {rt("Bỏ ngân sách", "Clear budget")}
        </button>
      )}
    </div>
  );
}
export function MoveInFields({
  value,
  change,
  required = false,
}: {
  value?: MoveIn | null;
  change: (value: MoveIn | null) => void;
  required?: boolean;
}) {
  return (
    <div className="rm-fields">
      <SelectField
        label={rt("Thời điểm vào ở", "Move-in timing")}
        value={value?.kind}
        required={required}
        choices={[
          ["flexible", rt("Linh hoạt", "Flexible")],
          ["date", rt("Ngày cụ thể", "Exact date")],
          ["range", rt("Khoảng ngày", "Date range")],
        ]}
        change={(kind) =>
          change(kind ? { kind: kind as MoveIn["kind"] } : null)
        }
      />
      {value && value.kind !== "flexible" && (
        <label>
          <span className="field-label">
            {rt("Ngày bắt đầu", "Start date")}
            <RequiredMark />
          </span>
          <input
            type="date"
            required
            value={value.start || ""}
            max={value.end || undefined}
            onChange={(e) => change({ ...value, start: e.target.value })}
          />
        </label>
      )}
      {value?.kind === "range" && (
        <label>
          <span className="field-label">
            {rt("Ngày kết thúc", "End date")}
            <RequiredMark />
          </span>
          <input
            type="date"
            required
            min={value.start || undefined}
            value={value.end || ""}
            onChange={(e) => change({ ...value, end: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}
export function QuietFields({
  value,
  change,
}: {
  value?: QuietHours | null;
  change: (value: QuietHours | null) => void;
}) {
  return (
    <div className="rm-fields">
      <label>
        <span className="field-label">
          {rt("Yên tĩnh từ", "Quiet from")}
          <RequiredMark required={Boolean(value?.end)} />
        </span>
        <input
          type="time"
          value={value?.start || ""}
          required={Boolean(value?.end)}
          onChange={(e) =>
            change(
              e.target.value
                ? { start: e.target.value, end: value?.end || "" }
                : null,
            )
          }
        />
      </label>
      <label>
        <span className="field-label">
          {rt("Yên tĩnh đến", "Quiet until")}
          <RequiredMark required={Boolean(value?.start)} />
        </span>
        <input
          type="time"
          value={value?.end || ""}
          required={Boolean(value?.start)}
          onChange={(e) => {
            e.target.setCustomValidity(
              e.target.value === value?.start
                ? rt("Hai giờ phải khác nhau.", "Times must differ.")
                : "",
            );
            change(
              e.target.value
                ? { start: value?.start || "", end: e.target.value }
                : null,
            );
          }}
        />
      </label>
    </div>
  );
}
