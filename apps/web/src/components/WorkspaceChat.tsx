import { t as uiText } from "../uiPreferences";
import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronDown,
  MapPin,
  MessageCircle,
  Send,
  Sparkles,
} from "lucide-react";
import type { Data } from "../types";
import { mergePlaceCandidates } from "../placeCandidates";

export interface ChatDockProps {
  text?: string;
  // The last answer is the result this workspace already shows; the dock summarises it instead.
  fromResult?: boolean;
  kind?: string;
  questions: Data[];
  suggestions?: Data[];
  busy: boolean;
  error?: string;
  notice?: string;
  online: boolean;
  onSend: (text: string, extra?: Data) => Promise<void>;
}

// Workspaces start with a floating launcher. Opening it reveals a compact composer;
// service results stay in the workspace and the full conversation remains in the main chat.
export function WorkspaceChat({
  text,
  kind,
  notice,
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
    [hidden, setHidden] = useState(true);
  const panelId = useId();
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (error || notice || questions.length) setHidden(false);
  }, [error, notice, questions.length]);
  useEffect(() => {
    if (!hidden) {
      opened.current = true;
      input.current?.focus();
    } else if (opened.current) launcher.current?.focus();
  }, [hidden]);
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
        ref={launcher}
        data-tour="workspace-chat"
        className="ws-chat-show"
        onClick={() => setHidden(false)}
        aria-label={uiText("Hiện khung chat")}
        aria-expanded={false}
        aria-controls={panelId}
      >
        <MessageCircle size={17} />
        {uiText(" Chat với ReloHome")}
        {busy && <span className="spinner small" />}
      </button>
    );
  return (
    <div
      id={panelId}
      data-tour="workspace-chat"
      className="ws-dock ws-dock-compact"
      role="region"
      aria-label={uiText("Trò chuyện với ReloHome")}
    >
      <form
        className="ws-dock-input"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Sparkles size={18} className="ws-dock-sparkle" />
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label={uiText("Tin nhắn cho ReloHome")}
          aria-describedby={caption ? panelId + "caption" : undefined}
          maxLength={5000}
        />
        <button
          className="send-button"
          disabled={busy || !draft.trim() || !online}
          aria-label={uiText("Gửi tin nhắn")}
        >
          {busy ? <span className="spinner small" /> : <Send size={18} />}
        </button>
        <button
          type="button"
          className="icon-button ws-dock-collapse"
          onClick={() => setHidden(true)}
          aria-label={uiText("Ẩn khung chat")}
          title={uiText("Thu gọn chat")}
          aria-expanded={true}
          aria-controls={panelId}
        >
          <ChevronDown size={18} />
        </button>
      </form>
      {caption && (
        <span id={panelId + "caption"} className="ws-dock-accessible-caption">
          {caption}
        </span>
      )}
      {busy && (
        <span className="ws-dock-accessible-caption" role="status">
          {uiText("ReloHome đang xử lý yêu cầu của bạn…")}
        </span>
      )}
      {((!busy && (questions.length > 0 || suggestions.length > 0)) ||
        error || notice || (!busy && kind === "ERROR" && text)) && (
        <div className="ws-dock-context">
          {notice && <p role="status">{uiText(notice)}</p>}
          {!busy && kind === "ERROR" && text && <p role="alert">{text}</p>}
          {!busy &&
            questions.map((q, i) => (
              <div key={i}>
                {q.text && <p>{q.text}</p>}
                <div className="tags">
                  {(q.choices?.length
                    ? mergePlaceCandidates(q.choices)
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
                  {uiText(s.label)}
                </button>
              ))}
            </div>
          )}
          {error && (
            <p className="notice error" role="alert">
              {uiText(error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
