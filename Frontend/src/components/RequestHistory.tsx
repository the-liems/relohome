import { formatUi } from "../uiPreferences";
import { t as uiText } from "../uiPreferences";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, History, Search } from "lucide-react";
import { api, dateTime } from "../api";
import type { Message, Thread } from "../types";
import { ContentSkeleton } from "./UiStates";

const LABELS: Record<string, string> = {
  ANSWER: "Có phản hồi",
  CLARIFY: "Cần bổ sung",
  ERROR: "Có lỗi",
  UNSUPPORTED: "Chưa hỗ trợ",
  pending: "Chờ phản hồi",
  unknown: "Cần kiểm tra",
  confirmation_required: "Chờ xác nhận",
  payment_required: "Chờ thanh toán",
};

export function RequestHistory({ threads }: { threads: Thread[] }) {
  const [loaded, setLoaded] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(12),
    [expanded, setExpanded] = useState<string | null>(null);
  const revision = threads
    .map((t) => `${t.id}:${t.revision}:${t.updated}`)
    .join("|");
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    Promise.allSettled(
      threads.map((t) =>
        api<Thread>("/threads/" + t.id, "GET", undefined, abort.signal),
      ),
    ).then((results) => {
      if (abort.signal.aborted) return;
      setLoaded(
        results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
      );
      if (results.some((r) => r.status === "rejected"))
        setError(
          "Một số hội thoại chưa tải được. Bạn có thể tải lại trang để xem đủ lịch sử.",
        );
      setLoading(false);
    });
    return () => abort.abort();
  }, [revision]);

  const calls = loaded
    .flatMap((thread) =>
      (thread.messages || []).flatMap((message, index) => {
        if (message.role !== "user") return [];
        let reply: Message | undefined;
        for (const next of thread.messages.slice(index + 1)) {
          if (next.role === "user") break;
          if (next.role === "assistant") {
            reply = next;
            break;
          }
        }
        const status = reply?.content.uncertain
          ? "unknown"
          : reply?.content.response?.kind || "pending";
        return [
          { id: thread.id + ":" + message.id, thread, message, reply, status },
        ];
      }),
    )
    .sort((a, b) => b.message.created - a.message.created);
  const visible = calls.filter(
    (call) =>
      (filter === "all" || call.status === filter) &&
      `${call.thread.title} ${call.message.content.text || ""} ${call.reply?.content.response?.text || ""}`
        .toLocaleLowerCase("vi")
        .includes(search.toLocaleLowerCase("vi")),
  );

  return (
    <section className="request-history" aria-label={uiText("Lịch sử yêu cầu")}>
      <div className="request-history-head">
        <div>
          <h3>{uiText("Lịch sử các lần gửi yêu cầu")}</h3>
          <p className="muted">
            {uiText(
              "Xem yêu cầu, phản hồi và thời gian đã lưu. Chọn một hội thoại để tiếp tục.",
            )}
          </p>
        </div>
        <span className="tag">
          {loading ? uiText("Đang tải…") : formatUi("{0} lượt", [calls.length])}
        </span>
      </div>
      <div className="request-history-filters">
        <label className="history-search">
          <Search size={16} />
          <input
            aria-label={uiText("Tìm trong lịch sử yêu cầu")}
            placeholder={uiText("Tìm yêu cầu hoặc hội thoại…")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(12);
            }}
          />
        </label>
        <select
          aria-label={uiText("Lọc trạng thái yêu cầu")}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setLimit(12);
          }}
        >
          <option value="all">{uiText("Mọi trạng thái")}</option>
          {Object.entries(LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {uiText(label)}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="notice amber" role="status">
          {uiText(error)}
        </p>
      )}
      {loading ? (
        <ContentSkeleton label={uiText("Đang đọc lịch sử đã lưu…")} />
      ) : visible.length ? (
        <div className="request-history-list">
          {visible.slice(0, limit).map((call) => (
            <article className="request-history-card" key={call.id}>
              <div className="request-history-meta">
                <span>
                  <History size={13} />
                  {dateTime(call.message.created)}
                </span>
                <span className={"request-status " + call.status}>
                  {uiText(LABELS[call.status] || call.status)}
                </span>
              </div>
              <h4>
                {call.message.content.text || uiText("Yêu cầu trong hội thoại")}
              </h4>
              <small className="muted">{call.thread.title}</small>
              {expanded === call.id && (
                <p className="request-history-reply">
                  {call.reply?.content.response?.text ||
                    uiText("Chưa có phản hồi được lưu cho lượt này.")}
                </p>
              )}
              <div className="request-history-actions">
                <button
                  className="text-button"
                  aria-expanded={expanded === call.id}
                  onClick={() =>
                    setExpanded(expanded === call.id ? null : call.id)
                  }
                >
                  {expanded === call.id
                    ? uiText("Thu gọn")
                    : uiText("Xem phản hồi")}
                </button>
                <Link to={"/ai/" + call.thread.id}>
                  {uiText("Mở hội thoại ")}
                  <ArrowUpRight size={14} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="request-history-empty">
          <History size={28} />
          <h3>
            {calls.length
              ? uiText("Không có yêu cầu phù hợp")
              : uiText("Chưa có lịch sử yêu cầu")}
          </h3>
          <p className="muted">
            {calls.length
              ? uiText("Thử đổi từ khóa hoặc trạng thái lọc.")
              : uiText(
                  "Các yêu cầu bạn gửi cho ReloHome sẽ xuất hiện tại đây.",
                )}
          </p>
        </div>
      )}
      {visible.length > limit && (
        <button className="secondary" onClick={() => setLimit(limit + 12)}>
          {uiText("Xem thêm ")}
          {Math.min(12, visible.length - limit)}
          {uiText(" lượt")}
        </button>
      )}
    </section>
  );
}
