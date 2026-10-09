import { Info, Motorbike, Package, Sparkles, Truck, X } from "lucide-react";
import { t, formatUi } from "../uiPreferences";

export const vehicleGuides: Record<
  string,
  { title: string; text: string; example: string }
> = {
  auto: {
    title: "Để ReloHome gợi ý",
    text: "Bạn chưa cần chọn một gói xe cụ thể. Sau khi bấm Xác nhận và lấy báo giá, ReloHome so sánh một số gói chuyển đồ trong danh mục AhaMove tại điểm A để bạn chọn. Không tự đặt xe.",
    example: "Phù hợp khi bạn muốn xem các phương án trước khi quyết định.",
  },
  truck: {
    title: "Xe tải",
    text: "Xe có cabin và thùng hàng riêng. Có nhiều cỡ xe để vận chuyển đồ đạc; kích thước thùng và giới hạn thực tế phụ thuộc từng gói.",
    example: "Tham khảo cho nhiều thùng đồ, bàn ghế hoặc đồ nội thất.",
  },
  van: {
    title: "Xe van",
    text: "Khoang chở hàng kín liền với thân xe. Cân nhắc khi chở thùng, kiện và đồ vừa khoang; kiểm tra kích thước cửa và khoang hàng theo gói.",
    example: "Tham khảo cho thùng quần áo, sách và đồ dùng đóng kiện.",
  },
  bike: {
    title: "Xe máy",
    text: "Giao đồ bằng xe máy. Cân nhắc cho ít kiện nhỏ, gọn; hàng lớn hoặc nặng cần kiểm tra lại giới hạn của hãng và loại xe phù hợp.",
    example: "Tham khảo cho túi đồ hoặc một vài kiện nhỏ.",
  },
  pickup: {
    title: "Xe bán tải",
    text: "Xe có cabin và khoang chở hàng phía sau. Kiểm tra kích thước khoang, cách bảo vệ hàng và giới hạn của gói trước khi chọn.",
    example: "Tham khảo cho các kiện vừa khoang chở hàng.",
  },
  tricycle: {
    title: "Xe ba gác",
    text: "Xe ba bánh với khoang chở hàng phía sau. Khả năng phục vụ và giới hạn hàng hóa cần xem trong gói AhaMove tại điểm lấy.",
    example: "Cân nhắc theo kích thước kiện và thông tin gói của hãng.",
  },
};

export function VehicleIcon({
  family,
  size = 20,
}: {
  family: string;
  size?: number;
}) {
  if (family === "auto") return <Sparkles size={size} />;
  if (family === "bike") return <Motorbike size={size} />;
  if (family === "van" || family === "pickup" || family === "tricycle")
    return <VehicleDrawing family={family} compact />;
  return <Truck size={size} />;
}

