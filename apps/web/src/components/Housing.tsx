import { formatUi, t as uiText } from "../uiPreferences";
import { useEffect, useState, type ReactNode } from "react";
import { rt } from "../roommate/text";
import {
  BadgeCheck,
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
import { posterLabels } from "../landlord/HostProfile";
import { api, housePrice, money, requestId, safeUrl } from "../api";
import type { Data, House } from "../types";
import { estimateCost, type CostLine, type Usage } from "../housingCost";
import { Dialog } from "./Dialog";
import { HouseGallery } from "./HouseGallery";
import { TenantHostReviews } from "./HousingReviews";
import { useAccountAccess } from "../accountAccess";

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
  roommateActions,
  roommateNotice,
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
  // A linked occupied room connects to its Roommate poster, never to a landlord.
  roommateActions?: ReactNode;
  roommateNotice?: string;
}) {
  const [detail, setDetail] = useState(house),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const { isGuest } = useAccountAccess();
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
    if (isGuest) return;
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
  }, [house.id, isGuest]);
  const source = safeUrl(
    detail.source?.url || detail.source?.source_url || detail.source_url,
  );
  return (
    <Dialog title={uiText("Chi tiết nhà")} onClose={onClose}>
      <div className="detail-photo">
        <HouseGallery key={house.id} house={detail} />
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
          [
            "Tiền cọc",
            detail.deposit_vnd != null ? money(detail.deposit_vnd) : null,
          ],
          ["Phòng ngủ", detail.bedrooms],
          ["Phòng tắm", detail.bathrooms],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{uiText(String(k))}</dt>
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
      {roommateActions ? (
        <p className="notice amber">
          {roommateNotice || rt(
            "Phòng đang tìm người ở cùng. Liên hệ người đăng qua Roommate; đây không phải yêu cầu thuê căn hoặc đặt lịch với chủ nhà.",
            "This room is seeking a roommate. Contact the poster through Roommate, not the landlord rental or viewing flow.",
          )}
        </p>
      ) : (
        <HousingDecisionTools house={detail} />
      )}
      {!roommateActions && detail.management && (
        <TenantHostReviews listingId={detail.id} />
      )}
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
      {roommateActions ? (
        <div className="detail-footer ws-roommate-actions">{roommateActions}</div>
      ) : (
        onSelect && (
          <div className="detail-footer">
            {onAsk && (
              <button
                className="secondary"
                onClick={() => onAsk("Tôi muốn hỏi thêm về căn nhà này.")}
              >
                <MessageCircle size={16} />
                {uiText("Hỏi AI")}
              </button>
            )}
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
        )
      )}
    </Dialog>
  );
}

const OPEN_REQUEST = new Set(["new", "contacted", "viewing"]);
const REQUEST_STATUS: Record<string, string> = {
  new: "Đã gửi yêu cầu",
  contacted: "Chủ nhà đã liên hệ",
  viewing: "Chủ nhà đã hẹn xem",
  resolved: "Đã hoàn tất",
  declined: "Đã đóng",
};

// Tenant quantities start empty: the estimate never assumes a usage level (SPEC-021 AC-04).
export function UsageInputs({
  usage,
  onChange,
}: {
  usage: Usage;
  onChange: (next: Usage) => void;
}) {
  const field = (key: keyof Usage, label: string, Icon: typeof Users, max: number) => (
    <label key={key}>
      <Icon size={15} /> {uiText(label)}
      <input
        type="number"
        min="0"
        max={max}
        inputMode="decimal"
        placeholder={uiText("Bạn nhập")}
        value={usage[key] ?? ""}
        onChange={(e) =>
          onChange({
            ...usage,
            [key]: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)),
          })
        }
      />
    </label>
  );
  return (
    <div className="housing-usage-grid">
      {field("people", "Số người", Users, 20)}
      {field("kwh", "Điện (kWh/tháng)", Zap, 10000)}
      {field("m3", "Nước (m³/tháng)", Droplets, 1000)}
      {field("vehicles", "Số xe", Calculator, 20)}
    </div>
  );
}

const amountText = (line: CostLine) =>
  line.amount != null
    ? money(line.amount)
    : line.missing === "quantity"
      ? uiText("Cần số liệu của bạn")
      : uiText("Chưa rõ");

