import { formatUi } from "../uiPreferences";
import { RequiredMark } from "./RequiredMark";
import { t as uiText } from "../uiPreferences";
import { useEffect, useState } from "react";
import {
  CreditCard,
  Box,
  Check,
  ChevronDown,
  Package,
  Sparkles,
  Plus,
  RefreshCw,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";
import { api, money } from "../api";
import type { Data } from "../types";
import {
  vehicleFamilies,
  vehicleFamily,
  vehicleCapacity,
} from "../movingCatalog";
import { VehicleGuide, VehicleIcon } from "./VehicleGuide";

export function MovingSteps({ stage }: { stage: number }) {
  return (
    <ol className="mv-steps" aria-label={uiText("Các bước chuyển đồ")}>
      {["Thông tin", "Báo giá", "Xác nhận"].map((label, i) => (
        <li
          key={uiText(label)}
          className={i === stage ? "active" : i < stage ? "done" : ""}
          aria-current={i === stage ? "step" : undefined}
        >
          <span>{i < stage ? <Check size={12} /> : i + 1}</span>
          {uiText(label)}
        </li>
      ))}
    </ol>
  );
}

export function MovingOptionsForm({
  value,
  onChange,
  pickup,
  onValidationChange,
  onRequestPickup,
}: {
  value: Data;
  onChange: (value: Data) => void;
  pickup?: Data | null;
  onValidationChange: (issue: string) => void;
  onRequestPickup?: () => void;
}) {
  const [services, setServices] = useState<Data[]>([]),
    [loading, setLoading] = useState(false),
    [received, setReceived] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [all, setAll] = useState(false),
    [family, setFamily] = useState<string | null>(null),
    [showServices, setShowServices] = useState(false),
    [advanced, setAdvanced] = useState(
      Boolean(
        value.require_pod || value.require_verification || value.promo_code,
      ),
    ),
    [guide, setGuide] = useState("");
  useEffect(() => {
    if (value.require_pod || value.require_verification || value.promo_code)
      setAdvanced(true);
  }, [value.require_pod, value.require_verification, value.promo_code]);
  useEffect(() => {
    const abort = new AbortController();
    setServices([]);
    setError("");
    setReceived(false);
    if (!pickup) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<Data>(
      `/moving/services?lat=${pickup.lat}&lng=${pickup.lng}&refresh=${retry > 0}`,
      "GET",
      undefined,
      abort.signal,
    )
      .then((r) => {
        if (!abort.signal.aborted) {
          setServices(r.services || []);
          setReceived(true);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [pickup?.lat, pickup?.lng, retry]);
  useEffect(() => {
    setFamily(null);
    setShowServices(false);
    setGuide("");
  }, [pickup?.lat, pickup?.lng]);
  const service = services.find((s) => s.service_id === value.service_id);
  const activeFamily = family ?? (service ? vehicleFamily(service) : "");
  const familyLabel =
    vehicleFamilies.find((f) => f.id === activeFamily)?.label || "AhaMove";
  const familyServices =
    activeFamily === "other"
      ? service
        ? [service]
        : []
      : services.filter((s) => vehicleFamily(s) === activeFamily);
  const sortedServices = [...familyServices].sort((a, b) => {
    const left = vehicleCapacity(a),
      right = vehicleCapacity(b);
    return (
      (left === "other" ? Infinity : Number(left)) -
      (right === "other" ? Infinity : Number(right))
    );
  });
  const visibleServices = showServices
    ? sortedServices
    : sortedServices.slice(0, 4);
  if (
    service &&
    vehicleFamily(service) === activeFamily &&
    !visibleServices.some((s) => s.service_id === service.service_id)
  )
    visibleServices.push(service);
  const requests: Data[] = service?.requests || [];
  const selected: Data[] = value.requests || [];
  const packages: Data[] = value.packages || [];
  useEffect(() => {
    let issue = "";
    if (family && !value.service_id)
      issue =
        "Hãy chọn gói dịch vụ cụ thể hoặc để ReloHome gợi ý trước khi lấy báo giá.";
    if (value.service_id) {
      if (!pickup) issue = "Hãy ghim lại điểm A để kiểm tra gói xe đã chọn.";
      else if (loading) issue = "Danh mục gói xe đang tải, hãy chờ một chút.";
      else if (error || !service)
        issue = "Hãy tải lại danh mục và chọn gói xe khả dụng tại điểm A.";
      else if (vehicleFamily(service) !== activeFamily)
        issue = "Hãy chọn gói xe thuộc loại xe đang chọn.";
      else if ((value.cod || 0) > (service.cod_limit ?? Infinity))
        issue = "Tiền thu hộ vượt giới hạn gói xe đã chọn.";
      else
        for (const choice of selected) {
          const item = requests.find(
            (r) => (r._id || r.request_id) === choice.request_id,
          );
          if (!item) {
            issue = "Dịch vụ thêm đã thay đổi, hãy chọn lại.";
            break;
          }
          for (const [key, list] of [
            ["tier_code", "tier_list"],
            ["option_id", "options"],
          ]) {
            if (
              (item[list] || []).length &&
              !(item[list] as Data[]).some(
                (c) =>
                  (c.code || c._id) === choice[key] &&
                  c.selectable !== false &&
                  !c.need_user_input,
              )
            ) {
              issue = `Hãy chọn mức hoặc loại hàng cho ${item.name_vi_vn || item.name}.`;
              break;
            }
          }
          if (issue) break;
        }
    }
    onValidationChange(issue);
  }, [
    value,
    pickup?.lat,
    pickup?.lng,
    services,
    loading,
    error,
    family,
    activeFamily,
    onValidationChange,
  ]);
  const update = (patch: Data) => onChange({ ...value, ...patch });
  function chooseService(id: string) {
    update({ service_id: id || undefined, requests: [], cod: undefined });
    setAll(false);
  }
  function chooseRequest(item: Data, patch?: Data) {
    const id = item._id || item.request_id;
    const previous = selected.find((r) => r.request_id === id);
    const next = selected.filter((r) => r.request_id !== id);
    if (patch) next.push({ request_id: id, ...previous, ...patch });
    update({ requests: next });
  }
  function packageField(index: number, field: string, v: string) {
    const next = [...packages];
    next[index] = {
      ...next[index],
      [field]:
        field === "description"
          ? v.trim()
            ? v
            : undefined
          : v === ""
            ? undefined
            : Number(v),
    };
    update({ packages: next });
  }
  return (
    <>
      <section className="mv-form-section" data-moving-section="cargo">
        <div className="mv-section-title">
          <Package size={18} />
          <div>
            <h3>{uiText("Đồ cần chuyển")}</h3>
            <p>{uiText("Khai kích thước để hãng kiểm tra gói xe phù hợp.")}</p>
          </div>
        </div>
        {packages.map((p, i) => (
          <fieldset className="mv-package" key={i}>
            <legend>
              {uiText("Kiện ")}
              {i + 1}
            </legend>
            <button
              type="button"
              className="icon-button mv-remove"
              aria-label={formatUi("Xóa kiện {0}", [i + 1])}
              onClick={() =>
                update({ packages: packages.filter((_, j) => j !== i) })
              }
            >
              <X size={15} />
            </button>
            <label>
              {uiText("Mô tả hàng")}
              <input
                aria-label={formatUi("Mô tả kiện {0}", [i + 1])}
                value={p.description || ""}
                maxLength={500}
                placeholder={uiText("Ví dụ: thùng quần áo, bàn làm việc")}
                onChange={(e) => packageField(i, "description", e.target.value)}
              />
            </label>
            <div className="mv-package-grid">
              {[
                ["weight_kg", "Nặng · kg"],
                ["length_cm", "Dài · cm"],
                ["width_cm", "Rộng · cm"],
                ["height_cm", "Cao · cm"],
              ].map(([key, label]) => (
                <label key={key}>
                  {uiText(label)}
                  <input
                    aria-label={formatUi("{0} kiện {1}", [
                      uiText(label),
                      i + 1,
                    ])}
                    type="number"
                    min="0.1"
                    max={key === "weight_kg" ? 100000 : 10000}
                    step="any"
                    value={p[key] ?? ""}
                    onChange={(e) => packageField(i, key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          className="mv-add-package"
          disabled={packages.length >= 100}
          onClick={() => update({ packages: [...packages, {}] })}
        >
          <Plus size={15} />
          {uiText(" Thêm kiện hàng")}
        </button>
        <div className="form-grid">
          <label>
            {uiText("Giá trị hàng · VND")}
            <input
              type="number"
              min="0"
              step="1000"
              value={value.item_value ?? ""}
              placeholder={uiText("Không khai giá")}
              onChange={(e) =>
                update({
                  item_value:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            {uiText("Tiền thu hộ · VND")}
            <input
              type="number"
              min="0"
              max={service?.cod_limit ?? undefined}
              step="1000"
              value={value.cod ?? ""}
              placeholder={uiText("Không thu hộ")}
              onChange={(e) =>
                update({
                  cod:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
            <small className="muted">
              {service?.cod_limit != null
                ? formatUi("Giới hạn gói xe: {0}", [money(service.cod_limit)])
                : uiText("Giới hạn được kiểm tra theo gói xe.")}
            </small>
          </label>
        </div>
      </section>
      <section className="mv-form-section" data-moving-section="vehicle">
        <div className="mv-section-title">
          <Truck size={18} />
          <div>
            <h3>{uiText("Gói xe & dịch vụ thêm")}</h3>
            <p>{uiText("Danh mục AhaMove tại đúng điểm lấy A.")}</p>
          </div>
        </div>
        {!pickup && (
          <div className="mv-catalog-pending" role="status">
            <strong>{uiText("Chọn điểm lấy để hiển thị gói xe")}</strong>
            <p>
              {uiText(
                "Ghim điểm A trên map để xem các gói xe và tùy chọn tại khu vực của bạn.",
              )}
            </p>
            {onRequestPickup && (
              <button
                type="button"
                className="secondary"
                onClick={onRequestPickup}
              >
                {uiText("Chọn điểm lấy đồ A")}
              </button>
            )}
          </div>
        )}
        {loading && (
          <p className="muted" role="status">
            {uiText("Đang tải gói xe AhaMove…")}
          </p>
        )}
        {(error || (received && !loading && services.length === 0)) && (
          <div className={"notice " + (error ? "error" : "amber")} role="alert">
            {error ||
              uiText(
                "Chưa có gói xe trong danh mục tại điểm A. Hãy kiểm tra lại điểm lấy hoặc tải lại danh mục.",
              )}
            <button
              type="button"
              className="text-button"
              onClick={() => setRetry((r) => r + 1)}
            >
              <RefreshCw size={14} />
              {uiText(" Tải lại danh mục")}
            </button>
          </div>
        )}
        {received && !error && services.length > 0 && (
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={() => setRetry((r) => r + 1)}
          >
            <RefreshCw size={14} />
            {uiText(" Tải lại danh mục")}
          </button>
        )}
        <div
          className="mv-vehicle-choices"
          role="group"
          aria-label={uiText("Loại xe AhaMove")}
        >
          <button
            type="button"
            className={!activeFamily && !value.service_id ? "selected" : ""}
            aria-pressed={!activeFamily && !value.service_id}
            onMouseEnter={() => setGuide("auto")}
            onFocus={() => setGuide("auto")}
            onClick={() => {
              if (activeFamily || value.service_id) {
                setFamily("");
                setShowServices(false);
                chooseService("");
              }
              setGuide("auto");
            }}
          >
            <Sparkles size={19} />
            <strong>{uiText("Để ReloHome gợi ý")}</strong>
          </button>
          {vehicleFamilies
            .filter((f) => services.some((s) => vehicleFamily(s) === f.id))
            .map((f) => (
              <button
                type="button"
                key={f.id}
                className={activeFamily === f.id ? "selected" : ""}
                aria-pressed={activeFamily === f.id}
                disabled={!pickup || loading || !!error}
                onMouseEnter={() => setGuide(f.id)}
                onFocus={() => setGuide(f.id)}
                onClick={() => {
                  if (activeFamily !== f.id) {
                    setFamily(f.id);
                    setShowServices(false);
                    chooseService("");
                  }
                  setGuide(f.id);
                }}
              >
                <VehicleIcon family={f.id} size={20} />
                <strong>{uiText(f.label)}</strong>
                {activeFamily === f.id && (
                  <Check
                    className="mv-vehicle-check"
                    size={13}
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
        </div>
        <p className="mv-vehicle-hint">
          {uiText("Bấm để chọn loại xe. Rê chuột để xem giới thiệu.")}
        </p>
        {!activeFamily && !value.service_id && (
          <p className="mv-inline-note">
            {uiText(
              "Sau khi bấm lấy báo giá, ReloHome so sánh các gói chuyển đồ tại điểm A để bạn chọn. Chưa đặt xe. Bạn cũng có thể tự chọn loại xe bên trên.",
            )}
          </p>
        )}
        {guide && <VehicleGuide family={guide} onClose={() => setGuide("")} />}
        {activeFamily && (
          <fieldset
            className="mv-service-picker"
            aria-label={uiText("Gói dịch vụ AhaMove")}
          >
            <legend>
              {formatUi("Các gói {0} tại điểm A", [uiText(familyLabel)])}
              <RequiredMark />
            </legend>
            <p className="muted small">
              {uiText(
                "Chọn cỡ xe phù hợp bên dưới. Bấm một gói để xem thông tin chở hàng của hãng.",
              )}
            </p>
            <div className="mv-service-cards">
              {visibleServices.map((s) => (
                <label
                  key={s.service_id}
                  className={
                    "mv-service-choice " +
                    (s.service_id === value.service_id ? "selected" : "")
                  }
                >
                  <input
                    type="radio"
                    name="ahamove-service"
                    value={s.service_id}
                    aria-label={`${s.name || s.service_id} · ${s.service_id}`}
                    checked={s.service_id === value.service_id}
                    disabled={!pickup || loading || !!error}
                    onChange={() => chooseService(s.service_id)}
                  />
                  <span>
                    <strong>{s.name || s.service_id}</strong>
                    {s.service_id === value.service_id && s.description && (
                      <span className="mv-service-description">
                        {s.description}
                      </span>
                    )}
                    {s.service_id === value.service_id && !s.description && (
                      <span className="mv-service-description">
                        {uiText("Hãng chưa cung cấp mô tả cho gói này.")}
                      </span>
                    )}
                    {s.service_id === value.service_id && (
                      <small>AhaMove · {s.service_id}</small>
                    )}
                  </span>
                </label>
              ))}
            </div>
            {sortedServices.length > 4 && (
              <button
                type="button"
                className="text-button mv-services-toggle"
                aria-expanded={showServices}
                onClick={() => setShowServices(!showServices)}
              >
                <ChevronDown size={15} />
                {showServices
                  ? uiText("Thu gọn gói xe")
                  : formatUi("Xem tất cả {0} gói xe", [sortedServices.length])}
              </button>
            )}
          </fieldset>
        )}
        {activeFamily && (
          <p className="mv-inline-note">
            {uiText(
              "Các gói và tải trọng lấy từ danh mục tại điểm A. Khai kích thước hàng để hãng kiểm tra khả năng phục vụ.",
            )}
          </p>
        )}
        {value.service_id && !loading && !error && !service && (
          <p className="notice amber">
            {uiText(
              "Gói xe cũ không còn trong danh mục của điểm A. Hãy chọn lại.",
            )}
          </p>
        )}
        {service && requests.length === 0 && (
          <p className="muted small">
            {uiText("Hãng chưa công bố tùy chọn thêm cho gói này.")}
          </p>
        )}
        <div className="mv-addon-list">
          {(all ? requests : requests.slice(0, 5)).map((item) => {
            const id = item._id || item.request_id,
              choice = selected.find((r) => r.request_id === id);
            const tiers: Data[] = item.tier_list || [],
              options: Data[] = item.options || [];
            const name = item.name_vi_vn || item.name || id;
            return (
              <div
                key={id}
                className={"mv-addon " + (choice ? "selected" : "")}
              >
                <label className="mv-addon-check">
                  <input
                    type="checkbox"
                    checked={!!choice}
                    onChange={(e) =>
                      chooseRequest(
                        item,
                        e.target.checked
                          ? {
                              ...(item.type === "PER_UNIT"
                                ? { quantity: 1 }
                                : {}),
                            }
                          : undefined,
                      )
                    }
                  />
                  <span>
                    <strong>{name}</strong>
                    <small>
                      {item.type === "PER_UNIT" &&
                      typeof item.price === "number"
                        ? formatUi("{0} / đơn vị · tham khảo", [
                            money(item.price),
                          ])
                        : item.type === "BOOLEAN" &&
                            typeof item.price === "number" &&
                            item.price > 0
                          ? formatUi("{0} · tham khảo", [money(item.price)])
                          : uiText("Phí theo báo giá của hãng")}
                    </small>
                  </span>
                </label>
                {choice && (
                  <div className="mv-addon-details">
                    {(item.description_vi_vn || item.description) && (
                      <p>{item.description_vi_vn || item.description}</p>
                    )}
                    {item.type === "PER_UNIT" && (
                      <label>
                        {uiText("Số lượng · ")}
                        {name}
                        <input
                          type="number"
                          min="1"
                          max="1000"
                          step="1"
                          value={choice.quantity ?? 1}
                          onChange={(e) =>
                            chooseRequest(item, {
                              quantity: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    )}
                    {[
                      ["tier_code", tiers, "Mức dịch vụ"],
                      ["option_id", options, "Loại hàng / tùy chọn"],
                    ].map(
                      ([key, choices, label]) =>
                        (choices as Data[]).length > 0 && (
                          <label key={String(key)}>
                            {String(label)} · {name}
                            <select
                              value={choice[String(key)] || ""}
                              onChange={(e) =>
                                chooseRequest(item, {
                                  [String(key)]: e.target.value || undefined,
                                })
                              }
                            >
                              <option value="">
                                {uiText("Chọn ")}
                                {String(label).toLowerCase()}
                              </option>
                              {(choices as Data[]).map((c) => (
                                <option
                                  key={c.code || c._id}
                                  value={c.code || c._id}
                                  disabled={
                                    c.selectable === false || c.need_user_input
                                  }
                                >
                                  {c.name_vi_vn || c.name || c.code}
                                  {c.description_vi_vn
                                    ? ` · ${c.description_vi_vn}`
                                    : ""}
                                  {typeof c.price === "number" && c.price >= 0
                                    ? ` · ${money(c.price)}`
                                    : ""}
                                  {c.selectable === false || c.need_user_input
                                    ? uiText(" · chưa hỗ trợ lựa chọn này")
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {requests.length > 5 && (
          <button
            type="button"
            className="text-button"
            aria-expanded={all}
            onClick={() => setAll(!all)}
          >
            <ChevronDown size={15} />
            {all
              ? uiText("Thu gọn tùy chọn")
              : formatUi("Xem tất cả {0} tùy chọn", [requests.length])}
          </button>
        )}
        {selected.length > 0 && (
          <small className="mv-inline-note">
            {uiText("Đã chọn ")}
            {selected.length}
            {uiText(" dịch vụ thêm. Tổng phí sẽ được AhaMove tính lại.")}
          </small>
        )}
      </section>
      <section className="mv-form-section" data-moving-section="delivery">
        <div className="mv-section-title">
          <ShieldCheck size={18} />
          <div>
            <h3>{uiText("Yêu cầu giao nhận")}</h3>
            <p>{uiText("Thông tin gửi cùng yêu cầu báo giá.")}</p>
          </div>
        </div>
        <label>
          {uiText("Ghi chú cho tài xế")}
          <textarea
            aria-label={uiText("Ghi chú cho tài xế")}
            rows={3}
            maxLength={1000}
            value={value.remarks || ""}
            placeholder={uiText(
              "Ví dụ: hàng đã đóng thùng, xe vào cổng sau. Tên/SĐT nhập ở bước xác nhận.",
            )}
            onChange={(e) => update({ remarks: e.target.value || undefined })}
          />
        </label>
        <details
          className="mv-optional"
          open={advanced}
          onToggle={(event) => setAdvanced(event.currentTarget.open)}
        >
          <summary>{uiText("Tùy chọn giao nhận (không bắt buộc)")}</summary>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!value.require_pod}
              onChange={(e) => update({ require_pod: e.target.checked })}
            />{" "}
            {uiText("Yêu cầu bằng chứng giao hàng")}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!value.require_verification}
              onChange={(e) =>
                update({ require_verification: e.target.checked })
              }
            />{" "}
            {uiText("Yêu cầu xác minh khi giao")}
          </label>
          <label>
            {uiText("Mã khuyến mãi")}
            <input
              maxLength={100}
              value={value.promo_code || ""}
              placeholder={uiText("Nhập mã nếu có")}
              onChange={(e) =>
                update({ promo_code: e.target.value.trim() || undefined })
              }
            />
          </label>
        </details>
      </section>
      <section className="mv-payment-tile">
        <CreditCard size={22} />
        <div>
          <strong>{uiText("Thanh toán trong app")}</strong>
          <p>
            {uiText(
              "Sau khi chọn gói xe, thanh toán qua ZaloPay sandbox. Bản demo không tạo đơn AhaMove; chưa thu tiền ở bước báo giá.",
            )}
          </p>
        </div>
        <Check size={17} />
      </section>
      <p className="mv-contact-hint">
        <Box size={15} />
        {uiText(
          " Bản demo không cần tên/SĐT người gửi, người nhận: không có đơn thật nào được tạo.",
        )}
      </p>
    </>
  );
}

export function validateMovingForm(value: Data): string | undefined {
  for (const p of value.packages || []) {
    if (
      !Number.isFinite(p.weight_kg) ||
      p.weight_kg <= 0 ||
      p.weight_kg > 100000
    )
      return "Hãy nhập khối lượng hợp lệ cho từng kiện hàng.";
    for (const k of ["length_cm", "width_cm", "height_cm"])
      if (p[k] != null && (!Number.isFinite(p[k]) || p[k] <= 0 || p[k] > 10000))
        return "Kích thước kiện hàng phải lớn hơn 0 và không quá 10.000 cm.";
  }
  for (const k of ["cod", "item_value"])
    if (value[k] != null && (!Number.isSafeInteger(value[k]) || value[k] < 0))
      return "Tiền thu hộ và giá trị hàng phải là số nguyên không âm.";
  for (const r of value.requests || [])
    if (
      r.quantity != null &&
      (!Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > 1000)
    )
      return "Số lượng dịch vụ thêm phải từ 1 đến 1.000.";
}

export function MovingQuoteSummary({
  options,
  labels = [],
}: {
  options: Data;
  labels?: Data[];
}) {
  const packages: Data[] = options.packages || [];
  const requests: Data[] = options.requests || [];
  if (
    !packages.length &&
    !requests.length &&
    !options.item_value &&
    !options.cod &&
    !options.remarks &&
    !options.promo_code &&
    !options.require_pod &&
    !options.require_verification
  )
    return null;
  return (
    <section
      className="mv-quote-summary"
      aria-label={uiText(" Yêu cầu đã báo giá")}
    >
      <h4>
        <Package size={16} />
        {uiText(" Yêu cầu đã báo giá")}
      </h4>
      {packages.map((p, i) => (
        <p key={i}>
          {p.description || `Kiện ${i + 1}`} · {p.weight_kg} kg
          {p.length_cm && p.width_cm && p.height_cm
            ? ` · ${p.length_cm} × ${p.width_cm} × ${p.height_cm} cm`
            : ""}
        </p>
      ))}
      {requests.map((r) => (
        <p key={r.request_id}>
          <Check size={12} />{" "}
          {labels.find((x) => x.id === r.request_id)?.label || r.request_id}
          {r.quantity ? ` × ${r.quantity}` : ""}
          {r.tier_code ? ` · ${r.tier_code}` : ""}
        </p>
      ))}
      {options.item_value != null && (
        <p>
          {uiText("Giá trị hàng: ")}
          {money(options.item_value)}
        </p>
      )}
      {options.cod != null && (
        <p>
          {uiText("Thu hộ: ")}
          {money(options.cod)}{" "}
          <small>{uiText("· tách biệt cước vận chuyển")}</small>
        </p>
      )}
      {options.require_pod && <p>{uiText("Yêu cầu bằng chứng giao hàng")}</p>}
      {options.require_verification && (
        <p>{uiText("Yêu cầu xác minh khi giao")}</p>
      )}
      {options.remarks && (
        <p>
          {uiText("Ghi chú: ")}
          {options.remarks}
        </p>
      )}
      {options.promo_code && (
        <p>
          {uiText("Mã khuyến mãi: ")}
          {options.promo_code}
          {uiText(" · mức giảm theo báo giá")}
        </p>
      )}
    </section>
  );
}
