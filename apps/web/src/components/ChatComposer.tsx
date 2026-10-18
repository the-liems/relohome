import { useEffect, useState, type RefObject } from "react";
import { Send, Sparkles } from "lucide-react";
import { t } from "../uiPreferences";

/** Animate the hint only, keeping the user's draft and submit behaviour independent. */
export function ChatComposer({ value, onChange, onSend, busy, online, inputRef }: {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  busy: boolean;
  online: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const example = t("Tôi muốn tìm nhà khu vực Bình Thạnh, thành phố Hồ Chí Minh dưới 5 triệu");
  const fallback = t("Nhắn cho ReloHome…");
  const [hint, setHint] = useState(fallback);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (value || focused || busy) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout>;
    let position = 0;
    const tick = () => {
      position += 1;
      setHint(example.slice(0, position));
      if (position < example.length) timer = setTimeout(tick, 45);
    };
    const start = () => {
      clearTimeout(timer);
      position = 0;
      setHint(motion.matches ? example : fallback);
      if (!motion.matches) timer = setTimeout(tick, 700);
    };
    start();
    motion.addEventListener("change", start);
    return () => { clearTimeout(timer); motion.removeEventListener("change", start); };
  }, [example, fallback, value, focused, busy]);
  return (
    <form className="composer" data-tour="chat-composer" onSubmit={event => { event.preventDefault(); onSend(value); }}>
      <span className="composer-spark" aria-hidden="true"><Sparkles size={21} /></span>
      <textarea
        ref={inputRef}
        value={value}
        onChange={event => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={1}
        placeholder={focused || busy ? fallback : hint}
        aria-label={t("Tin nhắn cho ReloHome")}
        maxLength={5000}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSend(value);
          }
        }}
      />
      <button className="send-button" disabled={busy || !value.trim() || !online} aria-label={t("Gửi tin nhắn")}>
        <Send size={20} />
      </button>
    </form>
  );
}
