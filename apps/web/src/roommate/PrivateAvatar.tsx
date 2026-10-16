import { useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";
import { AUTH_RESTORED, reportAuthFailure } from "../authEvents";
export function PrivateAvatar({ id }: { id?: string | null }) {
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const authenticationFailed = useRef(false);
  useEffect(() => {
    const resume = () => {
      if (authenticationFailed.current) setRevision((n) => n + 1);
    };
    window.addEventListener(AUTH_RESTORED, resume);
    return () => window.removeEventListener(AUTH_RESTORED, resume);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    setImage(null);
    authenticationFailed.current = false;
    if (id)
      void fetch("/web/api/roommate/media/" + encodeURIComponent(id), {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (response.status === 401) {
            authenticationFailed.current = true;
            reportAuthFailure("/roommate/media/" + id, 401, null);
          }
          if (
            !response.ok ||
            response.headers.get("content-type")?.split(";")[0] !== "image/png"
          )
            return;
          const data = await response.blob();
          if (controller.signal.aborted) return;
          url = URL.createObjectURL(data);
          setImage({ id, url });
        })
        .catch(() => {});
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, revision]);
  return (
    <span className="rm-avatar" aria-hidden="true">
      {image && image.id === id ? (
        <img src={image.url} alt="" />
      ) : (
        <UserRound size={26} />
      )}
    </span>
  );
}
