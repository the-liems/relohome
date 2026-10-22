import { useEffect, useState } from "react";
import { ProfilePreview, ProfileTransition } from "./ProfileDialogs";
import { ContentSkeleton } from "../components/UiStates";
import { useResource } from "./useResource";
import { useRoommateClient } from "./useRoommateClient";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileSummary } from "./ProfileSummary";
import { ErrorNotice } from "./ErrorNotice";
import { emptyProfile, type OwnProfile, type Profile } from "./types";
import { deadlineLabel, rt, stateName } from "./text";
import { useIntro } from "./useIntro";
import { LegacyPhotos } from "./LegacyPhotos";
export function MyProfile() {
  const roommate = useRoommateClient();
  const intro = useIntro(),
    own = useResource<OwnProfile>("/me/profile");
  const [content, setContent] = useState(emptyProfile()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [action, setAction] = useState<string | null>(null);
  useEffect(() => {
    if (!intro.loading && !intro.dirty.current) setContent(intro.content);
  }, [intro.content, intro.loading]);
  async function transition(value: string) {
    if (!own.value || busy) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await roommate("/me/profile/actions", "POST", {
        action: value,
        expected_version: own.value.version,
        reviewed,
      });
      window.dispatchEvent(new Event("roommate-profile-update"));
      setAction(null);
      if (value === "delete") {
        setContent(emptyProfile());
        intro.reload();
        setPreview(false);
      }
      own.reload();
      setNotice(rt("Đã cập nhật trạng thái hồ sơ.", "Profile status updated."));
    } catch (e) {
      setAction(null);
      setError(e);
      own.reload();
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const saved = await roommate<OwnProfile>("/me/profile", "PUT", {
        content,
        expected_version: own.value?.version ?? null,
      });
      await roommate("/me/profile/actions", "POST", {
        action:
          saved.state === "active"
            ? "reconfirm"
            : saved.state === "draft"
              ? "publish"
              : "resume",
        expected_version: saved.version,
        reviewed,
      });
      window.dispatchEvent(new Event("roommate-profile-update"));
      setPreview(false);
      own.reload();
      setNotice(
        rt(
          "Đã đăng nhu cầu. Có hiệu lực 30 ngày từ lần xác nhận này.",
          "Your discovery profile is active for 30 days from this confirmation.",
        ),
      );
    } catch (e) {
      setPreview(false);
      setError(e);
      own.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rm-detail-columns">
      <section className="rm-panel">
        <h2>{rt("Bản giới thiệu của bạn", "Your introduction")}</h2>
        <p className="rm-hint">
          {rt(
            "Lưu riêng để gửi yêu cầu. Chỉ xuất hiện trong tìm kiếm khi bạn chủ động đăng nhu cầu.",
            "Save privately to send requests. You appear in discovery only when you explicitly publish.",
          )}
        </p>
        {intro.loading || own.loading ? (
          <ContentSkeleton label={rt("Đang tải hồ sơ…", "Loading profile…")} />
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await roommate("/me/intro", "PUT", content);
                intro.saved();
                setNotice(
                  rt(
                    "Đã lưu bản giới thiệu riêng. Chưa đăng công khai.",
                    "Private introduction saved. It has not been published.",
                  ),
                );
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <legend className="sr-only">
                {rt("Thông tin và sinh hoạt", "Your information and lifestyle")}
              </legend>
              <ProfileEditor
                value={content}
                change={(v) => {
                  intro.dirty.current = true;
                  setContent(v);
                  setNotice("");
                }}
              />
              <div className="rm-actions">
                <button className="secondary" disabled={Boolean(intro.error)}>
                  {rt("Lưu bản giới thiệu riêng", "Save private introduction")}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    Boolean(own.error) || !content.facts.area_ids.length
                  }
                  onClick={async (e) => {
                    const form = e.currentTarget.form!;
                    if (!form.reportValidity()) return;
                    setBusy(true);
                    setError(null);
                    try {
                      await roommate("/me/profile/preview", "POST", content);
                      setReviewed(false);
                      setPreview(true);
                    } catch (err) {
                      setError(err);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {rt("Xem trước để đăng nhu cầu", "Preview discovery profile")}
                </button>
              </div>
            </fieldset>
          </form>
        )}
        <ErrorNotice
          error={error || intro.error || own.error}
          retry={() => {
            intro.reload();
            own.reload();
            setError(null);
          }}
        />
        {notice && (
          <p className="rm-success" role="status">
            {notice}
          </p>
        )}
      </section>
      <aside
        className="rm-panel"
        aria-label={rt("Quản lý nhu cầu công khai", "Manage discovery profile")}
      >
        <h2>{rt("Nhu cầu đang đăng", "Your discovery status")}</h2>
        <strong className="rm-status">
          {own.value
            ? stateName(own.value.state)
            : rt("Chưa đăng", "Not published")}
        </strong>
        {own.value?.expires_at && (
          <p>
            {rt("Hạn hoạt động: ", "Active until: ")}
            {deadlineLabel(own.value.expires_at)}
          </p>
        )}
        <p className="rm-hint">
          {rt(
            "Sửa bản giới thiệu riêng không tự cập nhật hồ sơ công khai hoặc gia hạn. Đăng/xác nhận lại mới bắt đầu chu kỳ 30 ngày.",
            "Editing your private introduction does not update or renew the public profile. Publishing or reconfirming starts a new 30-day period.",
          )}
        </p>
        {own.value && !["deleted", "restricted"].includes(own.value.state) && (
          <div className="rm-actions">
            {(own.value.state === "active"
              ? ["reconfirm", "pause", "resolve", "delete"]
              : ["resume", "delete"]
            ).map((value) => (
              <button
                key={value}
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setAction(value);
                  setReviewed(false);
                }}
              >
                {
                  {
                    reconfirm: rt(
                      "Xác nhận vẫn đang tìm",
                      "Reconfirm availability",
                    ),
                    pause: rt("Tạm dừng", "Pause"),
                    resolve: rt("Đã tìm được", "Found a roommate"),
                    resume: rt("Tiếp tục tìm", "Resume discovery"),
                    delete: rt("Xóa nhu cầu", "Delete profile"),
                  }[value]
                }
              </button>
            ))}
          </div>
        )}
        {own.value?.state === "active" && (
          <ProfileSummary profile={own.value.content} />
        )}
      </aside>
      <LegacyPhotos changed={own.reload} />
      {preview && (
        <ProfilePreview
          content={content}
          busy={busy}
          reviewed={reviewed}
          setReviewed={setReviewed}
          close={() => setPreview(false)}
          publish={publish}
        />
      )}
      {action && own.value && (
        <ProfileTransition
          content={own.value.content}
          busy={busy}
          reviewed={reviewed}
          setReviewed={setReviewed}
          close={() => setAction(null)}
          action={action}
          error={error}
          transition={transition}
        />
      )}
    </div>
  );
}
