import { useContext, useEffect, useState } from "react";
import { RoommateFeatures } from "./Features";
import { ChatConnectionComposer } from "./ChatConnectionComposer";
import { useNavigate } from "react-router-dom";
import { Dialog } from "../components/Dialog";
import { ContentSkeleton } from "../components/UiStates";
import { roommate } from "./client";
import { useResource } from "./useResource";
import { useOperation } from "./useOperation";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileSummary } from "./ProfileSummary";
import { ContactPicker } from "./ContactPicker";
import { ErrorNotice } from "./ErrorNotice";
import {
  emptyProfile,
  type Contact,
  type Profile,
  type PublicProfile,
} from "./types";
import { rt } from "./text";
export function ConnectionComposer(props: {
  recipient: PublicProfile;
  close: () => void;
}) {
  const features = useContext(RoommateFeatures);
  return features.includes("chat") ? (
    <ChatConnectionComposer {...props} />
  ) : (
    <LegacyConnectionComposer {...props} />
  );
}
function LegacyConnectionComposer({
  recipient,
  close,
}: {
  recipient: PublicProfile;
  close: () => void;
}) {
  const stored = useResource<Profile>("/me/intro"),
    operation = useOperation(),
    navigate = useNavigate();
  const [intro, setIntro] = useState(emptyProfile()),
    [contact, setContact] = useState<Contact | null>(null),
    [consent, setConsent] = useState(false),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (stored.value) setIntro(stored.value);
  }, [stored.value]);
  return (
    <Dialog
      wide
      title={rt("Gửi yêu cầu kết nối", "Send a connection request")}
      onClose={() => !operation.disabled && !busy && close()}
    >
      <div className="rm-dialog-content">
        <p className="rm-hint">
          {rt("Gửi đến: ", "To: ")}
          <strong>{recipient.display_name}</strong> ·{" "}
          {rt(
            "Không tự đăng hồ sơ tìm người.",
            "This does not publish a discovery profile.",
          )}
        </p>
        {stored.loading ? (
          <ContentSkeleton
            label={rt("Đang tải bản giới thiệu…", "Loading your introduction…")}
          />
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setBusy(true);
              try {
                await roommate("/me/profile/preview", "POST", intro);
                setReview(true);
                setConsent(false);
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={operation.disabled || busy}>
              <legend>
                {review
                  ? rt(
                      "Xem lại bản giới thiệu gửi đi",
                      "Review your introduction",
                    )
                  : rt("Bản giới thiệu riêng tư", "Your private introduction")}
              </legend>
              {review ? (
                <ProfileSummary profile={intro} full />
              ) : (
                <ProfileEditor value={intro} change={setIntro} />
              )}
              <ContactPicker
                selected={contact}
                select={(c) => {
                  setContact(c);
                  setConsent(false);
                }}
              />
              {review && (
                <label className="rm-check rm-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  {rt(
                    "Tôi đã xem lại bản giới thiệu và đồng ý chia sẻ kênh đã chọn với người này khi họ đồng ý. Quyền xem có hạn 7 ngày và có thể thu hồi.",
                    "I reviewed my introduction and consent to sharing the selected contact with this person if they accept. Access lasts 7 days and can be revoked.",
                  )}
                </label>
              )}
            </fieldset>
            <ErrorNotice
              error={stored.error || error}
              retry={stored.error ? stored.reload : undefined}
            />
            {operation.notice}
            <div className="rm-actions">
              {review ? (
                <>
                  <button
                    type="button"
                    className="secondary"
                    disabled={operation.disabled}
                    onClick={() => {
                      setReview(false);
                      setConsent(false);
                    }}
                  >
                    {rt("Sửa giới thiệu", "Edit introduction")}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!consent || !contact || operation.disabled}
                    onClick={() =>
                      operation.run(
                        "/requests",
                        "POST",
                        {
                          recipient_id: recipient.profile_id,
                          intro,
                          contact: {
                            channel_id: contact!.channel_id,
                            version: contact!.version,
                          },
                          consent,
                        },
                        (result) => {
                          close();
                          navigate("/roommate/requests/" + result.request_id);
                        },
                      )
                    }
                  >
                    {operation.busy
                      ? rt("Đang gửi…", "Sending…")
                      : rt("Gửi yêu cầu", "Send request")}
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  disabled={
                    busy ||
                    stored.loading ||
                    Boolean(stored.error) ||
                    !intro.facts.area_ids.length
                  }
                >
                  {busy
                    ? rt("Đang kiểm tra…", "Checking…")
                    : rt("Xem lại trước khi gửi", "Review before sending")}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
