export type City = "hcm" | "hanoi" | "danang";
export type Budget = {
  min_vnd: number;
  max_vnd: number;
  fee_basis: "rent_only" | "including_fees" | null;
};
export type MoveIn = {
  kind: "date" | "range" | "flexible";
  start?: string | null;
  end?: string | null;
};
export type QuietHours = { start: string; end: string };
export type Traits = {
  gender?: string | null;
  smoking?: string | null;
  has_pets?: boolean | null;
  quiet_hours?: QuietHours | null;
  cleanliness?: string | null;
  sociability?: string | null;
};
export type Facts = {
  city?: City | null;
  area_ids: string[];
  budget?: Budget | null;
  need?: {
    kind: "has_room" | "looking_together";
    willing_to_move?: boolean | null;
  } | null;
  move_in?: MoveIn | null;
  self_traits: Traits;
};
export type Preference<T> = { value: T; strength: "soft" | "hard" };
export type Preferences = {
  areas?: Preference<{ area_ids: string[] }> | null;
  budget?: Preference<Budget> | null;
  move_in?: Preference<MoveIn> | null;
  gender?: Preference<string> | null;
  smoking?: Preference<string> | null;
  pets_allowed?: Preference<boolean> | null;
  quiet_hours?: Preference<QuietHours> | null;
  cleanliness?: Preference<string> | null;
  sociability?: Preference<string> | null;
};
export type Criteria = {
  city: City;
  self_facts: Facts;
  preferences: Preferences;
};
export type Profile = {
  display_name: string | null;
  introduction: string | null;
  facts: Facts;
  preferences: Preferences;
  room?: { listing_id: string; public_location_consent: true } | null;
};
export type PublicProfile = Omit<Profile, "preferences" | "room"> & {
  profile_id: string;
  avatar_id?: string | null;
};
export type Compatibility = {
  score: number | null;
  label: string | null;
  positives: string[];
  differences: string[];
  missing: string[];
};
export type Candidate = {
  profile: PublicProfile;
  compatibility: Compatibility;
};
export type Page = {
  items: Candidate[];
  total: number;
  offset: number;
  limit: number;
};
export type Access = {
  eligible: boolean;
  reason?: string;
  terms_version: string;
  moderator: boolean;
};
export type Availability = {
  enabled: boolean;
  cities: City[];
  terms_version: string;
  features?: string[];
};
export type OwnProfile = {
  version: number;
  state: string;
  content: Profile;
  expires_at: string | null;
  confirmed_at: string | null;
  avatar_id?: string | null;
};
export type Detail = {
  available?: boolean;
  profile?: PublicProfile;
  profile_id?: string;
  owner?: OwnProfile;
};
export type Contact = {
  channel_id: string;
  kind: "phone" | "zalo";
  version: number;
  value: string | null;
};
export type RequestSummary = {
  mode?: "contact" | "chat";
  conversation_id?: string | null;
  conversation_state?: "active" | "closed" | null;
  counterparty_id?: string | null;
  request_id: string;
  direction: "sent" | "received";
  state: string;
  expires_at: string;
  created_at: string;
  grant_state: string | null;
  grant_expires_at: string | null;
  available: boolean;
  counterparty?: {
    display_name: string | null;
    avatar_id?: string | null;
  } | null;
  preview?: string | null;
  unread?: boolean;
};
export type RequestDetail = RequestSummary & {
  intro?: Omit<Profile, "preferences"> & { reviewed_at: string };
  actions?: string[];
};
export type Inbox = {
  items: RequestSummary[];
  received_pending: number;
  total?: number;
  offset?: number;
  limit?: number | null;
  profile_reminder: { expires_at: string } | null;
};
export type Notification = {
  id: string;
  kind: string;
  resource_id: string;
  created_at: string;
  read: boolean;
};
export type Notifications = {
  items: Notification[];
  unread: number;
  total: number;
  offset: number;
  limit: number;
};
export type Media = {
  media_id: string;
  status: string;
  mime: string;
  created: number;
};
export type Lease = {
  request_id: string;
  expires_at: string;
  contact: { kind: "phone" | "zalo"; value: string };
};
export const emptyFacts = (): Facts => ({ area_ids: [], self_traits: {} });
export const emptyCriteria = (): Criteria => ({
  city: "hcm",
  self_facts: emptyFacts(),
  preferences: {},
});
export const emptyProfile = (): Profile => ({
  display_name: null,
  introduction: null,
  facts: emptyFacts(),
  preferences: {},
});
