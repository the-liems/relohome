import { formatUi, t as uiText } from "../uiPreferences";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { LoaderCircle, Send, ShieldAlert } from "lucide-react";
import { api, dateTime } from "../api";
import type { Data } from "../types";

// Messages between the tenant and the landlord of one contact request. Both sides use this
// component; the server decides who the caller is and never shows phone numbers.
const REFRESH_MS = 15_000; // a light poll while the conversation is open

export function ContactThread({
  requestId,
  onRead,
}: {
  requestId: string;
  onRead?: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [text, setText] = useState(""),
    [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const read = useRef(onRead);
  read.current = onRead;
  const path = `/housing-management/housing/contact-requests/${encodeURIComponent(requestId)}/messages`;
  const load = useCallback(async () => {
    try {
      setData(await api<Data>(path));
      setError("");
      read.current?.();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [data?.messages?.length]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError("");
    try {
      await api(path, "POST", { body: text.trim() });
      setText("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  if (!data)
    return error ? (
      <p className="notice error" role="alert">
        {error}
      </p>
    ) : (
      <p role="status" className="muted small">
        <LoaderCircle size={14} className="spin" />{" "}
        {uiText("Đang tải tin nhắn…")}
      </p>
    );
  const role = data.role as "tenant" | "landlord";
  const request = data.request as Data;
  const rows: Data[] = [
    // The request itself is the tenant's first message.
    {
      id: "request",
      sender_role: "tenant",
      body: request.message,
      created_at: request.created_at,
    },
    ...(data.messages || []),
  ];
  return (
    <div className="contact-thread">
      <ol className="contact-thread-list" aria-label={uiText("Tin nhắn")}>
        {rows.map((m) => (
          <li key={m.id} className={m.sender_role === role ? "mine" : "theirs"}>
            <span className="contact-thread-who">
              {m.sender_role === role
                ? uiText("Bạn")
                : m.sender_role === "landlord"
                  ? uiText("Chủ nhà")
                  : uiText("Người thuê")}
              {" · "}
              {dateTime(m.created_at)}
            </span>
            <p>{m.body}</p>
          </li>
        ))}
      </ol>
      <div ref={end} />
      <p className="contact-thread-hint small">
        <ShieldAlert size={14} aria-hidden="true" />{" "}
        {uiText(
          "Trao đổi lịch và câu hỏi tại đây. Không chuyển tiền cọc trước khi xem nhà và gặp chủ nhà.",
        )}
      </p>
      {request.open ? (
        <form className="contact-thread-form" onSubmit={send}>
          <textarea
            aria-label={uiText("Nội dung tin nhắn")}
            maxLength={2000}
            rows={2}
            value={text}
            placeholder={
              role === "tenant"
                ? uiText("Ví dụ: Chiều thứ Bảy em qua xem được không ạ?")
                : uiText("Ví dụ: Được em, 3 giờ chiều nhé.")
            }
            onChange={(e) => setText(e.target.value)}
          />
          <button className="primary" disabled={sending || !text.trim()}>
            <Send size={15} /> {uiText("Gửi")}
          </button>
        </form>
      ) : (
        <p className="muted small">
          {formatUi("Yêu cầu đã đóng ({0}); không gửi thêm tin nhắn được.", [
            uiText(request.status === "resolved" ? "hoàn tất" : "đã đóng"),
          ])}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
