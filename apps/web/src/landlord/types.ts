export type ManagementStatus = "pending" | "active" | "revoked";
export type PublicationStatus =
  "draft" | "pending_review" | "published" | "hidden" | "rejected" | "deleted";
export type AvailabilityStatus = "vacant" | "rented" | "paused";

export interface Overview {
  properties: number;
  units: number;
  vacant: number;
  new_contacts: number;
  measured_since: string | null;
  detail_views: number;
  saves: number;
  contact_requests: number;
}

export interface PropertySummary {
  id: string;
  name: string;
  property_type: string;
  address: Record<string, unknown>;
  lng: number;
  lat: number;
  role: "owner" | "manager";
  status: ManagementStatus;
  revision: number;
  unit_count: number;
  vacant_count: number;
}

export interface ManagedUnit {
  unit_revision: number;
  id: string;
  unit_code: string;
  bedrooms: number | null;
  bathrooms: number | null;
  area_m2: number | null;
  amenities: string[];
  bathroom_type?: "shared" | "private" | null;
  listing_id: string | null;
  title: string | null;
  publication_status: PublicationStatus | null;
  availability_status: AvailabilityStatus | null;
  revision: number | null;
}

export interface ListingFee {
  id: string;
  code: string;
  label: string;
  amount: number | null; // null: the owner has not fixed the amount yet
  billing_unit: string;
  required: boolean;
  refundable: boolean;
}

export interface ListingMedia {
  id: string;
  url: string;
  alt_text: string | null;
  position: number;
  is_primary: boolean;
  moderation_status: string;
}

export interface ManagedListing {
  id: string;
  property_id: string;
  unit_id: string;
  title: string;
  description: string;
  rent_vnd: number;
  deposit_vnd: number | null;
  availability_from: string | null;
  publication_status: PublicationStatus;
  availability_status: AvailabilityStatus;
  rejection_reason: string | null;
  revision: number;
  updated_at: string;
  issues?: Record<string, string>;
  fees: ListingFee[];
  media: ListingMedia[];
}

export interface PropertyDetail extends PropertySummary {
  management_status: ManagementStatus;
  location_metadata?: Record<string, unknown>;
  location_confirmed_at?: string | null;
  units: ManagedUnit[];
}

export interface ContactRequest {
  property_id?: string;
  unit_id?: string | null;
  id: string;
  listing_id: string;
  tenant_user_id: string;
  message: string;
  status: "new" | "contacted" | "viewing" | "resolved" | "declined";
  revision: number;
  created_at: string;
  updated_at: string;
  title: string;
  unit_code: string | null;
  property_name: string;
  viewing_slot: string | null;
  viewing_status: "requested" | "confirmed" | "declined" | "cancelled" | null;
  viewing_options?: string[];
  payment_report?: {
    id: string;
    status: "pending" | "confirmed" | "rejected";
    revision: number;
    amount_vnd: number;
    paid_on: string;
    reason: string | null;
    agreement: {
      deposit_vnd?: number;
      first_month_vnd?: number;
      move_in?: string | null;
    };
  } | null;
  update_unread?: boolean;
  source: "contact" | "viewing";
  unread: number;
}

export interface ModerationProperty {
  revision: number;
  lat?: number;
  lng?: number;
  location_confirmed_at?: string | null;
  id: string;
  name: string;
  property_type: string;
  address: Record<string, unknown>;
  user_id: string;
  requested_at: string;
  host_status: HostStatus | null;
  host_name: string | null;
  poster_type: PosterType | null;
}

export interface ModerationListing {
  revision: number;
  publication_status: PublicationStatus;
  id: string;
  title: string;
  description: string | null;
  property_name: string;
  address: Record<string, unknown>;
  unit_code: string | null;
  created_by: string;
  updated_at: string;
  rent_vnd: number;
  deposit_vnd: number | null;
  fee_count: number;
  pending_media: { url: string; alt: string | null }[];
  property_status: ManagementStatus | null;
  host_status: HostStatus | null;
  host_name: string | null;
  poster_type: PosterType | null;
}

export interface ModerationQueue {
  hosts: ModerationHost[];
  properties: ModerationProperty[];
  listings: ModerationListing[];
}

export type PosterType = "owner" | "manager" | "broker" | "business";
export type HostStatus = "pending" | "verified" | "needs_info";

export interface HostProfile {
  user_id: string;
  poster_type: PosterType;
  display_name: string;
  legal_name: string;
  phone: string;
  broker_license_no: string | null;
  business_name: string | null;
  tax_code: string | null;
  status: HostStatus;
  info_request: string | null;
  terms_version: string | null;
  revision: number;
}

export interface HostProfilePage {
  profile: HostProfile | null;
  terms_version: string | null; // null: no terms acceptance step configured
}

export interface ModerationHost {
  can_review?: boolean;
  revision: number;
  user_id: string;
  poster_type: PosterType;
  display_name: string;
  legal_name: string;
  phone: string;
  broker_license_no: string | null;
  business_name: string | null;
  tax_code: string | null;
  updated_at: string;
  pending_properties: number;
  pending_listings: number;
}
