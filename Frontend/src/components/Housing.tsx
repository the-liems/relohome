import { t as uiText } from "../uiPreferences";
import { useEffect, useState } from "react";
import {
  BedDouble,
  Bath,
  Ruler,
  Heart,
  MapPin,
  ArrowUpRight,
  Check,
  House as HouseIcon,
  ExternalLink,
  MessageCircle,
  GitCompareArrows,
  Calculator,
  CircleAlert,
  Droplets,
  Send,
  Users,
  Zap,
} from "lucide-react";
import { api, housePrice, money, requestId, safeUrl } from "../api";
import type { House } from "../types";
import { Dialog } from "./Dialog";

export const amenities: Record<string, string> = {
  parking: "Chỗ để xe",
  air_conditioning: "Điều hòa",
  aircon: "Điều hòa",
  furnished: "Có nội thất",
  wifi: "Wi-Fi",
  elevator: "Thang máy",
  balcony: "Ban công",
  kitchen: "Bếp",
  washing_machine: "Máy giặt",
  pet_friendly: "Cho nuôi thú cưng",
  internet: "Internet",
  refrigerator: "Tủ lạnh",
  hot_water: "Nước nóng",
  allow_cooking: "Được nấu ăn",
  bed: "Giường",
  wardrobe: "Tủ quần áo",
  desk: "Bàn làm việc",
  security: "An ninh",
  natural_light: "Ánh sáng tự nhiên",
  private_bathroom: "WC riêng",
  shared_bathroom: "WC chung",
  gym: "Phòng gym",
  swimming_pool: "Hồ bơi",
};
export function HouseImage({ house }: { house: House }) {
  const [failed, setFailed] = useState(false);
  return safeUrl(house.thumbnail_url) && !failed ? (
    <img
      src={house.thumbnail_url}
      alt={house.title}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="house-placeholder">
      <HouseIcon size={30} />
      <span>{uiText("Chưa có ảnh")}</span>
    </div>
  );
}
export function HousingCard({
  house,
  selected,
  saved,
  compare,
  onOpen,
  onSave,
  onCompare,
}: {
  house: House;
  selected?: boolean;
  saved?: boolean;
  compare?: boolean;
  onOpen: () => void;
  onSave: () => void;
  onCompare?: () => void;
}) {
  return (
    <article className={"housing-card " + (selected ? "selected" : "")}>
      <button
        className="house-photo"
        onClick={onOpen}
        aria-label={"Xem " + house.title}
      >
        <HouseImage house={house} />
      </button>
      <div className="house-info">
        <div className="house-title">
          <button className="title-button" onClick={onOpen}>
            {house.title}
          </button>
          <button
            className={"icon-button heart " + (saved ? "saved" : "")}
            onClick={onSave}
            aria-label={saved ? uiText("Bỏ lưu nhà") : uiText("Lưu nhà")}
          >
            <Heart size={18} fill={saved ? "currentColor" : "none"} />
          </button>
        </div>
        <p className="muted address">
          <MapPin size={13} />
          {house.address || uiText("Chưa có địa chỉ")}
        </p>
        <strong className="price">{housePrice(house)}</strong>
        <div className="house-stats">
          {house.area_m2 != null && (
            <span>
              <Ruler size={13} />
              {house.area_m2} m²
            </span>
          )}
          {house.bedrooms != null && (
            <span>
              <BedDouble size={14} />
              {house.bedrooms} PN
            </span>
          )}
          {house.bathrooms != null && (
            <span>
              <Bath size={14} />
              {house.bathrooms} WC
            </span>
          )}
        </div>
        <div className="tags">
          {selected && (
            <span className="tag selected-tag">
              <Check size={12} />
              {uiText("Đã chọn")}
            </span>
          )}
          {house.location_accuracy !== "rooftop" && (
            <span className="tag amber">{uiText("Vị trí gần đúng")}</span>
          )}
          {(house.amenities || []).slice(0, 2).map((a: string) => (
            <span className="tag" key={a}>
              {amenities[a] || a}
            </span>
          ))}
        </div>
        <div className="house-actions">
          <button className="text-button" onClick={onOpen}>
            {uiText("Xem chi tiết ")}
            <ArrowUpRight size={14} />
          </button>
          {onCompare && (
            <label className="compare-label">
              <input
                type="checkbox"
                checked={compare || false}
                onChange={onCompare}
              />
              {uiText("So sánh")}
            </label>
          )}
        </div>
      </div>
    </article>
  );
}
export function HousingDetail({
  house,
  saved,
  selected,
  onClose,
  onSelect,
  onSave,
  onAsk,
  busy,
}: {
  house: House;
  saved: boolean;
  selected: boolean;
  onClose: () => void;
  // Absent when the conversation that found this home was deleted (saved home opened from Account).
  onSelect?: () => void;
  onSave: () => void;
  onAsk?: (text: string) => void;
  busy: boolean;
}) {
  const [detail, setDetail] = useState(house),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    api<House>(
      "/housing/" + encodeURIComponent(house.id),
      "GET",
      undefined,
      c.signal,
    )
      .then(setDetail)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => setLoading(false));
    return () => c.abort();
  }, [house.id]);
  useEffect(() => {
    let visitor = "session";
    try {
      visitor = sessionStorage.getItem("relohome-analytics-id") || requestId();
      sessionStorage.setItem("relohome-analytics-id", visitor);
    } catch {
      visitor = requestId();
    }
    void api(`/housing-management/housing/${encodeURIComponent(house.id)}/events`, "POST", {
      event_type: "detail_view",
      dedup_key: `detail:${visitor}:${house.id}`,
    }).catch(() => {});
  }, [house.id]);
  const source = safeUrl(
    detail.source?.url || detail.source?.source_url || detail.source_url,
  );
  return (
    <Dialog title={uiText("Chi tiết nhà")} onClose={onClose}>
      <div className="detail-photo">
        <HouseImage house={detail} />
      </div>
      <div className="detail-title">
        <h2>{detail.title}</h2>
        <button
          className={"icon-button " + (saved ? "saved" : "")}
          aria-label={saved ? uiText("Bỏ lưu") : uiText("Lưu nhà")}
          onClick={onSave}
        >
          <Heart size={21} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      <strong className="price price-large">{housePrice(detail)}</strong>
      <p className="address">
        <MapPin size={16} />
        {detail.address}
      </p>
      {loading && (
        <p role="status" className="muted">
          {uiText("Đang cập nhật thông tin…")}
        </p>
      )}
      {error && (
        <p role="alert" className="notice amber">
          {uiText(error)}
          {uiText(" Đang hiển thị thông tin đã tra cứu.")}
        </p>
      )}
      <dl className="detail-grid">
        {[
          ["Diện tích", detail.area_m2 != null ? detail.area_m2 + " m²" : null],
          ["Phòng ngủ", detail.bedrooms],
          ["Phòng tắm", detail.bathrooms],
          [
            "Tiền cọc",
            detail.deposit_vnd != null ? money(detail.deposit_vnd) : null,
          ],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v ?? uiText("Chưa có dữ liệu")}</dd>
          </div>
        ))}
      </dl>
      <h3>{uiText("Về căn nhà")}</h3>
      <p className="prose">
        {detail.description ||
          uiText("Nguồn tin chưa cung cấp mô tả chi tiết.")}
      </p>
      <div className="tags">
        {(detail.amenities || []).map((a: string) => (
          <span className="tag" key={a}>
            {amenities[a] || a}
          </span>
        ))}
      </div>
      <HousingDecisionTools house={detail} />
      <p className="notice">
        {detail.location_accuracy === "rooftop"
          ? uiText("Vị trí theo tin nhà.")
          : uiText("Vị trí chỉ gần đúng theo nguồn tin.")}{" "}
        {uiText("Cần xác nhận điểm xe dừng khi chuyển đồ.")}
      </p>
      {source && (
        <a
          className="text-button"
          href={source}
          target="_blank"
          rel="noreferrer"
        >
          {uiText("Mở nguồn tin ")}
          <ExternalLink size={14} />
        </a>
      )}
      {onAsk && onSelect && (
        <div className="detail-footer">
          <button
            className="secondary"
            onClick={() => onAsk("Tôi muốn hỏi thêm về căn nhà này.")}
          >
            <MessageCircle size={16} />
            {uiText("Hỏi AI")}
          </button>
          <button
            className="primary"
            disabled={busy || selected}
            onClick={onSelect}
          >
            {selected ? (
              <>
                <Check size={16} />
                {uiText("Đã chọn")}
              </>
            ) : (
              uiText("Chọn căn này")
            )}
          </button>
        </div>
      )}
    </Dialog>
  );
}

