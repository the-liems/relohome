import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Heart, ArrowLeft, UsersRound } from "lucide-react";
import { ContentSkeleton, EmptyState } from "../components/UiStates";
import { useResource } from "./useResource";
import { roommate } from "./client";
import { ErrorNotice } from "./ErrorNotice";
import { ProfileSummary, CompatibilityReasons } from "./ProfileSummary";
import { ConnectionComposer } from "./ConnectionComposer";
import { SafetyActions } from "./SafetyActions";
import { rt } from "./text";
import type { Compatibility, Criteria, Detail, Page } from "./types";
export function CandidateDetail() {
  const { profileId = "" } = useParams(),
    location = useLocation(),
    navigate = useNavigate();
  const profile = useResource<Detail>(
      "/profiles/" + encodeURIComponent(profileId),
    ),
    saved = useResource<{ items: Detail[] }>("/me/bookmarks");
  const [compose, setCompose] = useState(false),
    [score, setScore] = useState<Compatibility | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const criteria = location.state?.criteria as Criteria | undefined,
    offset = location.state?.offset || 0;
  useEffect(() => {
    setScore(null);
    const controller = new AbortController();
    if (criteria && profile.value?.available)
      void roommate<Page>(
        "/search",
        "POST",
        { criteria, offset, limit: 12 },
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted)
            setScore(
              result.items.find((c) => c.profile.profile_id === profileId)
                ?.compatibility || null,
            );
        })
        .catch(() => {});
    return () => controller.abort();
  }, [criteria, profile.value, profileId, offset]);
  useEffect(() => {
    const refresh = () => {
      profile.reload();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [profileId]);
  const isSaved = saved.value?.items.some(
    (item) => item.profile?.profile_id === profileId,
  );
  return (
    <section className="rm-detail">
      <Link
        className="text-button"
        to="/roommate"
        state={criteria ? { criteria, offset } : undefined}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {rt("Về danh sách", "Back to discovery")}
      </Link>
      <ErrorNotice
        error={profile.error || error}
        retry={profile.error ? profile.reload : undefined}
      />
      {profile.loading && !profile.value ? (
        <ContentSkeleton label={rt("Đang mở hồ sơ…", "Loading profile…")} />
      ) : profile.value?.profile && profile.value.available ? (
        <>
          <div className="rm-detail-columns">
            <div className="rm-panel">
              <ProfileSummary profile={profile.value.profile} full />
            </div>
            <aside
              className="rm-panel"
              aria-label={rt("Kết nối với hồ sơ", "Connect with this person")}
            >
              {score ? (
                <CompatibilityReasons value={score} />
              ) : (
                <p className="rm-hint">
                  {rt(
                    "Xem mức phù hợp từ kết quả tìm theo tiêu chí của bạn. Không có điểm cho link mở độc lập.",
                    "Compatibility comes from a search using your criteria. A direct profile link has no score.",
                  )}
                </p>
              )}
              <p>
                {rt(
                  "Xem hồ sơ không chia sẻ liên hệ. Hãy gửi bản giới thiệu trước, rồi hai bên cùng quyết định.",
                  "Viewing a profile does not share contacts. Send an introduction and let both parties decide.",
                )}
              </p>
              <button className="primary full" onClick={() => setCompose(true)}>
                {rt("Gửi yêu cầu kết nối", "Send a connection request")}
              </button>
              <button
                className="secondary full"
                disabled={busy || saved.loading}
                aria-pressed={Boolean(isSaved)}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await roommate(
                      "/me/bookmarks/" + encodeURIComponent(profileId),
                      "PUT",
                      { selected: !isSaved },
                    );
                    saved.reload();
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Heart size={17} aria-hidden="true" />
                {isSaved
                  ? rt("Bỏ quan tâm", "Remove saved profile")
                  : rt("Quan tâm hồ sơ", "Save profile")}
              </button>
              <SafetyActions
                id={profileId}
                hidden={() => {
                  setCompose(false);
                  navigate("/roommate", { replace: true });
                }}
              />
            </aside>
          </div>
          {compose && (
            <ConnectionComposer
              recipient={profile.value.profile}
              close={() => setCompose(false)}
            />
          )}
        </>
      ) : (
        !profile.error && (
          <EmptyState
            icon={<UsersRound />}
            title={rt("Hồ sơ không còn khả dụng", "Profile unavailable")}
            text={rt(
              "Nhu cầu có thể đã đóng, hết hạn hoặc bạn không còn quyền xem. Không hiển thị lại thông tin cũ.",
              "The profile may have closed, expired, or become inaccessible. Old profile information is not shown.",
            )}
          />
        )
      )}
    </section>
  );
}
