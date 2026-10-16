import { useContext, useState } from "react";
import { RoommateIdentity } from "./Features";
import { ContentSkeleton } from "../components/UiStates";
import { AccessGate } from "./AccessGate";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileSummary } from "./ProfileSummary";
import { ErrorNotice } from "./ErrorNotice";
import { useResource } from "./useResource";
import { useIntro } from "./useIntro";
import { roommate } from "./client";
import { rt } from "./text";
import type { Access, Availability } from "./types";

export function AccountIntroPanel({ name, id }: { name: string; id: string }) {
  return (
    <RoommateIdentity.Provider value={{ id, name }}>
      <AccountProfile name={name} />
    </RoommateIdentity.Provider>
  );
}
function AccountProfile({ name }: { name: string }) {
  const availability = useResource<Availability>("/availability");
  const enabled = Boolean(
    availability.value?.enabled &&
    availability.value.features?.includes("chat"),
  );
  const access = useResource<Access>(enabled ? "/access" : null);
  if (!enabled) return null;
  return (
    <section
      className="account-roommate-intro rm-panel"
      data-service="roommate"
    >
      <h2>{rt("Bản giới thiệu ở ghép", "Your roommate introduction")}</h2>
      <p className="rm-hint">
        {rt(
          "Điền một lần, dùng lại khi tìm người ở cùng. Thông tin chưa tự đăng công khai.",
          "Fill this in once and reuse it when finding a roommate. It is not automatically published.",
        )}
      </p>
      <ErrorNotice error={access.error} retry={access.reload} />
      {access.loading ? (
        <ContentSkeleton
          label={rt("Đang kiểm tra hồ sơ…", "Checking profile access…")}
        />
      ) : access.value?.eligible ? (
        <IntroEditor name={name} />
      ) : (
        access.value && (
          <AccessGate access={access.value} done={access.reload} />
        )
      )}
    </section>
  );
}

function IntroEditor({ name }: { name: string }) {
  const identity = useContext(RoommateIdentity);
  const intro = useIntro(name);
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState("");
  const edit = editing || !intro.value;
  if (intro.loading && !intro.value)
    return (
      <ContentSkeleton
        label={rt("Đang tải bản giới thiệu…", "Loading your introduction…")}
      />
    );
  return (
    <>
      {edit ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || intro.error) return;
            setBusy(true);
            setError(null);
            setNotice("");
            try {
              await roommate(
                "/me/intro",
                "PUT",
                intro.content,
                undefined,
                identity.id,
              );
              intro.saved();
              setEditing(false);
              setNotice(
                rt(
                  "Đã lưu để dùng lại trong Ở ghép. Chưa đăng công khai.",
                  "Saved for your roommate search. Not published.",
                ),
              );
            } catch (cause) {
              setError(cause);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <legend>
              {rt("Giới thiệu và nhu cầu", "Introduction and housing needs")}
            </legend>
            <ProfileEditor value={intro.content} change={intro.change} />
          </fieldset>
          <p className="rm-hint">
            {rt(
              "Thay đổi nhu cầu có thể đóng các yêu cầu đang chờ không còn phù hợp.",
              "Changing your needs may close pending requests that no longer fit.",
            )}
          </p>
          <button className="primary" disabled={busy || Boolean(intro.error)}>
            {busy
              ? rt("Đang lưu…", "Saving…")
              : rt("Lưu bản giới thiệu", "Save introduction")}
          </button>
        </form>
      ) : (
        <>
          <ProfileSummary profile={intro.content} />
          <button
            className="secondary"
            onClick={() => {
              setEditing(true);
              setNotice("");
            }}
          >
            {rt("Chỉnh sửa bản giới thiệu", "Edit introduction")}
          </button>
        </>
      )}
      <ErrorNotice
        error={intro.error || error}
        retry={intro.error ? intro.reload : undefined}
      />
      {notice && <p role="status">{notice}</p>}
    </>
  );
}
