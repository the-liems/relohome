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
  items: ChatMessage[];
  has_more: boolean;
  retention_days?: number;
};
