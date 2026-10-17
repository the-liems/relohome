import { UsersRound } from "lucide-react";
import { ContentSkeleton, EmptyState } from "../components/UiStates";
import { ErrorNotice } from "../roommate/ErrorNotice";
import { RoommateFeatures, RoommateIdentity } from "../roommate/Features";
import { ModerationWorkspace } from "../roommate/Moderation";
import { RecoveryPanel } from "../roommate/RecoveryPanel";
import { rt } from "../roommate/text";
import type { Access, Availability } from "../roommate/types";
import { useResource } from "../roommate/useResource";
import type { User } from "../types";
import "../roommate/roommate.css";

export function RoommateModeration({ user }: { user: User }) {
  return (
    <RoommateIdentity.Provider value={{ id: user.id, name: user.name }}>
      <CommunityModeration />
    </RoommateIdentity.Provider>
  );
}

function CommunityModeration() {
  const availability = useResource<Availability>("/availability");
  const access = useResource<Access>(
    availability.value?.enabled ? "/access" : null,
  );
  const error = availability.error || access.error;
  return (
    <div className="rm-workspace rm-admin-workspace" data-service="roommate">
      {error ? (
        <ErrorNotice
          error={error}
          retry={() => {
            availability.reload();
            access.reload();
          }}
        />
      ) : availability.loading || access.loading ? (
        <ContentSkeleton
          label={rt("Đang mở công cụ kiểm duyệt…", "Opening moderation tools…")}
        />
      ) : availability.value && !availability.value.enabled ? (
        <EmptyState
          icon={<UsersRound />}
          title={rt("Roommate chưa được bật", "Roommate is not enabled yet")}
          text={rt(
            "Bạn vẫn có thể quản lý nhà và tin đăng ở các mục khác.",
            "Housing management remains available in the other tabs.",
          )}
        />
      ) : access.value ? (
        // Moderation is a server-assigned role, independent of personal discovery consent.
        <RoommateFeatures.Provider value={availability.value?.features || []}>
          {access.value.moderator &&
            availability.value?.features?.includes("operation_drafts") && (
              <RecoveryPanel />
            )}
          <ModerationWorkspace allowed={access.value.moderator} />
        </RoommateFeatures.Provider>
      ) : null}
    </div>
  );
}
