import { useEffect, useState } from "react";
import { Navigation, RotateCw } from "lucide-react";
import { api, ApiError } from "../api";
import {
  locationErrorMessage,
  deviceRouteErrorMessage,
  validCoordinates,
  DEVICE_ROUTE_SNAP_M,
  CONSENTED_ROUTE_SNAP_M,
} from "../housingInteraction";
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
  const [errorCode, setErrorCode] = useState("");
  const [snapRadius, setSnapRadius] = useState(DEVICE_ROUTE_SNAP_M);
  useEffect(() => {
    let disposed = false;
    let locationTimer: ReturnType<typeof setTimeout> | undefined;
    setOrigin(null);
    setRouting(null);
    setError("");
    setErrorCode("");
    setSnapRadius(DEVICE_ROUTE_SNAP_M);
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
      }, 30000);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(locationTimer);
          if (disposed) return;
          const { latitude: lat, longitude: lng, accuracy } = position.coords;
          if (!validCoordinates(lat, lng)) {
            fail("Thiết bị trả về tọa độ không hợp lệ.");
            return;
          }
          const point = { lat, lng, accuracy };
          setOrigin(point);
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
    };
  }, [house.id, house.lat, house.lng, attempt]);

  useEffect(() => {
    if (!origin) return;
    const abort = new AbortController();
    let disposed = false;
    setBusy(true);
    setError("");
    setErrorCode("");
    setRouting(null);
    // Platform bounds the complete DB/local/public operation at 20s.
    const timer = setTimeout(() => abort.abort(), 25000);
    void api<Data>(
      "/platform/routes/device",
      "POST",
      {
        origin: {
          type: "coordinate",
          location: { lat: origin.lat, lng: origin.lng },
        },
        destination: { type: "housing", listing_id: house.id },
        snap_radius_m: snapRadius,
        routing_policy: "auto",
      },
      abort.signal,
    )
      .then((result) => {
        if (!disposed) setRouting(result);
      })
      .catch((e: unknown) => {
        if (disposed) return;
        const code = abort.signal.aborted
          ? "TIMEOUT"
          : e instanceof ApiError
            ? e.code
            : "";
        setErrorCode(code);
        setError(deviceRouteErrorMessage(code));
      })
      .finally(() => {
        clearTimeout(timer);
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      abort.abort();
    };
  }, [origin, house.id, snapRadius]);
  return (
    <Dialog title={t("Từ vị trí của bạn tới căn nhà")} wide onClose={onClose}>
      <p className="muted">{house.title}</p>
      <p className="muted small">
        {t(
          "Chỉ dùng vị trí bạn cấp quyền cho lần chỉ đường này; không lưu vào hồ sơ hay gửi cho AI.",
        )}
      </p>
      <p className="notice small">
        {t(
          "Ưu tiên tính đường nội bộ. Khi ngoài vùng hoặc dịch vụ nội bộ không dùng được, hệ thống tự gửi hai tọa độ tới OSRM công khai (FOSSGIS, có ghi log); không gửi cho LLM.",
        )}{" "}
        <a
          href="https://routing.openstreetmap.de/about.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Chính sách OSRM công khai")}
        </a>
        {" · "}
        <a
          href="https://www.openstreetmap.org/fixthemap"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Báo lỗi dữ liệu bản đồ")}
        </a>
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
      {routing?.routing_provider === "public_osrm" && (
        <p className="notice small">
          {t(
            "Tuyến này được tính bằng OSRM công khai. Thời gian là ước tính, không có giao thông thời gian thực hoặc bảo đảm dịch vụ.",
          )}
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
      {routing?.route?.snap_distances_meters && (
        <p className="muted small">
          {t("Điểm nối vào đường cách GPS / căn nhà:")}{" "}
          {routing.route.snap_distances_meters
            .map((m: number) => `${Math.round(m)} m`)
            .join(" / ")}
          .{" "}
          {t(
            "Khoảng cách tuyến trên chỉ tính giữa các điểm nối đường, chưa gồm đoạn từ vị trí tới đường.",
          )}
        </p>
      )}
      {origin && (
        <MapPanel
          large
          houses={[
            {
              ...house,
              lat: routing?.destination?.location?.lat ?? house.lat,
              lng: routing?.destination?.location?.lng ?? house.lng,
            },
          ]}
          routing={routing ?? undefined}
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
      {!busy &&
        errorCode === "NO_ROUTE" &&
        snapRadius === DEVICE_ROUTE_SNAP_M && (
          <div className="notice small">
            <p>
              {t(
                "Chưa có điểm nối đường trong 100 m. Nếu GPS trên map đúng, bạn có thể cho phép tìm điểm nối tối đa 500 m ở mỗi đầu; vị trí GPS không bị thay đổi.",
              )}
            </p>
            <button
              className="secondary"
              onClick={() => setSnapRadius(CONSENTED_ROUTE_SNAP_M)}
            >
              {t("Đồng ý thử nối đường trong 500 m")}
            </button>
          </div>
        )}
    </Dialog>
  );
}
