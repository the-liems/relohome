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
}: {
  step: PlanStep;
  viewingOnly: boolean;
  disabled: boolean;
  onContinue: () => void;
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
      data-service={step.agent}
      aria-label={uiText("Bước tiếp theo trong kế hoạch")}
    >
      <button
        className="plan-next-button"
        onClick={onContinue}
        disabled={disabled}
        title={uiText(
          viewingOnly && step.agent === "relocation"
            ? "Nhà mới được chọn để hẹn xem. Bạn sẽ xác nhận điểm giao khi lấy báo giá."
            : "Bổ sung thông tin cho bước kế tiếp khi bạn sẵn sàng.",
        )}
      >
        <Icon size={16} aria-hidden="true" />
        {formatUi("Bước tiếp theo: {0}", [
          uiText(domainLabels[step.agent] || step.agent),
        ])}
        <ArrowRight size={16} />
      </button>
      {viewingOnly && step.agent === "relocation" && (
        <span className="sr-only">
          {uiText(
            "Nhà mới được chọn để hẹn xem. Bạn sẽ xác nhận điểm giao khi lấy báo giá.",
          )}
        </span>
      )}
    </section>
  );
}
