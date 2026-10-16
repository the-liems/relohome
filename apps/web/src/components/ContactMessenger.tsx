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

type Conversation = {
  id: string;
  title: string;
  role: "tenant" | "landlord";
  counterpartyName?: string;
};
const personName = (role: "tenant" | "landlord", name?: string) =>
  name?.trim() || (role === "landlord" ? t("Người thuê") : t("Chủ nhà"));
const Context = createContext({
  open: (_id: string, _title: string, _role: "tenant" | "landlord") => {},
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
  const [rows, setRows] = useState<Data[]>([]),
    [current, setCurrent] = useState<Conversation | null>(null),
    [expanded, setExpanded] = useState(false),
    [list, setList] = useState(false),
    [notice, setNotice] = useState("");
  const previous = useRef("");
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
  useEffect(() => {
    setCurrent(null);
    setRows([]);
    previous.current = "";
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [refresh]);
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
  // Count only conversations visible in this bell; system updates stay inside their chat.
  const unread = rows.reduce(
    (count, row) =>
      count + Number(row.unread || 0) + (row.update_unread ? 1 : 0),
    0,
  );
  const currentName =
    current &&
    personName(
      current.role,
      current.counterpartyName ||
        rows.find((row) => row.id === current.id)?.counterparty_name,
    );
  const heading = current ? `${current.title} – ${currentName}` : "";
  return (
    <Context.Provider value={{ open, refresh: () => void refresh() }}>
      {children}
      <aside
        hidden={!enabled}
        style={!enabled ? { display: "none" } : undefined}
        className="contact-messenger"
        aria-label={t("Tin nhắn và cập nhật nhà thuê")}
      >
        {notice && (
          <div className="contact-messenger-toast" role="status">
            {notice}
          </div>
        )}
        {list && (
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
              {rows.length ? (
                rows.map((row) => (
                  <button
                    className={row.unread || row.update_unread ? "unread" : ""}
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
              ) : (
                <p>{t("Chưa có cuộc trò chuyện.")}</p>
              )}
            </div>
          </section>
        )}
        {current && expanded && (
          <section
            className="contact-messenger-panel"
            role="dialog"
            aria-label={formatUi("Tin nhắn · {0}", [heading])}
          >
            <header>
              <div>
                <strong>{heading}</strong>
                <small>
                  {current.role === "landlord" ? t("Người thuê") : t("Chủ nhà")}
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
            <ContactThread
              key={userId + current.id}
              requestId={current.id}
              viewerId={userId}
              expectedRole={current.role}
              onRead={() => void refresh()}
              onNavigate={() => setExpanded(false)}
              onDetails={(details) =>
                setCurrent((value) =>
                  value?.id === current.id &&
                  (value.title !== details.title ||
                    value.counterpartyName !== details.counterpartyName)
                    ? { ...value, ...details }
                    : value,
                )
              }
            />
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
