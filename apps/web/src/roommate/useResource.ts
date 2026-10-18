import { useContext, useEffect, useState } from "react";
import { RoommateIdentity } from "./Features";
import { roommate, RoommateError } from "./client";
import { AUTH_RESTORED } from "../authEvents";
export function useResource<T>(path: string | null) {
  const identity = useContext(RoommateIdentity);
  const [value, setValue] = useState<T | null>(null),
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(Boolean(path)),
    [revision, setRevision] = useState(0);
  const [loadedPath, setLoadedPath] = useState(path);
  useEffect(() => {
    if (path !== "/me/profile") return;
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener("roommate-profile-update", refresh);
    return () => window.removeEventListener("roommate-profile-update", refresh);
  }, [path]);
  useEffect(() => {
    if (!(error instanceof RoommateError) || error.status !== 401) return;
    const resume = () => setRevision((n) => n + 1);
    window.addEventListener(AUTH_RESTORED, resume);
    return () => window.removeEventListener(AUTH_RESTORED, resume);
  }, [error]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadedPath(path);
    setValue((value) => (path && loadedPath === path ? value : null));
    setError(null);
    setLoading(Boolean(path));
    if (path)
      void roommate<T>(path, "GET", undefined, controller.signal, identity.id)
        .then((data) => {
          if (!controller.signal.aborted) setValue(data);
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setValue(null);
            setError(e);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    return () => controller.abort();
  }, [path, revision, identity.id]);
  return {
    value: loadedPath === path ? value : null,
    error: loadedPath === path ? error : null,
    loading: loadedPath === path ? loading : Boolean(path),
    reload: () => setRevision((n) => n + 1),
  };
}
