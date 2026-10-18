import { formatUi } from "../uiPreferences";
import { RequiredMark } from "./RequiredMark";
import { t as uiText } from "../uiPreferences";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LibreMap, GeoJSONSource } from "maplibre-gl";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CreditCard,
  ChevronUp,
  Clock,
  Home,
  MessageCircle,
  Plane,
  Route,
  Search,
  Truck,
  X,
} from "lucide-react";
import { api, dateTime, money } from "../api";
import type { Data } from "../types";
import { BASEMAP_STYLE_URL, MAP_THEME, tuneBasemap } from "../mapStyle";
import { WorkspaceChat, type ChatDockProps } from "./WorkspaceChat";
import { ContentSkeleton } from "./UiStates";
import { mergePlaceCandidates } from "../placeCandidates";
import {
  movingDestinationPoint,
  movingScheduleIssue,
} from "../movingSubmission";
import {
  cityForPoint,
  scopedMapOptions,
  installMapScope,
  fitMapPoints,
  focusMapPoint,
  mapCity,
} from "../mapScope";
import { loadMovingRoute } from "../movingRoute";
import {
  priceExpired as expired,
  usePriceExpiry as useExpiryRefresh,
} from "../priceExpiry";
import {
  MovingOptionsForm,
  MovingSteps,
  MovingQuoteSummary,
  validateMovingForm,
} from "./MovingOptionsForm";

// Selecting an option uses the same structured action as chat cards. The parent keeps
// the selection visible and offers an explicit button for the next plan step.
interface WorkspaceProps {
  readOnly?: boolean;
  data: Data;
  onEdit?: () => void;
  selectedId?: string;
  chat: ChatDockProps;
  onSelect: (id: string) => Promise<void>;
  onExit: () => void;
  onPay?: () => void;
  onOutbound?: (id: string) => Promise<void>;
}

const minutes = (from?: string, to?: string) =>
  from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 60000) : null;
// Flight times are shown in the airport's local time carried by the provider's ISO offset,
// not the browser's time zone.
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const hm = (value?: string) => {
  const m = value?.match(LOCAL);
  return m ? `${m[4]}:${m[5]}` : "—";
};
const localDateTime = (value?: string) => {
  const m = value?.match(LOCAL);
  return m ? `${m[4]}:${m[5]} ${m[3]}/${m[2]}/${m[1]}` : dateTime(value);
};

function useSelect(onSelect: (id: string) => Promise<void>) {
  const [selecting, setSelecting] = useState<string | null>(null);
  async function select(id: string) {
    setSelecting(id);
    try {
      await onSelect(id);
    } catch {
      // Error is shown by the chat dock.
    } finally {
      setSelecting(null);
    }
  }
  return { selecting, select };
}

const FLIGHT_SORTS: Record<
  string,
  { label: string; key: (o: Data) => number }
> = {
  price: { label: "Giá thấp nhất", key: (o) => o.fare_vnd ?? Infinity },
  depart: {
    label: "Giờ đi sớm nhất",
    key: (o) => Date.parse(o.depart_at) || Infinity,
  },
  duration: {
    label: "Bay nhanh nhất",
    key: (o) => minutes(o.depart_at, o.arrive_at) ?? Infinity,
  },
  stops: { label: "Ít điểm dừng", key: (o) => o.stops ?? Infinity },
};

