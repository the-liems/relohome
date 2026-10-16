import { useState } from "react";
import { Dialog } from "../components/Dialog";
import { useContactMessenger } from "../components/ContactMessenger";
import { useOperation } from "./useOperation";
import { ProfileSummary } from "./ProfileSummary";
import { SafetyActions } from "./SafetyActions";
import { ServiceSuggestions } from "../components/ServiceSuggestions";
import { deadlineLabel, rt, stateName } from "./text";
import type { RequestDetail } from "./types";

export function ChatConnectionDetails({
  record,
  reload,
}: {
  record: RequestDetail;
  reload: () => void;
}) {
  const operation = useOperation(),
    messenger = useContactMessenger();
  const [closing, setClosing] = useState(false);
  function action(value: string) {
    const path = value === "accept" ? "/chat/requests/" : "/requests/";
    operation.run(
      path + encodeURIComponent(record.request_id) + "/" + value,
      "POST",
      {},
      (result) => {
        reload();
        messenger.refresh();
        if (typeof result.conversation_id === "string")
          messenger.openRoommate(result.conversation_id);
      },
    );
  }
  return (
    <div className="rm-detail-columns">
      <section className="rm-panel">
        <h2>{rt("Bản giới thiệu kết nối", "Connection introduction")}</h2>
        {record.intro && (
          <ProfileSummary profile={{ ...record.intro, preferences: {} }} full />
        )}
      </section>
      <aside className="rm-panel">
        <h2>{stateName(record.state)}</h2>
        {record.state === "pending" && (
          <>
            <p>
              {rt(
                "Khi người nhận đồng ý, hai bạn có thể trò chuyện trong ReloHome. Không cần chia sẻ Phone/Zalo.",
                "Once accepted, you can chat in ReloHome without sharing phone numbers or Zalo.",
              )}
            </p>
            <p className="rm-hint">
              {rt("Hạn phản hồi: ", "Reply deadline: ")}
              {deadlineLabel(record.expires_at)}
            </p>
            <div className="rm-actions">
              {record.actions?.map((value) => (
                <button
                  key={value}
                  className={value === "accept" ? "primary" : "secondary"}
                  disabled={operation.disabled}
                  onClick={() => action(value)}
                >
                  {value === "accept"
                    ? rt("Đồng ý kết nối", "Accept connection")
                    : value === "reject"
                      ? rt("Từ chối", "Decline")
                      : rt("Rút yêu cầu", "Withdraw request")}
                </button>
              ))}
            </div>
          </>
        )}
        {record.conversation_id && (
          <>
            <p>
              {record.conversation_state === "active"
                ? rt(
                    "Hai bạn đã kết nối. Có thể nhắn tin ngay tại đây.",
                    "You are connected. Start chatting here.",
                  )
                : rt(
                    "Kết nối đã dừng. Lịch sử còn được phép chỉ để đọc.",
                    "This connection is closed. Available history is read-only.",
                  )}
            </p>
            <button
              className="primary"
              onClick={() => messenger.openRoommate(record.conversation_id!)}
            >
              {rt("Nhắn tin", "Message")}
            </button>
            {record.conversation_state === "active" && (
              <button
                className="text-button"
                disabled={operation.disabled}
                onClick={() => setClosing(true)}
              >
                {rt("Ngừng kết nối", "End connection")}
              </button>
            )}
          </>
        )}
        {operation.notice}
        {record.counterparty_id && (
          <SafetyActions
            id={record.counterparty_id}
            hidden={() => {
              reload();
              messenger.refresh();
              window.dispatchEvent(new Event("roommate-chat-update"));
            }}
          />
        )}
        {record.conversation_state === "active" && (
          <ServiceSuggestions service="roommate" />
        )}
      </aside>
      {closing && (
        <Dialog
          title={rt("Ngừng kết nối?", "End this connection?")}
          onClose={() => !operation.disabled && setClosing(false)}
        >
          <div className="rm-dialog-content">
            <p>
              {rt(
                "Hai bên sẽ không gửi thêm tin nhắn được. Muốn trò chuyện lại cần một yêu cầu kết nối mới.",
                "Neither person can send more messages. Chatting again requires a new connection request.",
              )}
            </p>
            {operation.notice}
            <button
              className="primary"
              disabled={operation.disabled}
              onClick={() =>
                operation.run(
                  "/chat/conversations/" +
                    encodeURIComponent(record.conversation_id!) +
                    "/close",
                  "POST",
                  {},
                  () => {
                    setClosing(false);
                    reload();
                    messenger.refresh();
                    window.dispatchEvent(new Event("roommate-chat-update"));
                  },
                )
              }
            >
              {rt("Ngừng kết nối", "End connection")}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
