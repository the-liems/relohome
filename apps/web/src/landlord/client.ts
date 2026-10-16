import { normalizeHousingMedia } from "../housingMedia";
import { ApiError } from "../api";
import { reportAuthFailure } from "../authEvents";

export async function housingManagement<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    "/web/api/housing-management/" + path.replace(/^\//, ""),
    {
      method,
      credentials: "same-origin",
      signal,
      headers: { "Content-Type": "application/json", "X-SIU-Request": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    reportAuthFailure("/housing-management/" + path, response.status, data);
    throw new ApiError(
      response.status,
      typeof data.detail === "string"
        ? data.detail
        : "Không thể hoàn thành yêu cầu. Vui lòng thử lại.",
      typeof data.code === "string" ? data.code : "",
      data.fields && typeof data.fields === "object" ? data.fields : {},
    );
  }
  return normalizeHousingMedia(data, window.location.origin) as T;
}

export async function uploadListingImage(
  listingId: string,
  file: File,
  alt: string,
) {
  const response = await fetch(
    `/web/api/landlord/listings/${encodeURIComponent(listingId)}/media-upload?alt=${encodeURIComponent(alt)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": file.type, "X-SIU-Request": "1" },
      body: file,
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    reportAuthFailure("/landlord/listings/" + listingId + "/media-upload", response.status, data);
    throw new ApiError(response.status, data.detail || "Không tải được ảnh.");
  }
  return data;
}
