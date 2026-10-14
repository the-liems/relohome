import { ArrowUpRight, BookOpen, Compass, House } from "lucide-react";
import { Link } from "react-router-dom";
import { t as uiText } from "../uiPreferences";
import "./serviceSuggestions.css";

type Suggestion = {
  service: "property" | "map" | "guides";
  label: string;
  to: string;
};
const choices: Record<string, Suggestion[]> = {
  flight: [
    { service: "property", label: "Tìm chỗ ở", to: "/ai?service=property" },
    { service: "map", label: "Xem đường đi", to: "/ai?service=map" },
  ],
  relocation: [
    { service: "map", label: "Xem đường đi", to: "/ai?service=map" },
    {
      service: "guides",
      label: "Cẩm nang nhận phòng",
      to: "/guides?article=nhan-phong",
    },
  ],
  map: [
    { service: "property", label: "Tìm chỗ ở", to: "/ai?service=property" },
    {
      service: "guides",
      label: "Cẩm nang xem phòng",
      to: "/guides?article=xem-phong",
    },
  ],
  roommate: [
    {
      service: "property",
      label: "Cùng tìm chỗ ở",
      to: "/ai?service=property",
    },
    {
      service: "guides",
      label: "Cẩm nang hợp đồng thuê",
      to: "/guides?article=hop-dong-thue",
    },
  ],
  guides: [
    { service: "property", label: "Tìm chỗ ở", to: "/ai?service=property" },
    { service: "map", label: "Xem đường đi", to: "/ai?service=map" },
  ],
};

/** Optional navigation. Opening a suggestion never creates a plan task or sends a request. */
export function ServiceSuggestions({
  service,
  available,
  onOpen,
  disabled = false,
}: {
  service: string;
  available?: string[];
  onOpen?: (service: string, to: string) => void;
  disabled?: boolean;
}) {
  const suggestions = (choices[service] || []).filter(
    (item) =>
      item.service === "guides" ||
      !available ||
      available.includes(item.service),
  );
  if (!suggestions.length) return null;
  return (
    <section
      className="service-suggestions"
      aria-label={uiText("Gợi ý dịch vụ liên quan")}
    >
      <span>{uiText("Bạn có thể cần thêm")}</span>
      <div>
        {suggestions.map((item) => {
          const Icon = { property: House, map: Compass, guides: BookOpen }[
            item.service
          ];
          const content = (
            <>
              <span className="service-suggestion-icon">
                <Icon size={18} aria-hidden="true" />
              </span>
              <span className="service-suggestion-label">
                {uiText(item.label)}
              </span>
              <ArrowUpRight
                size={16}
                className="service-suggestion-arrow"
                aria-hidden="true"
              />
            </>
          );
          return onOpen ? (
            <button
              key={item.service}
              className="secondary service-suggestion"
              data-service={item.service}
              disabled={disabled}
              onClick={() => onOpen(item.service, item.to)}
            >
              {content}
            </button>
          ) : (
            <Link
              key={item.service}
              className="secondary service-suggestion"
              data-service={item.service}
              to={item.to}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
