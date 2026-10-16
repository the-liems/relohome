import { formatUi, t } from "../uiPreferences";
import type { Data } from "../types";

// Daily interest from /landlord/stats. Views are on their own chart: their scale
// is several times larger than saves and contacts, which share one axis.

type Day = { day: string; views: number; saves: number; contacts: number };

const W = 760,
  H = 240,
  LEFT = 40,
  RIGHT = 16,
  TOP = 20,
  BOTTOM = 34;
const plotW = W - LEFT - RIGHT,
  plotH = H - TOP - BOTTOM;

const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** Round the axis up to an even step so gridlines land on whole numbers. */
function scale(max: number) {
  const top = Math.max(2, max);
  const step =
    top <= 4
      ? 1
      : top <= 10
        ? 2
        : top <= 25
          ? 5
          : top <= 50
            ? 10
            : Math.ceil(top / 50) * 10;
  const ceiling = Math.ceil(top / step) * step;
  const ticks = [];
  for (let value = 0; value <= ceiling; value += step) ticks.push(value);
  return { ceiling, ticks };
}

function Axis({
  ticks,
  ceiling,
  days,
}: {
  ticks: number[];
  ceiling: number;
  days: Day[];
}) {
  const every = Math.ceil(days.length / 10);
  const band = plotW / days.length;
  return (
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
              {tick}
            </text>
          </g>
        );
      })}
      {days.map((day, index) =>
        index % every === 0 || index === days.length - 1 ? (
          <text
            key={day.day}
            x={LEFT + band * (index + 0.5)}
            y={H - 10}
            textAnchor="middle"
          >
            {shortDay(day.day)}
          </text>
        ) : null,
      )}
    </g>
  );
}

function ViewsChart({ days }: { days: Day[] }) {
  const { ceiling, ticks } = scale(Math.max(...days.map((d) => d.views)));
  const band = plotW / days.length,
    bar = Math.min(34, band * 0.5);
  const peak = days.reduce(
    (best, day) => (day.views > best.views ? day : best),
    days[0],
  );
  return (
    <figure className="ll-chart">
      <figcaption>
        <h3>{t("Lượt xem chi tiết theo ngày")}</h3>
        <span>
          {formatUi("{0} – {1} · cao nhất {2} lượt vào {3}", [
            shortDay(days[0].day),
            shortDay(days[days.length - 1].day),
            peak.views,
            shortDay(peak.day),
          ])}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={t("Biểu đồ cột lượt xem chi tiết theo ngày")}
      >
        <Axis ticks={ticks} ceiling={ceiling} days={days} />
        {days.map((day, index) => {
          const height = (day.views / ceiling) * plotH;
          const x = LEFT + band * index + (band - bar) / 2;
          const label = formatUi("{0}: {1} lượt xem", [
            shortDay(day.day),
            day.views,
          ]);
          return (
            <g
              key={day.day}
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
              <rect
                x={x}
                y={TOP + plotH - Math.max(height, day.views ? 2 : 0)}
                width={bar}
                height={Math.max(height, day.views ? 2 : 0)}
                rx={4}
                className="ll-series-views"
              />
              {day === peak && day.views > 0 && (
                <text
                  x={x + bar / 2}
                  y={TOP + plotH - height - 6}
                  textAnchor="middle"
                  className="ll-chart-value"
                >
                  {day.views}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function InterestChart({ days }: { days: Day[] }) {
  const { ceiling, ticks } = scale(
    Math.max(...days.map((d) => Math.max(d.saves, d.contacts))),
  );
  const band = plotW / days.length;
  const x = (index: number) => LEFT + band * (index + 0.5);
  const y = (value: number) => TOP + plotH - (value / ceiling) * plotH;
  const series = [
    { key: "saves" as const, label: "Lượt lưu", className: "ll-series-saves" },
    {
      key: "contacts" as const,
      label: "Liên hệ",
      className: "ll-series-contacts",
    },
  ];
  return (
    <figure className="ll-chart">
      <figcaption>
        <h3>{t("Lượt lưu và liên hệ theo ngày")}</h3>
        <span>{t("Hai số liệu cùng thang đếm, dùng chung một trục")}</span>
        <ul className="ll-chart-legend">
          {series.map((line) => (
            <li key={line.key}>
              <i className={line.className} aria-hidden="true" />
              {t(line.label)}
            </li>
          ))}
        </ul>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={t("Biểu đồ đường lượt lưu và liên hệ theo ngày")}
      >
        <Axis ticks={ticks} ceiling={ceiling} days={days} />
        {series.map((line) => (
          <polyline
            key={line.key}
            className={line.className}
            fill="none"
            points={days
              .map((day, index) => `${x(index)},${y(day[line.key])}`)
              .join(" ")}
          />
        ))}
        {days.map((day, index) => {
          const label = formatUi("{0}: {1} lượt lưu, {2} liên hệ", [
            shortDay(day.day),
            day.saves,
            day.contacts,
          ]);
          return (
            <g
              key={day.day}
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
              {series.map((line) => (
                <circle
                  key={line.key}
                  cx={x(index)}
                  cy={y(day[line.key])}
                  r={4}
                  className={line.className}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function ActivityCharts({ daily }: { daily: Data[] }) {
  const days: Day[] = [...daily]
    .map((row) => ({
      day: String(row.day),
      views: Number(row.detail_views || 0),
      saves: Number(row.saves || 0),
      contacts: Number(row.contacts || 0),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (!days.length) return null;
  return (
    <div className="ll-charts">
      <ViewsChart days={days} />
      <InterestChart days={days} />
      <p className="ll-form-hint">
        {t("Rê chuột hoặc dùng phím Tab để xem số liệu từng ngày.")}
      </p>
    </div>
  );
}
