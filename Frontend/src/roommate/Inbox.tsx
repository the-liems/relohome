import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { ContentSkeleton, EmptyState } from "../components/UiStates";
import { useResource } from "./useResource";
import { ErrorNotice } from "./ErrorNotice";
import type { Inbox as InboxData } from "./types";
import { dateLabel, deadlineLabel, rt, stateName } from "./text";
export function Inbox() {
  const data = useResource<InboxData>("/me/requests"),
    [direction, setDirection] = useState("received");
  const items =
    data.value?.items.filter((item) => item.direction === direction) || [];
  return (
    <section className="rm-panel">
      <div className="rm-section-heading">
        <div>
          <h2>{rt("Yêu cầu kết nối", "Connection requests")}</h2>
          <p className="rm-hint">
            {rt(
              "Phản hồi trong 7 ngày. Liên hệ luôn cần consent hai bên.",
              "Reply within 7 days. Contacts always require mutual consent.",
            )}
          </p>
        </div>
        <button className="secondary" onClick={data.reload}>
          {rt("Tải lại", "Refresh")}
        </button>
      </div>
      <div
        className="rm-actions"
        role="group"
        aria-label={rt("Lọc yêu cầu", "Request filters")}
      >
        <button
          className="secondary"
          aria-pressed={direction === "received"}
          onClick={() => setDirection("received")}
        >
          {rt("Đã nhận", "Received")}
          {data.value?.received_pending
            ? ` (${data.value.received_pending})`
            : ""}
        </button>
        <button
          className="secondary"
          aria-pressed={direction === "sent"}
          onClick={() => setDirection("sent")}
        >
          {rt("Đã gửi", "Sent")}
        </button>
      </div>
      <ErrorNotice error={data.error} retry={data.reload} />
      {data.loading ? (
        <ContentSkeleton
          label={rt("Đang tải hộp yêu cầu…", "Loading requests…")}
        />
      ) : items.length ? (
        <ul className="rm-inbox-list">
          {items.map((item) => (
            <li key={item.request_id}>
              <div>
                <strong>{stateName(item.state)}</strong>
                <p className="rm-hint">
                  {rt("Mã", "ID")}: {item.request_id.slice(0, 8)} ·{" "}
                  {rt("Tạo ngày ", "Created ")}
                  {dateLabel(item.created_at)}
                </p>
                <p>
                  {rt("Hạn phản hồi: ", "Reply deadline: ")}
                  {deadlineLabel(item.expires_at)}
                </p>
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
                  {rt("Xem yêu cầu", "View request")}
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
    </section>
  );
}