function HousingDecisionTools({ house }: { house: House }) {
  const [people, setPeople] = useState(1);
  const [electricity, setElectricity] = useState(100);
  const [water, setWater] = useState(4);
  const [vehicles, setVehicles] = useState(1);
  const [message, setMessage] = useState("Tôi quan tâm căn này và muốn trao đổi thêm về lịch xem phòng.");
  const [sending, setSending] = useState(false);
  const [requestState, setRequestState] = useState("");
  const fees = house.fees || [];
  const rent = house.price_vnd ?? house.price?.amount ?? 0;
  const quantity: Record<string, number> = {
    month: 1, one_time: 0, kwh: electricity, m3: water,
    person_month: people, vehicle_month: vehicles,
  };
  const monthlyFees = fees.reduce(
    (total, fee) => total + (fee.amount == null ? 0 : fee.amount * (quantity[fee.billing_unit] || 0)),
    0,
  );
  const oneTime = fees.filter((fee) => fee.billing_unit === "one_time" && fee.amount != null)
    .reduce((total, fee) => total + Number(fee.amount), 0);
  const unknown = fees.filter((fee) => fee.required && fee.amount == null);
  const monthly = rent + monthlyFees;
  const moveIn = monthly + (house.deposit_vnd || 0) + oneTime;
  async function contact() {
    setSending(true); setRequestState("");
    try {
      await api(`/housing-management/housing/${encodeURIComponent(house.id)}/contact-requests`, "POST", { message });
      setRequestState("Đã gửi yêu cầu. Chủ nhà sẽ thấy lời nhắn trong hộp thư quản lý.");
    } catch (cause) { setRequestState((cause as Error).message); }
    finally { setSending(false); }
  }
  return (
    <section className="housing-decision-tools" aria-labelledby="housing-cost-title">
      <div className="housing-tool-heading">
        <span><Calculator size={19} /></span>
        <div><h3 id="housing-cost-title">Ước tính chi phí thực tế</h3><p>Tính bằng quy tắc cố định từ mức phí chủ nhà đã công bố.</p></div>
      </div>
      <div className="housing-usage-grid">
        <label><Users size={15} /> Số người<input type="number" min="1" max="20" value={people} onChange={(e) => setPeople(Number(e.target.value) || 1)} /></label>
        <label><Zap size={15} /> Điện (kWh/tháng)<input type="number" min="0" max="10000" value={electricity} onChange={(e) => setElectricity(Number(e.target.value) || 0)} /></label>
        <label><Droplets size={15} /> Nước (m³/tháng)<input type="number" min="0" max="1000" value={water} onChange={(e) => setWater(Number(e.target.value) || 0)} /></label>
        <label>Xe<input type="number" min="0" max="20" value={vehicles} onChange={(e) => setVehicles(Number(e.target.value) || 0)} /></label>
      </div>
      <dl className="housing-cost-summary">
        <div><dt>Tiền thuê</dt><dd>{money(rent)}</dd></div>
        <div><dt>Phí ước tính mỗi tháng</dt><dd>{money(monthlyFees)}</dd></div>
        <div className="total"><dt>Tổng mỗi tháng</dt><dd>{money(monthly)}</dd></div>
        <div><dt>Chi phí khi vào ở</dt><dd>{money(moveIn)}</dd></div>
        {typeof house.area_m2 === "number" && house.area_m2 > 0 && <div><dt>Giá thuê / m²</dt><dd>{money(Math.round(rent / house.area_m2))}</dd></div>}
      </dl>
      {unknown.length > 0 && <p className="housing-cost-warning"><CircleAlert size={16} /> Chưa thể tính: {unknown.map((fee) => fee.label).join(", ")}.</p>}
      {fees.length === 0 && <p className="housing-cost-warning"><CircleAlert size={16} /> Chủ nhà chưa công bố chi tiết điện, nước và các phí định kỳ.</p>}
      {house.management?.accepts_contact_requests && (
        <div className="housing-contact-box">
          <h3>Gửi yêu cầu liên hệ</h3>
          <p>ReloHome chuyển lời nhắn tới tài khoản quản lý tin. Thông tin liên hệ không được công khai trên tin.</p>
          <textarea aria-label="Lời nhắn cho chủ nhà" maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
          <button className="primary" disabled={sending || !message.trim()} onClick={() => void contact()}><Send size={16} /> {sending ? "Đang gửi…" : "Gửi yêu cầu"}</button>
          {requestState && <p role="status" className="housing-contact-status">{requestState}</p>}
        </div>
      )}
    </section>
  );
}
export function Comparison({
  houses,
  onClose,
  onOpen,
  refresh = false,
}: {
  houses: House[];
  onClose: () => void;
  onOpen: (h: House) => void;
  refresh?: boolean;
}) {
  const [loaded, setLoaded] = useState(houses);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const ids = houses.map((h) => h.id).join("|");
  useEffect(() => {
    const abort = new AbortController();
    setLoaded(houses);
    setUnavailable([]);
    if (!refresh) return;
    setLoading(true);
    // Independent read-only detail requests; no Intake/Planner or selection call.
    Promise.all(
      houses.map(async (h) => {
        try {
          const detail = await api<House>(
            "/housing/" + encodeURIComponent(h.id),
            "GET",
            undefined,
            AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
          );
          return { house: { ...h, ...detail }, failed: false };
        } catch {
          return { house: h, failed: true };
        }
      }),
    ).then((results) => {
      if (abort.signal.aborted) return;
      setLoaded(results.map((r) => r.house));
      setUnavailable(results.filter((r) => r.failed).map((r) => r.house.id));
      setLoading(false);
    });
    return () => abort.abort();
  }, [ids, refresh]);
  return (
    <Dialog title={uiText("So sánh các căn đã chọn")} wide onClose={onClose}>
      <p className="muted">
        <GitCompareArrows size={16} />
        {uiText(
          " Thông tin từ những kết quả đã tải. Giá và tình trạng trống cần được xác minh với nguồn tin.",
        )}
      </p>
      {loading && (
        <p role="status">{uiText("Đang đọc lại chi tiết các căn…")}</p>
      )}
      {unavailable.length > 0 && (
        <p className="notice amber" role="alert">
          {uiText(
            "Một số tin chưa đọc lại được; bảng đang giữ dữ liệu đã tải, không coi đó là dữ liệu mới xác minh.",
          )}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{uiText("Tiêu chí")}</th>
              {loaded.map((h) => (
                <th scope="col" key={h.id}>
                  {h.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["Giá", (h: House) => housePrice(h)],
              [
                "Giá / m²",
                (h: House) =>
                  h.price_vnd != null && h.area_m2
                    ? money(Math.round(h.price_vnd / h.area_m2))
                    : "Chưa có dữ liệu",
              ],
              [
                "Phí cố định / tháng",
                (h: House) => {
                  const fixed = (h.fees || [])
                    .filter((fee) => fee.billing_unit === "month" && fee.amount != null)
                    .reduce((sum, fee) => sum + Number(fee.amount), 0);
                  return h.fees?.length ? money(fixed) : "Chưa có dữ liệu";
                },
              ],
              [
                "Diện tích",
                (h: House) =>
                  h.area_m2 != null ? h.area_m2 + " m²" : "Chưa có dữ liệu",
              ],
              ["Phòng ngủ", (h: House) => h.bedrooms ?? "Chưa có dữ liệu"],
              ["Phòng tắm", (h: House) => h.bathrooms ?? "Chưa có dữ liệu"],
              ["Địa chỉ", (h: House) => h.address || "Chưa có dữ liệu"],
              [
                "Tiền cọc",
                (h: House) =>
                  h.deposit_vnd != null
                    ? money(h.deposit_vnd)
                    : "Chưa có dữ liệu",
              ],
              [
                "Tiện nghi",
                (h: House) =>
                  (h.amenities || [])
                    .map((a: string) => amenities[a] || a)
                    .join(", ") || "Chưa có dữ liệu",
              ],
              [
                "Vị trí",
                (h: House) =>
                  h.location_accuracy === "rooftop"
                    ? "Theo tin nhà"
                    : "Gần đúng",
              ],
            ].map(([label, fn]) => (
              <tr key={String(label)}>
                <th scope="row">{uiText(String(label))}</th>
                {loaded.map((h) => (
                  <td key={h.id}>
                    {uiText(String((fn as (h: House) => unknown)(h)))}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">
                <span className="sr-only">{uiText("Thao tác")}</span>
              </th>
              <>
                {loaded.map((h) => (
                  <td key={h.id}>
                    <button className="secondary" onClick={() => onOpen(h)}>
                      {uiText("Xem chi tiết ")}
                    </button>
                  </td>
                ))}
              </>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="notice small">
        {uiText(
          "Thiếu thông tin không có nghĩa là miễn phí. So sánh không thay căn đã chọn và không đặt/thuê nhà.",
        )}
      </p>
    </Dialog>
  );
}
