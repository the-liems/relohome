import { Send } from "lucide-react";
import type { FormEvent } from "react";
import { t } from "../uiPreferences";

export function MessageComposer({
  text,
  change,
  send,
  busy,
  locked = false,
  placeholder,
}: {
  text: string;
  change: (value: string) => void;
  send: (event: FormEvent) => void;
  busy: boolean;
  locked?: boolean;
  placeholder: string;
}) {
  return (
    <form className="contact-thread-form" onSubmit={send}>
      <textarea
        aria-label={t("Nội dung tin nhắn")}
        maxLength={2000}
        rows={2}
        value={text}
        readOnly={locked}
        placeholder={placeholder}
        onChange={(event) => change(event.target.value)}
      />
      <button className="primary" disabled={busy || locked || !text.trim()}>
        <Send size={15} /> {t("Gửi")}
      </button>
    </form>
  );
}

// Shared message presentation; callers only render this with an actual counterpart read marker.
export function MessageReadReceipt() {
  return <span className="contact-thread-seen">{t("Đã xem")}</span>;
}
