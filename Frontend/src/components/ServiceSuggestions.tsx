import { BookOpen, House, Plane, Truck, UsersRound } from "lucide-react";
import { t as uiText } from "../uiPreferences";

const options = {
  property: {
    label: "Tìm nhà",
    icon: House,
    description: "Tìm nơi ở cho hành trình của bạn",
  },
  flight: {
    label: "Tìm chuyến bay",
    icon: Plane,
    description: "Chọn nơi đi, nơi đến và ngày bay",
  },
  relocation: {
    label: "Chuyển đồ",
    icon: Truck,
    description: "Chuẩn bị chuyển đồ và xem báo giá",
  },
  roommate: {
    label: "Ở ghép",
    icon: UsersRound,
    description: "Tìm người cùng chia sẻ chỗ ở",
  },
  guides: {
    label: "Cẩm nang",
    icon: BookOpen,
    description: "Đọc kinh nghiệm thuê nhà và chuyển chỗ ở",
  },
};

export function ServiceSuggestions({
  services,
  disabled,
  onOpen,
}: {
  services: string[];
  disabled: boolean;
  onOpen: (service: string) => void;
}) {
  if (!services.length) return null;
  return (
    <div
      className="service-suggestions"
      role="group"
      aria-label={uiText("Gợi ý dịch vụ liên quan")}
    >
      <span>{uiText("Bạn có thể cần")}</span>
      {services.map((service) => {
        const option = options[service as keyof typeof options];
        if (!option) return null;
        const Icon = option.icon;
        return (
          <button
            type="button"
            key={service}
            disabled={disabled}
            title={uiText(option.description)}
            onClick={() => onOpen(service)}
            aria-haspopup={
              ["property", "flight"].includes(service) ? "dialog" : undefined
            }
          >
            <Icon size={15} aria-hidden="true" />
            {uiText(option.label)}
          </button>
        );
      })}
    </div>
  );
}
