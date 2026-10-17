import { AccessGate } from "./AccessGate";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  UsersRound,
  Search,
  Heart,
  Mail,
  UserRound,
  Settings,
} from "lucide-react";
import { useUiPreferences } from "../uiPreferences";
import { ContentSkeleton, EmptyState } from "../components/UiStates";
import { useResource } from "./useResource";
import { ErrorNotice } from "./ErrorNotice";
import { Discovery } from "./Discovery";
import { SavedProfiles } from "./SavedProfiles";
import { Inbox } from "./Inbox";
import { MyProfile } from "./MyProfile";
import { CandidateDetail } from "./CandidateDetail";
import { ConnectionDetail } from "./ConnectionDetail";
import type { Access, Availability, Criteria } from "./types";
import { rt } from "./text";
import { RoommateSettings } from "./Settings";
import { NotificationsMenu } from "./NotificationsMenu";
import { ModerationWorkspace } from "./Moderation";
import { RoommateFeatures, RoommateIdentity } from "./Features";
import { RecoveryPanel } from "./RecoveryPanel";
import "./roommate.css";
export { RoommateGuest } from "./RoommateGuest";
export function RoommateWorkspace({
  name = "",
  id = "",
}: {
  name?: string;
  id?: string;
}) {
  return (
    <RoommateIdentity.Provider value={{ id, name }}>
      <Workspace />
    </RoommateIdentity.Provider>
  );
}
function Workspace() {
  useUiPreferences();
  const availability = useResource<Availability>("/availability"),
    access = useResource<Access>(
      availability.value?.enabled ? "/access" : null,
    );
  const [params] = useSearchParams(),
    location = useLocation();
  const tab = ["saved", "inbox", "profile", "settings"].includes(
    params.get("tab") || "",
  )
    ? params.get("tab")!
    : "discover";
  const tabs = [
    ["discover", rt("Tìm người", "Discover"), Search],
    ["saved", rt("Đã lưu", "Saved"), Heart],
    ["inbox", rt("Yêu cầu kết nối", "Requests"), Mail],
    ["profile", rt("Hồ sơ của tôi", "My profile"), UserRound],
    ["settings", rt("Cài đặt", "Settings"), Settings],
  ] as const;
  return (
    <RoommateFeatures.Provider value={availability.value?.features || []}>
      <div className="rm-workspace" data-service="roommate">
        <header className="rm-page-heading">
          <div>
            <span className="rm-kicker">
              {rt("Ở GHÉP · RELOHOME", "ROOMMATES · RELOHOME")}
            </span>
            <h1>{rt("Tìm người ở cùng", "Find a roommate")}</h1>
            <p>
              {rt(
                "Cùng nhu cầu, hiểu khác biệt, tự quyết định.",
                "Shared needs. Clear differences. Your decision.",
              )}
            </p>
          </div>
          <div className="rm-actions">
            {access.value?.eligible &&
              availability.value?.features?.includes("notifications") && (
                <NotificationsMenu />
              )}
            <Link className="secondary" to="/ai">
              <ArrowLeft size={16} aria-hidden="true" />
              {rt("Về chat", "Back to chat")}
            </Link>
          </div>
        </header>
        <ErrorNotice
          error={availability.error || access.error}
          retry={() => {
            availability.reload();
            access.reload();
          }}
        />
        {availability.loading || access.loading ? (
          <ContentSkeleton
            label={rt("Đang mở dịch vụ…", "Opening the service…")}
          />
        ) : availability.value && !availability.value.enabled ? (
          <EmptyState
            icon={<UsersRound />}
            title={rt("Roommate chưa được bật", "Roommate is not enabled yet")}
            text={rt(
              "Dịch vụ hiện chưa nhận hồ sơ. Bạn vẫn có thể dùng các dịch vụ khác của ReloHome.",
              "This service is not accepting profiles yet. Other ReloHome services remain available.",
            )}
          />
        ) : access.value && !access.value.eligible ? (
          <AccessGate access={access.value} done={access.reload} />
        ) : (
          access.value?.eligible && (
            <>
              {availability.value?.features?.includes("operation_drafts") && (
                <RecoveryPanel />
              )}
              <nav
                className="rm-navigation"
                aria-label={rt("Điều hướng Roommate", "Roommate navigation")}
              >
                {tabs.map(([key, label, Icon]) => (
                  <Link
                    key={key}
                    to={
                      key === "discover" ? "/roommate" : "/roommate?tab=" + key
                    }
                    aria-current={
                      location.pathname === "/roommate" && tab === key
                        ? "page"
                        : undefined
                    }
                  >
                    <Icon size={17} aria-hidden="true" />
                    {label}
                  </Link>
                ))}
                {access.value.moderator && (
                  <Link
                    to="/roommate/moderation"
                    aria-current={
                      location.pathname === "/roommate/moderation"
                        ? "page"
                        : undefined
                    }
                  >
                    {rt("Quản lý cộng đồng", "Community moderation")}
                  </Link>
                )}
              </nav>
              <Routes>
                <Route
                  path="moderation"
                  element={
                    <ModerationWorkspace
                      allowed={Boolean(access.value.moderator)}
                    />
                  }
                />
                <Route
                  path="profiles/:profileId"
                  element={<CandidateDetail />}
                />
                <Route
                  path="requests/:requestId"
                  element={
                    <ConnectionDetail
                      notificationsEnabled={availability.value?.features?.includes(
                        "notifications",
                      )}
                    />
                  }
                />
                <Route
                  path="*"
                  element={
                    tab === "saved" ? (
                      <SavedProfiles />
                    ) : tab === "inbox" ? (
                      <Inbox />
                    ) : tab === "profile" ? (
                      <MyProfile />
                    ) : tab === "settings" ? (
                      <RoommateSettings />
                    ) : (
                      <Discovery
                        initialOffset={location.state?.offset || 0}
                        initial={
                          location.state?.criteria as Criteria | undefined
                        }
                      />
                    )
                  }
                />
              </Routes>
            </>
          )
        )}
      </div>
    </RoommateFeatures.Provider>
  );
}
