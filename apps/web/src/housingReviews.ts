import { housingManagement } from "./landlord/client";

export interface ReviewSummary {
  rating: number | null;
  count: number;
  property_count: number;
  histogram: Record<string, number>;
}
export interface HousingReview {
  id: string;
  property_id: string;
  property_name: string;
  rating: number;
  body: string;
  stage: "contacted" | "viewed";
  created_at: string;
  updated_at: string;
  reply_body: string | null;
  reply_at: string | null;
  author_label: string;
  // The tenant decides; anonymous reviews never carry a name.
  is_anonymous?: boolean;
  author_name?: string | null;
  status?: "published" | "hidden" | "withdrawn";
  hidden_reason?: string | null;
  report_count?: number;
  reports?: { id: string; reason: string; created_at: string }[];
}
export interface ReviewPage {
  summary: ReviewSummary;
  property_summary?: ReviewSummary;
  items: HousingReview[];
  mine?: HousingReview | null;
  can_review?: boolean;
  next_offset: number | null;
}
export interface ReviewFlag {
  id: string;
  host_name: string;
  kind: string;
  evidence: {
    qualifies: boolean;
    author_count: number;
    property_count: number;
    review_count: number;
    window_days: number;
    computed_at: string;
  };
}
export interface ReviewQueue {
  items: HousingReview[];
  flags: ReviewFlag[];
  next_offset: number | null;
}
export const reviewsApi = housingManagement;
