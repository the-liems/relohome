import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, MessageCircle } from "lucide-react";
import { readActiveChat } from "../activeChatSession";
import { t } from "../uiPreferences";

export function ResumeChat({ owner }: { owner: string }) {
  const [session, setSession] = useState(() => readActiveChat(owner));
  useEffect(() => {
    const refresh = () => setSession(readActiveChat(owner));
    window.addEventListener("storage", refresh);
    const expiry = session ? window.setTimeout(refresh, Math.max(0, session.expiresAt - Date.now())) : undefined;
    return () => {
      window.removeEventListener("storage", refresh);
      if (expiry !== undefined) window.clearTimeout(expiry);
    };
  }, [owner, session?.expiresAt]);
  if (!session) return null;
  return (
    <Link className="secondary resume-chat" to={"/ai/" + session.threadId}>
      <MessageCircle size={18} aria-hidden="true" />
      {t("Tiếp tục phiên đang làm")}
      <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}
