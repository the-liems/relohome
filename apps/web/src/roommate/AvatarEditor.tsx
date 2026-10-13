import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { ConfirmDialog } from "../components/Dialog";
import { useResource } from "./useResource";
import { roommate, RoommateError } from "./client";
import { PrivateAvatar } from "./PrivateAvatar";
import { ErrorNotice } from "./ErrorNotice";
import { useActiveRefresh } from "./useActiveRefresh";
import { rt } from "./text";
import type { OwnProfile, Media } from "./types";

export function AvatarEditor({
  profile,
  changed,
}: {
  profile: OwnProfile | null;
  changed: () => void;
}) {
  const data = useResource<{ items: Media[] }>("/me/media");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [uncertain, setUncertain] = useState(false);
  const [remove, setRemove] = useState<Media | null>(null);
  const upload = useRef<{ file: File; key: string } | null>(null),
    locked = useRef(false);
  useActiveRefresh(data.reload, !busy && !uncertain, 60000);
  async function send() {
    if (!upload.current || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      let response: Response;
      try {
        response = await fetch("/web/api/roommate/media", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(30000),
          headers: {
            "X-SIU-Request": "1",
            "X-Roommate-Operation": upload.current.key,
            "Content-Type": "application/octet-stream",
          },
          body: upload.current.file,
        });
      } catch {
        throw new RoommateError("operation_unknown", 503);
      }
      let value;
      try {
        value = await response.json();
      } catch {
        throw new RoommateError("operation_unknown", 502);
      }
      if (!response.ok)
        throw new RoommateError(
          response.status >= 500
            ? "operation_unknown"
            : value?.detail?.code || "invalid_image",
          response.status,
        );
      upload.current = null;
      setUncertain(false);
      data.reload();
    } catch (e) {
      setError(e);
      setUncertain(
        e instanceof RoommateError && e.code === "operation_unknown",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="rm-panel rm-avatar-editor">
      <div className="rm-section-heading">
        <div>
          <h2>{rt("Ảnh hồ sơ", "Profile photo")}</h2>
          <p className="rm-hint">
            {rt(
              "Ảnh thật của bạn giúp người khác dễ nhận biết. Ảnh chỉ được gắn công khai sau khi duyệt.",
              "Your photo helps others recognize you. It can appear on your profile only after review.",
            )}
          </p>
        </div>
        <Camera aria-hidden="true" />
      </div>
      <label>
        {rt(
          "Chọn ảnh JPEG hoặc PNG · tối đa 5 MB",
          "Choose JPEG or PNG · up to 5 MB",
        )}
        <input
          type="file"
          accept="image/jpeg,image/png"
          disabled={busy || uncertain}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (
              file.size > 5 * 1024 * 1024 ||
              !["image/jpeg", "image/png"].includes(file.type)
            ) {
              setError(new RoommateError("invalid_image", 422));
              return;
            }
            upload.current = { file, key: crypto.randomUUID() };
            void send();
          }}
        />
      </label>
      <ErrorNotice error={error || data.error} retry={data.reload} />
      {busy && <p role="status">{rt("Đang tải ảnh…", "Uploading photo…")}</p>}
      {uncertain && (
        <div className="rm-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              if (!upload.current) return;
              setBusy(true);
              try {
                const status = await roommate<{ status: string }>(
                  "/operations/" + upload.current.key,
                );
                if (status.status === "completed") {
                  upload.current = null;
                  setUncertain(false);
                  setError(null);
                  data.reload();
                } else {
                  setBusy(false);
                  await send();
                }
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {rt("Kiểm tra ảnh đã tải", "Check upload status")}
          </button>
        </div>
      )}
      {!profile && (
        <p className="rm-hint">
          {rt(
            "Lưu hoặc đăng nhu cầu trước khi chọn ảnh đại diện đã duyệt.",
            "Save or publish a discovery profile before attaching an approved avatar.",
          )}
        </p>
      )}
      <ul className="rm-media-list">
        {data.value?.items.map((item) => (
          <li key={item.media_id}>
            <PrivateAvatar id={item.media_id} />
            <div>
              <strong>
                {item.status === "approved"
                  ? rt("Đã duyệt", "Approved")
                  : item.status === "rejected"
                    ? rt("Không được duyệt", "Rejected")
                    : rt("Đang chờ duyệt", "Pending review")}
              </strong>
              {profile?.avatar_id === item.media_id && (
                <p className="rm-hint">
                  {rt("Ảnh đại diện hiện tại", "Current avatar")}
                </p>
              )}
            </div>
            <div className="rm-actions">
              {item.status === "approved" &&
                profile &&
                profile.avatar_id !== item.media_id && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await roommate("/me/profile/avatar", "PUT", {
                          media_id: item.media_id,
                          expected_version: profile.version,
                        });
                        changed();
                        data.reload();
                      } catch (e) {
                        setError(e);
                        changed();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {rt("Dùng ảnh này", "Use this photo")}
                  </button>
                )}
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => setRemove(item)}
              >
                {rt("Xóa ảnh", "Delete photo")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {remove && (
        <ConfirmDialog
          title={rt("Xóa ảnh hồ sơ?", "Delete profile photo?")}
          action={rt("Xóa ảnh", "Delete photo")}
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await roommate(
              "/media/" + encodeURIComponent(remove.media_id),
              "DELETE",
            );
            setRemove(null);
            data.reload();
            changed();
          }}
        >
          <p>
            {rt(
              "Nếu đang dùng làm ảnh đại diện, ảnh sẽ được gỡ khỏi hồ sơ.",
              "If this is your avatar, it will be removed from your profile.",
            )}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
