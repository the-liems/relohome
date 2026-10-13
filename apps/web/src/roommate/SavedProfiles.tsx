import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import { ContentSkeleton, EmptyState } from "../components/UiStates";
import { useResource } from "./useResource";
import type { Detail } from "./types";
import { ProfileSummary } from "./ProfileSummary";
import { ErrorNotice } from "./ErrorNotice";
import { rt } from "./text";
import { useState } from "react";
import { roommate } from "./client";
export function SavedProfiles() {
  const data = useResource<{ items: Detail[] }>("/me/bookmarks");
  return (
    <section className="rm-results">
      <h2>{rt("Hồ sơ bạn quan tâm", "Saved profiles")}</h2>
      <p className="rm-hint">
        {rt(
          "Chỉ bạn thấy danh sách này. Lưu hồ sơ không gửi yêu cầu kết nối.",
          "Only you can see this list. Saving a profile does not send a request.",
        )}
      </p>
      <ErrorNotice error={data.error} retry={data.reload} />
      {data.loading ? (
        <ContentSkeleton
          label={rt("Đang tải hồ sơ đã lưu…", "Loading saved profiles…")}
        />
      ) : data.value?.items.length ? (
        <ul className="rm-candidate-list">
          {data.value.items.map((item) => (
            <li
              className="rm-candidate"
              key={item.profile?.profile_id || item.profile_id}
            >
              {item.available && item.profile ? (
                <>
                  <ProfileSummary profile={item.profile} />
                  <Link
                    className="secondary"
                    to={
                      "/roommate/profiles/" +
                      encodeURIComponent(item.profile.profile_id)
                    }
                  >
                    {rt("Xem hồ sơ", "View profile")}
                  </Link>
                </>
              ) : (
                <p>
                  {rt(
                    "Một hồ sơ đã lưu không còn khả dụng. Không hiển thị dữ liệu cũ.",
                    "A saved profile is no longer available. Old information is not displayed.",
                  )}
                </p>
              )}
              <RemoveBookmark
                id={item.profile?.profile_id || item.profile_id!}
                done={data.reload}
              />
            </li>
          ))}
        </ul>
      ) : (
        !data.error && (
          <EmptyState
            icon={<Heart />}
            title={rt("Chưa lưu hồ sơ", "No saved profiles")}
            text={rt(
              "Mở hồ sơ và chọn Quan tâm để lưu riêng cho lần sau.",
              "Open a profile and save it for later.",
            )}
          />
        )
      )}
    </section>
  );
}
function RemoveBookmark({ id, done }: { id: string; done: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  return (
    <>
      <ErrorNotice error={error} />
      <button
        className="text-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await roommate("/me/bookmarks/" + encodeURIComponent(id), "PUT", {
              selected: false,
            });
            done();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {rt("Bỏ quan tâm", "Remove saved profile")}
      </button>
    </>
  );
}
