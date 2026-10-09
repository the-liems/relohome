import { useEffect, useState } from "react";
import { roommate } from "./client";
import type { Lease } from "./types";
export function useContactLease(id: string, visible: boolean) {
  const [lease, setLease] = useState<Lease | null>(null),
    [error, setError] = useState<unknown>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true,
      controller: AbortController | null = null,
      expiry: ReturnType<typeof setTimeout> | undefined;
    setLease(null);
    setError(null);
    function clear() {
      controller?.abort();
      clearTimeout(expiry);
      setLease(null);
    }
    async function refresh() {
      clear();
      if (!visible || document.hidden || !document.hasFocus()) return;
      controller = new AbortController();
      const request = controller;
      try {
        const value = await roommate<Lease>(
          "/requests/" + encodeURIComponent(id) + "/contact",
          "GET",
          undefined,
          request.signal,
        );
        if (
          active &&
          !request.signal.aborted &&
          Date.parse(value.expires_at) > Date.now()
        ) {
          setLease(value);
          setError(null);
          expiry = setTimeout(
            () => setLease(null),
            Math.min(Date.parse(value.expires_at) - Date.now(), 2147483647),
          );
        }
      } catch (e) {
        if (active && !request.signal.aborted) {
          setLease(null);
          setError(e);
        }
      }
    }
    const visibility = () => (document.hidden ? clear() : void refresh());
    window.addEventListener("blur", clear);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visibility);
    if (visible) void refresh();
    const timer = visible
      ? setInterval(() => void refresh(), 15000)
      : undefined;
    return () => {
      active = false;
      controller?.abort();
      clearTimeout(expiry);
      clearInterval(timer);
      window.removeEventListener("blur", clear);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [id, visible, revision]);
  return {
    lease: visible ? lease : null,
    error,
    reload: () => setRevision((n) => n + 1),
  };
}