// Code-native illustrations, not photographs or promises of a particular vehicle model.
function VehicleDrawing({
  family,
  compact = false,
}: {
  family: string;
  compact?: boolean;
}) {
  if (family === "auto")
    return (
      <div className="mv-guide-auto-art">
        <Sparkles size={40} />
        <Package size={28} />
      </div>
    );
  return (
    <svg
      className={compact ? "mv-vehicle-icon" : "mv-vehicle-drawing"}
      viewBox={compact ? "20 20 200 90" : "0 0 240 120"}
      fill="none"
      aria-hidden="true"
      data-vehicle={family}
    >
      <path
        d="M18 104h205"
        stroke="currentColor"
        strokeWidth="2"
        opacity=".2"
      />
      {family === "bike" ? (
        <>
          <circle
            cx="63"
            cy="89"
            r="18"
            fill="var(--ui-surface)"
            stroke="currentColor"
            strokeWidth="5"
          />
          <circle
            cx="184"
            cy="89"
            r="18"
            fill="var(--ui-surface)"
            stroke="currentColor"
            strokeWidth="5"
          />
          <path
            d="m68 85 29-37h49l24 40h-62Z"
            fill="var(--ui-accent-soft)"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <path
            d="m184 87-22-53-18-2m18 2 7-13h17m-84 19h43"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <rect
            x="77"
            y="19"
            width="36"
            height="25"
            rx="5"
            fill="var(--ui-accent-soft)"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path d="M87 19v25m-32 16h32" stroke="currentColor" strokeWidth="3" />
        </>
      ) : (
        <>
          {family === "truck" ? (
            <>
              <rect
                x="32"
                y="24"
                width="121"
                height="60"
                rx="7"
                fill="var(--ui-accent-soft)"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                d="M153 43h28l29 26v24h-57V43Z"
                fill="var(--ui-surface)"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                d="M164 49h14l20 19h-34Z"
                fill="currentColor"
                opacity=".18"
              />
              <path
                d="M44 40h96m-96 9h96"
                stroke="currentColor"
                opacity=".2"
                strokeWidth="2"
              />
            </>
          ) : family === "van" ? (
            <>
              <path
                d="M32 87V41a15 15 0 0 1 15-15h109l46 29a17 17 0 0 1 8 14v23H32Z"
                fill="var(--ui-accent-soft)"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                d="M151 34v32h49l-49-32Z"
                fill="currentColor"
                opacity=".18"
              />
              <path
                d="M139 33v54m-7-32h-6m-87 19h81"
                stroke="currentColor"
                strokeWidth="3"
              />
            </>
          ) : family === "pickup" ? (
            <>
              <path
                d="M28 87V53h83V34h43l31 29h26v29H28Z"
                fill="var(--ui-accent-soft)"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                d="M118 42h31l20 20h-51Z"
                fill="currentColor"
                opacity=".18"
              />
              <path
                d="M34 60h67m9-6v35"
                stroke="currentColor"
                strokeWidth="3"
              />
            </>
          ) : (
            <>
              <path
                d="M31 86V52h113v34Z"
                fill="var(--ui-accent-soft)"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                d="M155 45h20l15 42m-46 0h40m-8-44 6-13h13"
                stroke="currentColor"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <path
                d="M45 61v17m27-17v17m27-17v17m27-17v17"
                stroke="currentColor"
                opacity=".35"
                strokeWidth="2"
              />
            </>
          )}
          <circle
            cx="67"
            cy="91"
            r="15"
            fill="var(--ui-surface)"
            stroke="currentColor"
            strokeWidth="5"
          />
          <circle
            cx="183"
            cy="91"
            r="15"
            fill="var(--ui-surface)"
            stroke="currentColor"
            strokeWidth="5"
          />
          <circle cx="67" cy="91" r="5" fill="currentColor" opacity=".3" />
          <circle cx="183" cy="91" r="5" fill="currentColor" opacity=".3" />
        </>
      )}
    </svg>
  );
}

export function VehicleGuide({
  family,
  onClose,
}: {
  family: string;
  onClose: () => void;
}) {
  const guide = vehicleGuides[family];
  if (!guide) return null;
  return (
    <section
      className="mv-vehicle-guide"
      aria-label={formatUi("Giới thiệu {0}", [t(guide.title)])}
    >
      <div className="mv-guide-head">
        <strong>
          <Info size={15} />
          {t(guide.title)}
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Đóng giới thiệu xe")}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      <div className="mv-guide-body">
        <div className="mv-guide-art">
          <VehicleDrawing family={family} />
          {family !== "auto" && <small>{t("Hình minh họa loại xe")}</small>}
        </div>
        <div>
          <p>{t(guide.text)}</p>
          <span>{t(guide.example)}</span>
        </div>
      </div>
      {family !== "auto" && (
        <small className="mv-guide-note">
          {t(
            "Thông số của gói AhaMove bên dưới quyết định giới hạn thực tế của chuyến hàng.",
          )}
        </small>
      )}
    </section>
  );
}
