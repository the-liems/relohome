import { useEffect, useState } from "react";
import { Navigation, RotateCw } from "lucide-react";
import { api } from "../api";
import { cityForPoint } from "../mapScope";
import { locationErrorMessage, validCoordinates } from "../housingInteraction";
import { t } from "../uiPreferences";
import type { Data, House } from "../types";
import { Dialog } from "./Dialog";
import { MapPanel } from "./MapPanel";

// Mounted only after an explicit Directions click. Coordinates remain transient;
// no chat/LLM, profile update, browser storage or selected-home mutation.
export function HousingDirections({
  house,
  onClose,
}: {
  house: House;
  onClose: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [origin, setOrigin] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
  } | null>(null);
  const [routing, setRouting] = useState<Data | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    let disposed = false;
    let routeTimer: ReturnType<typeof setTimeout> | undefined;
    let locationTimer: ReturnType<typeof setTimeout> | undefined;
    setOrigin(null);
    setRouting(null);
    setError("");
    setBusy(true);
    const fail = (message: string) => {
      if (!disposed) {
        setError(message);
        setBusy(false);
      }
    };
    if (!window.isSecureContext || !navigator.geolocation) {
      fail(
        "Trình duyệt cần HTTPS (hoặc localhost) và hỗ trợ quyền vị trí để chỉ đường.",
      );
    } else if (!validCoordinates(house.lat, house.lng)) {
      fail("Tin nhà chưa có tọa độ hợp lệ để chỉ đường.");
    } else {
      // Some browsers keep the consent prompt pending beyond the GPS timeout.
      locationTimer = setTimeout(() => {
        fail(locationErrorMessage(3));
        disposed = true;
        abort.abort();
      }, 30000);
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          clearTimeout(locationTimer);
          if (disposed) return;
          const { latitude: lat, longitude: lng, accuracy } = position.coords;
          if (!validCoordinates(lat, lng)) {
            fail("Thiết bị trả về tọa độ không hợp lệ.");
            return;
          }
          const point = { lat, lng, accuracy };
          setOrigin(point);
          const city = cityForPoint([house.lng!, house.lat!]);
          if (!city || cityForPoint([lng, lat]) !== city) {
            fail(
              "Vị trí của bạn và căn nhà nằm ngoài cùng vùng dữ liệu đường hiện có. Chưa thể tính tuyến đường này.",
            );
            return;
          }
          routeTimer = setTimeout(() => abort.abort(), 15000);
          try {
            const result = await api<Data>(
              "/platform/routes/entities",
              "POST",
              {
                city,
                profile: "driving",
                origin: { type: "coordinate", location: { lat, lng } },
                destination: { type: "housing", listing_id: house.id },
              },
              abort.signal,
            );
            if (!disposed) setRouting(result);
          } catch (e) {
            if (!disposed)
              fail(
                abort.signal.aborted
                  ? "Dịch vụ tuyến đường quá thời gian. Bạn có thể thử lại."
                  : (e as Error).message,
              );
          } finally {
            clearTimeout(routeTimer);
            if (!disposed) setBusy(false);
          }
        },
        (e) => {
          clearTimeout(locationTimer);
          if (!disposed) fail(locationErrorMessage(e.code));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
      );
    }
    return () => {
      disposed = true;
      clearTimeout(locationTimer);
      clearTimeout(routeTimer);
      abort.abort();
    };
  }, [house.id, house.lat, house.lng, attempt]);
  return (
    <Dialog title={t("Từ vị trí của bạn tới căn nhà")} wide onClose={onClose}>
      <p className="muted">{house.title}</p>
      <p className="muted small">
        {t(
          "Chỉ dùng vị trí bạn cấp quyền cho lần chỉ đường này; không lưu vào hồ sơ hay gửi cho AI.",
        )}
      </p>
      {busy && (
        <p role="status">
          <Navigation size={16} />{" "}
          {origin
            ? t("Đang tính tuyến đường…")
            : t("Đang xin quyền và lấy vị trí thiết bị…")}
        </p>
      )}
      {error && (
        <p className="notice amber" role="alert">
          {t(error)}
        </p>
      )}
      {origin && (
        <p className="muted small">
          {t("Vị trí thiết bị · sai số khoảng ±")}
          {Math.round(origin.accuracy)} m
        </p>
      )}
      {routing?.route && (
        <p className="housing-route-summary">
          <strong>
            {(routing.route.distance_meters / 1000).toFixed(1)} km
          </strong>{" "}
          · ~{Math.ceil(routing.route.duration_seconds / 60)} {t("phút")} ·{" "}
          {t("Tuyến ô tô tham khảo · OSRM")}
        </p>
      )}
      {routing && (
        <MapPanel
          large
          houses={[
            {
              ...house,
              lat: routing.destination?.location?.lat ?? house.lat,
              lng: routing.destination?.location?.lng ?? house.lng,
            },
          ]}
          routing={routing}
          points={
            origin
              ? [
                  {
                    id: "device-origin",
                    name: t("Vị trí của bạn"),
                    location: origin,
                  },
                ]
              : []
          }
        />
      )}
      {(routing?.destination?.location_accuracy ?? house.location_accuracy) !==
        "rooftop" && (
        <p className="notice">
          {t(
            "Điểm đến gần đúng theo nguồn tin; xác nhận địa chỉ với người cho thuê trước khi đi.",
          )}
        </p>
      )}
      {!busy && (
        <button className="secondary" onClick={() => setAttempt((n) => n + 1)}>
          <RotateCw size={16} />
          {t("Lấy lại vị trí và thử lại")}
        </button>
      )}
    </Dialog>
  );
}
