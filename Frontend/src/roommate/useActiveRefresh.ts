import { useEffect, useRef } from "react";

export function useActiveRefresh(
  refresh: () => void,
  enabled = true,
  interval = 30000,
) {
  const callback = useRef(refresh);
  callback.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    const update = () => {
      if (!document.hidden && document.hasFocus()) callback.current();
    };
    const timer = setInterval(update, interval);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [enabled, interval]);
}
