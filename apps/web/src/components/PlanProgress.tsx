import { t as uiText } from "../uiPreferences";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Eye,
  House,
  Plane,
  Route,
  Truck,
} from "lucide-react";
import { money } from "../api";
import type { Data } from "../types";
import { UsersRound } from "lucide-react";
import { rt as roommateText } from "../roommate/text";

// Horizontal plan strip. Items are only the goals the user has asked for (tasks of the current plan,
// computed by the backend `state.progress`); goals that do not depend on each other share a column
// (parallel), a goal built on another's result or choice comes after an arrow (sequential).

const CATEGORY: Record<string, string> = {
  hospital: "bệnh viện",
  clinic: "phòng khám",
  pharmacy: "nhà thuốc",
  school: "trường học",
  university: "trường đại học",
  marketplace: "chợ",
  supermarket: "siêu thị",
  convenience_store: "cửa hàng tiện lợi",
  gym: "phòng gym",
  park: "công viên",
  bus_stop: "trạm xe buýt",
  bus_station: "bến xe",
};
const SELECTED = "selected:property";
const place = (v: unknown) => (v === SELECTED ? "căn đã chọn" : String(v));
const short = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tr`
    : money(n);

export function describePlanItem(item: Data): {
  icon: any;
  title: string;
  detail: string;
} {
  const i = item.inputs || {};
  if (item.agent === "roommate") return {
    icon: UsersRound,
    title: roommateText("Tìm người ở cùng", "Find a roommate"),
    detail: roommateText("Xem hồ sơ và tự quyết định kết nối", "Explore profiles and choose who to connect with"),
  };
  if (item.agent === "property")
    return {
      icon: House,
      title: "Tìm nhà",
      detail: [
        [i.district, i.city].filter(Boolean).join(", ") ||
          (i.near ? `gần ${i.near}` : "vùng bản đồ đang xem"),
        i.max_price_vnd ? `≤ ${short(i.max_price_vnd)}/tháng` : "",
        i.min_bedrooms != null && i.min_bedrooms === i.max_bedrooms
          ? `${i.min_bedrooms} phòng ngủ`
          : "",
        (i.nearby_categories || []).length
          ? "gần " +
            i.nearby_categories.map((c: string) => CATEGORY[c] || c).join(", ")
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  if (item.agent === "map" && item.mode === "route")
    return {
      icon: Route,
      title: "Đường đi",
      detail: `${place(i.route_from)} → ${place(i.route_to)}`,
    };
  if (item.agent === "map")
    return {
      icon: Compass,
      title: "Tiện ích xung quanh",
      detail:
        (i.categories || []).map((c: string) => CATEGORY[c] || c).join(", ") +
        (i.near
          ? ` quanh ${i.near}`
          : item.after?.length
            ? " quanh các căn"
            : " quanh căn đã chọn"),
    };
  if (item.agent === "flight")
    return {
      icon: Plane,
      title: "Chuyến bay",
      detail: [
        i.origin && i.destination ? `${i.origin} → ${i.destination}` : "",
        i.date || i.flight_date,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  if (item.agent === "relocation")
    return {
      icon: Truck,
      title:
        item.mode === "catalog"
          ? "Phạm vi chuyển đồ"
          : item.mode === "order_status"
            ? "Theo dõi đơn chuyển đồ"
            : "Chuyển đồ",
      detail:
        item.mode === "catalog"
          ? "Khu vực AhaMove hỗ trợ"
          : item.mode === "order_status"
            ? i.order_id || i.tracking_number || ""
            : [
                i.from_address && i.to_address
                  ? `${place(i.from_address)} → ${place(i.to_address)}`
                  : "",
                [i.move_date, i.move_time].filter(Boolean).join(" "),
              ]
                .filter(Boolean)
                .join(" · "),
    };
  return { icon: Compass, title: item.agent, detail: "" };
}

const STATE: Record<string, { label: string; icon: any }> = {
  confirmed: { label: "Đã chốt", icon: Check },
  reviewed: { label: "Đã xem xét", icon: Eye },
  waiting: { label: "Chưa có kết quả", icon: null },
  stale: { label: "Cần báo giá lại", icon: null },
};

const OPEN_KEY = "siu-plan-strip-open";

export function PlanProgress({ progress }: { progress?: Data }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      // Preference only; storage may be unavailable.
    }
  }, [open]);
  const items: Data[] = progress?.items || [];
  if (!items.length) return null;
  const totals = progress?.totals || {};
  const columns: Data[][] = [];
  for (const item of items) (columns[item.level || 0] ||= []).push(item);
  const confirmed = items.filter((i) => i.state === "confirmed").length;
  const total = [
    totals.monthly_vnd ? `${money(totals.monthly_vnd)}/tháng` : "",
    totals.one_time_vnd ? `${money(totals.one_time_vnd)} một lần` : "",
  ]
    .filter(Boolean)
    .join(" + ");
  return (
    <section
      className={"plan-strip" + (open ? "" : " closed")}
      aria-label={uiText("Tiến trình kế hoạch")}
    >
      <header>
        <strong>{uiText("Kế hoạch của bạn")}</strong>
        <span className="muted small">
          {items.length}
          {uiText(" mục · ")}
          {confirmed}
          {uiText(" đã chốt")}
        </span>
        <span className="plan-total">
          {uiText("Tổng đã chốt: ")}
          <b>{total || uiText("chưa có")}</b>
          {totals.unpriced?.length > 0 && (
            <small className="muted">
              {uiText(" (có mục chưa xác minh giá)")}
            </small>
          )}
        </span>
        <button
          className="text-button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? uiText("Thu gọn kế hoạch") : uiText("Mở kế hoạch")}
        >
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {open ? uiText("Thu gọn") : uiText("Mở")}
        </button>
      </header>
      {open && (
        <div className="plan-flow">
          {columns.filter(Boolean).map((column, c) => (
            <div className="plan-step-wrap" key={c}>
              {c > 0 && <ArrowRight className="plan-arrow" size={18} />}
              <div className="plan-column">
                {column.map((item) => {
                  const d = describePlanItem(item),
                    s = item.task_status === "stale" ? STATE.stale : STATE[item.state] || STATE.waiting;
                  return (
                    <article
                      key={item.task_id}
                      className={"plan-step " + item.state}
                      data-task={item.task_id}
                    >
                      <span className="plan-step-icon" data-service={item.agent}>
                        <d.icon size={16} />
                      </span>
                      <span className="plan-step-body">
                        <strong>{d.title}</strong>
                        {d.detail && <small>{d.detail}</small>}
                        {item.chosen && (
                          <small className="plan-chosen">
                            {item.chosen.label}
                            {item.chosen.amount_vnd != null &&
                              ` · ${money(item.chosen.amount_vnd)}${item.chosen.recurrence === "monthly" ? "/tháng" : ""}`}
                          </small>
                        )}
                      </span>
                      <span className={"plan-badge " + (item.task_status === "stale" ? "stale" : item.state)}>
                        {s.icon && <s.icon size={12} />} {uiText(s.label)}
                      </span>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// What the user has confirmed so far (a chosen option, not a payment) and its price.
export function ConfirmedTotal({ progress }: { progress?: Data }) {
  const chosen = (progress?.items || []).filter((i: Data) => i.state === "confirmed" && i.chosen);
  const totals = progress?.totals || {};
  if (!chosen.length)
    return (
      <p className="muted">
        {uiText(
          "Chưa chốt phương án nào. Chọn một phương án trong kết quả để đưa vào tổng.",
        )}
      </p>
    );
  return (
    <div className="cost-lines">
      {chosen.map((i: Data) => (
        <div key={i.task_id}>
          <span>
            {i.chosen.label}
            <small>
              {describePlanItem(i).title} ·{" "}
              {i.chosen.recurrence === "monthly"
                ? uiText("Khoản hằng tháng")
                : i.chosen.recurrence
                  ? uiText("Khoản một lần")
                  : uiText("Giá chưa xác minh, chưa tính")}
            </small>
          </span>
          <strong>{money(i.chosen.amount_vnd)}</strong>
        </div>
      ))}
      <div className="cost-totals">
        <span>
          {uiText("Một lần ")}
          <b>{money(totals.one_time_vnd || 0)}</b>
        </span>
        <span>
          {uiText("Mỗi tháng ")}
          <b>{money(totals.monthly_vnd || 0)}</b>
        </span>
      </div>
    </div>
  );
}
