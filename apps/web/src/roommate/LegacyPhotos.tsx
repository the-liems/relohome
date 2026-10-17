import { useState } from "react";
import { Dialog } from "../components/Dialog";
import { ErrorNotice } from "./ErrorNotice";
import { PrivateAvatar } from "./PrivateAvatar";
import { rt } from "./text";
import { useResource } from "./useResource";
import { useRoommateClient } from "./useRoommateClient";

type Photo = { media_id: string };

// This only manages existing private media; uploading/attaching stays retired.
export function LegacyPhotos({ changed }: { changed: () => void }) {
  const photos = useResource<{ items: Photo[] }>("/me/media");
  const roommate = useRoommateClient();
  const [selected, setSelected] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!photos.error && !photos.value?.items?.length) return null;
  return (
    <section
      className="rm-panel rm-legacy-photos"
      aria-label={rt("Ảnh đã lưu trước đây", "Previously saved photos")}
    >
      <h2>{rt("Ảnh đã lưu trước đây", "Previously saved photos")}</h2>
      <p className="rm-hint">
        {rt(
          "Bạn có thể xem hoặc xóa ảnh cũ. Xóa ảnh đại diện cũng gỡ ảnh khỏi hồ sơ; các thông tin khác được giữ nguyên.",
          "View or remove existing photos. Deleting the current avatar also removes it from your profile; other information is preserved.",
        )}
      </p>
      <ErrorNotice error={photos.error} retry={photos.reload} />
      <ul className="rm-media-list">
        {photos.value?.items?.map((photo, index) => (
          <li key={photo.media_id}>
            <PrivateAvatar id={photo.media_id} />
            <span>
              {rt("Ảnh ", "Photo ")}
              {index + 1}
            </span>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setError(null);
                setSelected(photo);
              }}
            >
              {rt("Xóa ảnh này", "Delete this photo")}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <Dialog
          title={rt("Xóa ảnh đã lưu?", "Delete saved photo?")}
          onClose={() => !busy && setSelected(null)}
        >
          <p>
            {rt(
              "Chỉ xóa ảnh này, không xóa hồ sơ hoặc tin nhắn Roommate.",
              "Only this photo will be deleted, not your Roommate profile or messages.",
            )}
          </p>
          <ErrorNotice error={error} />
          <div className="rm-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              {rt("Hủy", "Cancel")}
            </button>
            <button
              className="primary danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await roommate(
                    "/media/" + encodeURIComponent(selected.media_id),
                    "DELETE",
                  );
                  setSelected(null);
                  photos.reload();
                  changed();
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {rt("Xóa ảnh", "Delete photo")}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
