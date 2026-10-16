import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import { MessageComposer } from "../components/MessageComposer";
import { dateTime } from "../api";
import { RoommateError } from "./client";
import { useRoommateClient } from "./useRoommateClient";
import { ErrorNotice } from "./ErrorNotice";
import { rt } from "./text";
import type { ChatMessage, ChatPage } from "./chatTypes";

export function RoommateThread({
  conversationId,
  viewerId,
  onRead,
  onDetails,
}: {
  conversationId: string;
  viewerId: string;
  onRead: () => void;
  onDetails: (name: string) => void;
}) {
  const roommate = useRoommateClient(viewerId);
  const [page, setPage] = useState<ChatPage | null>(null),
    [text, setText] = useState(""),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<{
      body: string;
      client_message_id: string;
    } | null>(null),
    [older, setOlder] = useState<ChatMessage[]>([]),
    [olderHasMore, setOlderHasMore] = useState(true);
  const active = useRef(true),
    locked = useRef(false),
    loading = useRef(false),
    generation = useRef(0),
    read = useRef(onRead),
    details = useRef(onDetails),
    end = useRef<HTMLDivElement>(null);
  read.current = onRead;
  details.current = onDetails;
  const path = "/chat/conversations/" + encodeURIComponent(conversationId);
  const load = useCallback(
    async (force = false) => {
      if (loading.current && !force) return;
      const version = ++generation.current;
      loading.current = true;
      try {
        const next = await roommate<ChatPage>(path + "/messages");
        if (!active.current || version !== generation.current) return;
        if (next.viewer_id !== viewerId)
          throw new RoommateError("authentication_required", 401);
        setPage(next);
        setError(null);
        details.current(
          next.counterparty_name || rt("Người ở ghép", "Roommate"),
        );
        const last = next.items.at(-1);
        if (last)
          await roommate(path + "/read", "POST", { message_id: last.id });
        if (active.current && version === generation.current) read.current();
      } catch (cause) {
        if (!active.current || version !== generation.current) return;
        setPage(null);
        setOlder([]);
        setError(cause);
        if (
          cause instanceof RoommateError &&
          (cause.code === "actor_changed" ||
            [401, 403, 404].includes(cause.status))
        ) {
          setText("");
          setPending(null);
        }
      } finally {
        if (version === generation.current) loading.current = false;
      }
    },
    [path, viewerId, roommate],
  );
  useEffect(() => {
    active.current = true;
    void load();
    const invalidate = () => {
      setPage(null);
      setOlder([]);
      setText("");
      setPending(null);
      void load(true);
    };
    window.addEventListener("roommate-chat-update", invalidate);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      active.current = false;
      generation.current++;
      loading.current = false;
      window.clearInterval(timer);
      window.removeEventListener("roommate-chat-update", invalidate);
    };
  }, [load]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [page?.items.at(-1)?.id]);
  async function transmit(payload: {
    body: string;
    client_message_id: string;
  }) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await roommate(path + "/messages", "POST", payload);
      if (!active.current) return;
      setPending(null);
      setText("");
      await load();
    } catch (cause) {
      if (!active.current) return;
      setError(cause);
      if (
        !(cause instanceof RoommateError) ||
        cause.code !== "operation_unknown"
      )
        setPending(null);
      if (
        cause instanceof RoommateError &&
        (cause.code === "actor_changed" ||
          [401, 403, 404].includes(cause.status))
      ) {
        setPage(null);
        setOlder([]);
        setText("");
        setPending(null);
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function send(event: FormEvent) {
    event.preventDefault();
    if (pending || !text.trim() || page?.state !== "active") return;
    const payload = {
      body: text.trim(),
      client_message_id: crypto.randomUUID(),
    };
    setPending(payload);
    void transmit(payload);
  }
  async function previous() {
    const first = older[0] || page?.items[0];
    if (!first || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const result = await roommate<ChatPage>(
        path + "/messages?before=" + encodeURIComponent(first.id),
      );
      if (!active.current) return;
      setOlder((value) => [...result.items, ...value]);
      setOlderHasMore(result.has_more);
    } catch (cause) {
      if (active.current) {
        setError(cause);
        setOlder([]);
        setPage(null);
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  const messages = [...older, ...(page?.items || [])].filter(
    (message, index, all) =>
      all.findIndex((item) => item.id === message.id) === index,
  );
  return (
    <div className="contact-thread" data-service="roommate">
      <ErrorNotice error={error} retry={() => void load()} />
      {!page && !error && (
        <p role="status">{rt("Đang tải tin nhắn…", "Loading messages…")}</p>
      )}
      {page && (
        <>
          <p className="contact-thread-hint small">
            {rt(
              "Hai bạn đã đồng ý kết nối. Trò chuyện tại đây, không cần chia sẻ số điện thoại.",
              "You both accepted the connection. Chat here without sharing your phone number.",
            )}
          </p>
          {page.retention_days && (
            <p className="contact-thread-hint small">
              {rt(
                `Tin nhắn được lưu tối đa ${page.retention_days} ngày.`,
                `Messages are kept for up to ${page.retention_days} days.`,
              )}
            </p>
          )}
          {!!page.has_more && olderHasMore && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void previous()}
            >
              {rt("Tin nhắn trước", "Earlier messages")}
            </button>
          )}
          <ol
            className="contact-thread-list"
            tabIndex={0}
            aria-label={rt("Tin nhắn ở ghép", "Roommate messages")}
          >
            {!messages.length && (
              <li className="rm-chat-empty">
                <strong>
                  {rt("Bắt đầu làm quen", "Start a conversation")}
                </strong>
                <p>
                  {rt(
                    "Hỏi nhau về khu vực, ngân sách hoặc thời điểm chuyển nhé.",
                    "Ask about your preferred area, budget or move-in date.",
                  )}
                </p>
              </li>
            )}
            {messages.map((message) => (
              <li
                key={message.id}
                className={message.sender_id === viewerId ? "mine" : "theirs"}
              >
                <span className="contact-thread-who">
                  {message.sender_id === viewerId
                    ? rt("Bạn", "You")
                    : page.counterparty_name}{" "}
                  · {dateTime(message.created_at)}
                </span>
                <p>{message.body}</p>
              </li>
            ))}
          </ol>
          <div ref={end} />
          {page.state === "active" ? (
            <MessageComposer
              text={text}
              change={setText}
              send={send}
              busy={busy}
              locked={Boolean(pending)}
              placeholder={rt(
                "Chào bạn, mình muốn trao đổi về việc ở ghép…",
                "Hi, I'd like to discuss sharing a home…",
              )}
            />
          ) : (
            <p role="status">
              {rt(
                "Kết nối đã dừng. Bạn vẫn có thể xem lịch sử còn được phép.",
                "This connection is closed. Available history is read-only.",
              )}
            </p>
          )}
          <Link
            className="text-button"
            to={"/roommate/requests/" + encodeURIComponent(page.request_id)}
          >
            {rt(
              "Chi tiết kết nối · Chặn / Báo cáo",
              "Connection details · Block / Report",
            )}
          </Link>
        </>
      )}
      {pending && !busy && (
        <button className="secondary" onClick={() => void transmit(pending)}>
          {rt("Thử lại cùng tin nhắn", "Retry the same message")}
        </button>
      )}
    </div>
  );
}
