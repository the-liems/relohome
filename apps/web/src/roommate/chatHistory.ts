import type { ChatMessage, ChatPage } from "./chatTypes";

// Server cursors order canonical UTC timestamps, then IDs, in the same way.
export function compareChatMessages(a: ChatMessage, b: ChatMessage) {
  if (a.created_at !== b.created_at)
    return a.created_at < b.created_at ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function mergeChatPages(
  current: ChatPage | null,
  incoming: ChatPage,
): ChatPage {
  if (
    !current ||
    current.id !== incoming.id ||
    current.viewer_id !== incoming.viewer_id
  )
    return incoming;
  const items = new Map(current.items.map((item) => [item.id, item]));
  for (const item of incoming.items) items.set(item.id, item);
  const first = incoming.items[0],
    oldest = current.items[0];
  return {
    ...incoming,
    items: [...items.values()].sort(compareChatMessages),
    // Pagination belongs to the oldest loaded boundary, not the latest window.
    has_more:
      !first || !oldest || compareChatMessages(first, oldest) <= 0
        ? incoming.has_more
        : current.has_more,
  };
}
