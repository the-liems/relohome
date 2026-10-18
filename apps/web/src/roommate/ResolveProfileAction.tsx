import { useEffect, useRef, useState } from "react";
import { RoommateError } from "./client";
import { ErrorNotice } from "./ErrorNotice";
import { rt } from "./text";
import { useRoommateClient } from "./useRoommateClient";
import type { ChatPage } from "./chatTypes";

type ProfileStatus = NonNullable<ChatPage["own_profile"]>;

export function ResolveProfileAction({
  profile,
  viewerId,
  resolved,
  refresh,
}: {
  profile: ChatPage["own_profile"];
  viewerId: string;
  resolved: (profile: ProfileStatus) => void;
  refresh: () => Promise<void>;
}) {
  const roommate = useRoommateClient(viewerId);
  const active = useRef(true),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [pendingVersion, setPendingVersion] = useState<number | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (pendingVersion !== null && profile?.version !== pendingVersion) {
      setPendingVersion(null);
      setError(null);
      window.dispatchEvent(new Event("roommate-profile-update"));
    }
  }, [profile?.version, pendingVersion]);

  async function confirm(version: number) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setPendingVersion(version);
    try {
      const result = await roommate<ProfileStatus>(
        "/me/profile/actions",
        "POST",
        {
          action: "resolve",
          expected_version: version,
        },
      );
      if (!active.current) return;
      if (!result || result.state !== "resolved" || result.version !== version + 1)
        throw new RoommateError("operation_unknown", 502);
      setPendingVersion(null);
      resolved(result);
    } catch (cause) {
      if (!active.current) return;
      setError(cause);
      if (
        !(cause instanceof RoommateError) ||
        cause.code !== "operation_unknown"
      )
        setPendingVersion(null);
      // A lost response or stale version is reconciled by a read, never an automatic write.
      await refresh();
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }

  if (!profile) return null;
  if (profile.state === "resolved")
    return (
      <p className="rm-chat-resolve rm-success" role="status">
        {rt(
          "Đã xác nhận và gỡ tin của bạn.",
          "Confirmed. Your listing has been removed from discovery.",
        )}
      </p>
    );
  if (profile.state !== "active") return null;
  const uncertain =
    error instanceof RoommateError && error.code === "operation_unknown";
  return (
    <div className="rm-chat-resolve">
      <small>
        {rt(
          "Gỡ tin của bạn khỏi tìm kiếm, bản đồ và hủy các yêu cầu kết nối đang chờ (gửi đi và nhận vào). Các cuộc chat đã kết nối vẫn được giữ.",
          "Remove your listing from search and the map and cancel pending connection requests, both sent and received. Existing connected chats are kept.",
        )}
      </small>
      <ErrorNotice error={error} />
      {uncertain ? (
        <div className="rm-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {rt("Kiểm tra trạng thái", "Check status")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || pendingVersion === null}
            onClick={() =>
              pendingVersion !== null && void confirm(pendingVersion)
            }
          >
            {rt("Thử lại cùng yêu cầu", "Retry the same request")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void confirm(profile.version)}
        >
          {busy
            ? rt("Đang xác nhận…", "Confirming…")
            : rt(
                "Xác nhận ở cùng & gỡ tin đăng",
                "Confirm co-living & remove my listing",
              )}
        </button>
      )}
    </div>
  );
}
