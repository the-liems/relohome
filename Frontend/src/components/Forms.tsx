import { useEffect, useState } from "react";
import { MapPin, Search, ShieldCheck, ArrowRight, Check } from "lucide-react";
import { api, dateTime, money } from "../api";
import type { Data, House } from "../types";
import { Dialog } from "./Dialog";
import { MapPanel } from "./MapPanel";

const cities = ["Hà Nội", "Đà Nẵng", "Thành phố Hồ Chí Minh"];
export function LocationPicker({
  onUse,
  onClose,
}: {
  onUse: (p: Data) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Data[]>([]),
    [selected, setSelected] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSelected(null);
    setResults([]);
    try {
      const r = await api<Data>(
        "/map/search?text=" + encodeURIComponent(query),
      );
      setResults(r.candidates || r.results || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Chọn địa điểm" onClose={onClose}>
      <form className="search-row" onSubmit={search}>
        <Search size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tên đường, địa điểm, thành phố…"
          minLength={2}
          required
          autoFocus
        />
        <button className="primary" disabled={busy}>
          Tìm
        </button>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="place-list">
        {results.map((r, i) => (
          <button
            className={selected === r ? "place active" : "place"}
            key={r.id || r.entity_id || i}
            onClick={() => setSelected(r)}
          >
            <MapPin size={18} />
            <span>
              <strong>{r.name || r.label || r.text || "Địa điểm"}</strong>
              <small>
                {typeof r.address === "string"
                  ? r.address
                  : [r.address?.district, r.address?.city]
                      .filter(Boolean)
                      .join(", ")}{" "}
                {["area", "administrative_area"].includes(r.entity_type)
                  ? "· Khu vực hành chính"
                  : ""}
              </small>
            </span>
            {selected === r && <Check size={16} />}
          </button>
        ))}
      </div>
      {results.length === 0 && !busy && (
        <p className="muted">
          Tìm địa điểm rồi kiểm tra vị trí trước khi sử dụng.
        </p>
      )}
      {selected?.location && (
        <MapPanel
          points={[selected]}
          onPick={(lat, lng) =>
            setSelected({
              ...selected,
              entity_type: "coordinate",
              location: { lat, lng },
            })
          }
        />
      )}
      <p className="muted">
        Chọn điểm trên bản đồ để chỉnh vị trí. Điểm lấy/giao đồ cần được bạn xác
        nhận lại trong form.
      </p>
      <button
        className="primary full"
        disabled={
          !selected?.location ||
          ["area", "administrative_area"].includes(selected?.entity_type)
        }
        onClick={() =>
          onUse({
            ...selected,
            address:
              typeof selected?.address === "string"
                ? selected.address
                : selected?.name,
          })
        }
      >
        Dùng địa điểm này <ArrowRight size={16} />
      </button>
    </Dialog>
  );
}

export function TaskForm({
  kind,
  onClose,
  onSubmit,
  house,
}: {
  kind: string;
  onClose: () => void;
  onSubmit: (text: string, extra?: Data) => Promise<void>;
  house?: House;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [picker, setPicker] = useState<string | null>(null);
  const [pins, setPins] = useState<Data>({
    pickup: { address: "", lat: "", lng: "", confirmed: false },
    destination: {
      address: house?.address || "",
      lat: house?.lat ?? "",
      lng: house?.lng ?? "",
      confirmed: false,
    },
  });
  const title: Record<string, string> = {
    property: "Bạn muốn tìm ngôi nhà như thế nào?",
    flight: "Tìm chuyến bay cho hành trình của bạn",
    relocation: "Sắp xếp chuyến chuyển đồ",
    map: "Khám phá đường đi & tiện ích",
  };
  function changePin(key: string, field: string, value: any) {
    setPins((p) => ({
      ...p,
      [key]: {
        ...p[key],
        [field]: value,
        confirmed: field === "confirmed" ? value : false,
      },
    }));
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    setError("");
    let text = "",
      extra: Data = {};
    if (kind === "property") {
      if (f.min && f.max && Number(f.min) > Number(f.max)) {
        setError("Giá tối thiểu phải nhỏ hơn hoặc bằng giá tối đa.");
        return;
      }
      text = `Tìm ${f.type || "nhà cho thuê"} tại ${f.district ? f.district + ", " : ""}${f.city}${f.min ? ", giá từ " + f.min + " đồng/tháng" : ""}${f.max ? ", không quá " + f.max + " đồng/tháng" : ""}${f.bedrooms ? ", có đúng " + f.bedrooms + " phòng ngủ" : ""}${f.area ? ", diện tích ít nhất " + f.area + " m²" : ""}${f.amenities ? ", cần " + f.amenities : ""}.`;
    }
    if (kind === "flight") {
      if (new Date(f.date + "T23:59:59") < new Date()) {
        setError("Hãy chọn ngày bay trong tương lai.");
        return;
      }
      text = `Tìm chuyến bay một chiều từ ${f.from} đến ${f.to} ngày ${f.date}, cho ${f.adults} người lớn. Chỉ tìm chuyến.`;
    }
    if (kind === "relocation") {
      if (new Date(f.date + "T" + f.time) < new Date()) {
        setError("Hãy chọn thời gian chuyển đồ trong tương lai.");
        return;
      }
      text = `Báo giá chuyển đồ từ ${pins.pickup.address} đến ${pins.destination.address} ngày ${f.date} lúc ${f.time}. Chưa đặt đơn.`;
      const locations: Data = {};
      for (const key of ["pickup", "destination"]) {
        const p = pins[key];
        if (p.confirmed && p.lat !== "" && p.lng !== "")
          locations[key] = {
            address: p.address,
            lat: Number(p.lat),
            lng: Number(p.lng),
            confirmed: true,
          };
      }
      extra = { moving_locations: locations };
    }
    if (kind === "map") {
      text =
        f.mode === "nearby"
          ? `Tìm ${f.categories} quanh ${f.near} trong bán kính ${f.radius} mét.`
          : `Tính đường ${f.profile} từ ${f.from} đến ${f.to} tại ${f.city}.`;
    }
    setBusy(true);
    try {
      await onSubmit(text, extra);
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
        {kind === "relocation" && (
          <>
            <p className="muted">
              Báo giá từ AhaMove staging · trả tiền mặt. Xác nhận đúng điểm xe
              dừng nếu dùng pin.
            </p>
            {["pickup", "destination"].map((key, i) => (
              <fieldset key={key} className="pin-form">
                <legend>
                  <span className="step-dot">{i + 1}</span>
                  {i === 0 ? "Lấy đồ tại" : "Giao đến"}
                </legend>
                <div className="search-row">
                  <input
                    aria-label={i === 0 ? "Địa chỉ lấy đồ" : "Địa chỉ giao đồ"}
                    value={pins[key].address}
                    required
                    onChange={(e) => changePin(key, "address", e.target.value)}
                    placeholder="Số nhà, đường, thành phố"
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={
                      "Chọn " +
                      (i === 0 ? "điểm lấy" : "điểm giao") +
                      " trên bản đồ"
                    }
                    onClick={() => setPicker(key)}
                  >
                    <MapPin size={18} />
                  </button>
                </div>
                <div className="form-grid">
                  <label>
                    Vĩ độ
                    <input
                      type="number"
                      min="-90"
                      max="90"
                      step="any"
                      value={pins[key].lat}
                      onChange={(e) => changePin(key, "lat", e.target.value)}
                    />
                  </label>
                  <label>
                    Kinh độ
                    <input
                      type="number"
                      min="-180"
                      max="180"
                      step="any"
                      value={pins[key].lng}
                      onChange={(e) => changePin(key, "lng", e.target.value)}
                    />
                  </label>
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={pins[key].confirmed}
                    disabled={pins[key].lat === "" || pins[key].lng === ""}
                    onChange={(e) =>
                      changePin(key, "confirmed", e.target.checked)
                    }
                  />
                  Tôi đã kiểm tra đúng điểm xe dừng
                </label>
              </fieldset>
            ))}
            <div className="form-grid">
              <label>
                Ngày chuyển
                <input type="date" name="date" required />
              </label>
              <label>
                Giờ lấy đồ
                <input type="time" name="time" required />
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
            {busy
              ? "Đang gửi…"
              : kind === "relocation"
                ? "Lấy báo giá"
                : "Áp dụng"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
      {picker && (
        <LocationPicker
          onClose={() => setPicker(null)}
          onUse={(p) => {
            setPins((old) => ({
              ...old,
              [picker]: {
                address: p.address,
                lat: p.location.lat,
                lng: p.location.lng,
                confirmed: false,
              },
            }));
            setPicker(null);
          }}
        />
      )}
    </Dialog>
  );
}
function MapFields() {
  const [mode, setMode] = useState("route");
  return (
    <>
      <div className="segmented">
        <button
          type="button"
          className={mode === "route" ? "active" : ""}
          onClick={() => setMode("route")}
        >
          Tuyến đường
        </button>
        <button
          type="button"
          className={mode === "nearby" ? "active" : ""}
          onClick={() => setMode("nearby")}
        >
          Tiện ích gần đây
        </button>
      </div>
      <input type="hidden" name="mode" value={mode} />
      {mode === "route" ? (
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
      ) : (
        <div className="form-grid">
          <label>
            Quanh địa điểm
            <input name="near" placeholder="Ví dụ: căn nhà đã chọn" required />
          </label>
          <label>
            Loại tiện ích
            <select name="categories">
              <option>bệnh viện và nhà thuốc</option>
              <option>siêu thị</option>
              <option>trường học</option>
              <option>quán cà phê</option>
            </select>
          </label>
          <label>
            Bán kính · mét
            <input
              name="radius"
              type="number"
              min="100"
              max="20000"
              defaultValue="1000"
              required
            />
          </label>
        </div>
      )}
    </>
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
        } else
          forms[id][field] = {
            name: data[prefix + "name"],
            mobile: data[prefix + "mobile"],
          };
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
      <form onSubmit={submit}>
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
                    />
                  </label>
                </div>
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
