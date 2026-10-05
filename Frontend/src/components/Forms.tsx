import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ArrowRight, MapPin, Copy } from "lucide-react";
import { dateTime, money } from "../api";
import type { Data } from "../types";
import { Dialog } from "./Dialog";
import { MovingSteps, MovingQuoteSummary } from "./MovingOptionsForm";

const cities = ["Hà Nội", "Đà Nẵng", "Thành phố Hồ Chí Minh"];
export function TaskForm({
  kind,
  onClose,
  onSubmit,
}: {
  kind: string;
  onClose: () => void;
  onSubmit: (text: string, extra?: Data) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const title: Record<string, string> = {
    property: "Bạn muốn tìm ngôi nhà như thế nào?",
    flight: "Tìm chuyến bay cho hành trình của bạn",
    map: "Tính đường đi",
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
      text = `Tìm ${f.type || "nhà cho thuê"} tại ${f.district ? f.district + ", " : ""}${f.city}${f.min ? ", giá từ " + f.min + " đồng/tháng" : ""}${f.max ? ", không quá " + f.max + " đồng/tháng" : ""}${f.bedrooms ? ", có đúng " + f.bedrooms + " phòng ngủ" : ""}${f.area ? ", diện tích ít nhất " + f.area + " m²" : ""}${f.amenities ? ", cần " + f.amenities : ""}.`;
    }
    if (kind === "flight") {
      f.from = f.from.trim();
      f.to = f.to.trim();
      if (!f.from || !f.to) {
        setError("Hãy nhập nơi đi và nơi đến.");
        return;
      }
      if (f.from.toLocaleLowerCase("vi") === f.to.toLocaleLowerCase("vi")) {
        setError("Nơi đi và nơi đến phải khác nhau.");
        return;
      }
      if (new Date(f.date + "T23:59:59") < new Date()) {
        setError("Hãy chọn ngày bay trong tương lai.");
        return;
      }
      text = `Tìm chuyến bay một chiều từ ${f.from} đến ${f.to} ngày ${f.date}, cho ${f.adults} người lớn. Chỉ tìm chuyến.`;
    }
    if (kind === "map") {
      text = `Tính đường ${f.profile} từ ${f.from} đến ${f.to} tại ${f.city}.`;
    }
    setBusy(true);
    try {
      await onSubmit(text);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={title[kind] || "Bổ sung yêu cầu"} onClose={onClose}>
      <form onSubmit={submit} className="task-form">
        {kind === "property" && (
          <>
            <p className="muted">
              Điền những tiêu chí bạn cần. Bạn cũng có thể nhắn trực tiếp cho
              SIU AI.
            </p>
            <div className="form-grid">
              <label>
                Thành phố
                <select name="city">
                  {cities.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Quận / khu vực
                <input name="district" placeholder="Ví dụ: Quận 7" />
              </label>
              <label>
                Giá từ · VND/tháng
                <input
                  name="min"
                  type="number"
                  min="0"
                  step="100000"
                  placeholder="Không giới hạn"
                />
              </label>
              <label>
                Đến · VND/tháng
                <input
                  name="max"
                  type="number"
                  min="0"
                  step="100000"
                  placeholder="Ví dụ: 5000000"
                />
              </label>
              <label>
                Loại nhà
                <select name="type">
                  <option>nhà cho thuê</option>
                  <option>căn hộ</option>
                  <option>phòng trọ</option>
                  <option>studio</option>
                  <option>nhà nguyên căn</option>
                </select>
              </label>
              <label>
                Số phòng ngủ chính xác
                <input
                  name="bedrooms"
                  type="number"
                  min="0"
                  max="20"
                  placeholder="Không yêu cầu"
                />
              </label>
              <label>
                Diện tích tối thiểu · m²
                <input
                  name="area"
                  type="number"
                  min="0"
                  placeholder="Không yêu cầu"
                />
              </label>
              <label>
                Tiện nghi cần có
                <input
                  name="amenities"
                  placeholder="Ví dụ: chỗ để xe, điều hòa"
                />
              </label>
            </div>
          </>
        )}
        {kind === "flight" && (
          <>
            <p className="muted">
              Tìm kiếm giá chuyến bay một chiều. Hệ thống hiện chưa hỗ trợ xuất
              vé.
            </p>
            <div className="form-grid">
              <label>
                Nơi đi
                <input name="from" placeholder="Hà Nội hoặc HAN" required />
              </label>
              <label>
                Nơi đến
                <input name="to" placeholder="Đà Nẵng hoặc DAD" required />
              </label>
              <label>
                Ngày bay
                <input name="date" type="date" required />
              </label>
              <label>
                Người lớn
                <input
                  name="adults"
                  type="number"
                  min="1"
                  max="9"
                  defaultValue="1"
                  required
                />
              </label>
            </div>
          </>
        )}
        {kind === "map" && <MapFields />}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Hủy
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Đang gửi…" : "Áp dụng"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
// Directions only: amenities are a filter of the home search, not a service of their own.
function MapFields() {
  return (
    <div className="form-grid">
      <label>
        Điểm đi
        <input
          name="from"
          placeholder="Tên địa điểm hoặc căn nhà đã chọn"
          required
        />
      </label>
      <label>
        Điểm đến
        <input name="to" placeholder="Nơi bạn muốn tới" required />
      </label>
      <label>
        Thành phố
        <select name="city">
          {cities.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        Phương tiện
        <select name="profile">
          <option>đi bộ</option>
          <option>xe máy</option>
          <option>ô tô</option>
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
          <h3>Phương án cần bạn xác nhận</h3>
          <p>Kiểm tra thao tác và chi phí trước khi tiếp tục.</p>
        </div>
      </div>
      {Object.keys(pending.pii_required || {}).length > 0 && (
        <MovingSteps stage={2} />
      )}
      {Object.entries(pending.moving_details || {}).map(([id, detail]) => (
        <div className="mv-approval-route" key={id}>
          <p>
            <MapPin size={15} />
            <b>A · Lấy đồ</b>
            <span>{(detail as Data).from_address}</span>
          </p>
          <p>
            <MapPin size={15} />
            <b>B · Giao đồ</b>
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
            )[action.kind] || "Thao tác chưa được giao diện hỗ trợ"}
          </li>
        ))}
      </ul>
      {Object.values(pending.notes || {}).map((v, i) => (
        <p className="notice" key={i}>
          {String(v)}
        </p>
      ))}
      <small className="muted">
        Có hiệu lực đến {dateTime(pending.expires_at)}
      </small>
      {pending.last_error && (
        <p className="notice error">{pending.last_error}</p>
      )}
      {expired && (
        <p className="notice amber">
          Phương án đã hết hạn. Hãy yêu cầu phương án mới.
        </p>
      )}
      {unsupported && (
        <p className="notice amber">
          Phương án có thao tác chưa được giao diện hỗ trợ. Hãy đổi phương án
          trước khi xác nhận.
        </p>
      )}
      {!enabled && (
        <p className="notice amber">
          Hiện chưa thể đặt hoặc sửa đơn trên hệ thống. Bạn vẫn có thể xem và
          đổi phương án.
        </p>
      )}
      <form ref={approvalForm} onSubmit={submit}>
        {Object.entries(pending.pii_required || {}).map(([id, fields]) => (
          <div key={id}>
            {(fields as string[]).map((field) => (
              <fieldset className="pin-form" key={field}>
                <legend>
                  {field === "pickup_contact"
                    ? "Liên hệ điểm lấy"
                    : field === "destination_contact"
                      ? "Liên hệ điểm giao"
                      : "Cập nhật liên hệ / ghi chú"}
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
                      <Copy size={14} /> Dùng liên hệ điểm lấy
                    </button>
                  )}
                {field === "order_update" && (
                  <label>
                    Điểm cần sửa
                    <select name={id + "|" + field + "|path_index"}>
                      <option value="0">Điểm lấy</option>
                      <option value="1">Điểm giao</option>
                    </select>
                  </label>
                )}
                <div className="form-grid">
                  <label>
                    Họ tên
                    <input
                      name={id + "|" + field + "|name"}
                      required={field !== "order_update"}
                      maxLength={150}
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    Số điện thoại
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
                        Tòa nhà
                        <input
                          name={`${id}|${field}|building`}
                          maxLength={200}
                          placeholder="Tên tòa nhà, nếu có"
                        />
                      </label>
                      <label>
                        Căn hộ / tầng
                        <input
                          name={`${id}|${field}|apartment_or_floor`}
                          maxLength={100}
                          placeholder="Ví dụ: tầng 3, căn 302"
                        />
                      </label>
                    </div>
                    <label>
                      Chỉ dẫn giao nhận
                      <textarea
                        name={`${id}|${field}|remarks`}
                        rows={2}
                        maxLength={500}
                        placeholder="Ví dụ: gọi khi tới cổng, có thang máy"
                      />
                    </label>
                  </div>
                )}
                {field === "order_update" && (
                  <label>
                    Ghi chú
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
          Thông tin liên hệ được gửi riêng để xử lý giao dịch.
        </p>
        <label className="checkbox">
          <input type="checkbox" required />
          Tôi đồng ý với toàn bộ thao tác và chi phí ở trên.
        </label>
        {error && (
          <p className="notice error" role="alert">
            {error}
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
            Từ chối
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setChange(!change)}
          >
            Đổi phương án
          </button>
          <button
            className="primary"
            disabled={busy || expired || !enabled || unsupported}
          >
            Xác nhận thao tác
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
            Bạn muốn thay đổi điều gì?
            <input
              name="change"
              required
              placeholder="Ví dụ: đổi thời gian sang 15 giờ"
            />
          </label>
          <button className="secondary" disabled={busy}>
            Gửi thay đổi
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
                ? "Đã đặt"
                : l.recurrence === "monthly"
                  ? "Khoản hằng tháng"
                  : "Khoản một lần"}
            </small>
          </span>
          <strong>
            {money(l.amount_vnd)}
            {l.max_amount_vnd != null && l.max_amount_vnd !== l.amount_vnd && (
              <small>Tối đa {money(l.max_amount_vnd)}</small>
            )}
          </strong>
        </div>
      ))}
      {summary && (
        <div className="cost-totals">
          <span>
            Dự kiến một lần <b>{money(summary.total_one_time_vnd)}</b>
          </span>
          <span>
            Dự kiến mỗi tháng <b>{money(summary.total_monthly_vnd)}</b>
          </span>
        </div>
      )}
    </div>
  );
}
