// Domain payloads are additive. Unknown component types fall back to explanatory text.
export type Data = Record<string, any>;
export interface User {
  id: string;
  email: string;
  name: string;
  preferences: Record<string, string>;
}
export interface House extends Data {
  id: string;
  title: string;
  address: string;
  lat?: number;
  lng?: number;
  price_vnd?: number;
  price?: { amount: number; currency: string; period: string };
  thumbnail_url?: string;
  location_accuracy?: string;
  fees?: Array<{
    code: string;
    label: string;
    amount: number | null;
    billing_unit: "month" | "one_time" | "kwh" | "m3" | "person_month" | "vehicle_month";
    required: boolean;
    refundable: boolean;
  }>;
  management?: {
    publication_status: string;
    availability_status: string;
    accepts_contact_requests: boolean;
    availability_confirmed_at: string | null;
  } | null;
}
export interface Component extends Data {
  id: string;
  type: string;
  task_id: string;
  fetched_at: string;
  data: Data;
}
export interface Payload extends Data {
  status: string;
  response?: {
    kind: string;
    text: string;
    data?: Data;
    questions?: Data[];
    suggestions?: Data[];
  };
  confirmation?: Data;
  payment?: Data;
  ui?: { version: number; plan_version: number; components: Component[] };
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  created: number;
  content: Payload & { text?: string };
}
export interface Thread {
  id: string;
  title: string;
  updated: number;
  revision: number;
  state: Data;
  messages: Message[];
  runs: { id: string; status: string }[];
}
export interface Saved {
  id: string;
  thread_id: string;
  house: House;
}
