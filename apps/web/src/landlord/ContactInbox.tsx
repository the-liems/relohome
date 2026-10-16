import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CalendarCheck,
  ChevronDown,
  CircleDollarSign,
  Home,
  MessageSquare,
} from "lucide-react";
import { attentionItems } from "../housingActivity";
import { t, formatUi } from "../uiPreferences";
import { housingManagement } from "./client";
import type { ContactRequest, PropertyDetail, PropertySummary } from "./types";

type Room = {
  id: string;
  code: string;
  title: string | null;
  listing: string | null;
};

/** Calendar, transfer and unread icons, each with its own count. */
function WorkIcons({ items }: { items: ContactRequest[] }) {
  const work = attentionItems(items);
  const icons = [
    [CalendarCheck, work.viewings, "lịch cần xác nhận"],
    [CircleDollarSign, work.payments, "báo chuyển tiền"],
    [MessageSquare, work.unread, "tin chưa đọc"],
  ] as const;
  return (
    <span className="ll-work-icons">
      {icons.map(([Icon, count, label]) => (
        <span
          key={label}
          role="img"
          aria-label={formatUi("{0} " + label, [count])}
          title={formatUi("{0} " + label, [count])}
          className={count ? "active" : ""}
        >
          <Icon size={20} aria-hidden="true" />
          {count > 0 && <b aria-hidden="true">{count}</b>}
        </span>
      ))}
    </span>
  );
}

function TotalBadge({ items }: { items: ContactRequest[] }) {
  const total = attentionItems(items).total;
  return total > 0 ? (
    <span
      className="ll-request-badge"
      aria-label={formatUi("{0} việc cần chú ý", [total])}
    >
      {total}
    </span>
  ) : null;
}

function roomsOf(detail: PropertyDetail | null, items: ContactRequest[]) {
  const rooms: Room[] = (detail?.units || []).map((unit) => ({
    id: unit.listing_id || unit.id,
    code: unit.unit_code,
    title: unit.title,
    listing: unit.listing_id,
  }));
  // Preserve contact history for older whole-home listings and removed rooms.
  for (const item of items)
    if (!rooms.some((unit) => unit.listing === item.listing_id))
      rooms.push({
        id: item.listing_id,
        code: item.unit_code || t("Cả căn"),
        title: item.title,
        listing: item.listing_id,
      });
  return rooms;
}