// Daily or non-VND prices cannot be turned into a monthly total without guessing.
const NO_MONTHLY_RENT = "Chưa rõ: giá không tính theo tháng";
function HousingDecisionTools({ house }: { house: House }) {
  const { isGuest, requireAccount } = useAccountAccess();
  const [usage, setUsage] = useState<Usage>({});
  const [message, setMessage] = useState(
    uiText("Tôi quan tâm căn này và muốn trao đổi thêm về lịch xem phòng."),
  );
  const [sending, setSending] = useState(false);
  const [requestState, setRequestState] = useState("");
  const [mine, setMine] = useState<Data | null>(null);
  const cost = estimateCost(house, usage);
  const acceptsContact = Boolean(house.management?.accepts_contact_requests);
  async function loadMine() {
    try {
      const page = await api<{ items: Data[] }>(
        "/housing-management/housing/contact-requests/me",
      );
      setMine(
        page.items.find(
          (r) => r.listing_id === house.id && OPEN_REQUEST.has(r.status),
        ) || null,
      );
    } catch {
      setMine(null);
    }
  }
  useEffect(() => {
    if (acceptsContact && !isGuest) void loadMine();
  }, [house.id, acceptsContact, isGuest]);
  async function contact() {
    if (!requireAccount()) return;
    setSending(true);
    setRequestState("");
    try {
      await api(
        `/housing-management/housing/${encodeURIComponent(house.id)}/contact-requests`,
        "POST",
        { message },
      );
      setRequestState(
        uiText("Đã gửi yêu cầu. Chủ nhà sẽ thấy lời nhắn trong hộp thư quản lý."),
      );
      await loadMine();
    } catch (cause) {
      setRequestState((cause as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function cancel() {
    if (!mine) return;
    setSending(true);
    try {
      await api(
        `/housing-management/housing/contact-requests/${encodeURIComponent(mine.id)}/cancel`,
        "POST",
        { revision: mine.revision },
      );
      setRequestState(uiText("Đã hủy yêu cầu liên hệ."));
      await loadMine();
    } catch (cause) {
      setRequestState((cause as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="housing-decision-tools" aria-labelledby="housing-cost-title">
      <div className="housing-cost-box">
      <div className="housing-tool-heading">
        <span>
          <Calculator size={19} />
        </span>
        <div>
          <h3 id="housing-cost-title">{uiText("Ước tính chi phí")}</h3>
          <p>
            {uiText(
              "Chỉ dùng mức phí chủ nhà công bố và số liệu bạn nhập; khoản thiếu không được tính bằng 0.",
            )}
          </p>
        </div>
      </div>
      <UsageInputs usage={usage} onChange={setUsage} />
      <dl className="housing-cost-summary">
        {cost.monthly.map((l, i) => (
          <div key={"m" + i}>
            <dt>{uiText(l.label)}</dt>
            <dd>{amountText(l)}</dd>
          </div>
        ))}
        <div className="total">
          <dt>
            {cost.monthlyComplete
              ? uiText("Tổng mỗi tháng")
              : uiText("Tạm tính mỗi tháng (từ các khoản đã biết)")}
          </dt>
          <dd>{cost.rent == null ? uiText(NO_MONTHLY_RENT) : money(cost.monthlyKnown)}</dd>
        </div>
        <div>
          <dt>{uiText("Tiền cọc")}</dt>
          <dd>{cost.deposit != null ? money(cost.deposit) : uiText("Chưa rõ")}</dd>
        </div>
        <div>
          <dt>
            {cost.moveInComplete
              ? uiText("Cần chuẩn bị khi vào ở")
              : uiText("Cần chuẩn bị khi vào ở (tạm tính)")}
          </dt>
          <dd>{cost.rent == null ? uiText(NO_MONTHLY_RENT) : money(cost.moveInKnown)}</dd>
        </div>
        {cost.oneTime.map((l, i) => (
          <div key={"o" + i}>
            <dt>{formatUi("{0} (một lần)", [uiText(l.label)])}</dt>
            <dd>{amountText(l)}</dd>
          </div>
        ))}
      </dl>
      {cost.optional.length > 0 && (
        <p className="muted small">
          {uiText("Phí tùy chọn, không tính vào tổng: ")}
          {cost.optional
            .map((l) => `${uiText(l.label)} ${amountText(l)}`)
            .join(" · ")}
        </p>
      )}
      {cost.unknown.length > 0 && (
        <p className="housing-cost-warning">
          <CircleAlert size={16} />{" "}
          {formatUi("Chưa rõ, hãy hỏi chủ nhà: {0}.", [
            cost.unknown.map((l) => uiText(l)).join(", "),
          ])}
        </p>
      )}
      {!cost.feesPublished && (
        <p className="housing-cost-warning">
          <CircleAlert size={16} />{" "}
          {uiText(
            "Tin này chưa công bố điện, nước và phí định kỳ; tổng chỉ gồm tiền thuê.",
          )}
        </p>
      )}
      </div>
      {acceptsContact && (
        <div className="housing-contact-box">
          <h3>{uiText("Gửi yêu cầu liên hệ")}</h3>
          {house.management?.poster_type && (
            <p className="housing-poster">
              <BadgeCheck size={15} aria-hidden="true" />
              {[
                house.management.poster_name,
                uiText(posterLabels[house.management.poster_type]),
                house.management.host_verified
                  ? uiText("Người đăng đã được ReloHome xác minh")
                  : uiText("Người đăng chưa được xác minh"),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p>
            {uiText(
              "ReloHome chuyển lời nhắn tới tài khoản quản lý tin. Thông tin liên hệ không được công khai trên tin.",
            )}
          </p>
          {mine ? (
            <p role="status" className="housing-contact-status">
              {formatUi("Yêu cầu của bạn: {0}.", [
                uiText(REQUEST_STATUS[mine.status] || mine.status),
              ])}{" "}
              {["new", "contacted"].includes(mine.status) && (
                <button className="text-button" disabled={sending} onClick={() => void cancel()}>
                  {uiText("Hủy yêu cầu")}
                </button>
              )}
              {mine.status === "viewing" && (
                <span className="small muted"> {uiText(VIEWING_HINT)}</span>
              )}
            </p>
          ) : (
            <>
              <textarea
                aria-label={uiText("Lời nhắn cho chủ nhà")}
                maxLength={1000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <button
                className="primary"
                disabled={sending || !message.trim()}
                onClick={() => void contact()}
              >
                <Send size={16} /> {sending ? uiText("Đang gửi…") : uiText("Gửi yêu cầu")}
              </button>
            </>
          )}
          {requestState && (
            <p role="status" className="housing-contact-status">
              {requestState}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
// The owner's "viewing" status links to the in-plan viewing flow (docs/review/housing-viewing-design.md).
export const VIEWING_HINT =
  "Chủ nhà đã nhận lịch hẹn. Chọn căn này để hẹn xem trong hội thoại, rồi đặt giờ ở Kế hoạch → Xem nhà để ReloHome nhắc lịch và hỗ trợ chốt căn.";
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
  const [usage, setUsage] = useState<Usage>({});
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
      <p className="comparison-guide">
        <span className="notice-symbol info" aria-hidden="true">i</span>
        {uiText(
          "Nhập mức dùng của bạn để so sánh chi phí; để trống thì khoản đó được ghi là chưa tính.",
        )}
      </p>
      <UsageInputs usage={usage} onChange={setUsage} />
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
      <div className="table-scroll housing-cost-comparison">
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
                "Tạm tính mỗi tháng",
                (h: House) => {
                  const cost = estimateCost(h, usage);
                  if (cost.rent == null) return uiText(NO_MONTHLY_RENT);
                  return cost.monthlyComplete
                    ? money(cost.monthlyKnown)
                    : formatUi("{0} (tạm tính)", [money(cost.monthlyKnown)]);
                },
              ],
              [
                "Cần chuẩn bị khi vào ở",
                (h: House) => {
                  const cost = estimateCost(h, usage);
                  if (cost.rent == null) return uiText(NO_MONTHLY_RENT);
                  return cost.moveInComplete
                    ? money(cost.moveInKnown)
                    : formatUi("{0} (tạm tính)", [money(cost.moveInKnown)]);
                },
              ],
              [
                "Khoản chưa rõ",
                (h: House) => {
                  const cost = estimateCost(h, usage);
                  if (!cost.feesPublished) return "Chưa công bố phí";
                  return cost.unknown.map((l) => uiText(l)).join(", ") || "Không có";
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
