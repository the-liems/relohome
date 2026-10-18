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
  const movingExample = t("Tôi muốn chuyển đồ từ Bình Thạnh đến Gò Vấp");
  const fallback = t("Nhắn cho ReloHome…");
  const [hint, setHint] = useState(fallback);
  const [interacted, setInteracted] = useState(false);
  useEffect(() => {
    if (value || interacted || busy) return;
    const examples = [example, movingExample];
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout>;
    let index = 0;
    let position = 0;
    let deleting = false;
    const tick = () => {
      const sentence = examples[index];
      position += deleting ? -1 : 1;
      setHint(sentence.slice(0, position));
      if (!deleting && position === sentence.length) {
        deleting = true;
        timer = setTimeout(tick, 1800);
      } else if (deleting && position === 0) {
        deleting = false;
        index = (index + 1) % examples.length;
        timer = setTimeout(tick, 350);
      } else {
        timer = setTimeout(tick, deleting ? 22 : 45);
      }
    };
    const start = () => {
      clearTimeout(timer);
      index = 0;
      position = 0;
      deleting = false;
      setHint(motion.matches ? example : fallback);
      if (!motion.matches) timer = setTimeout(tick, 700);
    };
    start();
    motion.addEventListener("change", start);
    return () => { clearTimeout(timer); motion.removeEventListener("change", start); };
  }, [example, movingExample, fallback, value, interacted, busy]);
  return (
    <form className="composer" data-tour="chat-composer" onSubmit={event => { event.preventDefault(); onSend(value); }}>
      <span className="composer-spark" aria-hidden="true"><Sparkles size={21} /></span>
      <textarea
        ref={inputRef}
        value={value}
        onChange={event => onChange(event.target.value)}
        onFocus={() => setInteracted(true)}
        rows={1}
        placeholder={interacted || busy ? fallback : hint}
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
