import { useEffect, useState } from "react";
import { t, formatUi } from "../uiPreferences";
import { housingManagement } from "./client";
import type { PropertyDetail, PropertySummary } from "./types";
export function RoomsInventory({
  properties,
  vacant,
  open,
}: {
  properties: PropertySummary[];
  vacant: boolean;
  open: (id: string) => void;
}) {
  const [houses, setHouses] = useState<PropertyDetail[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    Promise.all(
      properties.map((property) =>
        housingManagement<PropertyDetail>(
          `landlord/properties/${property.id}`,
          "GET",
          undefined,
          abort.signal,
        ),
      ),
    )
      .then(setHouses)
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [properties]);
  const units = houses.flatMap((house) =>
    house.units
      .filter((unit) => !vacant || unit.availability_status === "vacant")
      .map((unit) => ({ house, unit })),
  );
  return (
    <section className="ll-panel">
      <h2>{t(vacant ? "Phòng còn trống" : "Phòng trong hệ thống")}</h2>
      {loading ? (
        <p role="status">{t("Đang tải nhà…")}</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : !units.length ? (
        <p>{t("Chưa có phòng")}</p>
      ) : (
        <div className="ll-property-list">
          {units.map(({ house, unit }) => (
            <button key={unit.id} onClick={() => open(house.id)}>
              <div className="ll-property-copy">
                <strong>
                  {house.name} · {unit.unit_code}
                </strong>
                <p>{unit.title}</p>
                <small>{formatUi("{0} m²", [unit.area_m2 ?? "?"])}</small>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
