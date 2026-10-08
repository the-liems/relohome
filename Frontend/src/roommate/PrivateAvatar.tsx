import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
export function PrivateAvatar({ id }: { id?: string | null }) {
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    setImage(null);
    if (id)
      void fetch("/web/api/roommate/media/" + encodeURIComponent(id), {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
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
  }, [id]);
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