export function ContactInbox({
  properties,
  contacts,
  initialThread,
  children,
}: {
  properties: PropertySummary[];
  contacts: ContactRequest[];
  initialThread: string;
  children: (contacts: ContactRequest[]) => React.ReactNode;
}) {
  const [selected, setSelected] = useState<PropertySummary | null>(null);
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Quick view lists a home's rooms under its card, loaded when first opened.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [quick, setQuick] = useState<Record<string, PropertyDetail | "error">>(
    {},
  );
  const opened = useRef("");
  const belongs = (row: ContactRequest, property: PropertySummary) =>
    row.property_id
      ? row.property_id === property.id
      : row.property_name === property.name;
  useEffect(() => {
    if (!initialThread) {
      opened.current = "";
      return;
    }
    if (opened.current === initialThread) return;
    const row = contacts.find((item) => item.id === initialThread);
    const property = row && properties.find((item) => belongs(row, item));
    if (property && row) {
      opened.current = initialThread;
      setSelected(property);
      setRoom(row.listing_id);
    }
  }, [initialThread, properties, contacts]);
  useEffect(() => {
    setDetail(null);
    setError("");
    if (!selected) return;
    const abort = new AbortController();
    housingManagement<PropertyDetail>(
      `landlord/properties/${selected.id}`,
      "GET",
      undefined,
      abort.signal,
    )
      .then(setDetail)
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      });
    return () => abort.abort();
  }, [selected?.id]);
  function toggle(property: PropertySummary) {
    const next = !open[property.id];
    setOpen((value) => ({ ...value, [property.id]: next }));
    if (next && !quick[property.id])
      housingManagement<PropertyDetail>(`landlord/properties/${property.id}`)
        .then((page) =>
          setQuick((value) => ({ ...value, [property.id]: page })),
        )
        .catch(() =>
          setQuick((value) => ({ ...value, [property.id]: "error" })),
        );
  }
  if (!selected)
    return (
      <section className="ll-panel ll-contact-hierarchy">
        <h2>{t("Yêu cầu liên hệ theo nhà")}</h2>
        <p>
          {t(
            "Chọn nhà, sau đó chọn phòng để xử lý lịch hẹn và báo cáo chuyển tiền. Hoặc bấm nút xem nhanh ở bên phải để mở thẳng phòng cần xử lý.",
          )}
        </p>
        {!properties.length && <p>{t("Chưa có nhà nào")}</p>}
        <div className="ll-contact-properties">
          {properties.map((property) => {
            const items = contacts.filter((row) => belongs(row, property));
            const loaded = quick[property.id];
            return (
              <article key={property.id} className="ll-contact-house">
                <div className="ll-contact-house-head">
                  <button
                    className="ll-contact-house-open"
                    onClick={() => {
                      setSelected(property);
                      setRoom(null);
                    }}
                  >
                    <Building2 aria-hidden="true" />
                    <span className="ll-property-copy">
                      <strong>{property.name}</strong>
                      <p>
                        {formatUi("{0} phòng / căn", [property.unit_count])}
                      </p>
                      <WorkIcons items={items} />
                    </span>
                  </button>
                  <TotalBadge items={items} />
                  <button
                    className="ll-quick-toggle"
                    aria-expanded={Boolean(open[property.id])}
                    aria-label={formatUi(
                      open[property.id]
                        ? "Thu gọn các phòng của {0}"
                        : "Xem nhanh các phòng của {0}",
                      [property.name],
                    )}
                    title={t("Xem nhanh các phòng")}
                    onClick={() => toggle(property)}
                  >
                    <ChevronDown size={20} aria-hidden="true" />
                  </button>
                </div>
                {open[property.id] && (
                  <ul
                    className="ll-quick-rooms"
                    aria-label={formatUi("Các phòng của {0}", [property.name])}
                  >
                    {!loaded ? (
                      <li role="status">{t("Đang tải nhà…")}</li>
                    ) : loaded === "error" ? (
                      <li role="alert">
                        {t("Chưa tải được danh sách phòng.")}
                      </li>
                    ) : (
                      roomsOf(loaded, items).map((unit) => (
                        <li key={unit.id}>
                          <button
                            onClick={() => {
                              setSelected(property);
                              setRoom(unit.listing || unit.id);
                            }}
                          >
                            <span className="ll-quick-room-name">
                              <Home size={18} aria-hidden="true" />
                              <strong>{unit.code}</strong>
                            </span>
                            <span>{unit.title || t("Chưa có tin")}</span>
                            <WorkIcons
                              items={items.filter(
                                (item) => item.listing_id === unit.listing,
                              )}
                            />
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </section>
    );
  const items = contacts.filter((row) => belongs(row, selected));
  if (room)
    return (
      <div className="ll-contact-hierarchy">
        <button className="ll-back" onClick={() => setRoom(null)}>
          <ArrowLeft size={16} />
          {formatUi("Các phòng tại {0}", [selected.name])}
        </button>
        {children(items.filter((item) => item.listing_id === room))}
      </div>
    );
  const rooms = roomsOf(detail, items);
  return (
    <section className="ll-panel ll-contact-hierarchy">
      <button
        className="ll-back"
        onClick={() => {
          setSelected(null);
          setRoom(null);
        }}
      >
        <ArrowLeft size={16} />
        {t("Tất cả nhà")}
      </button>
      <h2>{selected.name}</h2>
      <p>{t("Chọn phòng để xem yêu cầu từ người thuê.")}</p>
      {error && (
        <p role="alert" className="ll-form-error">
          {error}
        </p>
      )}
      {!detail && !error && <p role="status">{t("Đang tải nhà…")}</p>}
      {detail && !rooms.length && <p>{t("Chưa có phòng")}</p>}
      <div className="ll-contact-rooms">
        {rooms.map((unit) => {
          const matches = items.filter(
            (item) => item.listing_id === unit.listing,
          );
          return (
            <button
              className="ll-contact-room"
              key={unit.id}
              onClick={() => setRoom(unit.listing || unit.id)}
            >
              <TotalBadge items={matches} />
              <Home aria-hidden="true" />
              <strong>{unit.code}</strong>
              <span>{unit.title || t("Chưa có tin")}</span>
              <WorkIcons items={matches} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
