import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { money } from "../api";
import { formatUi, t } from "../uiPreferences";
import { housingManagement } from "./client";

// Estimated revenue from /landlord/revenue: rent x days a room was rented.
// Rent after the first month never passes through ReloHome, so every figure
// here is labelled an estimate. Deposits are never counted.

type Property = {
  id: string;
  name: string;
  units: number;
  rented_units: number;
  period_total: number;
  current_month: number;
  previous_month: number;
};
type Revenue = {
  months: number;
  as_of: string;
  series: {
    month: string;
    total: number;
    by_property: Record<string, number>;
  }[];
  properties: Property[];
  total: number;
  previous_total: number;
  average_monthly: number;
};

const OTHER = "other";
const MAX_SERIES = 5;
const W = 760,
  H = 260,
  LEFT = 56,
  RIGHT = 16,
  TOP = 20,
  BOTTOM = 34;
const plotW = W - LEFT - RIGHT,
  plotH = H - TOP - BOTTOM;

const monthLabel = (month: string) =>
  `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const millions = (value: number) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(
    value / 1_000_000,
  );

/** Round the axis up to a whole step in millions so gridlines read cleanly. */
function scale(max: number) {
  const top = Math.max(1_000_000, max);
  const raw = top / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10]
    .map((m) => m * magnitude)
    .find((s) => s >= raw)!;
  const ceiling = Math.ceil(top / step) * step;
  const ticks = [];
  for (let value = 0; value <= ceiling; value += step) ticks.push(value);
  return { ceiling, ticks };
}

/**
 * The first five homes in the owner's list keep their own colour and the rest fold
 * into "Khác". Colour follows the home's place in that list, never its revenue
 * rank, so switching the period or filter never repaints a home. Filtered to one
 * home, that home is shown by itself.
 */
function seriesOf(data: Revenue, homes: Property[]) {
  const listed = homes.length ? homes : data.properties;
  const slotOf = (id: string) => listed.findIndex((home) => home.id === id);
  if (data.properties.length === 1 && listed.length > 1) {
    const only = data.properties[0];
    return [
      {
        key: only.id,
        label: only.name,
        slot:
          slotOf(only.id) >= 0 && slotOf(only.id) < MAX_SERIES
            ? slotOf(only.id) + 1
            : 1,
        ids: [only.id],
      },
    ];
  }
  const shown = data.properties.filter(
    (p) => slotOf(p.id) >= 0 && slotOf(p.id) < MAX_SERIES,
  );
  const series: {
    key: string;
    label: string;
    slot: number | "other";
    ids: string[];
  }[] = shown.map((p) => ({
    key: p.id,
    label: p.name,
    slot: slotOf(p.id) + 1,
    ids: [p.id],
  }));
  const rest = data.properties
    .filter((p) => !shown.includes(p))
    .map((p) => p.id);
  if (rest.length)
    series.push({ key: OTHER, label: "Khác", slot: "other", ids: rest });
  return series;
}

function RevenueChart({ data, homes }: { data: Revenue; homes: Property[] }) {
  const series = seriesOf(data, homes);
  const value = (month: Revenue["series"][number], ids: string[]) =>
    ids.reduce((sum, id) => sum + (month.by_property[id] ?? 0), 0);
  const { ceiling, ticks } = scale(
    Math.max(...data.series.map((m) => m.total)),
  );
  const band = plotW / data.series.length,
    bar = Math.min(48, band * 0.56);
  const peak = data.series.reduce(
    (best, m) => (m.total > best.total ? m : best),
    data.series[0],
  );
  return (
    <figure className="ll-chart">
      <figcaption>
        <h3>{t("Doanh thu ước tính theo tháng và theo nhà")}</h3>
        <span>
          {formatUi("{0} – {1} · cao nhất {2} triệu ₫ vào {3}", [
            monthLabel(data.series[0].month),
            monthLabel(data.series[data.series.length - 1].month),
            millions(peak.total),
            monthLabel(peak.month),
          ])}
        </span>
        <ul className="ll-chart-legend">
          {series.map((s) => (
            <li key={s.key}>
              <i
                className={`ll-revenue-swatch ll-revenue-${s.slot}`}
                aria-hidden="true"
              />
              {s.key === OTHER ? t(s.label) : s.label}
            </li>
          ))}
        </ul>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={t(
          "Biểu đồ cột chồng doanh thu ước tính theo tháng và theo nhà",
        )}
      >
        <g className="ll-chart-axis" aria-hidden="true">
          {ticks.map((tick) => {
            const y = TOP + plotH - (tick / ceiling) * plotH;
            return (
              <g key={tick}>
                <line
                  x1={LEFT}
                  x2={W - RIGHT}
                  y1={y}
                  y2={y}
                  className={tick ? "grid" : "base"}
                />
                <text x={LEFT - 8} y={y + 4} textAnchor="end">
                  {millions(tick)}
                </text>
              </g>
            );
          })}
          <text x={4} y={10}>
            {t("Triệu ₫")}
          </text>
          {data.series.map((m, index) => (
            <text
              key={m.month}
              x={LEFT + band * (index + 0.5)}
              y={H - 10}
              textAnchor="middle"
            >
              {monthLabel(m.month)}
            </text>
          ))}
        </g>
        {data.series.map((m, index) => {
          const x = LEFT + band * index + (band - bar) / 2;
          let top = TOP + plotH;
          const parts = series.map((s) => ({ s, amount: value(m, s.ids) }));
          const label = [
            formatUi("Tháng {0}: tổng {1}", [
              monthLabel(m.month),
              money(m.total),
            ]),
            ...parts
              .filter((p) => p.amount > 0)
              .map(
                (p) =>
                  `${p.s.key === OTHER ? t(p.s.label) : p.s.label}: ${money(p.amount)}`,
              ),
          ].join("\n");
          return (
            <g
              key={m.month}
              className="ll-chart-hit"
              tabIndex={0}
              role="img"
              aria-label={label}
            >
              <title>{label}</title>
              <rect
                x={LEFT + band * index}
                y={TOP}
                width={band}
                height={plotH}
                className="hit"
              />
              {parts.map(({ s, amount }) => {
                if (amount <= 0) return null;
                const height = Math.max(2, (amount / ceiling) * plotH);
                top -= height;
                return (
                  <rect
                    key={s.key}
                    x={x}
                    y={top}
                    width={bar}
                    height={height}
                    className={`ll-revenue-bar ll-revenue-${s.slot}`}
                  />
                );
              })}
              {m.total > 0 && (
                <text
                  x={x + bar / 2}
                  y={top - 6}
                  textAnchor="middle"
                  className="ll-chart-value"
                >
                  {millions(m.total)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function Change({ now, before }: { now: number; before: number }) {
  if (now === before)
    return <span className="ll-revenue-flat">{t("Không đổi")}</span>;
  const up = now > before;
  return (
    <span className={up ? "ll-revenue-up" : "ll-revenue-down"}>
      {up ? "+" : "−"}
      {money(Math.abs(now - before))}
    </span>
  );
}

export function RevenuePanel() {
  const [months, setMonths] = useState(6),
    [property, setProperty] = useState(""),
    [data, setData] = useState<Revenue | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    const query = new URLSearchParams({ months: String(months) });
    if (property) query.set("property_id", property);
    void housingManagement<Revenue>(
      "landlord/revenue?" + query,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setData)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [months, property]);
  // The home filter keeps every home listed even after filtering to one.
  const [homes, setHomes] = useState<Property[]>([]);
  useEffect(() => {
    if (data && !property) setHomes(data.properties);
  }, [data, property]);
  const change =
    data && data.previous_total > 0
      ? (data.total / data.previous_total - 1) * 100
      : null;
  const current = data?.series[data.series.length - 1]?.month;
  const previous = data?.series[data.series.length - 2]?.month;
  const totals = data?.properties.reduce(
    (sum, p) => ({
      current_month: sum.current_month + p.current_month,
      previous_month: sum.previous_month + p.previous_month,
      units: sum.units + p.units,
      rented_units: sum.rented_units + p.rented_units,
    }),
    { current_month: 0, previous_month: 0, units: 0, rented_units: 0 },
  );
  const occupancy = (rented: number, units: number) =>
    units
      ? formatUi("{0}/{1} phòng · {2}%", [
          rented,
          units,
          Math.round((rented / units) * 100),
        ])
      : "—";
  return (
    <section className="ll-panel ll-revenue" aria-labelledby="ll-revenue-title">
      <div className="ll-section-heading">
        <div>
          <h2 id="ll-revenue-title">{t("Doanh thu ước tính")}</h2>
          <p>
            {t(
              "Tiền thuê ước tính chủ nhà nhận mỗi tháng từ các phòng đã cho thuê. Không tính tiền cọc.",
            )}
          </p>
        </div>
      </div>
      <div className="ll-filters">
        <select
          aria-label={t("Khoảng thời gian doanh thu")}
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
        >
          <option value={3}>{t("3 tháng gần nhất")}</option>
          <option value={6}>{t("6 tháng gần nhất")}</option>
          <option value={12}>{t("12 tháng gần nhất")}</option>
        </select>
        <select
          aria-label={t("Lọc doanh thu theo nhà")}
          value={property}
          onChange={(e) => setProperty(e.target.value)}
        >
          <option value="">{t("Tất cả nhà")}</option>
          {homes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="ll-form-error">
          {error}
        </p>
      )}
      {!data ? (
        !error && <p role="status">{t("Đang tải doanh thu…")}</p>
      ) : (
        <>
          <div className="ll-status-metrics">
            <div>
              <strong>{money(data.total)}</strong>
              <span>{t("Tổng doanh thu trong kỳ")}</span>
            </div>
            <div>
              <strong>{money(data.average_monthly)}</strong>
              <span>{t("Trung bình mỗi tháng")}</span>
            </div>
            <div>
              {change === null ? (
                <strong className="ll-revenue-flat">—</strong>
              ) : (
                <strong
                  className={change >= 0 ? "ll-revenue-up" : "ll-revenue-down"}
                >
                  {change >= 0 ? (
                    <ArrowUp size={22} aria-hidden="true" />
                  ) : (
                    <ArrowDown size={22} aria-hidden="true" />
                  )}
                  {formatUi("{0}%", [
                    (change >= 0 ? "+" : "−") +
                      new Intl.NumberFormat("vi-VN", {
                        maximumFractionDigits: 1,
                      }).format(Math.abs(change)),
                  ])}
                </strong>
              )}
              <span>
                {change === null
                  ? t("Chưa có doanh thu kỳ trước để so sánh")
                  : formatUi("So với {0} tháng trước đó · {1}", [
                      data.months,
                      money(data.previous_total),
                    ])}
              </span>
            </div>
          </div>
          {data.total === 0 ? (
            <p className="ll-empty-inline">
              {t(
                "Chưa có phòng nào được ghi nhận đã cho thuê trong khoảng thời gian này.",
              )}
            </p>
          ) : (
            <>
              <div className="ll-charts">
                <RevenueChart data={data} homes={homes} />
                <p className="ll-form-hint">
                  {t(
                    "Rê chuột hoặc dùng phím Tab để xem doanh thu từng nhà trong tháng.",
                  )}
                </p>
              </div>
              <details className="ll-table-scroll ll-daily-table">
                <summary>{t("Doanh thu theo tháng · xem dạng bảng")}</summary>
                <table>
                  <caption className="sr-only">
                    {t("Doanh thu theo tháng")}
                  </caption>
                  <thead>
                    <tr>
                      <th>{t("Tháng")}</th>
                      {data.properties.map((p) => (
                        <th key={p.id}>{p.name}</th>
                      ))}
                      <th>{t("Tổng")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.series.map((m) => (
                      <tr key={m.month}>
                        <td>{monthLabel(m.month)}</td>
                        {data.properties.map((p) => (
                          <td key={p.id}>{money(m.by_property[p.id] ?? 0)}</td>
                        ))}
                        <td>{money(m.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
          {current && previous && (
            <>
              <h3 id="ll-revenue-compare">{t("So sánh giữa các nhà")}</h3>
              {/* Focusable so keyboard users can scroll the table on narrow screens. */}
              <div
                className="ll-table-scroll"
                tabIndex={0}
                role="region"
                aria-labelledby="ll-revenue-compare"
              >
                <table className="ll-revenue-compare">
                  <thead>
                    <tr>
                      <th>{t("Căn nhà")}</th>
                      <th>{formatUi("Tháng {0}", [monthLabel(current)])}</th>
                      <th>{formatUi("Tháng {0}", [monthLabel(previous)])}</th>
                      <th>{t("Chênh lệch")}</th>
                      <th>{t("Tỷ lệ lấp đầy")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.properties.map((p) => (
                      <tr key={p.id}>
                        <th scope="row">{p.name}</th>
                        <td>{money(p.current_month)}</td>
                        <td>{money(p.previous_month)}</td>
                        <td>
                          <Change
                            now={p.current_month}
                            before={p.previous_month}
                          />
                        </td>
                        <td>{occupancy(p.rented_units, p.units)}</td>
                      </tr>
                    ))}
                    {totals && data.properties.length > 1 && (
                      <tr className="ll-revenue-total">
                        <th scope="row">{t("Tổng")}</th>
                        <td>{money(totals.current_month)}</td>
                        <td>{money(totals.previous_month)}</td>
                        <td>
                          <Change
                            now={totals.current_month}
                            before={totals.previous_month}
                          />
                        </td>
                        <td>{occupancy(totals.rented_units, totals.units)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="ll-form-hint ll-revenue-note">
            {formatUi(
              "Ước tính: giá thuê hằng tháng × số ngày phòng ở trạng thái đã thuê, tính đến {0}. Không gồm tiền cọc, tiền điện nước thu hộ và các khoản hoàn trả. Tháng hiện tại chỉ tính tới hôm nay.",
              [data.as_of.split("-").reverse().join("/")],
            )}
          </p>
        </>
      )}
    </section>
  );
}
