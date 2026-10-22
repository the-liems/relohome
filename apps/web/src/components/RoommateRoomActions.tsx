import { Link } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { rt } from "../roommate/text";

export type RoomMarker = {
  listing_id: string;
  profile_id: string;
  display_name: string;
  source_kind: "real" | "demo";
  label: string;
};

export function RoommateRoomActions({
  profiles,
  onChoosePoster,
  primary = false,
}: {
  profiles: RoomMarker[];
  onChoosePoster: () => void;
  primary?: boolean;
}) {
  const label = rt("Liên hệ người đăng", "Contact poster");
  if (!profiles.length) return null;
  const className =
    "ws-roommate-contact " +
    (primary ? "primary ws-select" : "ws-select-small");
  // Opening a profile is read-only. The existing Roommate page rechecks access,
  // availability and consent before the user can send a connection request.
  return profiles.length === 1 ? (
    <Link
      className={className}
      to={"/roommate/profiles/" + encodeURIComponent(profiles[0].profile_id)}
    >
      <MessageCircle size={16} /> {label}
    </Link>
  ) : (
    <button type="button" className={className} onClick={onChoosePoster}>
      <MessageCircle size={16} /> {label}
    </button>
  );
}
