import { formatUi, t as uiText } from "../uiPreferences";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { activityText, activityDestination } from "../housingActivity";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { MessageComposer, MessageReadReceipt } from "./MessageComposer";
import { api, dateTime } from "../api";
import type { Data } from "../types";

// Messages between the tenant and the landlord of one contact request. Both sides use this
// component; the server decides who the caller is and never shows phone numbers.
const REFRESH_MS = 15_000; // a light poll while the conversation is open

export function ContactThread({
  requestId,
  onRead,
  viewerId,
  expectedRole,
  onDetails,
  onNavigate,
}: {
  requestId: string;
  onNavigate?: () => void;
  onRead?: () => void;
  viewerId?: string;
  expectedRole?: "tenant" | "landlord";
  onDetails?: (details: { title: string; counterpartyName?: string }) => void;
}) {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Data[]>([]);
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [text, setText] = useState(""),
    [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const identity = requestId + ":" + viewerId + ":" + expectedRole;
  const active = useRef(identity);
  active.current = identity;
  const read = useRef(onRead);
  read.current = onRead;
  const details = useRef(onDetails);
  details.current = onDetails;
  const path = `/housing-management/housing/contact-requests/${encodeURIComponent(requestId)}/messages`;
  const load = useCallback(async () => {
    try {
      const response = await api<Data>(
        path,
        "GET",
        undefined,
        undefined,
        viewerId ? { "X-SIU-User": viewerId } : undefined,
      );
      if (active.current !== identity) return;
      if (expectedRole && response.role !== expectedRole)
        throw new Error(
          uiText(
            "Tài khoản hiện tại không khớp bên đang trò chuyện. Hãy kiểm tra tài khoản và dùng hai phiên đăng nhập riêng.",
          ),
        );
      setData(response);
      const activity = await api<Data>(
        path.replace(/messages$/, "activity"),
        "GET",
        undefined,
        undefined,
        viewerId ? { "X-SIU-User": viewerId } : undefined,
      ).catch(() => ({ items: [] }));
      if (active.current !== identity) return;
      setEvents(activity.items || []);
      setError("");
      details.current?.({
        title: response.request.title,
        counterpartyName: response.counterparty_name,
      });
      read.current?.();
    } catch (e) {
      if (active.current !== identity) return;
      setData(null);
      setError((e as Error).message);
    }
  }, [path, viewerId, expectedRole, identity]);
  useEffect(() => {
    setData(null);
    setText("");
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
      await api(
        path,
        "POST",
        { body: text.trim() },
        undefined,
        viewerId ? { "X-SIU-User": viewerId } : undefined,
      );
      setText("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function followEvent(event: Data) {
    try {
      const headers = viewerId ? { "X-SIU-User": viewerId } : undefined;
      const linked = await api<Data>(
        "/housing-management/housing/activity",
        "GET",
        undefined,
        undefined,
        headers,
      );
      const row =
        linked.items?.find((item: Data) => item.id === event.id) || event;
      const destination = activityDestination(row);
      if (!destination)
        throw new Error(
          uiText(
            "Chưa tìm thấy kế hoạch của yêu cầu này. Hãy mở lại hội thoại đã đặt lịch.",
          ),
        );
      await api(
        `/housing-management/housing/activity/${row.id}/read`,
        "POST",
        {},
        undefined,
        headers,
      );
      navigate(destination);
      onNavigate?.();
      window.dispatchEvent(new Event("housing-contact-update"));
    } catch (cause) {
      setError((cause as Error).message);
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
      sender_user_id: request.tenant_user_id,
      body: request.message,
      created_at: request.created_at,
    },
    ...(data.messages || []),
    ...events.map((event) => ({
      ...event,
      system: true,
      body: activityText(event),
    })),
  ].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const lastMessage = rows.filter((row) => !row.system).at(-1);
  const seen = role === "tenant" && lastMessage?.sender_role === "tenant" &&
    data.counterparty_read_at && Date.parse(data.counterparty_read_at) >= Date.parse(lastMessage.created_at);
  async function cancelRequest() {
    setSending(true);
    try {
      // The messages response omits revision. Read the current request before its guarded mutation.
      const headers = viewerId ? { "X-SIU-User": viewerId } : undefined;
      const own = await api<Data>(
        "/housing-management/housing/contact-requests/me",
        "GET", undefined, undefined, headers,
      );
      if (active.current !== identity) return;
      const latest = own.items?.find((item: Data) => item.id === requestId);
      if (!latest || !Number.isInteger(latest.revision))
        throw new Error(uiText("Không tìm thấy yêu cầu liên hệ."));
      await api(
        path.replace(/messages$/, "cancel"), "POST",
        { revision: latest.revision }, undefined, headers,
      );
      await load();
      window.dispatchEvent(new Event("housing-contact-update"));
    } catch (cause) { setError((cause as Error).message); }
    finally { setSending(false); }
  }
  return (
    <div className="contact-thread">
      <p className="contact-request-status">{formatUi("Trạng thái yêu cầu: {0}", [
        uiText(({ new: "Đã gửi yêu cầu", contacted: "Chủ nhà đã liên hệ", viewing: "Chủ nhà đã hẹn xem",
          resolved: "Đã hoàn tất", declined: "Đã đóng" } as Record<string, string>)[request.status] || request.status),
      ])}</p>
      <ol
        className="contact-thread-list"
        tabIndex={0}
        aria-label={uiText("Tin nhắn")}
      >
        {rows.map((m) => {
          const mine =
            m.sender_user_id && data.viewer_id
              ? m.sender_user_id === data.viewer_id
              : m.sender_role === role;
          return (
            <li
              key={m.id}
              className={m.system ? "system" : mine ? "mine" : "theirs"}
            >
              <span className="contact-thread-who">
                {m.system
                  ? uiText("Cập nhật ReloHome")
                  : mine
                    ? uiText("Bạn")
                    : m.sender_role === "landlord"
                      ? uiText("Chủ nhà")
                      : uiText("Người thuê")}
                {" · "}
                {dateTime(m.created_at)}
              </span>
              {m.system ? (
                <button
                  className="contact-system-action"
                  onClick={() => void followEvent(m)}
                  disabled={
                    m.audience !== (role === "landlord" ? "landlord" : "tenant")
                  }
                >
                  {m.body}
                  <small>
                    {m.audience ===
                    (role === "landlord" ? "landlord" : "tenant")
                      ? uiText("Mở chi tiết yêu cầu")
                      : uiText("Cập nhật đã gửi đến bên kia")}
                  </small>
                </button>
              ) : (
                <div className="contact-message-body"><p>{m.body}</p>
                  {seen && m.id === lastMessage?.id && <MessageReadReceipt />}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div ref={end} />
      <p className="contact-thread-hint small">
        <ShieldAlert size={14} aria-hidden="true" />{" "}
        {uiText(
          "Trao đổi lịch và câu hỏi tại đây. Không chuyển tiền cọc trước khi xem nhà và gặp chủ nhà.",
        )}
      </p>
      {request.open ? (
        <MessageComposer
          text={text}
          change={setText}
          send={send}
          busy={sending}
          placeholder={
            role === "tenant"
              ? uiText("Ví dụ: Chiều thứ Bảy em qua xem được không ạ?")
              : uiText("Ví dụ: Được em, 3 giờ chiều nhé.")
          }
        />
      ) : (
        <p className="muted small">
          {formatUi("Yêu cầu đã đóng ({0}); không gửi thêm tin nhắn được.", [
            uiText(request.status === "resolved" ? "hoàn tất" : "đã đóng"),
          ])}
        </p>
      )}
      {role === "tenant" && request.open && ["new", "contacted"].includes(request.status) && (
        <button className="text-button" disabled={sending} onClick={() => void cancelRequest()}>{uiText("Hủy yêu cầu")}</button>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
