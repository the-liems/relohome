import { RequiredMark } from "../components/RequiredMark";
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
}
export function PrivateLocationMap({ lat, lng }: { lat: number; lng: number }) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<Map | null>(null),
    marker = useRef<Marker | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void import("maplibre-gl").then((lib) => {
      if (cancelled || !container.current) return;
      try {
        lib.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        const current = new lib.Map({
          container: container.current,
          style: "https://tiles.openfreemap.org/styles/positron",
          center: [lng, lat],
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
        marker.current = new lib.Marker({ color: "#176e69" })
          .setLngLat([lng, lat])
          .addTo(current);
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
  }, []);
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
        {t("Vị trí gần đúng; hãy đối chiếu địa chỉ thực tế.")}
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
  async function search() {
    const version = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const found = await housingManagement<{ results: typeof results }>(
        "landlord/locations/search?text=" + encodeURIComponent(value.address),
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
        onChange({ ...found, confirmed: false });
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
        <span className="field-label">{t("Địa chỉ đầy đủ")}<RequiredMark /></span>
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
              onChange({
                address: event.target.value,
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
      <details className="ll-manual-location">
        <summary>{t("Nhập tọa độ để lưu nháp")}</summary>
        <p className="ll-form-hint">
          {t(
            "Tọa độ nhập tay chỉ dùng cho bản nháp. Chọn kết quả Vietmap trước khi gửi duyệt.",
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
                    location_token: undefined,
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
            <PrivateLocationMap
              lat={value.location.lat}
              lng={value.location.lng}
            />
            {(value.location_token || value.confirmed) && (
              <label className="checkbox ll-location-confirm">
                <input
                  type="checkbox"
                  checked={value.confirmed}
                  onChange={(event) =>
                    onChange({ ...value, confirmed: event.target.checked })
                  }
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
