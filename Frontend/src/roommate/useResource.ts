import { useEffect, useState } from "react";
import { roommate } from "./client";
export function useResource<T>(path: string | null) {
  const [value, setValue] = useState<T | null>(null),
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(Boolean(path)),
    [revision, setRevision] = useState(0);
  const [loadedPath, setLoadedPath] = useState(path);
  useEffect(() => {
    const controller = new AbortController();
    setLoadedPath(path);
    setValue(null);
    setError(null);
    setLoading(Boolean(path));
    if (path)
      void roommate<T>(path, "GET", undefined, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setValue(data);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    return () => controller.abort();
  }, [path, revision]);
  return {
    value: loadedPath === path ? value : null,
    error: loadedPath === path ? error : null,
    loading: loadedPath === path ? loading : Boolean(path),
    reload: () => setRevision((n) => n + 1),
  };
}
