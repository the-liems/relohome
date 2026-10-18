import { RequiredMark } from "./RequiredMark";
import { ArrowLeftRight } from "lucide-react";
import { t as uiText } from "../uiPreferences";
import { AIRPORT_OPTIONS, type FlightDraft } from "../serviceRequest";

export function FlightRouteFields({
  id,
  draft,
  onChange,
  onSwap,
}: {
  id: string;
  draft: FlightDraft;
  onChange: (key: "from" | "to", value: string) => void;
  onSwap: () => void;
}) {
  return (
    <>
      <div className="request-route">
        <label htmlFor={id + "from"}>
          <span className="field-label">{uiText("Nơi đi")}<RequiredMark /></span>
          <input
            id={id + "from"}
            name="from"
            list={id + "airports"}
            value={draft.from}
            onChange={(e) => onChange("from", e.target.value)}
            placeholder={uiText("Thành phố hoặc mã sân bay")}
            autoComplete="off"
            required
            aria-describedby={id + "airport-help"}
          />
        </label>
        <button
          className="request-swap icon-button outlined"
          type="button"
          aria-label={uiText("Đổi nơi đi và nơi đến")}
          onClick={onSwap}
        >
          <ArrowLeftRight size={18} />
        </button>
        <label htmlFor={id + "to"}>
          <span className="field-label">{uiText("Nơi đến")}<RequiredMark /></span>
          <input
            id={id + "to"}
            name="to"
            list={id + "airports"}
            value={draft.to}
            onChange={(e) => onChange("to", e.target.value)}
            placeholder={uiText("Thành phố hoặc mã sân bay")}
            autoComplete="off"
            required
            aria-describedby={id + "airport-help"}
          />
        </label>
      </div>
      <datalist id={id + "airports"}>
        {AIRPORT_OPTIONS.map((a) => (
          <option key={a.code} value={a.code}>
            {a.city} · {a.name}
          </option>
        ))}
      </datalist>
      <p className="request-help" id={id + "airport-help"}>
        {uiText(
          "Gõ tên thành phố hoặc chọn sân bay gợi ý. Ví dụ: Hà Nội · HAN.",
        )}
      </p>
    </>
  );
}
