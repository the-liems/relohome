import { useEffect, useRef, useState } from "react";
import type { Map, Marker } from "maplibre-gl";
import { CheckCircle2, MapPin, Search } from "lucide-react";
import { t } from "../uiPreferences";
import { housingManagement } from "./client";
import { tuneBasemap } from "../mapStyle";

export interface AddressSelection {
  address: string;
  location: { lat: number; lng: number } | null;
  location_token?: string;
  components?: Record<string, string>;
  confirmed: boolean;
  private_detail?: string;
  confirmation_token?: string;
}
export function PrivateLocationMap({
  lat,
  lng,
  onMove,
}: {
  lat: number;
  lng: number;
  onMove?: (point: { lat: number; lng: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<Map | null>(null),
    marker = useRef<Marker | null>(null);
  const [error, setError] = useState("");
  const move = useRef(onMove);
  move.current = onMove;
  const coordinates = useRef({ lat, lng });
  coordinates.current = { lat, lng };
  const editable = Boolean(onMove);
  useEffect(() => {
    let cancelled = false;
    void import("maplibre-gl").then((lib) => {
      if (cancelled || !container.current) return;
      try {
        lib.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        const point = coordinates.current;
        const current = new lib.Map({
          container: container.current,
          style: "https://tiles.openfreemap.org/styles/positron",
          center: [point.lng, point.lat],
          zoom: 16,
          attributionControl: { compact: true },
        });
        current.on("style.load", () => tuneBasemap(current));
        current.addControl(new lib.NavigationControl({ showCompass: false }));
        current.on("error", () =>
          setError(
            t("Chưa tải được một phần bản đồ. Tọa độ đã chọn vẫn được giữ."),
          ),
        );
        marker.current = new lib.Marker({
          color: "#176e69",
          draggable: Boolean(move.current),
        })
          .setLngLat([point.lng, point.lat])
          .addTo(current);
        const pin = marker.current;
        if (move.current) {
          const update = () => {
            const point = pin.getLngLat();
            move.current?.({ lat: point.lat, lng: point.lng });
          };
          pin.on("dragend", update);
          current.on("click", (event) => {
            if (pin.getElement().contains(event.originalEvent.target as Node))
              return;
            pin.setLngLat(event.lngLat);
            update();
          });
          const control = pin.getElement();
          control.tabIndex = 0;
          control.setAttribute("role", "button");
          control.setAttribute(
            "aria-label",
            t("Điều chỉnh ghim cửa chính bằng phím mũi tên"),
          );
          control.addEventListener("keydown", (event) => {
            if (
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const point = pin.getLngLat(),
              step = event.shiftKey ? 0.0001 : 0.00002;
            pin.setLngLat([
              point.lng +
                (event.key === "ArrowRight"
                  ? step
                  : event.key === "ArrowLeft"
                    ? -step
                    : 0),
              point.lat +
                (event.key === "ArrowUp"
                  ? step
                  : event.key === "ArrowDown"
                    ? -step
                    : 0),
            ]);
            update();
          });
        }
        map.current = current;
      } catch {
        setError(
          t(
            "Thiết bị chưa hiển thị được bản đồ. Hãy kiểm tra lại địa chỉ và tọa độ.",
          ),
        );
      }
    });
    return () => {
      cancelled = true;
      marker.current?.remove();
      map.current?.remove();
      map.current = null;
    };
  }, [editable]);
  useEffect(() => {
    marker.current?.setLngLat([lng, lat]);
    map.current?.jumpTo({ center: [lng, lat] });
  }, [lat, lng]);
  return (
    <div className="ll-location-preview">
      <div
        ref={container}
        className="ll-private-map"
        aria-label={t("Bản đồ xem trước vị trí nhà")}
      />
      <p className="ll-form-hint">
        <MapPin size={14} /> {lat.toFixed(6)}, {lng.toFixed(6)} ·{" "}
        {t("Vị trí riêng tư: chỉ chủ nhà và Admin thấy tọa độ này.")}
      </p>
      {error && (
        <p className="ll-form-hint" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
export function LocationPicker({
  value,
  onChange,
}: {
  value: AddressSelection;
  onChange: (value: AddressSelection) => void;
}) {
  const [results, setResults] = useState<{ ref_id: string; display: string }[]>(
      [],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const operation = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const current = useRef(value);
  current.current = value;
  useEffect(
    () => () => {
      clearTimeout(searchTimer.current);
      ++operation.current;
    },
    [],
  );
  async function confirm() {
    if (!value.location_token || !value.location) return;
    const version = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const result = await housingManagement<{ location_token: string }>(
        "landlord/locations/confirm",
        "POST",
        {
          location_token: value.location_token,
          location: value.location,
          private_detail: value.private_detail || "",
        },
      );
      if (version === operation.current)
        onChange({
          ...current.current,
          confirmation_token: result.location_token,
          confirmed: true,
        });
    } catch (cause) {
      if (version === operation.current) setError((cause as Error).message);
    } finally {
      if (version === operation.current) setBusy(false);
    }
  }
  async function search(text = current.current.address) {
    clearTimeout(searchTimer.current);
    const version = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const found = await housingManagement<{ results: typeof results }>(
        "landlord/locations/search?text=" + encodeURIComponent(text),
      );
      if (version === operation.current) {
        setResults(found.results);
        if (!found.results.length)
          setError(
            t(
              "Chưa tìm thấy địa chỉ. Hãy thêm số nhà, tên đường và tỉnh/thành.",
            ),
          );
      }
    } catch (cause) {
      if (version === operation.current) setError((cause as Error).message);
    } finally {
      if (version === operation.current) setBusy(false);
    }
  }
  async function choose(ref: string) {
    const version = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const found = await housingManagement<{
        address: string;
        location: { lat: number; lng: number };
        location_token: string;
        components: Record<string, string>;
      }>("landlord/locations/resolve", "POST", { ref_id: ref });
      if (version === operation.current) {
        clearTimeout(searchTimer.current);
        onChange({
          ...found,
          private_detail: value.private_detail || "",
          confirmed: false,
        });
        setResults([]);
      }
    } catch (cause) {
      if (version === operation.current) setError((cause as Error).message);
    } finally {
      if (version === operation.current) setBusy(false);
    }
  }
  return (
    <div className="ll-address-picker wide">
      <label>
        {t("Địa chỉ đầy đủ")}
        <span className="ll-inline-search">
          <input
            required
            value={value.address}
            maxLength={220}
            placeholder={t("Số nhà, đường, phường/xã, tỉnh/thành")}
            onChange={(event) => {
              ++operation.current;
              setBusy(false);
              setResults([]);
              setError("");
              clearTimeout(searchTimer.current);
              const text = event.target.value;
              if (text.trim().length >= 3)
                searchTimer.current = setTimeout(() => void search(text), 500);
              onChange({
                address: text,
                private_detail: value.private_detail,
                location: null,
                confirmed: false,
              });
            }}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => void search()}
            disabled={busy || value.address.trim().length < 3}
          >
            <Search size={16} />
            {t(busy ? "Đang tìm…" : "Tìm vị trí")}
          </button>
        </span>
      </label>
      {results.length > 0 && (
        <div className="ll-place-results" aria-label={t("Địa chỉ gợi ý")}>
          {results.map((result) => (
            <button
              key={result.ref_id}
              type="button"
              disabled={busy}
              onClick={() => void choose(result.ref_id)}
            >
              <MapPin size={16} />
              {result.display}
            </button>
          ))}
        </div>
      )}
      {value.location_token && (
        <label>
          {t("Căn, tầng, tòa nhà (địa chỉ riêng)")}
          <input
            maxLength={300}
            value={value.private_detail || ""}
            placeholder={t("Ví dụ: Căn 1208, Tòa S2.01")}
            onChange={(event) => {
              ++operation.current;
              setBusy(false);
              onChange({
                ...value,
                private_detail: event.target.value,
                confirmed: false,
                confirmation_token: undefined,
              });
            }}
          />
        </label>
      )}
      <details className="ll-manual-location">
        <summary>
          {t(
            value.location_token
              ? "Tinh chỉnh tọa độ cửa chính"
              : "Nhập tọa độ để lưu nháp",
          )}
        </summary>
        <p className="ll-form-hint">
          {t(
            value.location_token
              ? "Có thể kéo ghim, bấm trên bản đồ hoặc nhập tọa độ để đặt đúng cửa chính, rồi xác nhận lại."
              : "Tọa độ nhập tay chỉ dùng cho bản nháp. Chọn kết quả Vietmap trước khi gửi duyệt.",
          )}
        </p>
        <div className="ll-inline-search">
          {(
            [
              ["lat", "Vĩ độ", 8, 24],
              ["lng", "Kinh độ", 102, 110],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key}>
              {t(label)}
              <input
                type="number"
                step="any"
                min={min}
                max={max}
                value={value.location?.[key] ?? ""}
                onChange={(event) => {
                  const point = {
                    ...(value.location || { lat: NaN, lng: NaN }),
                    [key]:
                      event.target.value === ""
                        ? NaN
                        : Number(event.target.value),
                  };
                  onChange({
                    ...value,
                    location: point,
                    confirmation_token: undefined,
                    confirmed: false,
                  });
                }}
              />
            </label>
          ))}
        </div>
      </details>
      {value.location &&
        Number.isFinite(value.location.lat) &&
        Number.isFinite(value.location.lng) && (
          <>
            {value.location_token && (
              <p className="ll-review-note">
                {t(
                  "Hãy kéo chiếc ghim này đặt đúng vào vị trí cửa chính căn hộ của bạn.",
                )}
              </p>
            )}
            <PrivateLocationMap
              onMove={
                value.location_token
                  ? (point) => {
                      ++operation.current;
                      setBusy(false);
                      onChange({
                        ...current.current,
                        location: point,
                        confirmed: false,
                        confirmation_token: undefined,
                      });
                    }
                  : undefined
              }
              lat={value.location.lat}
              lng={value.location.lng}
            />
            {(value.location_token || value.confirmed) && (
              <label className="checkbox ll-location-confirm">
                <input
                  type="checkbox"
                  checked={value.confirmed}
                  disabled={busy}
                  onChange={(event) => {
                    if (event.target.checked) void confirm();
                    else
                      onChange({
                        ...value,
                        confirmed: false,
                        confirmation_token: undefined,
                      });
                  }}
                />
                <CheckCircle2 size={17} />
                {t("Tôi đã kiểm tra địa chỉ và vị trí trên bản đồ")}
              </label>
            )}
          </>
        )}
      {!value.confirmed && (
        <p className="ll-form-hint">
          {t(
            "Bạn có thể lưu nháp. Chọn và xác nhận vị trí trước khi gửi duyệt.",
          )}
        </p>
      )}
      {error && (
        <p className="ll-form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
