import { useState } from "react";
import { ShieldCheck, Image, Flag, UsersRound } from "lucide-react";
import { Dialog, ConfirmDialog } from "../components/Dialog";
import { ContentSkeleton, EmptyState } from "../components/UiStates";
import { useResource } from "./useResource";
import { useOperation } from "./useOperation";
import { useRoommateClient } from "./useRoommateClient";
import { PrivateAvatar } from "./PrivateAvatar";
import { ErrorNotice } from "./ErrorNotice";
import { rt, stateName } from "./text";
import type { Media } from "./types";

type Report = {
  id: string;
  target: string;
  reason: string;
  status: string;
  created: number;
};
type Profile = {
  profile_id: string;
  state: string;
  display_name: string | null;
  introduction: string | null;
  avatar_id: string | null;
};
type Item = Report | (Media & { owner: string }) | Profile;
type Queue = { items: Item[]; total: number };

function RestrictDialog({
  target,
  restricted,
  done,
  close,
}: {
  target: string;
  restricted: boolean;
  done: () => void;
  close: () => void;
}) {
  const [reason, setReason] = useState("");
  const operation = useOperation();
  return (
    <Dialog
      title={
        restricted
          ? rt("Khôi phục quyền sử dụng", "Restore service access")
          : rt("Hạn chế tài khoản", "Restrict account")
      }
      onClose={() => !operation.disabled && close()}
    >
      <p>
        {restricted
          ? rt(
              "Hồ sơ trở về tạm dừng. Người dùng phải chủ động đăng lại.",
              "The profile will be paused. Its owner must publish it again.",
            )
          : rt(
              "Yêu cầu đang chờ và quyền liên hệ sẽ được đóng theo chính sách hiện tại.",
              "Pending requests and contact access will close under the existing policy.",
            )}
      </p>
      <label>
        {rt("Lý do xử lý", "Review reason")}
        <textarea
          maxLength={1000}
          required
          value={reason}
          disabled={operation.disabled}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {operation.notice}
      <div className="rm-actions">
        <button
          className="secondary"
          disabled={operation.disabled}
          onClick={close}
        >
          {rt("Quay lại", "Back")}
        </button>
        <button
          className="primary"
          disabled={operation.disabled || !reason.trim()}
          onClick={() =>
            operation.run(
              "/moderation/profiles/" + encodeURIComponent(target),
              "POST",
              { selected: !restricted, reason: reason.trim() },
              done,
            )
          }
        >
          {rt("Xác nhận xử lý", "Confirm action")}
        </button>
      </div>
    </Dialog>
  );
}

