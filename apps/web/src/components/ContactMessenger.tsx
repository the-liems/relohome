import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Bell, Minus, X } from "lucide-react";
import { api } from "../api";
import type { Data } from "../types";
import { t, formatUi } from "../uiPreferences";
import { ContactThread } from "./ContactThread";
import "./contactMessenger.css";
import { RoommateError } from "../roommate/client";
import { useRoommateClient } from "../roommate/useRoommateClient";
import { RoommateThread } from "../roommate/RoommateThread";
import type { ChatConversation } from "../roommate/chatTypes";

type Conversation = {
  id: string;
  title: string;
  counterpartyName?: string;
} & ({ kind?: "housing"; role: "tenant" | "landlord" } | { kind: "roommate" });
const personName = (role: "tenant" | "landlord", name?: string) =>
  name?.trim() || (role === "landlord" ? t("Người thuê") : t("Chủ nhà"));
const Context = createContext({
  open: (_id: string, _title: string, _role: "tenant" | "landlord") => {},
  openRoommate: (_id: string, _name?: string) => {},
  refresh: () => {},
});
export const useContactMessenger = () => useContext(Context);
const summary = (row: Data) =>
  row.payment_status === "pending"
    ? row.role === "landlord"
      ? t("Người thuê báo đã chuyển tiền")
      : t("Chờ chủ nhà xác nhận nhận tiền")
    : row.payment_status === "confirmed"
      ? t("Chủ nhà đã xác nhận nhận tiền")
      : row.payment_status === "rejected"
        ? t("Chủ nhà phản hồi báo cáo chuyển tiền")
        : row.viewing_status === "declined"
          ? t("Chủ nhà đề xuất giờ xem khác")
          : row.viewing_status === "confirmed"
            ? t("Lịch xem đã được xác nhận")
            : row.viewing_status === "requested"
              ? t("Có yêu cầu xác nhận lịch xem")
              : t("Có cập nhật mới");

