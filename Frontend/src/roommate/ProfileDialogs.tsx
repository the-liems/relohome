import { Dialog } from "../components/Dialog";
import { ProfileSummary } from "./ProfileSummary";
import { ErrorNotice } from "./ErrorNotice";
import type { Profile } from "./types";
import { rt } from "./text";
type ReviewProps = {
  content: Profile;
  busy: boolean;
  reviewed: boolean;
  setReviewed: (value: boolean) => void;
  close: () => void;
};
export function ProfilePreview({
  content,
  busy,
  reviewed,
  setReviewed,
  close,
  publish,
}: ReviewProps & { publish: () => Promise<void> }) {
  return (
    <Dialog
      wide
      title={rt("Xem trước hồ sơ công khai", "Preview public profile")}
      onClose={() => !busy && close()}
    >
      <div className="rm-dialog-content">
        <ProfileSummary profile={content} full />
        <label className="rm-check rm-consent">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          {rt(
            "Tôi đã xem lại nội dung và muốn công khai nhu cầu trong 30 ngày. Điều kiện ưu tiên được dùng để lọc hai chiều, không hiển thị như thông tin bản thân.",
            "I reviewed this information and want to publish for 30 days. Preferences are used for mutual filtering, not displayed as personal facts.",
          )}
        </label>
        <button
          className="primary"
          disabled={busy || !reviewed}
          onClick={() => void publish()}
        >
          {busy
            ? rt("Đang đăng…", "Publishing…")
            : rt("Xác nhận đăng nhu cầu", "Publish discovery profile")}
        </button>
      </div>
    </Dialog>
  );
}
export function ProfileTransition({
  content,
  busy,
  reviewed,
  setReviewed,
  close,
  action,
  error,
  transition,
}: ReviewProps & {
  action: string;
  error: unknown;
  transition: (value: string) => Promise<void>;
}) {
  return (
    <Dialog
      title={rt("Cập nhật nhu cầu", "Update discovery status")}
      onClose={() => !busy && close()}
    >
      <div className="rm-dialog-content">
        <p>
          {action === "delete"
            ? rt(
                "Xóa hồ sơ, bản giới thiệu và ảnh; đóng pending và thu hồi liên hệ. Cooldown/lịch sử thao tác vẫn được giữ để chống lạm dụng.",
                "Delete your profile, introduction and images; close pending requests and revoke contacts. Cooldowns and operation history remain for abuse prevention.",
              )
            : action === "pause"
              ? rt(
                  "Ẩn nhu cầu và đóng yêu cầu đến đang chờ. Liên hệ đã được consent còn giữ đúng thời hạn.",
                  "Hide your profile and close incoming pending requests. Previously consented contacts retain their original expiry.",
                )
              : action === "resolve"
                ? rt(
                    "Ẩn nhu cầu và đóng tất cả pending của bạn. Liên hệ đã mở vẫn giữ đúng thời hạn.",
                    "Hide your profile and close all your pending requests. Existing contact access retains its expiry.",
                  )
                : rt(
                    "Xem lại hồ sơ và xác nhận nhu cầu còn đúng. Bắt đầu chu kỳ hoạt động mới 30 ngày.",
                    "Review the profile and confirm it is current. This starts a new 30-day active period.",
                  )}
        </p>
        {["resume", "reconfirm"].includes(action) && (
          <>
            <ProfileSummary profile={content} full />
            <label className="rm-check">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              {rt(
                "Thông tin này còn đúng và tôi vẫn đang tìm.",
                "This information is current and I am still looking.",
              )}
            </label>
          </>
        )}
        <ErrorNotice error={error} />
        <button
          className="primary"
          disabled={
            busy || (["resume", "reconfirm"].includes(action) && !reviewed)
          }
          onClick={() => void transition(action)}
        >
          {rt("Xác nhận", "Confirm")}
        </button>
      </div>
    </Dialog>
  );
}
