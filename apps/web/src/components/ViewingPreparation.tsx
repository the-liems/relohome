import { BookOpen, Compass, Plane, Truck, UsersRound } from "lucide-react";
import { t as uiText } from "../uiPreferences";
import type { Data } from "../types";
import { useEffect, useRef } from "react";

// Only persisted appointment/agreement state can trigger this presentation.
export function ViewingPreparation({
  item,
  available,
  disabled,
  onOpen,
  focusAfterSchedule = false,
}: {
  item: Data;
  available: string[];
  disabled: boolean;
  onOpen: (service: string, item: Data) => void;
  focusAfterSchedule?: boolean;
}) {
  const settled = ["agreed", "reported_paid"].includes(item.status);
  const landlord = item.landlord;
  const scheduled =
    ["viewing_scheduled", "visit_due"].includes(item.status) &&
    item.viewing?.slot &&
    landlord?.sync !== "failed" &&
    !["declined", "cancelled"].includes(landlord?.viewing_status) &&
    !["declined", "resolved"].includes(landlord?.request_status);
  const region = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusAfterSchedule && scheduled) {
      region.current?.scrollIntoView({ block: "nearest" });
      region.current?.focus({ preventScroll: true });
    }
  }, [focusAfterSchedule, scheduled]);
  if (!settled && !scheduled) return null;
  const title = settled ? "Chuẩn bị chuyển đến" : "Chuẩn bị cho buổi xem nhà";
  const primary = settled
    ? [
        { service: "relocation", label: "Chuyển đồ", Icon: Truck },
        { service: "roommate", label: "Ở ghép", Icon: UsersRound },
      ]
    : [{ service: "map", label: "Xem đường đi", Icon: Compass }];
  const optional = settled
    ? [{ service: "flight", label: "Tìm chuyến bay", Icon: Plane }]
    : [
        { service: "flight", label: "Tìm chuyến bay", Icon: Plane },
        { service: "relocation", label: "Chuyển đồ", Icon: Truck },
      ];
  const button = ({ service, label, Icon }: (typeof primary)[number]) => (
    <button
      type="button"
      className="secondary"
      key={service}
      disabled={disabled}
      onClick={() => onOpen(service, item)}
      aria-haspopup={["map", "flight"].includes(service) ? "dialog" : undefined}
    >
      <Icon size={15} aria-hidden="true" />
      {uiText(label)}
    </button>
  );
  return (
    <section
      ref={region}
      tabIndex={-1}
      className="viewing-preparation"
      aria-label={uiText(title)}
    >
      <strong>{uiText(title)}</strong>
      <p>
        {uiText(
          settled
            ? "Sắp xếp bước tiếp theo khi bạn sẵn sàng."
            : "Bạn có thể chuẩn bị trước; giờ hẹn vẫn theo trạng thái xác nhận ở trên.",
        )}
      </p>
      <div className="viewing-preparation-actions">
        {primary.filter((a) => available.includes(a.service)).map(button)}
        {button({
          service: "guides",
          label: settled ? "Cẩm nang chuyển đến" : "Cẩm nang xem phòng",
          Icon: BookOpen,
        })}
      </div>
      {optional.some((a) => available.includes(a.service)) && (
        <div className="viewing-preparation-optional">
          <span>{uiText("Cần chuẩn bị thêm?")}</span>
          {optional.filter((a) => available.includes(a.service)).map(button)}
        </div>
      )}
    </section>
  );
}
