import { useState } from "react";
import {
  ChevronDown,
  MapPin,
  MessageCircle,
  Send,
  Sparkles,
} from "lucide-react";
import type { Data } from "../types";

export interface ChatDockProps {
  text?: string;
  // The last answer is the result this workspace already shows; the dock summarises it instead.
  fromResult?: boolean;
  kind?: string;
  questions: Data[];
  suggestions?: Data[];
  busy: boolean;
  error?: string;
  online: boolean;
  onSend: (text: string, extra?: Data) => Promise<void>;
}

// Chat docked over a service workspace (map, flights, moving). It can be hidden so the
// workspace stays readable; a floating button brings it back.
export function WorkspaceChat({
  text,
  kind,
  questions,
  suggestions = [],
  busy,
  error,
  online,
  placeholder,
  caption,
  onSendText,
  onChoose,
}: ChatDockProps & {
  placeholder: string;
  caption?: string;
  onSendText: (text: string, extra?: Data) => Promise<void>;
  onChoose?: (choice: Data) => Promise<void>;
}) {
  const [draft, setDraft] = useState(""),
    [expanded, setExpanded] = useState(false),
    [hidden, setHidden] = useState(false);
  async function submit() {
    if (!draft.trim() || busy) return;
    const value = draft;
    setDraft("");
    try {
      await onSendText(value);
    } catch {
      setDraft(value);
    }
  }
  if (hidden)
    return (
      <button
        className="ws-chat-show"
        onClick={() => setHidden(false)}
        aria-label="Hiện khung chat"
      >
        <MessageCircle size={17} /> Chat với SIU
        {busy && <span className="spinner small" />}
      </button>
    );
  return (
    <div className="ws-dock" aria-label="Trò chuyện với SIU AI">
      <div className={"ws-dock-answer " + (kind === "ERROR" ? "error" : "")}>
        <div className="ws-dock-head">
          <span className="assistant-label">
            SIU AI <Sparkles size={12} />
          </span>
          <button
            className="text-button"
            onClick={() => setHidden(true)}
            aria-label="Ẩn khung chat"
          >
            Ẩn chat <ChevronDown size={14} />
          </button>
        </div>
        {busy ? (
          <p className="muted">SIU đang xử lý yêu cầu của bạn…</p>
        ) : (
          text && <p className={expanded ? "prose" : "prose clamp"}>{text}</p>
        )}
        {!busy && text && text.length > 160 && (
          <button
            className="text-button"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Thu gọn" : "Xem đầy đủ"}
          </button>
        )}
        {!busy &&
          questions.map((q, i) => (
            <div className="tags" key={i}>
              {(q.choices?.length
                ? q.choices
                : (q.options || []).map((o: string) => ({ label: o }))
              ).map((c: Data) => (
                <button
                  key={c.id || c.label}
                  className="suggestion"
                  onClick={() =>
                    void (
                      c.id && onChoose
                        ? onChoose({ ...c, field: q.field })
                        : onSendText(c.label)
                    ).catch(() => {})
                  }
                >
                  {c.id && <MapPin size={12} />} {c.label}
                </button>
              ))}
            </div>
          ))}
        {!busy && suggestions.length > 0 && (
          <div className="tags">
            {suggestions.map((s) => (
              <button
                key={s.key}
                className="suggestion"
                onClick={() => void onSendText(s.message).catch(() => {})}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </div>
      <form
        className="ws-dock-input"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Sparkles size={18} className="muted" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label="Tin nhắn cho SIU AI"
          maxLength={5000}
        />
        <button
          className="send-button"
          disabled={busy || !draft.trim() || !online}
          aria-label="Gửi tin nhắn"
        >
          <Send size={18} />
        </button>
      </form>
      {caption && (
        <span className="ws-dock-caption muted small">{caption}</span>
      )}
    </div>
  );
}
