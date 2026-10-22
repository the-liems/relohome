import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "../components/Dialog";
import { ContentSkeleton } from "../components/UiStates";
import { useContactMessenger } from "../components/ContactMessenger";
import { useRoommateClient } from "./useRoommateClient";
import { useIntro } from "./useIntro";
import { useOperation } from "./useOperation";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileSummary } from "./ProfileSummary";
import { ErrorNotice } from "./ErrorNotice";
import { rt } from "./text";
import type { Profile, PublicProfile } from "./types";

export function introComplete(value: Profile) {
  const facts = value.facts;
  return Boolean(
    value.display_name?.trim() &&
    value.introduction?.trim() &&
    facts.self_traits.gender &&
    facts.city &&
    facts.area_ids.length &&
    facts.budget?.fee_basis &&
    facts.need &&
    facts.move_in &&
    (facts.need.kind !== "has_room" || facts.need.willing_to_move != null),
  );
}

export function ChatConnectionComposer({
  recipient,
  close,
}: {
  recipient: PublicProfile;
  close: () => void;
}) {
  const roommate = useRoommateClient();
  const intro = useIntro(),
    operation = useOperation(),
    navigate = useNavigate(),
    messenger = useContactMessenger();
  const [editing, setEditing] = useState(false),
    [checking, setChecking] = useState(false),
    [error, setError] = useState<unknown>(null);
  const lock = useRef(false);
  const edit = editing || !introComplete(intro.content);
  return (
    <Dialog
      wide
      title={rt("Gửi yêu cầu kết nối", "Send a connection request")}
      onClose={() => !operation.disabled && !checking && close()}
    >
      <div className="rm-dialog-content">
        <p>
          {rt("Gửi đến: ", "To: ")}
          <strong>{recipient.display_name}</strong>
        </p>
        <p className="rm-hint">
          {rt(
            "Khi người này đồng ý, hai bạn có thể nhắn tin trong ReloHome. Không cần cung cấp Phone/Zalo.",
            "Once they accept, you can chat in ReloHome. No phone number or Zalo required.",
          )}
        </p>
        {intro.loading ? (
          <ContentSkeleton
            label={rt("Đang tải bản giới thiệu…", "Loading your introduction…")}
          />
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (lock.current || operation.disabled || intro.error) return;
              lock.current = true;
              setChecking(true);
              setError(null);
              const payload = structuredClone(intro.content);
              try {
                await roommate("/me/profile/preview", "POST", payload);
                operation.run(
                  "/chat/requests",
                  "POST",
                  { recipient_id: recipient.profile_id, intro: payload },
                  (result) => {
                    intro.saved();
                    messenger.refresh();
                    close();
                    if (typeof result.conversation_id === "string")
                      messenger.openRoommate(
                        result.conversation_id,
                        recipient.display_name || undefined,
                      );
                    navigate("/roommate/requests/" + result.request_id);
                  },
                );
              } catch (cause) {
                setError(cause);
                setEditing(true);
              } finally {
                lock.current = false;
                setChecking(false);
              }
            }}
          >
            <fieldset disabled={checking || operation.disabled}>
              <legend>
                {rt("Bản giới thiệu của bạn", "Your introduction")}
              </legend>
              {edit ? (
                <>
                  <ProfileEditor value={intro.content} change={intro.change} />
                  {introComplete(intro.content) && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setEditing(false)}
                    >
                      {rt("Thu gọn", "Collapse")}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <ProfileSummary profile={intro.content} full />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditing(true)}
                  >
                    {rt("Chỉnh sửa", "Edit")}
                  </button>
                </>
              )}
            </fieldset>
            <p className="rm-hint">
              {rt(
                "Bản giới thiệu được dùng cho lần gửi sau. Gửi yêu cầu không đăng hồ sơ công khai.",
                "This introduction is reused for future requests. Sending does not publish your profile.",
              )}
            </p>
            <ErrorNotice
              error={intro.error || error}
              retry={intro.error ? intro.reload : undefined}
            />
            {operation.notice}
            <div className="rm-actions rm-composer-footer">
              <button
                className="primary"
                disabled={
                  checking || operation.disabled || Boolean(intro.error)
                }
              >
                {checking || operation.busy
                  ? rt("Đang gửi…", "Sending…")
                  : rt("Gửi yêu cầu kết nối", "Send connection request")}
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
