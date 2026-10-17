import {
  ArrowUpRight,
  BookOpen,
  CalendarCheck,
  Compass,
  Plane,
  Truck,
  UsersRound,
} from "lucide-react";
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
    item.status === "viewing_scheduled" &&
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
      className="secondary service-suggestion"
      data-service={service}
      key={service}
      disabled={disabled}
      onClick={() => onOpen(service, item)}
      aria-haspopup={["map", "flight"].includes(service) ? "dialog" : undefined}
    >
      <span className="service-suggestion-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="service-suggestion-label">{uiText(label)}</span>
      <ArrowUpRight
        size={16}
        className="service-suggestion-arrow"
        aria-hidden="true"
      />
    </button>
  );
  return (
    <section
      ref={region}
      tabIndex={-1}
      className={"viewing-preparation" + (settled ? " settled" : "")}
      aria-label={uiText(title)}
    >
      <div className="viewing-preparation-heading">
        <CalendarCheck size={18} aria-hidden="true" />
        <strong>{uiText(title)}</strong>
        {settled && <span className="viewing-suggestion-label">{uiText("Gợi ý")}</span>}
      </div>
      <p>
        {uiText(
          settled
            ? "Chỉ là gợi ý, bạn có thể làm sau. Sắp xếp bước tiếp theo khi bạn sẵn sàng."
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
