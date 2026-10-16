import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Building2, Home, CalendarClock } from "lucide-react";
import { attentionCount } from "../housingActivity";
import { t, formatUi } from "../uiPreferences";
import { housingManagement } from "./client";
import type { ContactRequest, PropertyDetail, PropertySummary } from "./types";

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
  const activity = (items: ContactRequest[]) =>
    formatUi("{0} lịch cần xác nhận · {1} báo chuyển tiền · {2} tin chưa đọc", [
      items.filter((item) => item.viewing_status === "requested").length,
      items.filter((item) => item.payment_report?.status === "pending").length,
      items.reduce((sum, item) => sum + item.unread, 0),
    ]);
  if (!selected)
    return (
      <section className="ll-panel ll-contact-hierarchy">
        <h2>{t("Yêu cầu liên hệ theo nhà")}</h2>
        <p>
          {t(
            "Chọn nhà, sau đó chọn phòng để xử lý lịch hẹn và báo cáo chuyển tiền.",
          )}
        </p>
        {!properties.length && <p>{t("Chưa có nhà nào")}</p>}
        <div className="ll-property-list ll-contact-properties">
          {properties.map((property) => {
            const items = contacts.filter((row) => belongs(row, property));
            return (
              <button
                key={property.id}
                onClick={() => {
                  setSelected(property);
                  setRoom(null);
                }}
              >
                {attentionCount(items) > 0 && (
                  <span
                    className="ll-request-badge"
                    aria-label={formatUi("{0} yêu cầu cần chú ý", [
                      attentionCount(items),
                    ])}
                  >
                    {attentionCount(items)}
                  </span>
                )}
                <Building2 aria-hidden="true" />
                <div className="ll-property-copy">
                  <strong>{property.name}</strong>
                  <p>{formatUi("{0} phòng / căn", [property.unit_count])}</p>
                  <small>{activity(items)}</small>
                </div>
              </button>
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
  const rooms = (detail?.units || []).map((unit) => ({
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
      <div className="ll-unit-list">
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
              {attentionCount(matches) > 0 && (
                <span
                  className="ll-request-badge"
                  aria-label={formatUi("{0} yêu cầu cần chú ý", [
                    attentionCount(matches),
                  ])}
                >
                  {attentionCount(matches)}
                </span>
              )}
              <Home aria-hidden="true" />
              <strong>{unit.code}</strong>
              <span>{unit.title || t("Chưa có tin")}</span>
              <small>{activity(matches)}</small>
              <span>
                <CalendarClock size={16} />
                {formatUi("{0} yêu cầu", [matches.length])}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
