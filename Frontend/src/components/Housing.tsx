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
} from "lucide-react";
import { api, housePrice, money, safeUrl } from "../api";
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
export function Comparison({
  houses,
  onClose,
  onOpen,
}: {
  houses: House[];
  onClose: () => void;
  onOpen: (h: House) => void;
}) {
  return (
    <Dialog title={uiText("So sánh các căn đã chọn")} wide onClose={onClose}>
      <p className="muted">
        <GitCompareArrows size={16} />
        {uiText(
          " Thông tin từ những kết quả đã tải. Giá và tình trạng trống cần được xác minh với nguồn tin.",
        )}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{uiText("Tiêu chí")}</th>
              {houses.map((h) => (
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
                "Diện tích",
                (h: House) =>
                  h.area_m2 != null ? h.area_m2 + " m²" : "Chưa có dữ liệu",
              ],
              ["Phòng ngủ", (h: House) => h.bedrooms ?? "Chưa có dữ liệu"],
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
                {houses.map((h) => (
                  <td key={h.id}>{(fn as (h: House) => string)(h)}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">
                <span className="sr-only">{uiText("Thao tác")}</span>
              </th>
              <>
                {houses.map((h) => (
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
    </Dialog>
  );
}
