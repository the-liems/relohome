import type { OwnProfile } from "./types";

export type ChatConversation = {
  id: string;
  request_id: string;
  state: "active" | "closed";
  counterparty_name: string | null;
  unread: number;
  updated_at: number;
};
export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};
export type ChatPage = ChatConversation & {
  viewer_id: string;
  own_profile?: Pick<OwnProfile, "state" | "version"> | null;
  counterparty_read_message_id?: string | null;
  items: ChatMessage[];
  has_more: boolean;
  retention_days?: number;
};
