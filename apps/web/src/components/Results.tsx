import { t as uiText } from "../uiPreferences";
import { useEffect, useRef, useState } from "react";
import {
  Plane,
  Truck,
  House as HouseIcon,
  MapPin,
  ArrowRight,
  ArrowUpRight,
  Check,
  GitCompareArrows,
  CreditCard,
  Clock,
  ExternalLink,
  Route,
  SlidersHorizontal,
} from "lucide-react";
import { api, dateTime, money, safeUrl, housePrice } from "../api";
import type { Component, Data, House, Payload } from "../types";
import { HousingCard, Comparison } from "./Housing";
import { MapPanel } from "./MapPanel";
import { Dialog } from "./Dialog";
import { priceExpired, usePriceExpiry } from "../priceExpiry";
import { MAX_COMPARISON_HOMES } from "../housingInteraction";
import { RoommateResult } from "../roommate/RoommateResult";

export interface ResultProps {
  payload: Payload;
  selected: Data;
  saved: Set<string>;
  busy: boolean;
  onOpen: (h: House, c: Component, version: number) => void;
  onSave: (h: House) => void;
  onAction: (
    c: Component,
    version: number,
    kind: string,
    id?: string,
  ) => Promise<void>;
  onPrompt: (text: string) => void;
  onFilter: () => void;
  writes: boolean;
}
export function Results(props: ResultProps) {
  const components = props.payload.ui?.components || [];
  return (
    <>
      {components.map((c) =>
        c.type === "roommate" ? (
          <RoommateResult key={c.id} data={c.data || {}} />
        ) : (
          <Result key={c.id} c={c} {...props} />
        ),
      )}
    </>
  );
}
function Result({ c, ...p }: ResultProps & { c: Component }) {
  const [compare, setCompare] = useState<string[]>([]),
    [comparing, setComparing] = useState(false),
    [mobileTab, setMobileTab] = useState("list"),
    [detail, setDetail] = useState<Data | null>(null),
    [error, setError] = useState("");
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
  const data = c.data || {},
    version = p.payload.ui?.plan_version || 0;
  usePriceExpiry(
    c.type === "flight"
      ? [
          ...(data.offers || []).map((o: Data) => o.expires_at),
          detail?.expires_at,
        ]
      : c.type === "relocation"
        ? [data.expires_at]
        : [],
  );
  const icons: Data = {
    property: HouseIcon,
    flight: Plane,
    relocation: Truck,
    map: MapPin,
    payment: CreditCard,
  };
  const Icon = icons[c.type] || MapPin;
  const title: Data = {
    property: "Một nơi để gọi là nhà",
    flight: "Chuyến bay cho hành trình của bạn",
    relocation: "Phương án chuyển đồ",
    map: "Khám phá quanh bạn",
    payment: "Trạng thái thanh toán",
  };
  const select = (id: string) =>
    p.onAction(c, version, "select", id).catch((e) => setError(e.message));
  const selected = p.selected["selected:" + c.type]?.value;
  const points: Data[] = Object.values(data.nearby || {}).flat() as Data[];
  async function flightDetail(offer: Data) {
    const request = ++detailRequest.current;
    setDetail({ ...offer, loading: true });
    try {
      const detail = await api<Data>("/flight/" + encodeURIComponent(offer.id));
      if (request === detailRequest.current) setDetail({ ...offer, ...detail });
    } catch (e) {
      if (request === detailRequest.current)
        setDetail({ ...offer, error: (e as Error).message });
    }
  }
  return (
    <section className={"result-group " + c.type} data-service={c.type}>
      <div className="section-heading">
        <span
          className={
            "service-icon " +
            (c.type === "relocation"
              ? "peach"
              : c.type === "property"
                ? "mint"
                : "blue")
          }
        >
          <Icon size={21} />
        </span>
        <div>
          <h3>{title[c.type] || uiText("Kết quả dịch vụ")}</h3>
          <p>
            {c.source_kind === "sandbox" ? uiText("Môi trường sandbox · ") : ""}
            {c.source || uiText("Theo nguồn dịch vụ")}
            {c.fetched_at ? " · " + dateTime(c.fetched_at) : ""}
          </p>
        </div>
        {c.type === "property" && (
          <button
            className="icon-button"
            aria-label={uiText("Sửa tiêu chí tìm nhà")}
            onClick={p.onFilter}
          >
            <SlidersHorizontal size={18} />
          </button>
        )}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {uiText(error)}
        </p>
      )}
      {c.type === "property" && (
        <>
          <div className="filter-row">
            <span className="tag">
              {data.area_name || uiText("Kết quả tìm nhà")}
            </span>
            {data.search_request?.district && (
              <span className="tag">{data.search_request.district}</span>
            )}
            {data.search_request?.max_price && (
              <span className="tag">
                {uiText("Đến ")}
                {housePrice({ price: data.search_request.max_price })}
              </span>
            )}
            <span className="result-count">
              {uiText("Đang hiển thị ")}
              {(data.candidates || []).length}
              {uiText(" căn")}
            </span>
          </div>
          {data.candidates?.length ? (
            <>
              <div className="segmented mobile-only">
                <button
                  className={mobileTab === "list" ? "active" : ""}
                  onClick={() => setMobileTab("list")}
                >
                  {uiText("Danh sách")}
                </button>
                <button
                  className={mobileTab === "map" ? "active" : ""}
                  onClick={() => setMobileTab("map")}
                >
                  {uiText("Bản đồ")}
                </button>
              </div>
              <div className={"housing-layout tab-" + mobileTab}>
                <div className="housing-list">
                  {data.candidates.map((h: House) => (
                    <HousingCard
                      key={h.id}
                      house={h}
                      selected={selected === h.id}
                      saved={p.saved.has(h.id)}
                      compare={compare.includes(h.id)}
                      onSave={() => p.onSave(h)}
                      onOpen={() => p.onOpen(h, c, version)}
                      onCompare={() =>
                        setCompare((old) =>
                          old.includes(h.id)
                            ? old.filter((x) => x !== h.id)
                            : old.length < MAX_COMPARISON_HOMES
                              ? [...old, h.id]
                              : old,
                        )
                      }
                    />
                  ))}
                </div>
                <div className="housing-map">
                  <MapPanel
                    houses={data.candidates}
                    selected={selected}
                    onSelect={(h) => p.onOpen(h, c, version)}
                    filter={data.search_request}
                  />
                </div>
              </div>
              <div className="result-footer">
                {data.has_more && data.next_cursor && (
                  <button
                    className="text-button"
                    disabled={p.busy}
                    onClick={() =>
                      p
                        .onAction(c, version, "more")
                        .catch((e) => setError(e.message))
                    }
                  >
                    {uiText("Xem thêm kết quả ")}
                    <ArrowRight size={16} />
                  </button>
                )}
                {compare.length >= 2 && (
                  <button
                    className="secondary"
                    onClick={() => setComparing(true)}
                  >
                    <GitCompareArrows size={16} />
                    {uiText("So sánh ")}
                    {compare.length}
                    {uiText(" căn")}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="empty-inline">
              <HouseIcon size={30} />
              <h4>{uiText("Chưa tìm thấy căn phù hợp")}</h4>
              <p>
                {uiText("Thử thay đổi ngân sách hoặc khu vực bạn quan tâm.")}
              </p>
              <button className="secondary" onClick={p.onFilter}>
                {uiText("Sửa tiêu chí")}
              </button>
            </div>
          )}
          {comparing && (
            <Comparison
              houses={data.candidates.filter((h: House) =>
                compare.includes(h.id),
              )}
              onClose={() => setComparing(false)}
              onOpen={(h) => {
                setComparing(false);
                p.onOpen(h, c, version);
              }}
            />
          )}
        </>
      )}
      {c.type === "flight" && (
        <>
          <div className="filter-row">
            <span className="tag">
              {data.origin} <ArrowRight size={13} /> {data.destination}
            </span>
            <span className="muted small">
              {uiText("Giá tại thời điểm tra cứu · chưa đặt vé")}
            </span>
          </div>
          <div className="offer-list">
            {(data.offers || []).map((o: Data) => (
              <article className="flight-card" key={o.id}>
                <div className="airline-icon">
                  <Plane size={22} />
                </div>
                <div className="flight-body">
                  <strong>{o.carrier}</strong>
                  <div className="flight-time">
                    <span>{dateTime(o.depart_at)}</span>
                    <span className="flight-line">
                      <Plane size={13} />
                    </span>
                    <span>{dateTime(o.arrive_at)}</span>
                  </div>
                  <small>
                    {o.stops === 0
                      ? uiText("Bay thẳng")
                      : o.stops != null
                        ? o.stops + uiText(" điểm dừng")
                        : uiText("Chưa rõ điểm dừng")}
                  </small>
                </div>
                <div className="offer-end">
                  <strong className="price">
                    {o.kind === "round_trip_outbound" ? uiText("từ ") : ""}
                    {money(o.fare_vnd)}
                  </strong>
                  <small>
                    {o.kind === "round_trip_outbound"
                      ? uiText("Khứ hồi rẻ nhất có chuyến đi này")
                      : uiText("Tổng giá theo kết quả")}
                  </small>
                  <button className="secondary" onClick={() => flightDetail(o)}>
                    {uiText("Xem hành trình ")}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!data.offers?.length && (
            <p className="notice">
              {uiText("Chưa có chuyến phù hợp với yêu cầu này.")}
            </p>
          )}
        </>
      )}
      {c.type === "relocation" && (
        <>
          {(data.cities || []).map((city: Data) => (
            <button
              className="suggestion"
              key={city.city_id}
              onClick={() =>
                p.onPrompt(
                  `Xem dịch vụ chuyển đồ tại ${city.local_name || city.city_name} (mã khu vực ${city.city_id})`,
                )
              }
            >
              {city.local_name || city.city_name || city.city_id}
            </button>
          ))}
          {data.from_address && (
            <div className="move-route">
              <div>
                <i className="route-dot" />
                <span>{data.from_address}</span>
              </div>
              <div>
                <MapPin size={15} />
                <span>{data.to_address}</span>
              </div>
            </div>
          )}
          {(data.quotes || []).map((q: Data) => (
            <article className="moving-card" key={q.id}>
              <span className="service-icon peach">
                <Truck size={23} />
              </span>
              <div>
                <h4>{q.vehicle || q.service_id}</h4>
                <p>
                  {q.provider || "AhaMove"} · {q.date}
                </p>
                <div className="tags">
                  <span className="tag">{uiText("Tiền mặt")}</span>
                  {q.distance_km != null && (
                    <span className="tag">{q.distance_km} km</span>
                  )}
                  {selected === q.id && (
                    <span className="tag selected-tag">
                      <Check size={12} />
                      {uiText("Đã chọn")}
                    </span>
                  )}
                </div>
                <small>
                  {uiText("Hết hạn: ")}
                  {dateTime(data.expires_at)}
                </small>
              </div>
              <div className="offer-end">
                <strong className="price">{money(q.price_vnd)}</strong>
                <button
                  className="secondary"
                  onClick={() => setDetail({ ...q, kind: "moving" })}
                >
                  {uiText("Xem dịch vụ")}
                </button>
                <button
                  className="text-button"
                  disabled={
                    p.busy ||
                    priceExpired(data.expires_at) ||
                    q.price_vnd == null ||
                    selected === q.id
                  }
                  onClick={() => {
                    if (!priceExpired(data.expires_at)) void select(q.id);
                  }}
                >
                  {priceExpired(data.expires_at)
                    ? uiText("Báo giá hết hạn")
                    : uiText("Chọn báo giá")}{" "}
                  <ArrowRight size={14} />
                </button>
              </div>
            </article>
          ))}
          {data.quotes?.length > 0 && (
            <p className="notice">
              {p.writes
                ? uiText(
                    "Sau khi chọn, nhắn yêu cầu đặt để xem và phê duyệt phương án.",
                  )
                : uiText(
                    "Hiện chưa thể đặt đơn trên hệ thống. Bạn vẫn có thể xem báo giá.",
                  )}
            </p>
          )}
          {data.order && <Order order={data.order} onPrompt={p.onPrompt} />}{" "}
          {(data.orders || []).map((order: Data) => (
            <Order key={order.order_id} order={order} onPrompt={p.onPrompt} />
          ))}
          {(data.warnings || []).map((w: any, i: number) => (
            <p className="notice amber" key={i}>
              {warningText(w)}
            </p>
          ))}
          {(data.services || []).map((s: Data) => (
            <div className="service-row" key={s.service_id}>
              <Truck size={18} />
              <div>
                <strong>{s.service_name || s.name}</strong>
                <p>{s.description || uiText("Chưa có mô tả bổ sung.")}</p>
                <button
                  className="text-button"
                  onClick={() =>
                    p.onPrompt(
                      `Xem giới hạn và yêu cầu bổ sung của dịch vụ chuyển đồ ${s.service_id}`,
                    )
                  }
                >
                  {uiText("Xem thông tin dịch vụ")}
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      {c.type === "map" && (
        <>
          {data.routing?.route && (
            <div className="route-summary">
              <Route size={22} />
              <div>
                <strong>
                  {(data.routing.route.distance_meters / 1000).toFixed(2)} km{" "}
                  <span>·</span>{" "}
                  {Math.round(data.routing.route.duration_seconds / 60)}
                  {uiText(" phút")}
                </strong>
                <p>
                  {{ walking: "Đi bộ", motorcycle: "Xe máy", driving: "Ô tô" }[
                    data.routing.profile as string
                  ] || data.routing.profile}{" "}
                  {uiText("· Ước tính, chưa tính giao thông trực tiếp")}
                </p>
              </div>
            </div>
          )}
          <MapPanel
            points={[
              ...points,
              ...Object.entries(data.origins || {}).map(([id, location]) => ({
                id,
                location,
              })),
              ...[data.routing?.origin, data.routing?.destination].filter(
                Boolean,
              ),
            ]}
            routing={data.routing}
          />
          {points.length > 0 && (
            <>
              <p className="muted small">
                {uiText(
                  "Các địa điểm gần nhất theo nhóm · khoảng cách đường thẳng",
                )}
              </p>
              <div className="poi-list">
                {points.map((poi, i) => (
                  <article key={poi.id || i}>
                    <span className="service-icon mint">
                      <MapPin size={17} />
                    </span>
                    <div>
                      <strong>{poi.name || uiText("Địa điểm")}</strong>
                      <small>
                        {poi.category} ·{" "}
                        {poi.distance_m != null
                          ? Math.round(poi.distance_m) +
                            uiText(" m đường thẳng")
                          : uiText("Chưa rõ khoảng cách")}
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={uiText("Tính đường tới ") + poi.name}
                      onClick={() =>
                        p.onPrompt(
                          "Tính đường đi bộ từ căn nhà đã chọn đến " +
                            poi.name +
                            ".",
                        )
                      }
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
          {!points.length && !data.routing?.route && (
            <p className="notice">
              {uiText("Chưa có địa điểm phù hợp trong kết quả này.")}
            </p>
          )}
          {data.approximate_origins?.length > 0 && (
            <p className="notice amber">
              {uiText(
                "Vị trí nhà gần đúng; khoảng cách tới tiện ích cũng chỉ gần đúng.",
              )}
            </p>
          )}
          {(data.routing?.warnings || []).map((w: any, i: number) => (
            <p className="notice amber" key={i}>
              {warningText(w)}
            </p>
          ))}
        </>
      )}
      {c.type === "payment" && <PaymentStatus payment={data.payment || {}} />}
      {!["property", "flight", "relocation", "map", "payment"].includes(
        c.type,
      ) && (
        <p className="notice">
          {uiText(
            "Kết quả này chưa có giao diện chi tiết. Xem nội dung phản hồi của AI ở trên.",
          )}
        </p>
      )}
      {detail && (
        <Dialog
          title={
            detail.kind === "moving"
              ? uiText("Chi tiết dịch vụ")
              : uiText("Chi tiết hành trình")
          }
          onClose={closeDetail}
        >
          {detail.kind === "moving" ? (
            <>
              <h2>{detail.vehicle || detail.service_id}</h2>
              <p className="price price-large">{money(detail.price_vnd)}</p>
              <p>{uiText("Báo giá AhaMove staging · thanh toán trong app")}</p>
              {detail.fee_breakdown && (
                <FeeBreakdown fee={detail.fee_breakdown} />
              )}
              <dl className="detail-grid">
                <div>
                  <dt>{uiText("Khoảng cách")}</dt>
                  <dd>{detail.distance_km ?? uiText("Chưa có dữ liệu")} km</dd>
                </div>
                <div>
                  <dt>{uiText("Nhân công bốc xếp")}</dt>
                  <dd>{detail.movers ?? uiText("Chưa có dữ liệu")}</dd>
                </div>
              </dl>
              <p className="notice">
                {uiText(
                  "Dịch vụ đóng gói, bốc xếp hoặc tháo lắp chỉ được xác nhận khi nhà cung cấp có thông tin.",
                )}
              </p>
            </>
          ) : (
            <>
              <h2>{detail.carrier}</h2>
              <p className="price price-large">
                {money(detail.total_price ?? detail.fare_vnd)}
              </p>
              {detail.loading && (
                <p role="status">{uiText("Đang tải hành trình…")}</p>
              )}
              {detail.error && <p className="notice amber">{detail.error}</p>}
              {(detail.segments || []).map((s: Data, i: number) => (
                <div className="itinerary-stop" key={i}>
                  <Plane size={19} />
                  <div>
                    <strong>
                      {s.airline_name || s.airline_code} {s.flight_number}
                    </strong>
                    <p>
                      {s.origin || s.departure_airport} →{" "}
                      {s.destination || s.arrival_airport}
                    </p>
                    <small>
                      {dateTime(s.departure_time)} — {dateTime(s.arrival_time)}
                    </small>
                  </div>
                </div>
              ))}
              <p className="notice">
                {uiText(
                  "Chưa có thông tin hành lý và điều kiện đổi/hủy được xác minh. Lựa chọn vào kế hoạch chưa phải đặt vé.",
                )}
              </p>
              <button
                className="primary"
                disabled={
                  p.busy ||
                  detail.loading ||
                  !!detail.error ||
                  selected === detail.id ||
                  priceExpired(detail.expires_at)
                }
                onClick={() => {
                  if (!priceExpired(detail.expires_at)) void select(detail.id);
                }}
              >
                {selected === detail.id
                  ? uiText("Đã chọn vào kế hoạch")
                  : priceExpired(detail.expires_at)
                    ? uiText("Giá đã hết hạn")
                    : uiText("Chọn vào kế hoạch")}
              </button>
            </>
          )}
        </Dialog>
      )}
    </section>
  );
}
export function PaymentStatus({ payment }: { payment: Data }) {
  const states: Data = {
    PENDING: "Chờ thanh toán",
    PAID: "Đã thanh toán",
    FAILED: "Thanh toán thất bại",
    CANCELLED: "Đã hủy",
    EXPIRED: "Đã hết hạn",
    REFUNDED: "Đã hoàn tiền",
  };
  return (
    <div className="payment-status">
      <CreditCard size={28} />
      <div>
        <h4>{states[payment.status] || uiText("Đang xác minh")}</h4>
        <p>
          {money(payment.amount ?? payment.amount_vnd)} ·{" "}
          {payment.provider || "ZaloPay"} sandbox
        </p>
        <small>{payment.payment_id}</small>
      </div>
    </div>
  );
}
export function Order({
  order,
  onPrompt,
}: {
  order: Data;
  onPrompt: (s: string) => void;
}) {
  const url = safeUrl(
    order.shared_link || order.tracking_url || order.tracking_link,
  );
  return (
    <div className="order-card">
      <div className="section-heading">
        <Truck />
        <div>
          <h4>
            {uiText("Đơn chuyển đồ ")}
            {order.order_id}
          </h4>
          <p>{order.status || uiText("Đang xác minh trạng thái")}</p>
        </div>
      </div>
      <strong>{money(order.total_price ?? order.amount_vnd)}</strong>
      <div className="form-actions">
        <button
          className="secondary"
          onClick={() =>
            onPrompt("Kiểm tra trạng thái đơn chuyển đồ " + order.order_id)
          }
        >
          {uiText("Kiểm tra trạng thái")}
        </button>
        {url && (
          <a className="secondary" href={url} target="_blank" rel="noreferrer">
            {uiText("Theo dõi ")}
            <ExternalLink size={14} />
          </a>
        )}
        <button
          className="text-button"
          onClick={() =>
            onPrompt(
              "Tôi muốn cập nhật liên hệ cho đơn chuyển đồ " +
                order.order_id +
                ". Hãy cho tôi xem phương án trước khi thực hiện.",
            )
          }
        >
          {uiText("Yêu cầu sửa liên hệ")}
        </button>
        <button
          className="text-button"
          onClick={() =>
            onPrompt(
              "Tôi muốn hủy đơn chuyển đồ " +
                order.order_id +
                ". Hãy cho tôi xem điều kiện hủy và phương án xác nhận trước.",
            )
          }
        >
          {uiText("Yêu cầu hủy đơn")}
        </button>
      </div>
    </div>
  );
}

function warningText(w: any): string {
  if (typeof w === "string") return w;
  const endpoint = w?.endpoint === "origin" ? "Điểm đi" : "Điểm đến";
  if (w?.code === "APPROXIMATE_LOCATION")
    return (
      endpoint + " có vị trí gần đúng; cần kiểm tra lại trước khi di chuyển."
    );
  if (w?.code === "UNKNOWN_LOCATION_ACCURACY")
    return endpoint + " chưa có độ chính xác được xác minh.";
  return typeof w?.message === "string"
    ? w.message
    : "Nhà cung cấp có lưu ý cho kết quả này; cần kiểm tra lại thông tin.";
}

function FeeBreakdown({ fee }: { fee: Data }) {
  const labels: Data = {
    distance_price: "Phí quãng đường",
    stop_point_price: "Phí điểm dừng",
    special_request_price: "Phí yêu cầu bổ sung",
    cod_commission_price: "Phí thu hộ",
    voucher_discount: "Giảm giá",
    subtotal_price: "Tạm tính",
    total_price: "Tổng báo giá",
    total_pay: "Tổng phải trả",
  };
  return (
    <dl className="detail-grid">
      {Object.entries(labels)
        .filter(([key]) => fee[key] != null)
        .map(([key, label]) => (
          <div key={key}>
            <dt>{String(label)}</dt>
            <dd>{money(fee[key], fee.currency || "VND")}</dd>
          </div>
        ))}
    </dl>
  );
}
