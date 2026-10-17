import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { ContentSkeleton, EmptyState } from "../components/UiStates";
import { useResource } from "./useResource";
import { ErrorNotice } from "./ErrorNotice";
import type { Inbox as InboxData } from "./types";
import { dateLabel, deadlineLabel, rt, stateName } from "./text";
import { PrivateAvatar } from "./PrivateAvatar";
import { useActiveRefresh } from "./useActiveRefresh";
export function Inbox() {
  const [direction, setDirection] = useState("received"),
    [offset, setOffset] = useState(0);
  const data = useResource<InboxData>(
    `/me/requests?direction=${direction}&offset=${offset}&limit=12`,
  );
  useActiveRefresh(data.reload);
  const items =
    data.value?.items.filter((item) => item.direction === direction) || [];
  return (
    <section className="rm-panel">
      <div className="rm-section-heading">
        <div>
          <h2>{rt("Yêu cầu kết nối", "Connection requests")}</h2>
          <p className="rm-hint">
            {rt(
              "Phản hồi trong 7 ngày. Đồng ý kết nối để trò chuyện trong ReloHome; liên hệ cũ vẫn theo quyền đã xác nhận.",
              "Reply within 7 days. Accept a connection to chat in ReloHome; legacy contacts retain their existing permissions.",
            )}
          </p>
        </div>
        <button className="secondary" onClick={data.reload}>
          {rt("Tải lại", "Refresh")}
        </button>
      </div>
      {data.value?.profile_reminder && (
        <div className="rm-reminder" role="status">
          <p>
            {rt(
              "Nhu cầu của bạn sắp hết hạn. Bạn vẫn đang tìm người ở cùng?",
              "Your profile expires soon. Still looking for a roommate?",
            )}
          </p>
          <Link to="/roommate?tab=profile" className="text-button">
            {rt("Xác nhận còn tìm", "Reconfirm availability")}
          </Link>
        </div>
      )}
      <div
        className="rm-actions"
        role="group"
        aria-label={rt("Lọc yêu cầu", "Request filters")}
      >
        <button
          className="secondary"
          aria-pressed={direction === "received"}
          onClick={() => {
            setDirection("received");
            setOffset(0);
          }}
        >
          {rt("Đã nhận", "Received")}
          {data.value?.received_pending
            ? ` (${data.value.received_pending})`
            : ""}
        </button>
        <button
          className="secondary"
          aria-pressed={direction === "sent"}
          onClick={() => {
            setDirection("sent");
            setOffset(0);
          }}
        >
          {rt("Đã gửi", "Sent")}
        </button>
      </div>
      <ErrorNotice error={data.error} retry={data.reload} />
      {data.loading && !data.value ? (
        <ContentSkeleton
          label={rt("Đang tải hộp yêu cầu…", "Loading requests…")}
        />
      ) : items.length ? (
        <ul className="rm-inbox-list">
          {items.map((item) => (
            <li
              key={item.request_id}
              className={item.unread ? "rm-unread" : ""}
            >
              <PrivateAvatar
                id={item.available ? item.counterparty?.avatar_id : null}
              />
              <div>
                {item.available && item.counterparty?.display_name && (
                  <h3>{item.counterparty.display_name}</h3>
                )}
                <strong>{stateName(item.state)}</strong>
                {item.preview && item.available && (
                  <p className="rm-inbox-preview">{item.preview}</p>
                )}
                <p className="rm-hint">
                  {rt("Mã", "ID")}: {item.request_id.slice(0, 8)} ·{" "}
                  {rt("Tạo ngày ", "Created ")}
                  {dateLabel(item.created_at)}
                </p>
                {item.state === "pending" && (
                  <p>
                    {rt("Hạn phản hồi: ", "Reply deadline: ")}
                    {deadlineLabel(item.expires_at)}
                  </p>
                )}
                {item.grant_state && (
                  <small>
                    {rt("Quyền liên hệ: ", "Contact access: ")}
                    {item.grant_state === "active"
                      ? rt("Đang mở", "Open")
                      : stateName(item.grant_state)}
                  </small>
                )}
              </div>
              {item.available ? (
                <Link
                  className="secondary"
                  to={
                    "/roommate/requests/" + encodeURIComponent(item.request_id)
                  }
                >
                  {item.conversation_id
                    ? rt("Mở kết nối", "Open connection")
                    : rt("Xem yêu cầu", "View request")}
                </Link>
              ) : (
                <span className="rm-hint">
                  {rt("Không còn quyền xem", "Access unavailable")}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !data.error && (
          <EmptyState
            icon={<Mail />}
            title={rt("Chưa có yêu cầu", "No requests yet")}
            text={
              direction === "received"
                ? rt(
                    "Yêu cầu từ người khác sẽ xuất hiện ở đây khi bạn đang đăng tìm.",
                    "Incoming requests appear here while your discovery profile is active.",
                  )
                : rt(
                    "Xem hồ sơ và gửi bản giới thiệu để bắt đầu trao đổi.",
                    "Explore profiles and send an introduction to start a conversation.",
                  )
            }
          />
        )
      )}
      {!!data.value?.total && data.value.total > 12 && (
        <div className="rm-actions rm-pagination">
          <button
            className="secondary"
            disabled={offset === 0 || data.loading}
            onClick={() => setOffset(offset - 12)}
          >
            {rt("Trước", "Previous")}
          </button>
          <span>
            {Math.floor(offset / 12) + 1} / {Math.ceil(data.value.total / 12)}
          </span>
          <button
            className="secondary"
            disabled={offset + 12 >= data.value.total || data.loading}
            onClick={() => setOffset(offset + 12)}
          >
            {rt("Tiếp", "Next")}
          </button>
        </div>
      )}
    </section>
  );
}
