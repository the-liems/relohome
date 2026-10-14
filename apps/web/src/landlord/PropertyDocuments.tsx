import { useEffect, useState } from "react";
import { t } from "../uiPreferences";
import { housingManagement } from "./client";
import { normalizeHousingMedia } from "../housingMedia";
import type { Data } from "../types";
export function PropertyDocuments({ propertyId }: { propertyId: string }) {
  const [items, setItems] = useState<Data[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    housingManagement<{ items: Data[] }>(
      `landlord/properties/${propertyId}/documents`,
      "GET",
      undefined,
      abort.signal,
    )
      .then((result) => setItems(result.items || []))
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      });
    return () => abort.abort();
  }, [propertyId]);
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/web/api/landlord/properties/${propertyId}/document-upload?label=${encodeURIComponent(file.name.slice(0, 160))}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "X-SIU-Request": "1", "Content-Type": file.type },
          body: file,
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.detail || t("Không thể hoàn thành yêu cầu. Vui lòng thử lại."),
        );
      const result = await housingManagement<{ items: Data[] }>(
        `landlord/properties/${propertyId}/documents`,
      );
      setItems(result.items);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ll-private-documents">
      <h3>{t("Giấy tờ chứng minh (không bắt buộc)")}</h3>
      <p>
        {t(
          "Ảnh giấy tờ sở hữu, ủy quyền hoặc kinh doanh. Chỉ chủ nhà và Admin được xem; không xuất hiện trong tin công khai.",
        )}
      </p>
      <label>
        {t("Tải ảnh giấy tờ JPEG/PNG, tối đa 5 MB")}
        <input
          type="file"
          accept="image/jpeg,image/png"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
      </label>
      {busy && <p role="status">{t("Đang tải ảnh…")}</p>}
      {error && <p role="alert">{error}</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={normalizeHousingMedia(item.url, window.location.origin)}
              target="_blank"
              rel="noreferrer"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
