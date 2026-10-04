import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LibreMap } from "maplibre-gl";
import {
  ArrowRight,
  Check,
  Clock,
  MessageCircle,
  Plane,
  Route,
  Truck,
  X,
} from "lucide-react";
import { api, dateTime, money } from "../api";
import type { Data } from "../types";
import { BASEMAP_STYLE_URL, MAP_THEME, tuneBasemap } from "../mapStyle";
import { WorkspaceChat, type ChatDockProps } from "./WorkspaceChat";

// Selecting an option is the same structured action as in the chat cards; the parent returns to
// the conversation afterwards so the user can continue with other services.
interface WorkspaceProps {
  data: Data;
  selectedId?: string;
  chat: ChatDockProps;
  onSelect: (id: string) => Promise<void>;
  onExit: () => void;
}

const expired = (value?: string) =>
  !value ||
  !Number.isFinite(Date.parse(value)) ||
  Date.parse(value) <= Date.now();
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
  data,
  selectedId,
  chat,
  onSelect,
  onExit,
}: WorkspaceProps) {
  const [sort, setSort] = useState("price"),
    [carrier, setCarrier] = useState(""),
    [detail, setDetail] = useState<Data | null>(null);
  const { selecting, select } = useSelect(onSelect);
  const offers: Data[] = data.offers || [];
  const carriers = [...new Set(offers.map((o) => o.carrier).filter(Boolean))];
  const shown = useMemo(
    () =>
      offers
        .filter((o) => !carrier || o.carrier === carrier)
        .sort((a, b) => FLIGHT_SORTS[sort].key(a) - FLIGHT_SORTS[sort].key(b)),
    [offers, sort, carrier],
  );
  async function open(o: Data) {
    setDetail({ ...o, loading: true });
    try {
      setDetail({
        ...o,
        ...(await api<Data>("/flight/" + encodeURIComponent(o.id))),
      });
    } catch (e) {
      setDetail({ ...o, error: (e as Error).message });
    }
  }
  return (
    <div className="svc-workspace">
      <section className="svc-main" aria-label="Chuyến bay">
        <header className="svc-head">
          <span className="service-icon blue">
            <Plane size={20} />
          </span>
          <div>
            <span className="eyebrow">CHUYẾN BAY</span>
            <h2>
              {data.origin || "Nơi đi"} <ArrowRight size={18} />{" "}
              {data.destination || "Nơi đến"}
            </h2>
            <p className="muted small">
              {offers.length} chuyến · giá tại thời điểm tra cứu · chưa đặt vé
            </p>
          </div>
          <button className="ws-pill-button" onClick={onExit}>
            <MessageCircle size={15} /> Về hội thoại
          </button>
        </header>
        <div className="svc-toolbar">
          <select
            aria-label="Sắp xếp chuyến bay"
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
            Tất cả hãng
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
          {shown.map((o) => {
            const duration = minutes(o.depart_at, o.arrive_at);
            const late = expired(o.expires_at);
            return (
              <article
                key={o.id}
                className={"svc-card " + (selectedId === o.id ? "chosen" : "")}
              >
                <div className="svc-card-main" onClick={() => void open(o)}>
                  <strong className="svc-carrier">{o.carrier}</strong>
                  <div className="svc-timeline">
                    <span>
                      <strong>{hm(o.depart_at)}</strong>
                      <small>{data.origin}</small>
                    </span>
                    <span className="svc-line">
                      <small>
                        {duration != null
                          ? `${Math.floor(duration / 60)}g ${duration % 60}p`
                          : ""}
                      </small>
                      <i />
                      <small>
                        {o.stops === 0
                          ? "Bay thẳng"
                          : o.stops != null
                            ? `${o.stops} điểm dừng`
                            : "Chưa rõ"}
                      </small>
                    </span>
                    <span>
                      <strong>{hm(o.arrive_at)}</strong>
                      <small>{data.destination}</small>
                    </span>
                  </div>
                  <small className="muted">{localDateTime(o.depart_at)}</small>
                </div>
                <div className="svc-card-end">
                  <strong className="price">{money(o.fare_vnd)}</strong>
                  <small className="muted">Tổng giá theo kết quả</small>
                  <button
                    className="primary"
                    disabled={
                      chat.busy ||
                      selecting !== null ||
                      selectedId === o.id ||
                      late ||
                      o.fare_vnd == null
                    }
                    title={late ? "Giá đã hết hạn, hãy tìm lại" : undefined}
                    onClick={() => void select(o.id)}
                  >
                    {selectedId === o.id ? (
                      <>
                        <Check size={14} /> Đã chọn
                      </>
                    ) : selecting === o.id ? (
                      "Đang chọn…"
                    ) : (
                      "Chọn chuyến này"
                    )}
                  </button>
                  <button className="text-button" onClick={() => void open(o)}>
                    Xem hành trình
                  </button>
                </div>
              </article>
            );
          })}
          {!shown.length && <p className="notice">Chưa có chuyến phù hợp.</p>}
        </div>
        <WorkspaceChat
          {...chat}
          text={
            chat.fromResult
              ? `Có ${offers.length} chuyến ${data.origin || ""} → ${data.destination || ""}. Chọn một chuyến trong danh sách; giá theo thời điểm tra cứu, chưa đặt vé.`
              : chat.text
          }
          placeholder="Hỏi SIU: đổi ngày bay, thêm hành khách…"
          onSendText={chat.onSend}
        />
      </section>
      {detail && (
        <aside
          className="ws-detail svc-detail"
          aria-label="Chi tiết hành trình"
        >
          <button
            className="icon-button ws-detail-close"
            aria-label="Đóng chi tiết"
            onClick={() => setDetail(null)}
          >
            <X size={18} />
          </button>
          <div className="ws-detail-body">
            <h3>{detail.carrier}</h3>
            <strong className="price">
              {money(detail.fare_vnd ?? detail.total_price)}
            </strong>
            {detail.loading && <p className="muted">Đang tải hành trình…</p>}
            {detail.error && <p className="notice error">{detail.error}</p>}
            {(detail.segments || []).map((s: Data, i: number) => (
              <div className="svc-segment" key={i}>
                <strong>
                  {s.departure_airport || s.from} <ArrowRight size={13} />{" "}
                  {s.arrival_airport || s.to}
                </strong>
                <small>
                  {localDateTime(s.departure_time)} →{" "}
                  {localDateTime(s.arrival_time)} ·{" "}
                  {s.airline_name || s.airline_code} {s.flight_number || ""}
                </small>
              </div>
            ))}
            <p className="muted small">
              Giá hết hạn: {dateTime(detail.expires_at)}. Điều kiện hành lý/đổi
              vé chưa được nhà cung cấp xác nhận.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}

export function MovingWorkspace({
  data,
  selectedId,
  chat,
  onSelect,
  onExit,
}: WorkspaceProps) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { selecting, select } = useSelect(onSelect);
  const quotes: Data[] = data.quotes || [];
  const route = data.route || {};
  const late = expired(data.expires_at);
  useEffect(() => {
    let disposed = false;
    import("maplibre-gl").then(
      ({ Map, Marker, NavigationControl, setWorkerUrl }) => {
        if (disposed || !container.current) return;
        setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        const points = [route.pickup, route.destination].filter(
          (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng),
        );
        const m = new Map({
          container: container.current,
          style: BASEMAP_STYLE_URL,
          center: points[0]
            ? [points[0].lng, points[0].lat]
            : [106.7009, 10.7769],
          zoom: 13,
          attributionControl: { compact: true },
        });
        map.current = m;
        m.addControl(
          new NavigationControl({ showCompass: false }),
          "bottom-left",
        );
        m.on("load", () => {
          if (disposed) return;
          tuneBasemap(m);
          m.addSource("mv-line", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: points.map((p) => [p.lng, p.lat]),
              },
            },
          });
          m.addLayer({
            id: "mv-line",
            type: "line",
            source: "mv-line",
            paint: {
              "line-color": MAP_THEME.route,
              "line-width": 4,
              "line-dasharray": [2, 1.5],
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
            m.fitBounds(
              [
                [
                  Math.min(points[0].lng, points[1].lng),
                  Math.min(points[0].lat, points[1].lat),
                ],
                [
                  Math.max(points[0].lng, points[1].lng),
                  Math.max(points[0].lat, points[1].lat),
                ],
              ],
              { padding: 80, duration: 0 },
            );
        });
      },
    );
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, [data.quote_id]);
  return (
    <div className="map-workspace">
      <aside className="ws-list" aria-label="Phương án chuyển đồ">
        <header className="ws-list-head">
          <div>
            <span className="eyebrow">CHUYỂN ĐỒ · AHAMOVE</span>
            <h2>{quotes.length} phương án</h2>
          </div>
        </header>
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
            <Clock size={12} /> Báo giá hết hạn {dateTime(data.expires_at)} ·
            trả tiền mặt cho tài xế
          </small>
        </div>
        <div className="ws-list-body">
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
                      ? ` · ~${Math.round(q.duration_seconds / 60)} phút`
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
                    chat.busy ||
                    selecting !== null ||
                    selectedId === q.id ||
                    late ||
                    q.price_vnd == null
                  }
                  title={
                    late ? "Báo giá đã hết hạn, hãy báo giá lại" : undefined
                  }
                  onClick={() => void select(q.id)}
                >
                  {selectedId === q.id
                    ? "Đã chọn"
                    : selecting === q.id
                      ? "Đang chọn…"
                      : "Chọn phương án"}
                </button>
                <button
                  className="text-button"
                  onClick={() => setOpen(open === q.id ? null : q.id)}
                >
                  {open === q.id ? "Ẩn chi phí" : "Xem chi phí"}
                </button>
              </div>
            </article>
          ))}
          {late && (
            <p className="notice amber">
              Báo giá đã hết hạn. Nhắn "báo giá lại" để lấy giá mới.
            </p>
          )}
          {(data.warnings || []).map((w: any, i: number) => (
            <p className="notice amber" key={i}>
              {typeof w === "string" ? w : w.message || w.code}
            </p>
          ))}
        </div>
        <p className="ws-list-foot muted small">
          Giá do AhaMove trả tại thời điểm báo giá; chưa đặt xe.
        </p>
      </aside>
      <section className="ws-map" aria-label="Bản đồ chuyển đồ">
        <div className="ws-filterbar">
          <span className="ws-filter-label">
            <Route size={15} /> Tuyến A → B (đường thẳng minh hoạ, không phải lộ
            trình tài xế)
          </span>
          <span className="ws-spacer" />
          <button className="ws-pill-button" onClick={onExit}>
            <MessageCircle size={15} /> Về hội thoại
          </button>
        </div>
        <div ref={container} className="ws-canvas" />
        <WorkspaceChat
          {...chat}
          text={
            chat.fromResult
              ? `${quotes.length} phương án chuyển đồ từ điểm A tới điểm B. Chọn một phương án; báo giá hết hạn lúc ${dateTime(data.expires_at)}.`
              : chat.text
          }
          placeholder="Hỏi SIU: đổi giờ lấy hàng, đổi điểm giao…"
          onSendText={chat.onSend}
        />
      </section>
    </div>
  );
}

