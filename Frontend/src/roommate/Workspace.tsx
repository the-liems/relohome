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
import "./roommate.css";
export { RoommateGuest } from "./RoommateGuest";
export function RoommateWorkspace() {
  useUiPreferences();
  const availability = useResource<Availability>("/availability"),
    access = useResource<Access>(
      availability.value?.enabled ? "/access" : null,
    );
  const [params] = useSearchParams(),
    location = useLocation();
  const tab = ["saved", "inbox", "profile"].includes(params.get("tab") || "")
    ? params.get("tab")!
    : "discover";
  const tabs = [
    ["discover", rt("Tìm người", "Discover"), Search],
    ["saved", rt("Đã lưu", "Saved"), Heart],
    ["inbox", rt("Yêu cầu kết nối", "Requests"), Mail],
    ["profile", rt("Hồ sơ của tôi", "My profile"), UserRound],
  ] as const;
  return (
    <div className="rm-workspace">
      <header className="rm-page-heading">
        <div>
          <span className="rm-kicker">ROOMMATE DISCOVERY</span>
          <h1>{rt("Tìm người ở cùng", "Find a roommate")}</h1>
          <p>
            {rt(
              "Cùng nhu cầu, hiểu khác biệt, tự quyết định.",
              "Shared needs. Clear differences. Your decision.",
            )}
          </p>
        </div>
        <Link className="secondary" to="/ai">
          <ArrowLeft size={16} aria-hidden="true" />
          {rt("Về chat", "Back to chat")}
        </Link>
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
            <nav
              className="rm-navigation"
              aria-label={rt("Điều hướng Roommate", "Roommate navigation")}
            >
              {tabs.map(([key, label, Icon]) => (
                <Link
                  key={key}
                  to={key === "discover" ? "/roommate" : "/roommate?tab=" + key}
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
            </nav>
            <Routes>
              <Route path="profiles/:profileId" element={<CandidateDetail />} />
              <Route
                path="requests/:requestId"
                element={<ConnectionDetail />}
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
                  ) : (
                    <Discovery
                      initialOffset={location.state?.offset || 0}
                      initial={location.state?.criteria as Criteria | undefined}
                    />
                  )
                }
              />
            </Routes>
          </>
        )
      )}
    </div>
  );
}
