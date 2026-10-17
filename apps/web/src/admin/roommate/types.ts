import type { Facts } from "../../roommate/types";
export type Profile = {
  profile_id: string;
  display_name: string | null;
  introduction: string | null;
  state: string;
  version?: number;
  facts?: Partial<Facts>;
  avatar_id?: string | null;
  updated_at?: string | null;
  expires_at?: string | null;
};
export type Report = {
  id: string;
  target: string;
  target_name?: string | null;
  reason: string;
  status: string;
  created: number;
};
export type Queue = { items: (Profile | Report)[]; total: number };
export type Summary = {
  active_profiles: number;
  pending_reports: number;
  restricted_profiles?: number;
};
export type History = {
  items: {
    id: string;
    actor: string;
    action: string;
    reason: string;
    created: number;
  }[];
  total: number;
};
