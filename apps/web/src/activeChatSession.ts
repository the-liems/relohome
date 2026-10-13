export const ACTIVE_CHAT_TTL = 24 * 60 * 60 * 1000;
export type ChatSessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ActiveChatSession = { threadId: string; expiresAt: number };
const key = (owner: string) => "relohome-active-chat:" + encodeURIComponent(owner);

export function readActiveChat(owner: string, now = Date.now(), storage?: ChatSessionStorage): ActiveChatSession | null {
  try {
    const cache = storage ?? localStorage;
    const value = JSON.parse(cache.getItem(key(owner)) ?? "null");
    if (value && typeof value.threadId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value.threadId)
      && typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
      && value.expiresAt > now && value.expiresAt <= now + ACTIVE_CHAT_TTL) return value;
    cache.removeItem(key(owner));
  } catch { /* Optional browser cache must not block chat. */ }
  return null;
}
export function rememberActiveChat(owner: string, threadId: string, now = Date.now(), storage?: ChatSessionStorage) {
  try {
    (storage ?? localStorage).setItem(key(owner), JSON.stringify({ threadId, expiresAt: now + ACTIVE_CHAT_TTL }));
  } catch { /* Private browsing may disable storage. */ }
}
export function forgetActiveChat(owner: string, threadId?: string, storage?: ChatSessionStorage) {
  try {
    const cache = storage ?? localStorage;
    if (threadId && JSON.parse(cache.getItem(key(owner)) ?? "null")?.threadId !== threadId) return;
    cache.removeItem(key(owner));
  } catch { /* No cache is required for backend operations. */ }
}