export function ModerationWorkspace({ allowed }: { allowed: boolean }) {
  const roommate = useRoommateClient();
  const [tab, setTab] = useState<"reports" | "media" | "profiles">("reports"),
    [offset, setOffset] = useState(0),
    [status, setStatus] = useState("open");
  const [report, setReport] = useState<Report | null>(null),
    [restriction, setRestriction] = useState<{
      target: string;
      restricted: boolean;
    } | null>(null);
  const [image, setImage] = useState<(Media & { owner: string }) | null>(null),
    [reason, setReason] = useState(""),
    [approved, setApproved] = useState(true);
  const queue = useResource<Queue>(
    allowed
      ? `/moderation/${tab}?offset=${offset}&limit=20${status ? "&status=" + status : ""}`
      : null,
  );
  const summary = useResource<{
    active_profiles: number;
    pending_reports: number;
    pending_media: number;
    pending_requests: number;
  }>(allowed ? "/moderation/summary" : null);
  const reload = () => {
    queue.reload();
    summary.reload();
  };
  if (!allowed)
    return (
      <p role="alert">
        {rt(
          "Bạn không có quyền quản lý cộng đồng.",
          "You do not have community moderation access.",
        )}
      </p>
    );
  return (
    <section className="rm-panel">
      <div className="rm-section-heading">
        <div>
          <h2>{rt("Quản lý cộng đồng", "Community moderation")}</h2>
          <p className="rm-hint">
            {rt(
              "Duyệt nội dung, xử lý báo cáo và giữ an toàn cho người đang tìm ở ghép.",
              "Review content and reports to keep roommate discovery safe.",
            )}
          </p>
        </div>
        <ShieldCheck aria-hidden="true" />
      </div>
      {summary.value && (
        <dl className="rm-moderation-stats">
          <div>
            <dt>{rt("Đang tìm", "Active profiles")}</dt>
            <dd>{summary.value.active_profiles}</dd>
          </div>
          <div>
            <dt>{rt("Báo cáo chờ", "Open reports")}</dt>
            <dd>{summary.value.pending_reports}</dd>
          </div>
          <div>
            <dt>{rt("Ảnh chờ duyệt", "Pending photos")}</dt>
            <dd>{summary.value.pending_media}</dd>
          </div>
        </dl>
      )}
      <div
        className="rm-actions"
        role="group"
        aria-label={rt("Loại nội dung", "Content queue")}
      >
        {(
          [
            ["reports", rt("Báo cáo", "Reports"), Flag],
            ["media", rt("Ảnh hồ sơ", "Profile photos"), Image],
            ["profiles", rt("Hồ sơ", "Profiles"), UsersRound],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            className="secondary"
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setOffset(0);
              setStatus(
                key === "reports"
                  ? "open"
                  : key === "media"
                    ? "pending"
                    : "active",
              );
            }}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
        <label>
          {rt("Trạng thái", "Status")}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">{rt("Tất cả", "All")}</option>
            {(tab === "reports"
              ? ["open", "reviewed"]
              : tab === "media"
                ? ["pending", "approved", "rejected"]
                : ["active", "paused", "restricted", "expired"]
            ).map((s) => (
              <option key={s} value={s}>
                {stateName(s)}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" onClick={reload}>
          {rt("Tải lại", "Refresh")}
        </button>
      </div>
      <ErrorNotice error={queue.error || summary.error} retry={reload} />
      {queue.loading ? (
        <ContentSkeleton label={rt("Đang tải danh sách…", "Loading queue…")} />
      ) : queue.value?.items.length ? (
        <ul className="rm-moderation-list">
          {queue.value.items.map((item) => {
            if ("id" in item)
              return (
                <li key={item.id}>
                  <div>
                    <h3>
                      {rt("Báo cáo hồ sơ", "Profile report")} ·{" "}
                      {item.target.slice(0, 8)}
                    </h3>
                    <p className="rm-wrap">{item.reason}</p>
                    <small>{stateName(item.status)}</small>
                  </div>
                  <div className="rm-actions">
                    <button
                      className="secondary"
                      onClick={() => setReport(item)}
                    >
                      {rt("Xử lý báo cáo", "Review report")}
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() =>
                        setRestriction({
                          target: item.target,
                          restricted: false,
                        })
                      }
                    >
                      {rt("Hạn chế tài khoản", "Restrict account")}
                    </button>
                  </div>
                </li>
              );
            if ("media_id" in item)
              return (
                <li key={item.media_id}>
                  <PrivateAvatar id={item.media_id} />
                  <div>
                    <h3>
                      {rt("Ảnh của tài khoản", "Account photo")} ·{" "}
                      {item.owner.slice(0, 8)}
                    </h3>
                    <small>{stateName(item.status)}</small>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => {
                      setImage(item);
                      setReason("");
                      setApproved(true);
                    }}
                  >
                    {rt("Duyệt ảnh", "Review photo")}
                  </button>
                </li>
              );
            return (
              <li key={item.profile_id}>
                <PrivateAvatar id={item.avatar_id} />
                <div>
                  <h3>
                    {item.display_name ||
                      rt("Hồ sơ không còn khả dụng", "Unavailable profile")}
                  </h3>
                  <p className="rm-inbox-preview">{item.introduction}</p>
                  <small>{stateName(item.state)}</small>
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    setRestriction({
                      target: item.profile_id,
                      restricted: item.state === "restricted",
                    })
                  }
                >
                  {item.state === "restricted"
                    ? rt("Khôi phục", "Restore")
                    : rt("Hạn chế", "Restrict")}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        !queue.error && (
          <EmptyState
            icon={<ShieldCheck />}
            title={rt("Không có nội dung trong mục này", "This queue is empty")}
            text={rt(
              "Nội dung mới sẽ xuất hiện ở đây.",
              "New content will appear here.",
            )}
          />
        )
      )}
      {queue.value && queue.value.total > 20 && (
        <div className="rm-actions rm-pagination">
          <button
            className="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(offset - 20)}
          >
            {rt("Trước", "Previous")}
          </button>
          <span>
            {Math.floor(offset / 20) + 1} / {Math.ceil(queue.value.total / 20)}
          </span>
          <button
            className="secondary"
            disabled={offset + 20 >= queue.value.total}
            onClick={() => setOffset(offset + 20)}
          >
            {rt("Tiếp", "Next")}
          </button>
        </div>
      )}
      {report && (
        <ConfirmDialog
          title={rt("Đánh dấu đã xem báo cáo?", "Mark this report reviewed?")}
          action={rt("Đã xử lý", "Mark reviewed")}
          onClose={() => setReport(null)}
          onConfirm={async () => {
            await roommate(
              "/moderation/reports/" +
                encodeURIComponent(report.id) +
                "/resolve",
              "POST",
            );
            setReport(null);
            reload();
          }}
        >
          <p>
            {rt(
              "Thao tác này không tự chặn hoặc hạn chế người bị báo cáo.",
              "This action does not automatically block or restrict the reported account.",
            )}
          </p>
        </ConfirmDialog>
      )}
      {restriction && (
        <RestrictDialog
          {...restriction}
          close={() => setRestriction(null)}
          done={() => {
            setRestriction(null);
            reload();
          }}
        />
      )}
      {image && (
        <ConfirmDialog
          title={rt("Duyệt ảnh hồ sơ", "Review profile photo")}
          action={rt("Lưu kết quả duyệt", "Save review")}
          onClose={() => setImage(null)}
          onConfirm={async () => {
            if (!reason.trim())
              throw new Error(
                rt("Vui lòng ghi lý do.", "Enter a review reason."),
              );
            await roommate(
              "/moderation/media/" + encodeURIComponent(image.media_id),
              "POST",
              { approved, reason: reason.trim() },
            );
            setImage(null);
            reload();
          }}
        >
          <div className="rm-review-photo">
            <PrivateAvatar id={image.media_id} />
          </div>
          <p className="rm-hint">
            {rt(
              "Kiểm tra thông tin liên hệ trong ảnh và nội dung không phù hợp trước khi duyệt.",
              "Check for contact information or inappropriate content before approving.",
            )}
          </p>
          <label>
            {rt("Kết quả", "Decision")}
            <select
              value={String(approved)}
              onChange={(e) => setApproved(e.target.value === "true")}
            >
              <option value="true">{rt("Duyệt", "Approve")}</option>
              <option value="false">{rt("Từ chối", "Reject")}</option>
            </select>
          </label>
          <label>
            {rt("Lý do xử lý", "Review reason")}
            <textarea
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </ConfirmDialog>
      )}
    </section>
  );
}
