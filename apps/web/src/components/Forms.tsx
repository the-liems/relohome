import { RequiredMark } from "./RequiredMark";
import { t as uiText } from "../uiPreferences";
import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ArrowRight, MapPin, Copy, House, Compass } from "lucide-react";
import { dateTime, money } from "../api";
import type { Data } from "../types";
import { Dialog } from "./Dialog";
import { MovingSteps, MovingQuoteSummary } from "./MovingOptionsForm";
import { FlightSearchForm } from "./FlightSearchForm";

const cities = ["Hà Nội", "Đà Nẵng", "Thành phố Hồ Chí Minh"];
export function TaskForm({
  kind,
  onClose,
  onSubmit,
  known = {},
  embedded = false,
  disabled = false,
  questions = [],
}: {
  kind: string;
  onClose: () => void;
  onSubmit: (text: string, extra?: Data) => Promise<void>;
  known?: Data;
  embedded?: boolean;
  disabled?: boolean;
  questions?: Data[];
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const title: Record<string, string> = {
    property: "Bạn muốn tìm ngôi nhà như thế nào?",
    flight: "Tìm chuyến bay cho hành trình của bạn",
    map: "Tính đường đi",
  };
  const close = () => { if (!busy) onClose(); };
  if (kind === "flight") {
    const content = <FlightSearchForm known={known} questions={questions} continuation={embedded} disabled={disabled} onSubmit={onSubmit} onClose={embedded ? undefined : onClose} onBusyChange={setBusy} />;
    return embedded ? content : <Dialog title={uiText(title.flight)} onClose={close} wide>{content}</Dialog>;
  }
  const city = ({ hanoi: cities[0], danang: cities[1], hcm: cities[2] } as Record<string, string>)[known.city] || known.city || "";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || disabled) return;
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    setError("");
    let text = "";
    if (kind === "property") {
      if (f.min && f.max && Number(f.min) > Number(f.max)) {
        setError("Giá tối thiểu phải nhỏ hơn hoặc bằng giá tối đa.");
        return;
      }
      text = `${embedded ? "Bổ sung cho yêu cầu tìm nhà hiện tại: " : "Tìm "}${f.type || "nhà cho thuê"} tại ${f.district ? f.district + ", " : ""}${f.city}${f.near ? ", gần " + f.near : ""}${f.min ? ", giá từ " + f.min + " đồng/tháng" : ""}${f.max ? ", không quá " + f.max + " đồng/tháng" : ""}.`;
    }
    if (kind === "map") {
      text = `${embedded ? "Bổ sung cho yêu cầu đường đi hiện tại: " : "Tính đường "}${f.profile} từ ${f.from} đến ${f.to} tại ${f.city}.`;
    }
    setBusy(true);
    try {
      await onSubmit(text);
      if (!embedded) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const content = (
      <form onSubmit={submit} className="task-form service-request" data-service={kind} aria-label={uiText(title[kind])} aria-busy={busy}>
        <div className="request-intro"><span className="request-symbol" aria-hidden="true">{kind === "property" ? <House size={24} /> : <Compass size={24} />}</span><div>{embedded && <h3>{uiText(title[kind])}</h3>}<p>{uiText("Điền một lần, ReloHome sẽ xử lý yêu cầu và mở kết quả để bạn lựa chọn.")}</p></div></div>
        <fieldset className="request-fields" disabled={busy || disabled}>
          <legend className="sr-only">{uiText("Thông tin dịch vụ")}</legend>
        {kind === "property" && (
          <>
            <div className="form-grid">
              <label>
                <span className="field-label">{uiText("Thành phố")}<RequiredMark /></span>
                <select name="city" defaultValue={city} aria-label={uiText("Thành phố")} required>
                  <option value="">{uiText("Chọn thành phố")}</option>
                  {city && !cities.includes(city) && <option>{city}</option>}
                  {cities.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                {uiText("Quận / khu vực")}
                <input name="district" defaultValue={known.district || ""} placeholder={uiText("Ví dụ: Quận 7")} />
              </label>
              <label>
                {uiText("Giá từ · VND/tháng")}
                <input name="min" defaultValue={known.min_price_vnd ?? known.min_price?.amount ?? ""} type="number" min="0" step="100000" placeholder={uiText("Không giới hạn")} />
              </label>
              <label>
                {uiText("Đến · VND/tháng")}
                <input
                  name="max"
                  defaultValue={known.max_price_vnd ?? known.max_price?.amount ?? ""}
                  type="number"
                  min="0"
                  step="100000"
                  placeholder={uiText("Ví dụ: 5000000")}
                />
              </label>
            </div>
            <section className="request-extra housing-optional" aria-label={uiText("Tiêu chí chi tiết · không bắt buộc")}>
              <h4>{uiText("Tiêu chí chi tiết")} <span>{uiText("Không bắt buộc")}</span></h4>
              <div className="form-grid">
              <label>
                {uiText("Loại nhà")}
                <select name="type" aria-label={uiText("Loại nhà")} defaultValue={({ room: "phòng trọ", apartment: "căn hộ", house: "nhà nguyên căn", studio: "studio" } as Record<string, string>)[known.room_type] || known.room_type || "nhà cho thuê"}>
                  <option value="nhà cho thuê">{uiText("nhà cho thuê")}</option>
                  <option value="căn hộ">{uiText("căn hộ")}</option>
                  <option value="phòng trọ">{uiText("phòng trọ")}</option>
                  <option>studio</option>
                  <option value="nhà nguyên căn">
                    {uiText("nhà nguyên căn")}
                  </option>
                </select>
              </label>
              <label>
                {uiText("Gần địa điểm")}
                <input name="near" defaultValue={known.near || ""} placeholder={uiText("Trường học, công ty hoặc địa chỉ")} />
              </label>
            </div>
            </section>
          </>
        )}
        {kind === "map" && <MapFields known={known} city={city} />}
        </fieldset>
        {error && (
          <p className="notice error" role="alert">
            {uiText(error)}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" disabled={busy} onClick={close}>
            {uiText(embedded ? "Tiếp tục bằng chat" : "Hủy")}
          </button>
          <button className="primary" disabled={busy || disabled}>
            {busy ? uiText("Đang gửi…") : uiText("Áp dụng")}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
  );
  return embedded ? content : <Dialog title={uiText(title[kind]) || uiText("Bổ sung yêu cầu")} onClose={close} wide>{content}</Dialog>;
}
// Directions only: amenities are a filter of the home search, not a service of their own.
function MapFields({ known, city }: { known: Data; city: string }) {
  return (
    <div className="form-grid">
      <label>
        <span className="field-label">{uiText("Điểm đi")}<RequiredMark /></span>
        <input
          name="from"
          defaultValue={known.route_from && !String(known.route_from).startsWith("selected:") ? known.route_from : ""}
          placeholder={uiText("Tên địa điểm hoặc căn nhà đã chọn")}
          required
        />
      </label>
      <label>
        <span className="field-label">{uiText("Điểm đến")}<RequiredMark /></span>
        <input name="to" defaultValue={known.route_to && !String(known.route_to).startsWith("selected:") ? known.route_to : ""} placeholder={uiText("Nơi bạn muốn tới")} required />
      </label>
      <label>
        <span className="field-label">{uiText("Thành phố")}<RequiredMark /></span>
        <select name="city" defaultValue={city} aria-label={uiText("Thành phố")} required>
          <option value="">{uiText("Chọn thành phố")}</option>
          {city && !cities.includes(city) && <option>{city}</option>}
          {cities.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="field-label">{uiText("Phương tiện")}<RequiredMark /></span>
        <select name="profile" aria-required="true" defaultValue={({ walking: "đi bộ", motorcycle: "xe máy", driving: "ô tô" } as Record<string, string>)[known.route_profile] || "xe máy"}>
          <option value="đi bộ">{uiText("đi bộ")}</option>
          <option value="xe máy">{uiText("xe máy")}</option>
          <option value="ô tô">{uiText("ô tô")}</option>
        </select>
      </label>
    </div>
  );
}

export function Approval({
  pending,
  enabled,
  busy,
  onDecision,
}: {
  pending: Data;
  enabled: boolean;
  busy: boolean;
  onDecision: (body: Data) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [now, setNow] = useState(Date.now()),
    [change, setChange] = useState(false);
  const approvalForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);
  const expiry = new Date(pending.expires_at).getTime();
  const expired = !Number.isFinite(expiry) || expiry <= now;
  const unsupported =
    Object.values(pending.pii_required || {})
      .flat()
      .some(
        (f) =>
          !["pickup_contact", "destination_contact", "order_update"].includes(
            String(f),
          ),
      ) ||
    (pending.cost_summary?.commit_actions || []).some(
      (a: Data) =>
        !["moving_booking", "cancel_order", "update_order"].includes(a.kind),
    );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || expired || unsupported || !enabled) return;
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const forms: Data = {};
    for (const [id, fields] of Object.entries(pending.pii_required || {})) {
      forms[id] = {};
      for (const field of fields as string[]) {
        const prefix = id + "|" + field + "|";
        if (field === "order_update") {
          forms[id][field] = {
            path_index: Number(data[prefix + "path_index"]),
          };
          for (const k of ["name", "mobile", "remarks"])
            if (data[prefix + k]) forms[id][field][k] = data[prefix + k];
        } else {
          forms[id][field] = {
            name: String(data[prefix + "name"] || "").trim(),
            mobile: String(data[prefix + "mobile"] || "").trim(),
          };
          for (const key of ["building", "apartment_or_floor", "remarks"])
            if (String(data[prefix + key] || "").trim())
              forms[id][field][key] = String(data[prefix + key]).trim();
        }
      }
    }
    try {
      await onDecision({
        kind: "CONFIRM",
        plan_version: pending.plan_version,
        payload_hash: pending.payload_hash,
        pii_forms: forms,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="approval-card">
      <div className="section-heading">
        <span className="service-icon purple">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h3>{uiText("Phương án cần bạn xác nhận")}</h3>
          <p>{uiText("Kiểm tra thao tác và chi phí trước khi tiếp tục.")}</p>
        </div>
      </div>
      {Object.keys(pending.pii_required || {}).length > 0 && (
        <MovingSteps stage={2} />
      )}
      {Object.entries(pending.moving_details || {}).map(([id, detail]) => (
        <div className="mv-approval-route" key={id}>
          <p>
            <MapPin size={15} />
            <b>{uiText("A · Lấy đồ")}</b>
            <span>{(detail as Data).from_address}</span>
          </p>
          <p>
            <MapPin size={15} />
            <b>{uiText("B · Giao đồ")}</b>
            <span>{(detail as Data).to_address}</span>
          </p>
          {(detail as Data).moving_options && (
            <MovingQuoteSummary
              options={(detail as Data).moving_options}
              labels={(detail as Data).addon_labels}
            />
          )}
        </div>
      ))}
      <CostLines summary={pending.cost_summary} />
      <ul>
        {(pending.cost_summary?.commit_actions || []).map((action: Data) => (
          <li key={action.id}>
            {(
              {
                moving_booking: "Đặt đơn chuyển đồ",
                cancel_order: "Hủy đơn đã đặt",
                update_order: "Cập nhật liên hệ / ghi chú của đơn",
                flight_booking: "Đặt vé máy bay",
                deposit: "Thanh toán tiền cọc",
              } as Data
            )[action.kind] || uiText("Thao tác chưa được giao diện hỗ trợ")}
          </li>
        ))}
      </ul>
      {Object.values(pending.notes || {}).map((v, i) => (
        <p className="notice" key={i}>
          {String(v)}
        </p>
      ))}
      <small className="muted">
        {uiText("Có hiệu lực đến ")}
        {dateTime(pending.expires_at)}
      </small>
      {pending.last_error && (
        <p className="notice error">{pending.last_error}</p>
      )}
      {expired && (
        <p className="notice amber">
          {uiText("Phương án đã hết hạn. Hãy yêu cầu phương án mới.")}
        </p>
      )}
      {unsupported && (
        <p className="notice amber">
          {uiText(
            "Phương án có thao tác chưa được giao diện hỗ trợ. Hãy đổi phương án trước khi xác nhận.",
          )}
        </p>
      )}
      {!enabled && (
        <p className="notice amber">
          {uiText(
            "Hiện chưa thể đặt hoặc sửa đơn trên hệ thống. Bạn vẫn có thể xem và đổi phương án.",
          )}
        </p>
      )}
      <form ref={approvalForm} onSubmit={submit}>
        {Object.entries(pending.pii_required || {}).map(([id, fields]) => (
          <div key={id}>
            {(fields as string[]).map((field) => (
              <fieldset className="pin-form" key={field}>
                <legend>
                  {field === "pickup_contact"
                    ? uiText("Liên hệ điểm lấy")
                    : field === "destination_contact"
                      ? uiText("Liên hệ điểm giao")
                      : uiText("Cập nhật liên hệ / ghi chú")}
                </legend>
                {field === "destination_contact" &&
                  (fields as string[]).includes("pickup_contact") && (
                    <button
                      type="button"
                      className="text-button mv-copy-contact"
                      onClick={() => {
                        const form = approvalForm.current;
                        for (const key of ["name", "mobile"]) {
                          const source = form?.elements.namedItem(
                            `${id}|pickup_contact|${key}`,
                          ) as HTMLInputElement | null;
                          const target = form?.elements.namedItem(
                            `${id}|destination_contact|${key}`,
                          ) as HTMLInputElement | null;
                          if (source && target) target.value = source.value;
                        }
                      }}
                    >
                      <Copy size={14} />
                      {uiText(" Dùng liên hệ điểm lấy")}
                    </button>
                  )}
                {field === "order_update" && (
                  <label>
                    {uiText("Điểm cần sửa")}
                    <select name={id + "|" + field + "|path_index"}>
                      <option value="0">{uiText("Điểm lấy")}</option>
                      <option value="1">{uiText("Điểm giao")}</option>
                    </select>
                  </label>
                )}
                <div className="form-grid">
                  <label>
                    <span className="field-label">{uiText("Họ tên")}<RequiredMark required={field !== "order_update"} /></span>
                    <input
                      name={id + "|" + field + "|name"}
                      required={field !== "order_update"}
                      maxLength={150}
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    <span className="field-label">{uiText("Số điện thoại")}<RequiredMark required={field !== "order_update"} /></span>
                    <input
                      name={id + "|" + field + "|mobile"}
                      required={field !== "order_update"}
                      pattern="\+?[0-9]{9,15}"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={16}
                    />
                  </label>
                </div>
                {field !== "order_update" && (
                  <div className="mv-contact-more">
                    <div className="form-grid">
                      <label>
                        {uiText("Tòa nhà")}
                        <input
                          name={`${id}|${field}|building`}
                          maxLength={200}
                          placeholder={uiText("Tên tòa nhà, nếu có")}
                        />
                      </label>
                      <label>
                        {uiText("Căn hộ / tầng")}
                        <input
                          name={`${id}|${field}|apartment_or_floor`}
                          maxLength={100}
                          placeholder={uiText("Ví dụ: tầng 3, căn 302")}
                        />
                      </label>
                    </div>
                    <label>
                      {uiText("Chỉ dẫn giao nhận")}
                      <textarea
                        name={`${id}|${field}|remarks`}
                        rows={2}
                        maxLength={500}
                        placeholder={uiText(
                          "Ví dụ: gọi khi tới cổng, có thang máy",
                        )}
                      />
                    </label>
                  </div>
                )}
                {field === "order_update" && (
                  <label>
                    {uiText("Ghi chú")}
                    <input
                      name={id + "|" + field + "|remarks"}
                      maxLength={500}
                    />
                  </label>
                )}
              </fieldset>
            ))}
          </div>
        ))}
        <p className="muted small">
          {uiText("Thông tin liên hệ được gửi riêng để xử lý giao dịch.")}
        </p>
        <label className="checkbox">
          <input type="checkbox" required />
          <span className="field-label">{uiText("Tôi đồng ý với toàn bộ thao tác và chi phí ở trên.")}<RequiredMark /></span>
        </label>
        {error && (
          <p className="notice error" role="alert">
            {uiText(error)}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              onDecision({
                kind: "REJECT",
                plan_version: pending.plan_version,
              }).catch((e) => setError(e.message))
            }
          >
            {uiText("Từ chối")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setChange(!change)}
          >
            {uiText("Đổi phương án")}
          </button>
          <button
            className="primary"
            disabled={busy || expired || !enabled || unsupported}
          >
            {uiText("Xác nhận thao tác")}
          </button>
        </div>
      </form>
      {change && (
        <form
          className="change-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            onDecision({
              kind: "CHANGE",
              plan_version: pending.plan_version,
              change_request: String(f.get("change")),
            }).catch((e) => setError(e.message));
          }}
        >
          <label>
            <span className="field-label">{uiText("Bạn muốn thay đổi điều gì?")}<RequiredMark /></span>
            <input
              name="change"
              required
              placeholder={uiText("Ví dụ: đổi thời gian sang 15 giờ")}
            />
          </label>
          <button className="secondary" disabled={busy}>
            {uiText("Gửi thay đổi")}
          </button>
        </form>
      )}
    </section>
  );
}
export function CostLines({ summary }: { summary?: Data }) {
  return (
    <div className="cost-lines">
      {(summary?.lines || []).map((l: Data) => (
        <div key={l.task_id}>
          <span>
            {l.label}
            <small>
              {l.committed
                ? uiText("Đã đặt")
                : l.recurrence === "monthly"
                  ? uiText("Khoản hằng tháng")
                  : uiText("Khoản một lần")}
            </small>
          </span>
          <strong>
            {money(l.amount_vnd)}
            {l.max_amount_vnd != null && l.max_amount_vnd !== l.amount_vnd && (
              <small>
                {uiText("Tối đa ")}
                {money(l.max_amount_vnd)}
              </small>
            )}
          </strong>
        </div>
      ))}
      {summary && (
        <div className="cost-totals">
          <span>
            {uiText("Dự kiến một lần ")}
            <b>{money(summary.total_one_time_vnd)}</b>
          </span>
          <span>
            {uiText("Dự kiến mỗi tháng ")}
            <b>{money(summary.total_monthly_vnd)}</b>
          </span>
        </div>
      )}
    </div>
  );
}
