import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  MessageComposer,
  MessageReadReceipt,
} from "../components/MessageComposer";
import { dateTime } from "../api";
import { RoommateError } from "./client";
import { useRoommateClient } from "./useRoommateClient";
import { ErrorNotice } from "./ErrorNotice";
import { rt } from "./text";
import type { ChatPage } from "./chatTypes";
import { compareChatMessages, mergeChatPages } from "./chatHistory";
import { ResolveProfileAction } from "./ResolveProfileAction";

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
    } | null>(null);
  const active = useRef(true),
    locked = useRef(false),
    loading = useRef(false),
    generation = useRef(0),
    history = useRef<ChatPage | null>(null),
    historyEpoch = useRef(0),
    read = useRef(onRead),
    details = useRef(onDetails),
    end = useRef<HTMLDivElement>(null);
  read.current = onRead;
  details.current = onDetails;
  const path = "/chat/conversations/" + encodeURIComponent(conversationId);
  const savePage = useCallback((value: ChatPage) => {
    history.current = value;
    setPage(value);
  }, []);
  const clearHistory = useCallback(() => {
    historyEpoch.current++;
    history.current = null;
    setPage(null);
  }, []);
  const load = useCallback(
    async (force = false) => {
      if (loading.current && !force) return;
      const version = ++generation.current;
      const epoch = historyEpoch.current;
      loading.current = true;
      try {
        let next = await roommate<ChatPage>(path + "/messages");
        if (
          !active.current ||
          version !== generation.current ||
          epoch !== historyEpoch.current
        )
          return;
        if (next.viewer_id !== viewerId)
          throw new RoommateError("authentication_required", 401);
        const lastKnown = history.current?.items.at(-1);
        // A background tab may miss more than one latest page. Follow server
        // cursors until the refreshed range reaches the history already loaded.
        while (
          lastKnown &&
          next.has_more &&
          next.items[0] &&
          compareChatMessages(next.items[0], lastKnown) > 0
        ) {
          const first = next.items[0];
          const earlier = await roommate<ChatPage>(
            path + "/messages?before=" + encodeURIComponent(first.id),
          );
          if (
            !active.current ||
            version !== generation.current ||
            epoch !== historyEpoch.current
          )
            return;
          if (earlier.viewer_id !== viewerId)
            throw new RoommateError("authentication_required", 401);
          if (
            earlier.items[0] &&
            compareChatMessages(earlier.items[0], first) >= 0
          )
            throw new RoommateError("service_unavailable", 503);
          next = mergeChatPages(next, earlier);
        }
        savePage(
          next.items.length ? mergeChatPages(history.current, next) : next,
        );
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
        clearHistory();
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
    [path, viewerId, roommate, clearHistory, savePage],
  );
  useEffect(() => {
    active.current = true;
    void load();
    const invalidate = () => {
      clearHistory();
      setText("");
      setPending(null);
      void load(true);
    };
    window.addEventListener("roommate-chat-update", invalidate);
    const refreshProfile = () => void load(true);
    window.addEventListener("roommate-profile-update", refreshProfile);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      active.current = false;
      historyEpoch.current++;
      generation.current++;
      loading.current = false;
      window.clearInterval(timer);
      window.removeEventListener("roommate-chat-update", invalidate);
      window.removeEventListener("roommate-profile-update", refreshProfile);
    };
  }, [load, clearHistory]);
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
        clearHistory();
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
    const first = history.current?.items[0];
    if (!first || locked.current) return;
    const epoch = historyEpoch.current;
    locked.current = true;
    setBusy(true);
    try {
      const result = await roommate<ChatPage>(
        path + "/messages?before=" + encodeURIComponent(first.id),
      );
      if (!active.current || epoch !== historyEpoch.current) return;
      if (result.viewer_id !== viewerId)
        throw new RoommateError("authentication_required", 401);
      const merged = mergeChatPages(history.current, result);
      // An older-page request may finish after a newer status/unread refresh.
      // It extends history only; it must not roll conversation metadata back.
      savePage({
        ...merged,
        ...history.current,
        items: merged.items,
        has_more: merged.has_more,
      });
    } catch (cause) {
      if (active.current && epoch === historyEpoch.current) {
        setError(cause);
        clearHistory();
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  const messages = page?.items || [];
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
          {!!page.has_more && (
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
                {message.sender_id === viewerId &&
                  message.id === messages.at(-1)?.id &&
                  message.id === page.counterparty_read_message_id && (
                    <MessageReadReceipt />
                  )}
              </li>
            ))}
          </ol>
          <div ref={end} />
          {page.state === "active" ? (
            <>
              <ResolveProfileAction
                profile={page.own_profile}
                viewerId={viewerId}
                refresh={() => load(true)}
                resolved={(profile) => {
                  if (history.current)
                    savePage({ ...history.current, own_profile: profile });
                  window.dispatchEvent(new Event("roommate-profile-update"));
                }}
              />
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
            </>
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