export function ContactMessengerProvider({
  userId,
  children,
  admin = false,
  enabled = true,
}: {
  userId: string;
  admin?: boolean;
  enabled?: boolean;
  children: ReactNode;
}) {
  const roommate = useRoommateClient(userId);
  const [rows, setRows] = useState<Data[]>([]),
    [stateOwner, setStateOwner] = useState(userId),
    [current, setCurrent] = useState<Conversation | null>(null),
    [expanded, setExpanded] = useState(false),
    [list, setList] = useState(false),
    [notice, setNotice] = useState("");
  const previous = useRef("");
  const [chatRows, setChatRows] = useState<ChatConversation[]>([]),
    [chatMore, setChatMore] = useState(false),
    [chatOffset, setChatOffset] = useState(0),
    [chatUnread, setChatUnread] = useState(0);
  const chatAvailable = useRef<boolean | null>(null);
  const chatGeneration = useRef(0),
    currentChatOffset = useRef(chatOffset);
  currentChatOffset.current = chatOffset;
  const viewer = useRef(userId);
  viewer.current = userId;
  const refresh = useCallback(async () => {
    try {
      if (!enabled) return;
      const data = admin
        ? { items: [] }
        : await api<Data>(
            "/housing-management/housing/contact-notifications",
            "GET",
            undefined,
            undefined,
            { "X-SIU-User": userId },
          );
      if (viewer.current !== userId) return;
      const items = data.items || [];
      const stamp = JSON.stringify(
        items.map((row: Data) => [
          row.id,
          row.unread,
          row.update_unread,
          row.updated_at,
        ]),
      );
      if (previous.current && previous.current !== stamp) {
        window.dispatchEvent(new Event("housing-contact-update"));
        if (items.some((row: Data) => row.unread > 0 || row.update_unread))
          setNotice(
            `${items.find((row: Data) => row.unread || row.update_unread)?.property_name || items.find((row: Data) => row.unread || row.update_unread)?.title || t("Tin nhắn")} · ${t("Có tin nhắn hoặc cập nhật mới về nhà thuê.")}`,
          );
      }
      previous.current = stamp;
      setRows(items);
    } catch {
      /* Open conversations show actionable errors; background polling stays quiet. */
    }
  }, [userId, admin, enabled]);
  const refreshChat = useCallback(async () => {
    if (!enabled || admin) return;
    const owner = userId;
    const version = ++chatGeneration.current;
    try {
      if (chatAvailable.current === null) {
        const availability = await roommate<{ features?: string[] }>(
          "/availability",
        );
        if (viewer.current !== owner) return;
        chatAvailable.current = Boolean(
          availability.features?.includes("chat"),
        );
      }
      if (!chatAvailable.current) return;
      const response = await roommate<{
        items: ChatConversation[];
        has_more: boolean;
        unread_total?: number;
      }>("/chat/conversations?offset=" + chatOffset);
      if (
        viewer.current !== owner ||
        currentChatOffset.current !== chatOffset ||
        version !== chatGeneration.current
      )
        return;
      setChatRows(response.items);
      setChatMore(response.has_more);
      setChatUnread(
        response.unread_total ??
          response.items.reduce((sum, row) => sum + row.unread, 0),
      );
    } catch (cause) {
      if (viewer.current !== owner || version !== chatGeneration.current)
        return;
      if (
        cause instanceof RoommateError &&
        (cause.code === "actor_changed" ||
          [401, 403, 404].includes(cause.status))
      ) {
        setChatRows([]);
        setChatUnread(0);
      }
    }
  }, [enabled, admin, userId, chatOffset, roommate]);
  useEffect(() => {
    setCurrent(null);
    setStateOwner(userId);
    setRows([]);
    setChatRows([]);
    setChatMore(false);
    setChatOffset(0);
    setChatUnread(0);
    chatAvailable.current = null;
    previous.current = "";
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    void refreshChat();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshChat();
    }, 10000);
    window.addEventListener("roommate-chat-update", refreshChat);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("roommate-chat-update", refreshChat);
    };
  }, [refreshChat]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const open = useCallback(
    (id: string, title: string, role: "tenant" | "landlord") => {
      setCurrent({ id, title, role });
      setExpanded(true);
      setList(false);
      setNotice("");
    },
    [],
  );
  const openRoommate = useCallback((id: string, name?: string) => {
    setCurrent({
      id,
      title: t("Ở ghép"),
      kind: "roommate",
      counterpartyName: name,
    });
    setExpanded(true);
    setList(false);
    setNotice("");
  }, []);
  // Count only conversations visible in this bell; system updates stay inside their chat.
  const unread = rows.reduce(
    (count, row) =>
      count + Number(row.unread || 0) + (row.update_unread ? 1 : 0),
    chatUnread,
  );
  const currentName =
    current &&
    (current.kind === "roommate"
      ? current.counterpartyName || t("Người ở ghép")
      : personName(
          current.role,
          current.counterpartyName ||
            rows.find((row) => row.id === current.id)?.counterparty_name,
        ));
  const heading = current
    ? current.kind === "roommate"
      ? currentName
      : `${current.title} – ${currentName}`
    : "";
  return (
    <Context.Provider
      value={{
        open,
        openRoommate,
        refresh: () => {
          void refresh();
          void refreshChat();
        },
      }}
    >
      {children}
      <aside
        hidden={!enabled || stateOwner !== userId}
        style={
          !enabled || stateOwner !== userId ? { display: "none" } : undefined
        }
        className="contact-messenger"
        aria-label={t("Tin nhắn và cập nhật nhà thuê / ở ghép")}
      >
        {notice && (
          <div className="contact-messenger-toast" role="status">
            {notice}
          </div>
        )}
        {stateOwner === userId && list && (
          <section className="contact-messenger-panel">
            <header>
              <strong>{t("Tin nhắn")}</strong>
              <button
                onClick={() => setList(false)}
                aria-label={t("Đóng danh sách tin nhắn")}
              >
                <X size={18} />
              </button>
            </header>
            <div className="contact-messenger-conversations">
              {chatRows.map((row) => (
                <button
                  key={"roommate:" + row.id}
                  className={row.unread ? "unread" : ""}
                  onClick={() =>
                    openRoommate(row.id, row.counterparty_name || undefined)
                  }
                >
                  <strong>{row.counterparty_name || t("Người ở ghép")}</strong>
                  <span>
                    {t("Ở ghép")} ·{" "}
                    {row.state === "active"
                      ? t("Đã kết nối")
                      : t("Đã ngừng kết nối")}
                  </span>
                  {row.unread > 0 && (
                    <small>{formatUi("{0} tin chưa đọc", [row.unread])}</small>
                  )}
                </button>
              ))}
              {chatOffset > 0 && (
                <button
                  onClick={() => {
                    setChatRows([]);
                    setChatOffset((offset) => Math.max(0, offset - 25));
                  }}
                >
                  {t("Trước")}
                </button>
              )}
              {chatMore && (
                <button
                  onClick={() => {
                    setChatRows([]);
                    setChatOffset((offset) => offset + 25);
                  }}
                >
                  {t("Xem thêm hội thoại ở ghép")}
                </button>
              )}
              {rows.length
                ? rows.map((row) => (
                    <button
                      className={
                        row.unread || row.update_unread ? "unread" : ""
                      }
                      key={row.id}
                      onClick={() => open(row.id, row.title, row.role)}
                    >
                      <strong>
                        {personName(row.role, row.counterparty_name)}
                      </strong>
                      <span>{row.title}</span>
                      <span>{summary(row)}</span>
                      {row.unread > 0 && (
                        <small>
                          {formatUi("{0} tin chưa đọc", [row.unread])}
                        </small>
                      )}
                    </button>
                  ))
                : !chatRows.length && <p>{t("Chưa có cuộc trò chuyện.")}</p>}
            </div>
          </section>
        )}
        {stateOwner === userId && current && expanded && (
          <section
            className="contact-messenger-panel"
            role="dialog"
            aria-label={formatUi("Tin nhắn · {0}", [heading])}
          >
            <header>
              <div>
                <strong>{heading}</strong>
                <small>
                  {current.kind === "roommate"
                    ? t("Ở ghép")
                    : current.role === "landlord"
                      ? t("Người thuê")
                      : t("Chủ nhà")}
                </small>
              </div>
              <button
                onClick={() => setExpanded(false)}
                aria-label={t("Thu gọn tin nhắn")}
              >
                <Minus size={18} />
              </button>
              <button
                onClick={() => {
                  setCurrent(null);
                  setExpanded(false);
                }}
                aria-label={t("Đóng tin nhắn")}
              >
                <X size={18} />
              </button>
            </header>
            {current.kind === "roommate" ? (
              <RoommateThread
                key={userId + ":roommate:" + current.id}
                conversationId={current.id}
                viewerId={userId}
                onRead={() => void refreshChat()}
                onDetails={(name) =>
                  setCurrent((value) =>
                    value?.kind === "roommate" &&
                    value.id === current.id &&
                    value.counterpartyName !== name
                      ? { ...value, counterpartyName: name }
                      : value,
                  )
                }
              />
            ) : (
              <ContactThread
                key={userId + current.id}
                requestId={current.id}
                viewerId={userId}
                expectedRole={current.role}
                onRead={() => void refresh()}
                onNavigate={() => setExpanded(false)}
                onDetails={(details) =>
                  setCurrent((value) =>
                    value?.kind !== "roommate" &&
                    value?.id === current.id &&
                    (value.title !== details.title ||
                      value.counterpartyName !== details.counterpartyName)
                      ? { ...value, ...details }
                      : value,
                  )
                }
              />
            )}
          </section>
        )}
        <div className="contact-messenger-controls">
          <button
            className="contact-messenger-toggle"
            onClick={() => {
              setList((value) => !value);
              setExpanded(false);
              setNotice("");
            }}
            aria-expanded={list}
            aria-label={formatUi("Tin nhắn và cập nhật · {0} chưa đọc", [
              unread,
            ])}
          >
            <Bell size={20} />
            {unread > 0 && (
              <b aria-hidden="true">{unread > 99 ? "99+" : unread}</b>
            )}
          </button>
        </div>
      </aside>
    </Context.Provider>
  );
}
