import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { Dialog } from "../components/Dialog";
import { ContentSkeleton, EmptyState } from "../components/UiStates";
import { useResource } from "./useResource";
import { useActiveRefresh } from "./useActiveRefresh";
import { roommate } from "./client";
import { ErrorNotice } from "./ErrorNotice";
import { dateLabel, rt } from "./text";
import type { Notifications } from "./types";

export function notificationName(kind: string) {
  const names: Record<string, string> = {
    chat_message: rt("Có tin nhắn ở ghép mới", "New roommate message"),
    request_received: rt("Có yêu cầu kết nối mới", "New connection request"),
    request_accepted: rt("Yêu cầu đã được đồng ý", "Your request was accepted"),
    request_rejected: rt(
      "Yêu cầu đã được từ chối",
      "Your request was declined",
    ),
    request_withdrawn: rt("Yêu cầu đã được rút", "A request was withdrawn"),
    request_cancelled: rt(
      "Yêu cầu không còn khả dụng",
      "A request is no longer available",
    ),
    request_expired: rt("Yêu cầu đã hết hạn", "A request expired"),
    contact_revoked: rt(
      "Quyền liên hệ đã được thu hồi",
      "Contact access was revoked",
    ),
    contact_expired: rt("Quyền liên hệ đã hết hạn", "Contact access expired"),
  };
  return names[kind] || rt("Có cập nhật về kết nối", "Connection update");
}

export function NotificationsMenu() {
  const [open, setOpen] = useState(false),
    [error, setError] = useState<unknown>(null),
    [offset, setOffset] = useState(0);
  const data = useResource<Notifications>(
    "/notifications?limit=20&offset=" + offset,
  );
  useActiveRefresh(data.reload);
  async function mark(ids: string[]) {
    try {
      await roommate("/notifications/read", "POST", { ids });
      data.reload();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <button
        className="secondary"
        onClick={() => setOpen(true)}
        aria-label={
          rt("Thông báo", "Notifications") + " · " + (data.value?.unread || 0)
        }
      >
        <Bell size={17} aria-hidden="true" />
        {rt("Thông báo", "Notifications")}
        {!!data.value?.unread && (
          <span className="rm-count">{data.value.unread}</span>
        )}
      </button>
      {open && (
        <Dialog
          title={rt("Thông báo ở ghép", "Roommate notifications")}
          onClose={() => setOpen(false)}
        >
          <ErrorNotice error={error || data.error} retry={data.reload} />
          <p className="rm-hint">
            {rt(
              "Theo dõi yêu cầu và quyền liên hệ tại đây.",
              "Follow requests and contact access here.",
            )}
          </p>
          {data.loading && !data.value ? (
            <ContentSkeleton
              label={rt("Đang tải thông báo…", "Loading notifications…")}
            />
          ) : data.value?.items.length ? (
            <>
              <ul className="rm-notifications">
                {data.value.items.map((item) => (
                  <li key={item.id} className={item.read ? "" : "rm-unread"}>
                    <Link
                      to={
                        "/roommate/requests/" +
                        encodeURIComponent(item.resource_id)
                      }
                      onClick={() => {
                        void mark([item.id]);
                        setOpen(false);
                      }}
                    >
                      {notificationName(item.kind)}
                    </Link>
                    <small className="rm-hint">
                      {dateLabel(item.created_at)}
                    </small>
                  </li>
                ))}
              </ul>
              <div className="rm-actions">
                <button
                  className="text-button"
                  onClick={() =>
                    void mark(
                      data.value!.items.filter((i) => !i.read).map((i) => i.id),
                    )
                  }
                >
                  {rt("Đánh dấu trang này đã đọc", "Mark this page as read")}
                </button>
                {offset > 0 && (
                  <button
                    className="secondary"
                    onClick={() => setOffset(offset - 20)}
                  >
                    {rt("Trước", "Previous")}
                  </button>
                )}
                {offset + 20 < data.value.total && (
                  <button
                    className="secondary"
                    onClick={() => setOffset(offset + 20)}
                  >
                    {rt("Tiếp", "Next")}
                  </button>
                )}
              </div>
            </>
          ) : (
            !data.error && (
              <EmptyState
                icon={<Bell />}
                title={rt("Chưa có thông báo", "No notifications yet")}
                text={rt(
                  "Cập nhật về yêu cầu của bạn sẽ hiện ở đây.",
                  "Updates about your requests will appear here.",
                )}
              />
            )
          )}
        </Dialog>
      )}
    </>
  );
}