function FeeBreakdown({ fee }: { fee?: Data }) {
  if (!fee)
    return <p className="muted small">Nhà cung cấp chưa trả chi tiết phí.</p>;
  const rows = Object.entries(fee).filter(([, v]) => typeof v === "number");
  return (
    <dl className="mv-fee">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k.replaceAll("_", " ")}</dt>
          <dd>
            {k.includes("price") || k.includes("fee") || k.includes("amount")
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
  chat,
  onConfirm,
  onExit,
}: {
  questions: Data[];
  known: Data;
  house?: Data;
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
  const text = (v: unknown) =>
    typeof v === "string" && v !== SELECTED ? v : "";
  const [ends, setEnds] = useState<Record<EndpointField, Endpoint>>({
    from_address: { address: text(known.from_address), pin: null },
    to_address: { address: text(known.to_address), pin: null },
  });
  const [useHouse, setUseHouse] = useState(
    Boolean(house) && !text(known.to_address),
  );
  const [date, setDate] = useState(text(known.move_date)),
    [time, setTime] = useState(text(known.move_time));
  const [active, setActive] = useState<EndpointField>(
    asked.to_address && !asked.from_address ? "to_address" : "from_address",
  );
  const [found, setFound] = useState<Record<string, Data[]>>({}),
    [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null),
    markers = useRef<any[]>([]),
    activeRef = useRef(active);
  activeRef.current = active;
  const candidates = (field: EndpointField): Data[] =>
    [
      ...(field === "to_address" && housePoint ? [housePoint] : []),
      ...(asked[field]?.choices || []),
      ...(found[field] || []),
    ].filter(
      (c) =>
        Number.isFinite(c.lat) &&
        Number.isFinite(c.lng) &&
        c.entity_type !== "area",
    );
  const shown = candidates(active);
  function pin(field: EndpointField, point: Data) {
    setEnds((e) => ({ ...e, [field]: { ...e[field], pin: point } }));
    if (field === "to_address")
      setUseHouse(point.id === housePoint?.id || (useHouse && !point.id));
  }
  function type(field: EndpointField, address: string) {
    // A new address invalidates the confirmed point; the user confirms again.
    setEnds((e) => ({ ...e, [field]: { address, pin: null } }));
    if (field === "to_address") setUseHouse(false);
  }
  useEffect(() => {
    let disposed = false;
    import("maplibre-gl").then(({ Map, NavigationControl, setWorkerUrl }) => {
      if (disposed || !container.current) return;
      setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const first = housePoint || candidates(active)[0];
      const m = new Map({
        container: container.current,
        style: BASEMAP_STYLE_URL,
        center: first ? [first.lng, first.lat] : DEFAULT_CENTER,
        zoom: first ? 15 : 11,
        attributionControl: { compact: true },
      });
      map.current = m;
      m.addControl(
        new NavigationControl({ showCompass: false }),
        "bottom-left",
      );
      m.on("load", () => tuneBasemap(m));
      // A tap places the pin for the endpoint being edited (e.g. the exact gate).
      m.on("click", (e) =>
        pin(activeRef.current, {
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
          pin(activeRef.current, c);
        };
        markers.current.push(
          new Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(m),
        );
      }
      for (const [field, e] of pins) {
        const el = document.createElement("div");
        el.className = "mv-marker mv-" + ENDPOINTS[field].tag.toLowerCase();
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
      const focus = [...shown, ...pins.map(([, e]) => e.pin!)];
      if (focus.length && !ends[active].pin) {
        const lats = focus.map((c) => c.lat),
          lngs = focus.map((c) => c.lng);
        m.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 90, maxZoom: 16, duration: 500 },
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(shown), JSON.stringify(ends), active]);
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError("");
    try {
      const r = await api<Data>(
        "/map/search?text=" + encodeURIComponent(query),
      );
      setFound((x) => ({
        ...x,
        [active]: (r.results || [])
          .filter(
            (x: Data) => x.location && x.entity_type !== "administrative_area",
          )
          .map((x: Data) => ({
            id: x.canonical_id || x.name,
            label: x.parent?.name ? `${x.name} (${x.parent.name})` : x.name,
            entity_type: x.entity_type,
            lat: x.location.lat,
            lng: x.location.lng,
          })),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }
  const destination = useHouse
    ? "phòng mình đã chọn"
    : ends.to_address.address.trim() || ends.to_address.pin?.label || "";
  const pickup =
    ends.from_address.address.trim() || ends.from_address.pin?.label || "";
  async function confirm() {
    setError("");
    if (!pickup || !destination) {
      setError("Hãy nhập hoặc chọn trên bản đồ cả điểm lấy và điểm giao.");
      return;
    }
    if (!date || !time) {
      setError("Hãy chọn ngày chuyển và giờ xe đến.");
      return;
    }
    if (new Date(date + "T" + time) <= new Date()) {
      setError("Hãy chọn thời gian chuyển đồ trong tương lai.");
      return;
    }
    const locations: Data = {};
    for (const field of Object.keys(ENDPOINTS) as EndpointField[]) {
      const p = ends[field].pin;
      if (!p) continue;
      const address =
        field === "to_address" && useHouse
          ? house?.address || house?.title
          : ends[field].address.trim() || p.label;
      locations[ENDPOINTS[field].key] = {
        address,
        lat: p.lat,
        lng: p.lng,
        confirmed: true,
      };
    }
    setSending(true);
    try {
      await onConfirm(
        `Báo giá chuyển đồ từ ${pickup} đến ${destination} ngày ${date} lúc ${time}. Chưa đặt đơn.`,
        Object.keys(locations).length ? { moving_locations: locations } : {},
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="map-workspace">
      <aside className="ws-list" aria-label="Thông tin chuyển đồ">
        <header className="ws-list-head">
          <div>
            <span className="eyebrow">CHUYỂN ĐỒ · AHAMOVE</span>
            <h2>Thông tin chuyển đồ</h2>
          </div>
        </header>
        <div className="ws-list-body mv-request">
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
                onClick={() => setActive(field)}
              >
                <i className={"mv-dot " + meta.tag.toLowerCase()}>{meta.tag}</i>
                <span>
                  <strong>{meta.label}</strong>
                  {asked[field] && (
                    <small className="mv-asked">{asked[field].text}</small>
                  )}
                  {home ? (
                    <>
                      <small>
                        Phòng đã chọn: <b>{house.title}</b>
                      </small>
                      {house.address && <small>{house.address}</small>}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => type("to_address", "")}
                      >
                        Giao tới địa chỉ khác
                      </button>
                    </>
                  ) : (
                    <>
                      <input
                        aria-label={meta.input}
                        value={e.address}
                        onFocus={() => setActive(field)}
                        onChange={(ev) => type(field, ev.target.value)}
                        placeholder="Số nhà, đường, phường/quận, thành phố"
                        maxLength={300}
                      />
                      {field === "to_address" && house && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setEnds((x) => ({
                              ...x,
                              to_address: { address: "", pin: null },
                            }));
                            setUseHouse(true);
                          }}
                        >
                          Giao tới phòng đã chọn ({house.title})
                        </button>
                      )}
                    </>
                  )}
                  <small className={e.pin ? "ok" : "muted"}>
                    {e.pin
                      ? `Đã ghim: ${e.pin.label}`
                      : "Chưa ghim trên bản đồ. SIU sẽ tìm theo địa chỉ."}
                  </small>
                  {e.pin && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setEnds((x) => ({
                          ...x,
                          [field]: { ...x[field], pin: null },
                        }));
                      }}
                    >
                      Bỏ ghim
                    </button>
                  )}
                </span>
              </section>
            );
          })}
          <div className="form-grid mv-when">
            <label>
              Ngày chuyển
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              {asked.move_date && (
                <small className="mv-asked">{asked.move_date.text}</small>
              )}
            </label>
            <label>
              Giờ xe đến
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
              {asked.move_time && (
                <small className="mv-asked">{asked.move_time.text}</small>
              )}
            </label>
          </div>
          <form className="search-row" onSubmit={search}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Tìm ${ENDPOINTS[active].label.toLowerCase()}: tòa nhà, ngõ, địa danh…`}
              aria-label="Tìm địa điểm"
            />
            <button className="secondary" disabled={searching}>
              Tìm
            </button>
          </form>
          {shown.map((c) => (
            <button
              key={c.id + c.lat}
              className={
                "place " + (ends[active].pin?.id === c.id ? "active" : "")
              }
              onClick={() => {
                pin(active, c);
                map.current?.easeTo({ center: [c.lng, c.lat], zoom: 17 });
              }}
            >
              <span>
                <strong>{c.label}</strong>
                {c.category && <small>{c.category}</small>}
              </span>
            </button>
          ))}
          {!shown.length && (
            <p className="muted small">
              Ghim là tùy chọn: tìm địa điểm hoặc chạm vào bản đồ để chỉ đúng
              cổng xe đến cho {ENDPOINTS[active].label.toLowerCase()}.
            </p>
          )}
        </div>
        <div className="mv-confirm">
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary ws-select"
            disabled={sending || chat.busy}
            onClick={() => void confirm()}
          >
            {sending ? "Đang gửi…" : "Xác nhận và lấy báo giá"}
          </button>
          <small className="muted">
            Báo giá AhaMove, trả tiền mặt. Chưa đặt đơn cho tới khi bạn đồng ý.
          </small>
        </div>
      </aside>
      <section className="ws-map" aria-label="Bản đồ chuyển đồ">
        <div className="ws-top">
          <div className="ws-filterbar">
            <span className="ws-filter-label">
              <Route size={15} /> Đang ghim: {ENDPOINTS[active].label}
            </span>
            <span className="ws-spacer" />
            <button className="ws-pill-button" onClick={onExit}>
              <MessageCircle size={15} /> Về hội thoại
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
              : "Điền thông tin bên trái hoặc nhắn cho SIU, rồi bấm “Xác nhận và lấy báo giá”."
          }
          placeholder="Hoặc nhắn yêu cầu chuyển đồ…"
          onSendText={chat.onSend}
        />
      </section>
    </div>
  );
}
