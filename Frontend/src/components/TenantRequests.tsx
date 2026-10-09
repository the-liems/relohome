import { formatUi, t as uiText } from "../uiPreferences";
import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { api, dateTime } from "../api";
import type { Data } from "../types";
import { VIEWING_HINT } from "./Housing";

// Contact requests the signed-in tenant sent to owner-managed listings (SPEC-021 AC-05).
const VIEWING: Record<string, string> = {
  requested: "Giờ xem {0}: chờ chủ nhà xác nhận",
  confirmed: "Giờ xem {0}: chủ nhà đã xác nhận",
  declined:
    "Giờ xem {0}: chủ nhà không nhận, hãy chọn giờ khác trong tab Xem nhà",
  cancelled: "Giờ xem {0}: bạn đã hủy",
};
const STATUS: Record<string, string> = {
  new: "Đã gửi, chủ nhà chưa xem",
  contacted: "Chủ nhà đã liên hệ",
  viewing: "Chủ nhà đã hẹn xem",
  resolved: "Đã hoàn tất",
  declined: "Đã đóng",
};

export function TenantRequests() {
  const [items, setItems] = useState<Data[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  async function load() {
    setError("");
    try {
      const page = await api<{ items: Data[] }>(
        "/housing-management/housing/contact-requests/me",
      );
      setItems(page.items);
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function cancel(item: Data) {
    setBusy(item.id);
    setError("");
    try {
      await api(
        `/housing-management/housing/contact-requests/${encodeURIComponent(item.id)}/cancel`,
        "POST",
        { revision: item.revision },
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (items === null)
    return <p role="status">{uiText("Đang tải yêu cầu liên hệ…")}</p>;
  return (
    <section className="surface tenant-requests">
      <h3>{uiText("Yêu cầu liên hệ đã gửi")}</h3>
      <p className="muted small">
        {uiText(
          "Lời nhắn bạn gửi tới chủ nhà qua ReloHome. Chủ nhà chỉ thấy nội dung bạn tự viết.",
        )}
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!items.length ? (
        <p className="muted">
          <Inbox size={16} />{" "}
          {uiText(
            'Chưa có yêu cầu nào. Mở một tin có nút "Gửi yêu cầu liên hệ" để bắt đầu.',
          )}
        </p>
      ) : (
        <ul className="tenant-request-list">
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.title}</strong>
              <span className="muted small">
                {formatUi("{0} · gửi lúc {1}", [
                  uiText(STATUS[item.status] || item.status),
                  dateTime(item.created_at),
                ])}
              </span>
              <blockquote>{item.message}</blockquote>
              {item.viewing_slot && VIEWING[item.viewing_status] && (
                <p className="small">
                  {formatUi(VIEWING[item.viewing_status], [
                    dateTime(item.viewing_slot),
                  ])}
                </p>
              )}
              {item.status === "viewing" && (
                <p className="muted small">{uiText(VIEWING_HINT)}</p>
              )}
              {["new", "contacted"].includes(item.status) && (
                <button
                  className="text-button"
                  disabled={busy === item.id}
                  onClick={() => void cancel(item)}
                >
                  {uiText("Hủy yêu cầu")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
