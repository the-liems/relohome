import {
  ArrowRight,
  Compass,
  House,
  Plane,
  Truck,
  UsersRound,
} from "lucide-react";
import { domainLabels } from "../api";
import { formatUi, t as uiText } from "../uiPreferences";
import type { PlanStep } from "../serviceJourney";

export function PlanNextStep({
  step,
  viewingOnly,
  disabled,
  onContinue,
  onPlan,
}: {
  step: PlanStep;
  viewingOnly: boolean;
  disabled: boolean;
  onContinue: () => void;
  onPlan: () => void;
}) {
  const Icon =
    {
      property: House,
      flight: Plane,
      relocation: Truck,
      map: Compass,
      roommate: UsersRound,
    }[step.agent] || Compass;
  return (
    <section
      className="plan-next-step"
      aria-label={uiText("Bước tiếp theo trong kế hoạch")}
    >
      <span className="plan-next-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <div className="plan-next-copy">
        <strong>{uiText("Tiếp tục kế hoạch của bạn")}</strong>
        <p>
          {uiText(
            viewingOnly && step.agent === "relocation"
              ? "Nhà mới được chọn để hẹn xem. Bạn sẽ xác nhận điểm giao khi lấy báo giá."
              : step.kind === "input"
                ? "Bổ sung thông tin cho bước kế tiếp khi bạn sẵn sàng."
                : "Xem và chọn phương án cho bước kế tiếp khi bạn sẵn sàng.",
          )}
        </p>
      </div>
      <div className="plan-next-actions">
        <button className="text-button" onClick={onPlan} disabled={disabled}>
          {uiText("Xem kế hoạch")}
        </button>
        <button className="primary" onClick={onContinue} disabled={disabled}>
          {formatUi("Bước tiếp theo: {0}", [
            uiText(domainLabels[step.agent] || step.agent),
          ])}
          <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}