export function FlightWorkspace({
  readOnly = false,
  data,
  selectedId,
  chat,
  onSelect,
  onOutbound,
  onPay,
  onEdit,
  onExit,
}: WorkspaceProps) {
  const [sort, setSort] = useState("price"),
    [carrier, setCarrier] = useState(""),
    [detail, setDetail] = useState<Data | null>(null);
  const { selecting, select } = useSelect(onSelect);
  const detailRequest = useRef(0);
  useEffect(
    () => () => {
      ++detailRequest.current;
    },
    [],
  );
  function closeDetail() {
    ++detailRequest.current;
    setDetail(null);
  }
  const offers: Data[] = data.offers || [];
  useExpiryRefresh(
    [...offers, ...(data.return_options || [])].map((o: Data) => o.expires_at),
  );
  const carriers = [...new Set(offers.map((o) => o.carrier).filter(Boolean))];
  const shown = useMemo(
    () =>
      offers
        .filter((o) => !carrier || o.carrier === carrier)
        .sort((a, b) => FLIGHT_SORTS[sort].key(a) - FLIGHT_SORTS[sort].key(b)),
    [offers, sort, carrier],
  );
  async function open(o: Data) {
    const request = ++detailRequest.current;
    setDetail({ ...o, loading: true });
    try {
      const loaded = await api<Data>("/flight/" + encodeURIComponent(o.id));
      if (request === detailRequest.current) setDetail({ ...o, ...loaded });
    } catch (e) {
      if (request === detailRequest.current)
        setDetail({ ...o, error: (e as Error).message });
    }
  }
  const roundTrip = data.trip_type === "round_trip";
  const returns: Data[] = data.return_options || [];
  const [outboundId, setOutboundId] = useState<string>(
    data.outbound_offer_id || "",
  );
  useEffect(
    () => setOutboundId(data.outbound_offer_id || ""),
    [data.outbound_offer_id],
  );
  const [loadingOutbound, setLoadingOutbound] = useState("");
  async function chooseOutbound(id: string) {
    if (!id) return setOutboundId("");
    if (id === data.outbound_offer_id) return setOutboundId(id);
    setLoadingOutbound(id);
    try {
      await onOutbound?.(id);
    } catch {
      // Error is shown by the chat dock.
    } finally {
      setLoadingOutbound("");
    }
  }
  const selectedInList =
    !!selectedId &&
    [...offers, ...returns].some(
      (o) => o.id === selectedId && o.kind !== "round_trip_outbound",
    );
  function card(o: Data, from: string, to: string, isReturn: boolean) {
    // Round trip: the return card shows the return leg; its price is the itinerary total.
    const leg = isReturn ? o.legs?.[1] || o : o;
    const duration = minutes(leg.depart_at, leg.arrive_at);
    const late = expired(o.expires_at);
    const outbound = o.kind === "round_trip_outbound";
    const chosen = outbound ? outboundId === o.id : selectedId === o.id;
    const working = outbound ? loadingOutbound === o.id : selecting === o.id;
    return (
      <article key={o.id} className={"svc-card " + (chosen ? "chosen" : "")}>
        <button
          type="button"
          className="svc-card-main"
          onClick={() => void open(o)}
          aria-label={formatUi("Xem chuyến bay {0} lúc {1}", [
            leg.carrier || o.carrier,
            hm(leg.depart_at),
          ])}
        >
          <strong className="svc-carrier">{leg.carrier || o.carrier}</strong>
          <span className="svc-timeline">
            <span>
              <strong>{hm(leg.depart_at)}</strong>
              <small>{from}</small>
            </span>
            <span className="svc-line">
              <small>
                {duration != null
                  ? `${Math.floor(duration / 60)}g ${duration % 60}p`
                  : ""}
              </small>
              <i />
              <small>
                {leg.stops === 0
                  ? uiText("Bay thẳng")
                  : leg.stops != null
                    ? formatUi("{0} điểm dừng", [leg.stops])
                    : uiText("Chưa rõ")}
              </small>
            </span>
            <span>
              <strong>{hm(leg.arrive_at)}</strong>
              <small>{to}</small>
            </span>
          </span>
          <small className="muted">{localDateTime(leg.depart_at)}</small>
        </button>
        <div className="svc-card-end">
          <strong className="price">
            {outbound ? uiText("từ ") : ""}
            {money(o.fare_vnd)}
          </strong>
          <small className="muted">
            {outbound
              ? uiText("Khứ hồi rẻ nhất có chuyến đi này")
              : o.kind === "round_trip"
                ? uiText("Tổng khứ hồi theo kết quả")
                : uiText("Tổng giá theo kết quả")}
          </small>
          <button
            className="primary"
            disabled={
              readOnly ||
              chat.busy ||
              selecting !== null ||
              !!loadingOutbound ||
              (chosen && !outbound) ||
              late ||
              o.fare_vnd == null
            }
            title={late ? uiText("Giá đã hết hạn, hãy tìm lại") : undefined}
            onClick={() => {
              if (expired(o.expires_at)) return;
              if (outbound) void chooseOutbound(o.id);
              else void select(o.id);
            }}
          >
            {chosen && !outbound ? (
              <>
                <Check size={14} />
                {uiText(" Đã chọn")}
              </>
            ) : late ? (
              uiText("Giá đã hết hạn")
            ) : working ? (
              outbound ? (
                uiText("Đang tải chiều về…")
              ) : (
                uiText("Đang chọn…")
              )
            ) : outbound ? (
              chosen ? (
                uiText("Xem chiều về")
              ) : (
                uiText("Chọn chuyến đi")
              )
            ) : isReturn ? (
              uiText("Chọn hành trình này")
            ) : (
              uiText("Chọn chuyến này")
            )}
          </button>
          <button className="text-button" onClick={() => void open(o)}>
            {uiText("Xem hành trình")}
          </button>
        </div>
      </article>
    );
  }
  return (
    <div className="svc-workspace" data-service="flight">
      <section className="svc-main" aria-label={uiText("Chuyến bay")}>
        <header className="svc-head">
          <span className="service-icon blue">
            <Plane size={20} />
          </span>
          <div>
            <span className="eyebrow">{uiText("CHUYẾN BAY")}</span>
            <h2>
              {data.origin || uiText("Nơi đi")} <ArrowRight size={18} />{" "}
              {data.destination || uiText("Nơi đến")}
            </h2>
            <p className="muted small">
              {roundTrip
                ? formatUi("Khứ hồi · đi {0} · về {1} · ", [
                    data.flight_date || "",
                    data.return_date || "",
                  ])
                : ""}
              {offers.length}
              {uiText(" chuyến · giá tại thời điểm tra cứu · chưa đặt vé")}
            </p>
          </div>
          {onEdit && !readOnly && (
            <button className="ws-pill-button" disabled={chat.busy} onClick={onEdit}>
              <CalendarDays size={15} />{uiText("Chỉnh hành trình")}
            </button>
          )}
          {onPay && selectedInList && (
            <button className="primary" onClick={onPay}>
              <CreditCard size={15} />
              {uiText(" Thanh toán")}
            </button>
          )}
          <button className="ws-pill-button" onClick={onExit}>
            <MessageCircle size={15} />
            {uiText(" Về hội thoại")}
          </button>
        </header>
        <div className="svc-toolbar">
          <select
            aria-label={uiText("Sắp xếp chuyến bay")}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {Object.entries(FLIGHT_SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <button
            className={"ws-pill-button " + (!carrier ? "active" : "")}
            onClick={() => setCarrier("")}
          >
            {uiText("Tất cả hãng")}
          </button>
          {carriers.map((c) => (
            <button
              key={c}
              className={"ws-pill-button " + (carrier === c ? "active" : "")}
              onClick={() => setCarrier(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="svc-list">
          {roundTrip && (
            <h3 className="svc-section-title">
              {outboundId
                ? uiText("1. Chuyến đi đã chọn")
                : uiText("1. Chọn chuyến đi")}
            </h3>
          )}
          {shown
            .filter((o) => !roundTrip || !outboundId || o.id === outboundId)
            .map((o) => card(o, data.origin, data.destination, false))}
          {roundTrip && outboundId && (
            <>
              <button
                className="text-button"
                onClick={() => void chooseOutbound("")}
              >
                {uiText("Đổi chuyến đi")}
              </button>
              <h3 className="svc-section-title">
                {uiText("2. Chọn chuyến về · giá là tổng cả hành trình")}
              </h3>
              {returns.map((r) => card(r, data.destination, data.origin, true))}
              {!returns.length && (
                <p className="notice">
                  {data.return_message ||
                    uiText("Chưa có chuyến về phù hợp. Hãy đổi chuyến đi.")}
                </p>
              )}
            </>
          )}
          {!shown.length && (
            <p className="notice">{uiText("Chưa có chuyến phù hợp.")}</p>
          )}
        </div>
        <WorkspaceChat
          {...chat}
          text={
            chat.fromResult
              ? formatUi(
                  "Có {0} chuyến {1} → {2}. Chọn một chuyến trong danh sách; giá theo thời điểm tra cứu, chưa đặt vé.",
                  [offers.length, data.origin || "", data.destination || ""],
                )
              : chat.text
          }
          placeholder={uiText("Hỏi ReloHome: đổi ngày bay, thêm hành khách…")}
          onSendText={chat.onSend}
        />
      </section>
      {detail && (
        <aside
          className="ws-detail svc-detail"
          aria-label={uiText("Chi tiết hành trình")}
        >
          <button
            className="icon-button ws-detail-close"
            aria-label={uiText("Đóng chi tiết")}
            onClick={closeDetail}
          >
            <X size={18} />
          </button>
          <div className="ws-detail-body">
            <h3>{detail.carrier}</h3>
            <strong className="price">
              {money(detail.fare_vnd ?? detail.total_price)}
            </strong>
            {detail.loading && (
              <ContentSkeleton
                label={uiText("Đang tải hành trình…")}
                rows={2}
              />
            )}
            {detail.error && <p className="notice error">{detail.error}</p>}
            {[
              ...(detail.segments || []),
              ...(detail.return_segments || []),
            ].map((s: Data, i: number) => (
              <div className="svc-segment" key={i}>
                <strong>
                  {s.origin || s.departure_airport || s.from}{" "}
                  <ArrowRight size={13} />{" "}
                  {s.destination || s.arrival_airport || s.to}
                </strong>
                <small>
                  {localDateTime(s.departure_time)} →{" "}
                  {localDateTime(s.arrival_time)} ·{" "}
                  {s.airline_name || s.airline_code} {s.flight_number || ""}
                </small>
              </div>
            ))}
            <p className="muted small">
              {uiText("Giá hết hạn: ")}
              {dateTime(detail.expires_at)}
              {uiText(
                ". Điều kiện hành lý/đổi vé chưa được nhà cung cấp xác nhận.",
              )}
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}

export function MovingWorkspace({
  readOnly = false,
  data,
  selectedId,
  chat,
  onSelect,
  onExit,
  onEdit,
  onPay,
}: WorkspaceProps) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [routeNotice, setRouteNotice] = useState("Đang tải tuyến đường…");
  const { selecting, select } = useSelect(onSelect);
  const quotes: Data[] = data.quotes || [];
  const route = data.route || {};
  useExpiryRefresh([data.expires_at]);
  const late = expired(data.expires_at);
  useEffect(() => {
    let disposed = false;
    const abort = new AbortController();
    setRouteNotice("Đang tải tuyến đường…");
    const routePoints = [route.pickup, route.destination].filter(
      (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng),
    );
    // Fetch the route while the basemap loads. Catch immediately: a slow/unavailable
    // map must not cause an unhandled rejection or delay provider quote controls.
    const preview =
      routePoints.length === 2
        ? loadMovingRoute(routePoints[0], routePoints[1], abort.signal)
            .then((geometry) => ({ geometry, error: null as Error | null }))
            .catch((error: Error) => ({ geometry: null, error }))
        : null;
    import("maplibre-gl").then(
      ({ Map, Marker, NavigationControl, setWorkerUrl }) => {
        if (disposed || !container.current) return;
        setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        const points = [route.pickup, route.destination].filter(
          (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng),
        );
        const city =
          points.map((p) => cityForPoint([p.lng, p.lat])).find(Boolean) ??
          "hcm";
        const m = new Map({
          container: container.current,
          style: BASEMAP_STYLE_URL,
          ...scopedMapOptions(container.current, city),
          attributionControl: { compact: true },
        });
        map.current = m;
        m.on("style.load", () => tuneBasemap(m));
        installMapScope(m, city);
        m.addControl(
          new NavigationControl({ showCompass: false }),
          "bottom-left",
        );
        m.on("load", () => {
          if (disposed) return;
          tuneBasemap(m);
          m.addSource("mv-line", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          m.addLayer({
            id: "mv-line",
            type: "line",
            source: "mv-line",
            paint: {
              "line-color": MAP_THEME.route,
              "line-width": 4,
            },
          });
          (["A", "B"] as const).forEach((label, i) => {
            const p = points[i];
            if (!p) return;
            const el = document.createElement("div");
            el.className = "mv-marker mv-" + label.toLowerCase();
            el.append(
              Object.assign(document.createElement("span"), {
                textContent: label,
              }),
            );
            new Marker({ element: el, anchor: "bottom" })
              .setLngLat([p.lng, p.lat])
              .addTo(m);
          });
          if (points.length === 2)
            fitMapPoints(
              m,
              points.map((p) => [p.lng, p.lat]),
              { padding: 80, duration: 0 },
            );
          if (points.length !== 2) {
            setRouteNotice("Chưa đủ tọa độ để hiển thị tuyến đường.");
            return;
          }
          void preview!.then(({ geometry, error }) => {
            if (error || !geometry) {
              if (!disposed && !abort.signal.aborted)
                setRouteNotice(
                  error?.message.includes("cùng khu vực")
                    ? error.message
                    : "Chưa tải được tuyến đường tham khảo OSRM. Khoảng cách trên báo giá vẫn lấy từ AhaMove.",
                );
              return;
            }
            if (disposed) return;
            (m.getSource("mv-line") as GeoJSONSource).setData({
              type: "Feature",
              properties: {},
              geometry,
            });
            fitMapPoints(m, geometry.coordinates, {
              padding: 80,
              duration: 0,
            });
            setRouteNotice("Tuyến đường tham khảo · OSRM (ô tô)");
          });
        });
      },
    );
    return () => {
      disposed = true;
      abort.abort();
      map.current?.remove();
      map.current = null;
    };
  }, [
    data.quote_id,
    route.pickup?.lat,
    route.pickup?.lng,
    route.destination?.lat,
    route.destination?.lng,
  ]);
  return (
    <div className="map-workspace moving-booking" data-service="relocation">
      <aside
        className={"ws-list " + (sheetOpen ? "open" : "")}
        aria-label={uiText("Phương án chuyển đồ")}
      >
        <button
          className="ws-sheet-toggle"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(!sheetOpen)}
        >
          {sheetOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          {uiText(" Báo giá chuyển đồ · ")}
          {quotes.length}
          {uiText(" gói xe")}
        </button>
        <header className="ws-list-head">
          <div>
            <span className="eyebrow">{uiText("CHUYỂN ĐỒ · AHAMOVE")}</span>
            <h2>{uiText("Chọn gói xe phù hợp")}</h2>
            <p className="mv-head-caption">
              {quotes.length}
              {uiText(" báo giá từ AhaMove")}
            </p>
          </div>
        </header>
        <MovingSteps stage={1} />
        <div className="mv-route">
          <div>
            <i className="mv-dot a">A</i>
            <span>{data.from_address || route.pickup?.address}</span>
          </div>
          <div>
            <i className="mv-dot b">B</i>
            <span>{data.to_address || route.destination?.address}</span>
          </div>
          <small className="muted">
            {route.order_time
              ? formatUi("Lịch lấy đồ: {0} · ", [dateTime(route.order_time)])
              : ""}
            <Clock size={12} />
            {uiText(" Báo giá hết hạn ")}
            {dateTime(data.expires_at)}
            {uiText(" · thanh toán trong app (sandbox)")}
          </small>
        </div>
        <div className="ws-list-body">
          {chat.kind === "CLARIFY" && chat.questions.length > 0 && (
            <div className="notice amber" role="status">
              <p>{chat.questions[0].text}</p>
              <button type="button" className="text-button" onClick={onExit}>
                {uiText("Về hội thoại")}
              </button>
            </div>
          )}
          {data.moving_options && (
            <MovingQuoteSummary
              options={data.moving_options}
              labels={data.addon_labels}
            />
          )}
          {quotes.map((q) => (
            <article
              key={q.id}
              className={"mv-card " + (selectedId === q.id ? "chosen" : "")}
            >
              <div className="mv-card-top">
                <span className="service-icon peach">
                  <Truck size={20} />
                </span>
                <div>
                  <strong>{q.vehicle || q.service_id}</strong>
                  <small className="muted">
                    {q.distance_km != null ? `${q.distance_km} km` : ""}
                    {q.duration_seconds != null
                      ? formatUi(" · ~{0} phút", [
                          Math.round(q.duration_seconds / 60),
                        ])
                      : ""}
                  </small>
                </div>
                <strong className="price">{money(q.price_vnd)}</strong>
              </div>
              {open === q.id && <FeeBreakdown fee={q.fee_breakdown} />}
              <div className="ws-card-actions">
                <button
                  className="ws-select-small"
                  disabled={
                    readOnly ||
                    chat.busy ||
                    selecting !== null ||
                    selectedId === q.id ||
                    late ||
                    q.price_vnd == null
                  }
                  title={
                    late
                      ? uiText("Báo giá đã hết hạn, hãy báo giá lại")
                      : undefined
                  }
                  onClick={() => {
                    if (!expired(data.expires_at)) void select(q.id);
                  }}
                >
                  {selectedId === q.id
                    ? uiText(" Đã chọn")
                    : late
                      ? uiText("Báo giá hết hạn")
                      : selecting === q.id
                        ? uiText("Đang chọn…")
                        : uiText("Chọn phương án")}
                </button>
                <button
                  className="text-button"
                  onClick={() => setOpen(open === q.id ? null : q.id)}
                >
                  {open === q.id ? uiText("Ẩn chi phí") : uiText("Xem chi phí")}
                </button>
              </div>
            </article>
          ))}
          {late && (
            <p className="notice amber">
              {uiText('Báo giá đã hết hạn. Nhắn "báo giá lại" để lấy giá mới.')}
            </p>
          )}
          {(data.warnings || []).map((w: any, i: number) => (
            <p className="notice amber" key={i}>
              {typeof w === "string" ? w : w.message || w.code}
            </p>
          ))}
        </div>
        <div className="mv-confirm">
          <button
            className="secondary"
            disabled={chat.busy}
            onClick={onEdit || onExit}
          >
            {uiText("Sửa yêu cầu / báo giá lại")}
          </button>
          {onPay && selectedId && (
            <button
              className="primary"
              disabled={chat.busy || late}
              onClick={onPay}
            >
              <CreditCard size={15} />
              {uiText(" Thanh toán")}
            </button>
          )}
          <small className="muted">
            {uiText(
              "Chọn gói xe rồi bấm Thanh toán. Bản demo không tạo đơn AhaMove và không cần tên/SĐT.",
            )}
          </small>
        </div>
      </aside>
      <section className="ws-map" aria-label={uiText("Bản đồ chuyển đồ")}>
        <div className="ws-filterbar">
          <span className="ws-filter-label">
            <Route size={15} /> <span role="status">{routeNotice}</span>
          </span>
          <span className="ws-spacer" />
          <button className="ws-pill-button" onClick={onExit}>
            <MessageCircle size={15} />
            {uiText(" Về hội thoại")}
          </button>
        </div>
        <div ref={container} className="ws-canvas" />
        <WorkspaceChat
          {...chat}
          text={
            chat.fromResult
              ? formatUi(
                  "{0} phương án chuyển đồ từ điểm A tới điểm B. Chọn một phương án; báo giá hết hạn lúc {1}.",
                  [quotes.length, dateTime(data.expires_at)],
                )
              : chat.text
          }
          placeholder={uiText("Hỏi ReloHome: đổi giờ lấy hàng, đổi điểm giao…")}
          onSendText={chat.onSend}
        />
      </section>
    </div>
  );
}

function FeeBreakdown({ fee }: { fee?: Data }) {
  if (!fee)
    return (
      <p className="muted small">
        {uiText("Nhà cung cấp chưa trả chi tiết phí.")}
      </p>
    );
  const rows = Object.entries(fee).filter(([, v]) => typeof v === "number");
  const labels: Data = {
    distance_km: "Quãng đường · km",
    duration_seconds: "Thời gian · giây",
    distance_price: "Phí quãng đường",
    stop_point_price: "Phí điểm dừng",
    special_request_price: "Phí dịch vụ thêm",
    cod_commission_price: "Phí thu hộ",
    voucher_discount: "Giảm giá",
    subtotal_price: "Tạm tính",
    total_price: "Tổng báo giá",
    total_pay: "Tổng cần trả",
  };
  return (
    <dl className="mv-fee">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{uiText(labels[k] || k.replaceAll("_", " "))}</dt>
          <dd>
            {k.includes("price") ||
            k.includes("fee") ||
            k.includes("amount") ||
            k === "total_pay"
              ? money(v)
              : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const ENDPOINTS = {
  from_address: {
    key: "pickup",
    label: "Điểm lấy đồ",
    input: "Địa chỉ lấy đồ",
    tag: "A",
  },
  to_address: {
    key: "destination",
    label: "Điểm giao đồ",
    input: "Địa chỉ giao đồ",
    tag: "B",
  },
} as const;
type EndpointField = keyof typeof ENDPOINTS;
export const MOVING_FIELDS = [
  "from_address",
  "to_address",
  "move_date",
  "move_time",
  "service_id",
] as const;
// Intake asks "relocation.move_date"; the Moving agent asks "move_date".
export const movingField = (field?: string) =>
  (field || "").replace(/^relocation\./, "");
const SELECTED = "selected:property";
const DEFAULT_CENTER: [number, number] = [105.8342, 21.0278];

interface Endpoint {
  address: string;
  pin: Data | null; // a point the user confirmed on the map, sent as moving_locations
}

// One place to enter and confirm a moving request: pickup/destination (typed, picked from
// Location candidates or tapped on the map), date and time. Prefilled from what the user already
// said, the agent's question and the home chosen earlier; nothing is sent until the user confirms.
export function MovingRequestWorkspace({
  questions,
  known,
  house,
  homeLoading = false,
  homeIssue = "",
  suggestedHomes = [],
  chat,
  onConfirm,
  onExit,
}: {
  questions: Data[];
  known: Data;
  house?: Data;
  homeLoading?: boolean;
  homeIssue?: string;
  // Homes still being viewed (not decided): suggestions for B that the user confirms.
  suggestedHomes?: Data[];
  chat: ChatDockProps;
  onConfirm: (text: string, extra: Data) => Promise<void>;
  onExit: () => void;
}) {
  const asked = Object.fromEntries(
    questions.map((q) => [movingField(q.field), q]),
  );
  const housePoint =
    house && Number.isFinite(house.lat) && Number.isFinite(house.lng)
      ? {
          id: "selected-home:" + house.id,
          label: "Phòng đã chọn: " + house.title,
          category:
            house.location_accuracy === "rooftop"
              ? house.address
              : "Vị trí tin đăng có thể gần đúng, hãy kiểm tra cổng xe đến",
          lat: house.lat,
          lng: house.lng,
        }
      : null;
  const viewingPoints: Data[] = suggestedHomes
    .filter(
      (h) =>
        h.listing_id !== house?.id &&
        Number.isFinite(h.lat) &&
        Number.isFinite(h.lng),
    )
    .map((h) => ({
      id: "viewing-home:" + h.listing_id,
      label: h.address || h.title,
      category: formatUi(
        h.location_accuracy === "rooftop"
          ? "Căn đang xem: {0}"
          : "Căn đang xem: {0} · vị trí gần đúng, hãy kiểm tra pin",
        [h.title],
      ),
      lat: h.lat,
      lng: h.lng,
    }));
  const text = (v: unknown) =>
    typeof v === "string" && v !== SELECTED ? v : "";
  const initialPin = (field: string, coordinate: Data | undefined) =>
    coordinate &&
    Number.isFinite(coordinate.lat) &&
    Number.isFinite(coordinate.lng) &&
    text(known[field])
      ? { ...coordinate, label: text(known[field]) }
      : null;
  const [ends, setEnds] = useState<Record<EndpointField, Endpoint>>({
    from_address: {
      address: text(known.from_address),
      pin: initialPin("from_address", known.pickup_coordinate),
    },
    to_address: {
      address: text(known.to_address),
      pin: initialPin("to_address", known.destination_coordinate),
    },
  });
  const [useHouse, setUseHouse] = useState(
    Boolean(house) && !text(known.to_address),
  );
  const destinationTouched = useRef(false);
  useEffect(() => {
    // Detail may arrive after the form mounts. Prefill only an untouched destination;
    // typing or pinning another B always takes precedence over a late response.
    if (house && !text(known.to_address) && !destinationTouched.current)
      setUseHouse(true);
  }, [house?.id]);
  const [date, setDate] = useState(text(known.move_date)),
    [time, setTime] = useState(text(known.move_time));
  const [options, setOptions] = useState<Data>(known.moving_options || {}),
    [optionsIssue, setOptionsIssue] = useState(""),
    [sheetOpen, setSheetOpen] = useState(true);
  const requestBody = useRef<HTMLDivElement>(null);
  function goToSection(name: string) {
    const body = requestBody.current;
    const target = body?.querySelector<HTMLElement>(
      `[data-moving-section="${name}"]`,
    );
    if (!body || !target) return;
    body.scrollTo({
      top:
        body.scrollTop +
        target.getBoundingClientRect().top -
        body.getBoundingClientRect().top -
        8,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }
  const [active, setActive] = useState<EndpointField>(
    asked.to_address && !asked.from_address ? "to_address" : "from_address",
  );
  const [found, setFound] = useState<Record<string, Data[]>>({}),
    [searched, setSearched] = useState<Record<string, boolean>>({}),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [searching, setSearching] = useState<EndpointField | null>(null),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null),
    markers = useRef<any[]>([]),
    activeRef = useRef(active);
  const searchAbort = useRef<AbortController | null>(null),
    searchGeneration = useRef(0),
    searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  activeRef.current = active;
  const candidates = (field: EndpointField): Data[] =>
    mergePlaceCandidates(
      [
        ...(field === "to_address" && housePoint ? [housePoint] : []),
        ...(field === "to_address" ? viewingPoints : []),
        ...(asked[field]?.choices || []),
        ...(found[field] || []),
      ].filter(
        (c) =>
          Number.isFinite(c.lat) &&
          Number.isFinite(c.lng) &&
          c.entity_type !== "area",
      ),
      ends[field].pin || undefined,
    );
  const shown = candidates(active);
  function activate(field: EndpointField) {
    activeRef.current = field;
    setActive(field);
    const point = ends[field].pin;
    if (point && map.current)
      focusMapPoint(map.current, [point.lng, point.lat], 17);
  }
  function editOnMap(field: EndpointField) {
    activate(field);
    if (window.matchMedia("(max-width: 767px)").matches) setSheetOpen(false);
  }
  function pin(field: EndpointField, point: Data) {
    if (field === "to_address") destinationTouched.current = true;
    if (
      field === "from_address" &&
      (ends[field].pin?.lat !== point.lat || ends[field].pin?.lng !== point.lng)
    )
      setOptions((v) => ({
        ...v,
        service_id: undefined,
        requests: [],
        cod: undefined,
      }));
    // A graph clarification resolves an existing detailed address; retain that
    // address when it is unchanged. A new search result replaces its query text.
    // Both the marker and the suggestion row use this same rule.
    setEnds((e) => {
      const resolvesKnown = e[field].address.trim() === text(known[field]).trim() &&
        asked[field]?.choices?.some((c: Data) => c.id === point.id) &&
        !found[field]?.some(c => c.id === point.id);
      return { ...e, [field]: {
        address: point.id && !resolvesKnown ? point.label : e[field].address || point.label,
        pin: point,
      } };
    });
    if (field === "to_address")
      setUseHouse(
        (current) =>
          Boolean(house) &&
          (Boolean(point.id && point.id === housePoint?.id) ||
            (current && !point.id)),
      );
  }
  function type(field: EndpointField, address: string) {
    if (field === "to_address") destinationTouched.current = true;
    // A new address invalidates the confirmed point; the user confirms again.
    setEnds((e) => ({ ...e, [field]: { address, pin: null } }));
    setDrafts((x) => ({ ...x, [field]: address }));
    setFound((x) => ({ ...x, [field]: [] }));
    setSearched(x => ({ ...x, [field]: false }));
    searchAbort.current?.abort();
    ++searchGeneration.current;
    setSearching(null);
    if (field === "to_address") setUseHouse(false);
    if (field === "from_address")
      setOptions((v) => ({
        ...v,
        service_id: undefined,
        requests: [],
        cod: undefined,
      }));
  }
  const pinRef = useRef(pin);
  pinRef.current = pin;
  const housePointRef = useRef(housePoint);
  housePointRef.current = housePoint;
  useEffect(() => {
    let disposed = false;
    import("maplibre-gl").then(({ Map, NavigationControl, setWorkerUrl }) => {
      if (disposed || !container.current) return;
      setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const first = ends[active].pin || housePointRef.current || candidates(active)[0];
      const center: [number, number] = first
        ? [first.lng, first.lat]
        : DEFAULT_CENTER;
      const city = cityForPoint(center) ?? "hanoi";
      const m = new Map({
        container: container.current,
        style: BASEMAP_STYLE_URL,
        ...scopedMapOptions(container.current, city, {
          center,
          zoom: first ? 15 : 11,
        }),
        attributionControl: { compact: true },
      });
      map.current = m;
      m.on("style.load", () => tuneBasemap(m));
      installMapScope(m, city);
      m.addControl(
        new NavigationControl({ showCompass: false }),
        "bottom-left",
      );
      m.on("load", () => tuneBasemap(m));
      // A tap places the pin for the endpoint being edited (e.g. the exact gate).
      m.on("click", (e) =>
        pinRef.current(activeRef.current, {
          lat: e.lngLat.lat,
          lng: e.lngLat.lng,
          label: "Vị trí bạn chạm trên bản đồ",
        }),
      );
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);
  const pins = Object.entries(ends).filter(([, e]) => e.pin) as [
    EndpointField,
    Endpoint,
  ][];
  useEffect(() => {
    if (
      housePoint &&
      !destinationTouched.current &&
      !ends.from_address.pin &&
      map.current
    )
      focusMapPoint(map.current, [housePoint.lng, housePoint.lat], 15);
  }, [house?.id, house?.lat, house?.lng]);
  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl").then(({ Marker }) => {
      const m = map.current;
      if (cancelled || !m) return;
      markers.current.forEach((x) => x.remove());
      markers.current = [];
      for (const c of shown) {
        const el = document.createElement("button");
        el.className = "mv-candidate" + (c === housePoint ? " home" : "");
        el.title = c.label;
        el.setAttribute("aria-label", "Chọn " + c.label);
        el.onclick = (ev) => {
          ev.stopPropagation();
          pinRef.current(activeRef.current, c);
        };
        markers.current.push(
          new Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(m),
        );
      }
      for (const [field, e] of pins) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "mv-marker mv-" + ENDPOINTS[field].tag.toLowerCase();
        el.setAttribute("aria-label", formatUi("Sửa điểm {0}", [ENDPOINTS[field].tag]));
        el.onclick = (ev) => { ev.stopPropagation(); activate(field); };
        el.append(
          Object.assign(document.createElement("span"), {
            textContent: ENDPOINTS[field].tag,
          }),
        );
        markers.current.push(
          new Marker({ element: el, anchor: "bottom" })
            .setLngLat([e.pin!.lng, e.pin!.lat])
            .addTo(m),
        );
      }
      const focus = shown.length ? shown : pins.map(([, e]) => e.pin!);
      const activePin = ends[active].pin;
      if (
        activePin &&
        cityForPoint([activePin.lng, activePin.lat]) !== mapCity(m)
      )
        focusMapPoint(m, [activePin.lng, activePin.lat], 17);
      if (focus.length && !ends[active].pin) {
        fitMapPoints(
          m,
          focus.map((c) => [c.lng, c.lat]),
          { padding: 90, maxZoom: 16, duration: 500 },
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(shown), JSON.stringify(ends), active]);
  async function search(field: EndpointField, address: string) {
    const query = address.trim();
    if (query.trim().length < 2) return;
    clearTimeout(searchTimer.current);
    searchAbort.current?.abort();
    const abort = new AbortController();
    searchAbort.current = abort;
    const generation = ++searchGeneration.current;
    setSearching(field);
    setError("");
    try {
      const r = await api<Data>(
        "/map/search?text=" + encodeURIComponent(query),
        "GET",
        undefined,
        abort.signal,
      );
      if (abort.signal.aborted || generation !== searchGeneration.current)
        return;
      setSearched(x => ({ ...x, [field]: true }));
      setFound((x) => ({
        ...x,
        [field]: (r.results || [])
          .filter(
            (x: Data) => x.location && x.entity_type !== "administrative_area",
          )
          .map((x: Data) => ({
            id: x.canonical_id || x.name,
            label:
              x.display_name ||
              (x.parent?.name ? `${x.name} (${x.parent.name})` : x.name),
            alias_ids: x.alias_ids || [],
            entity_type: x.entity_type,
            lat: x.location.lat,
            lng: x.location.lng,
          })),
      }));
    } catch (e) {
      if (!abort.signal.aborted && generation === searchGeneration.current)
        setError((e as Error).message);
    } finally {
      if (generation === searchGeneration.current) setSearching(null);
    }
  }
  useEffect(() => {
    const draft = drafts[active];
    if (draft !== undefined && draft.trim().length >= 2 && !ends[active].pin)
      searchTimer.current = setTimeout(() => void search(active, draft), 400);
    return () => {
      clearTimeout(searchTimer.current);
      searchAbort.current?.abort();
      ++searchGeneration.current;
      setSearching(null);
    };
  }, [active, drafts[active], ends[active].pin]);
  const destination =
    useHouse && house
      ? "phòng mình đã chọn"
      : ends.to_address.address.trim() || ends.to_address.pin?.label || "";
  const pickup =
    ends.from_address.address.trim() || ends.from_address.pin?.label || "";
  async function confirm() {
    if (sending || chat.busy) return;
    setError("");
    if (!pickup || !destination) {
      setError("Hãy nhập hoặc chọn trên bản đồ cả điểm lấy và điểm giao.");
      return;
    }
    const scheduleIssue = movingScheduleIssue(date, time);
    if (scheduleIssue) {
      setError(scheduleIssue);
      goToSection("schedule");
      return;
    }
    const invalidOptions = validateMovingForm(options) || optionsIssue;
    if (invalidOptions) {
      setError(invalidOptions);
      return;
    }
    const locations: Data = {};
    for (const field of Object.keys(ENDPOINTS) as EndpointField[]) {
      const resolved =
        field === "to_address"
          ? movingDestinationPoint(ends[field].pin, {
              decided: Boolean(useHouse && house),
              point: housePoint,
              loading: homeLoading,
            })
          : { point: ends[field].pin || undefined, issue: undefined };
      const p = resolved.point;
      if (!p) {
        setError(
          resolved.issue ||
            formatUi(
              "Hãy chọn kết quả tìm kiếm hoặc ghim điểm {0} trên bản đồ trước khi lấy báo giá.",
              [ENDPOINTS[field].tag],
            ),
        );
        setActive(field);
        goToSection("locations");
        return;
      }
      const address =
        field === "to_address" && useHouse && house
          ? house?.address || house?.title
          : ends[field].address.trim() || p.label;
      if (
        typeof address !== "string" ||
        address.trim().length < 3 ||
        address.trim().length > 300
      ) {
        setError(
          `Địa chỉ điểm ${ENDPOINTS[field].tag} cần từ 3 đến 300 ký tự. Hãy nhập hoặc ghim lại địa điểm.`,
        );
        return;
      }
      locations[ENDPOINTS[field].key] = {
        address: address.trim(),
        lat: p.lat,
        lng: p.lng,
        confirmed: true,
      };
    }
    setSending(true);
    try {
      await onConfirm(
        `Báo giá chuyển đồ từ ${pickup} đến ${destination} ngày ${date} lúc ${time}. Chưa đặt đơn.`,
        {
          moving_quote_form: {
            pickup: locations.pickup,
            destination: locations.destination,
            move_date: date,
            move_time: time,
            moving_options: options,
            ...(useHouse && house ? { destination_listing_id: house.id } : {}),
          },
          ...(Object.keys(locations).length
            ? { moving_locations: locations }
            : {}),
          ...(Object.keys(options).length ? { moving_options: options } : {}),
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="map-workspace moving-booking" data-service="relocation">
      <aside
        className={"ws-list " + (sheetOpen ? "open" : "")}
        aria-label={uiText("Thông tin chuyển đồ")}
      >
        <button
          className="ws-sheet-toggle"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(!sheetOpen)}
        >
          {sheetOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}{" "}
          {uiText("Thông tin chuyển đồ")}
        </button>
        <header className="ws-list-head">
          <div>
            <span className="eyebrow">{uiText("CHUYỂN ĐỒ · AHAMOVE")}</span>
            <h2>{uiText("Thông tin chuyển đồ")}</h2>
            <p className="mv-head-caption">
              {uiText("Sắp xếp chuyến chuyển đồ theo cách của bạn")}
            </p>
          </div>
        </header>
        <MovingSteps stage={0} />
        <nav
          className="mv-section-nav"
          aria-label={uiText("Các mục thông tin chuyển đồ")}
        >
          {[
            ["locations", "Địa điểm"],
            ["schedule", "Lịch chuyển"],
            ["cargo", "Hàng hóa"],
            ["vehicle", "Chọn xe"],
            ["delivery", "Giao nhận"],
          ].map(([key, label]) => (
            <button key={key} type="button" onClick={() => goToSection(key)}>
              {uiText(label)}
            </button>
          ))}
        </nav>
        <div className="ws-list-body mv-request" ref={requestBody}>
          <div className="mv-location-sections" data-moving-section="locations">
            {(Object.keys(ENDPOINTS) as EndpointField[]).map((field) => {
              const meta = ENDPOINTS[field],
                e = ends[field],
                home = field === "to_address" && useHouse && house;
              return (
                <section
                  key={field}
                  className={
                    "mv-endpoint " +
                    (active === field ? "active " : "") +
                    (asked[field] ? "asked" : "")
                  }
                  onClick={() => { if (active !== field) activate(field); }}
                  aria-label={uiText(meta.label)}
                >
                  <i className={"mv-dot " + meta.tag.toLowerCase()}>
                    {meta.tag}
                  </i>
                  <span>
                    <button
                      type="button"
                      className="mv-endpoint-heading"
                      onClick={() => activate(field)}
                      aria-pressed={active === field}
                    >
                      {uiText("Chọn điểm ")}
                      {meta.tag} · {uiText(meta.label)}<RequiredMark />
                    </button>
                    {asked[field] && (
                      <small className="mv-asked">{asked[field].text}</small>
                    )}
                    <div className="mv-location-input">
                      <Search size={16} aria-hidden="true" />
                      <input
                        aria-label={uiText(meta.input)}
                        aria-required="true"
                        value={
                          home
                            ? house.address || house.title
                            : e.address || e.pin?.label || ""
                        }
                        onFocus={(ev) => {
                          const value = ev.currentTarget.value;
                          setActive(field);
                          if (!e.pin && !home)
                            setDrafts((x) => ({ ...x, [field]: value }));
                        }}
                        onChange={(ev) => type(field, ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            ev.preventDefault();
                            void search(field, ev.currentTarget.value);
                          }
                        }}
                        placeholder={uiText(
                          `Tìm địa chỉ hoặc chọn điểm ${meta.tag} trên bản đồ`,
                        )}
                        maxLength={300}
                        autoComplete="off"
                      />
                    </div>
                    {field === "to_address" && homeLoading && (
                      <small role="status">
                        {uiText("Đang lấy địa chỉ căn đã chọn…")}
                      </small>
                    )}
                    {field === "to_address" && homeIssue && (
                      <small role="status">{homeIssue}</small>
                    )}
                    {field === "to_address" && house && (
                      <button
                        type="button"
                        className={
                          "mv-selected-home" + (home ? " selected" : "")
                        }
                        aria-label={formatUi("Giao tới phòng đã chọn ({0})", [
                          house.title,
                        ])}
                        aria-pressed={Boolean(home)}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          destinationTouched.current = true;
                          if (!home)
                            setEnds((x) => ({
                              ...x,
                              to_address: { address: "", pin: null },
                            }));
                          setUseHouse(true);
                          setActive("to_address");
                          if (housePoint && map.current)
                            focusMapPoint(
                              map.current,
                              [housePoint.lng, housePoint.lat],
                              16,
                            );
                        }}
                      >
                        <Home size={18} aria-hidden="true" />
                        <span>
                          <small>
                            {uiText("Phòng đã chọn: ")}
                            <b>{house.title}</b>
                          </small>
                          <span>
                            {house.address ||
                              uiText("Địa chỉ đang được cập nhật")}
                          </span>
                          <small>
                            {home
                              ? uiText(
                                  "Đang dùng làm điểm B · Kiểm tra pin trên bản đồ",
                                )
                              : uiText("Dùng căn này làm điểm giao")}
                          </small>
                        </span>
                        {home && <Check size={16} aria-hidden="true" />}
                      </button>
                    )}
                    {searching === field && (
                      <small className="muted" role="status">
                        {uiText("Đang tìm địa điểm…")}
                      </small>
                    )}
                    {active === field && searched[field] && !searching && !e.pin && !(found[field]?.length) && (
                      <small role="status">{uiText("Không tìm thấy địa chỉ này. Thử thêm tên đường, thành phố hoặc ghim trên bản đồ.")}</small>
                    )}
                    {active === field && !e.pin && shown.length > 0 && (
                      <div
                        className="mv-suggestions"
                        role="group"
                        aria-label={
                          uiText("Gợi ý ") + uiText(meta.label).toLowerCase()
                        }
                      >
                        {shown.slice(0, 8).map((c) => (
                          <button
                            key={c.id + c.lat}
                            data-place-id={c.id}
                            type="button"
                            className="place"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              pin(field, c);
                              if (map.current)
                                focusMapPoint(map.current, [c.lng, c.lat], 17);
                            }}
                          >
                            <span>
                              <strong>{c.label}</strong>
                              {c.category && <small>{c.category}</small>}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <small
                      className={e.pin || (home && housePoint) ? "ok" : "muted"}
                    >
                      {e.pin
                        ? formatUi("Đã ghim: {0}", [e.pin.label])
                        : home && housePoint
                          ? uiText(
                              house.location_accuracy === "rooftop"
                                ? "Điểm B là căn đã chốt."
                                : "Điểm B là căn đã chốt. Vị trí tin đăng có thể gần đúng: kiểm tra cổng xe đến, cần thì ghim lại.",
                            )
                          : uiText(
                              "Gõ để tìm địa điểm hoặc chạm bản đồ để ghim.",
                            )}
                    </small>
                    <button type="button" className="text-button"
                      onClick={(ev) => { ev.stopPropagation(); editOnMap(field); }}>
                      {formatUi("Ghim điểm {0} trên bản đồ", [meta.tag])}
                    </button>
                    {e.pin && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          activate(field);
                          if (field === "to_address") {
                            destinationTouched.current = true;
                            setUseHouse(false);
                          }
                          const query = e.address || e.pin?.label || "";
                          setDrafts(x => ({ ...x, [field]: query }));
                          if (field === "from_address")
                            setOptions((x) => ({
                              ...x,
                              service_id: undefined,
                              requests: [],
                              cod: undefined,
                            }));
                          setEnds((x) => ({
                            ...x,
                            [field]: { address: query, pin: null },
                          }));
                        }}
                      >
                        {formatUi("Tìm lại vị trí {0}", [meta.tag])}
                      </button>
                    )}
                  </span>
                </section>
              );
            })}
          </div>
          <div className="form-grid mv-when" data-moving-section="schedule">
            <label>
              <span className="field-label">{uiText("Ngày chuyển")}<RequiredMark /></span>
              <input
                type="date"
                aria-required="true"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              {asked.move_date && (
                <small className="mv-asked">{asked.move_date.text}</small>
              )}
            </label>
            <label>
              <span className="field-label">{uiText("Giờ xe đến")}<RequiredMark /></span>
              <input
                type="time"
                aria-required="true"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
              {asked.move_time && (
                <small className="mv-asked">{asked.move_time.text}</small>
              )}
            </label>
          </div>
          <MovingOptionsForm
            value={options}
            onChange={setOptions}
            pickup={ends.from_address.pin}
            onValidationChange={setOptionsIssue}
            onRequestPickup={() => {
              goToSection("locations");
              requestBody.current
                ?.querySelector<HTMLInputElement>(".mv-location-input input")
                ?.focus({ preventScroll: true });
            }}
          />
        </div>
        <div className="mv-confirm">
          {error && (
            <p className="notice error" role="alert">
              {uiText(error)}
            </p>
          )}
          <button
            className="primary ws-select"
            disabled={sending || chat.busy}
            data-tour="moving-quote"
            onClick={() => void confirm()}
          >
            {sending ? uiText("Đang gửi…") : uiText("Xác nhận và lấy báo giá")}
          </button>
          <small className="muted">
            {uiText(
              "Báo giá AhaMove. Thanh toán trong app sau khi chọn gói; chưa tạo đơn.",
            )}
          </small>
        </div>
      </aside>
      <section className="ws-map" aria-label={uiText("Bản đồ chuyển đồ")}>
        <div className="ws-top">
          <div className="ws-filterbar">
            <span className="ws-filter-label">
              <Route size={15} />
              {uiText(" Đang ghim: ")}
              {uiText(ENDPOINTS[active].label)}
            </span>
            <span className="ws-spacer" />
            <button className="ws-pill-button" onClick={onExit}>
              <MessageCircle size={15} />
              {uiText(" Về hội thoại")}
            </button>
          </div>
        </div>
        <div ref={container} className="ws-canvas" />
        <WorkspaceChat
          {...chat}
          questions={[]}
          text={
            chat.fromResult
              ? chat.text
              : uiText(
                  "Điền thông tin chuyến chuyển đồ hoặc nhắn cho ReloHome, rồi bấm “Xác nhận và lấy báo giá”.",
                )
          }
          placeholder={uiText("Hoặc nhắn yêu cầu chuyển đồ…")}
          onSendText={chat.onSend}
        />
      </section>
    </div>
  );
}
