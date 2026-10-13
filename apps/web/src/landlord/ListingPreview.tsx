import { useEffect, useState } from "react";
import { housingManagement } from "./client";
import { PrivateLocationMap } from "./LocationPicker";
import { money } from "../api";
import { t } from "../uiPreferences";
import { Dialog } from "../components/Dialog";
import type { Data } from "../types";

export function PreviewContent({ listing }: { listing: Data }) {
  return (
    <div className="ll-listing-preview">
      <div className="ll-preview-images">
        {(listing.media || []).map((media: Data) => (
          <figure key={media.id}>
            <img
              src={media.url}
              alt={media.alt_text || listing.title || t("Ảnh phòng")}
            />
            <figcaption>{media.is_primary && t("Ảnh bìa")}</figcaption>
          </figure>
        ))}
      </div>
      <h2>{listing.title || t("Tin chưa có tiêu đề")}</h2>
      <p>
        {listing.property_name} · {listing.unit_code} · {listing.area_m2 ?? "—"}{" "}
        m²
      </p>
      <p>{listing.address?.full_address || listing.address?.raw}</p>
      <strong>
        {money(listing.rent_vnd)} / {t("tháng")}
      </strong>
      <p>
        {t("Tiền cọc")}: {money(listing.deposit_vnd)}
      </p>
      <p className="ll-preview-description">
        {listing.description || t("Chưa có mô tả")}
      </p>
      {(listing.fees || []).length > 0 && (
        <ul>
          {listing.fees.map((fee: Data) => (
            <li key={fee.code}>
              {fee.label}: {money(fee.amount)} · {fee.billing_unit}
            </li>
          ))}
        </ul>
      )}
      {Number.isFinite(listing.lat) && Number.isFinite(listing.lng) && (
        <PrivateLocationMap lat={listing.lat} lng={listing.lng} />
      )}
    </div>
  );
}
export function ListingPreview({
  id,
  close,
}: {
  id: string;
  close: () => void;
}) {
  const [listing, setListing] = useState<Data | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void housingManagement<Data>(
      `landlord/listings/${id}/preview`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setListing)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [id]);
  return (
    <Dialog title={t("Xem trước tin của bạn")} onClose={close}>
      <p className="ll-form-hint">
        {t(
          "Bản xem trước riêng. Tin chỉ công khai sau khi được duyệt và còn trống.",
        )}
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : listing ? (
        <PreviewContent listing={listing} />
      ) : (
        <p role="status">{t("Đang tải tin…")}</p>
      )}
    </Dialog>
  );
}
