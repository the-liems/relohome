import { RequiredMark } from "../../components/RequiredMark";
import { useState } from "react";
import { ShieldAlert, History as HistoryIcon } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { ContentSkeleton } from "../../components/UiStates";
import { useResource } from "../../roommate/useResource";
import { useRoommateClient } from "../../roommate/useRoommateClient";
import { useOperation } from "../../roommate/useOperation";
import { ErrorNotice } from "../../roommate/ErrorNotice";
import { PrivateAvatar } from "../../roommate/PrivateAvatar";
import { rt, stateName } from "../../roommate/text";
import type { Profile, Report, History } from "./types";
import { budgetName, cityName, needName, timeName } from "./format";

function Restriction({
  profile,
  restricted,
  done,
  close,
}: {
  profile: Profile;
  restricted: boolean;
  done: () => void;
  close: () => void;
}) {
  const operation = useOperation();
  const [reason, setReason] = useState("");
  return (
    <Dialog
      title={
        restricted
          ? rt("Khôi phục quyền sử dụng", "Restore service access")
          : rt("Hạn chế tài khoản", "Restrict account")
      }
      onClose={() => !operation.disabled && close()}
    >
      <p className="ra-impact">
        <ShieldAlert size={20} aria-hidden="true" />
        {restricted
          ? rt(
              "Hồ sơ sẽ về tạm dừng. Chủ hồ sơ cần chủ động đăng lại để xuất hiện trong tìm kiếm.",
              "The profile will be paused. Its owner must publish it again to appear in discovery.",
            )
          : rt(
              "Thao tác này hạn chế quyền sử dụng Roommate, đóng yêu cầu đang chờ và quyền liên hệ/chat theo chính sách hiện có. Đây không chỉ là ẩn một tin.",
              "This restricts Roommate access and closes pending requests and contact/chat access under the existing policy.",
            )}
      </p>
      <strong>{profile.display_name || profile.profile_id}</strong>
      <label>
        <span className="field-label">{rt("Lý do xử lý", "Review reason")}<RequiredMark /></span>
        <textarea
          value={reason}
          maxLength={1000}
          disabled={operation.disabled}
          onChange={(e) => setReason(e.target.value)}
          required
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
          className={restricted ? "primary" : "secondary danger"}
          disabled={operation.disabled || !reason.trim()}
          onClick={() =>
            operation.run(
              "/moderation/profiles/" + encodeURIComponent(profile.profile_id),
              "POST",
              {
                selected: !restricted,
                reason: reason.trim(),
                ...(profile.version
                  ? { expected_version: profile.version }
                  : {}),
              },
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

export function Details({
  target,
  report,
  done,
  close,
}: {
  target: string;
  report?: Report;
  done: () => void;
  close: () => void;
}) {
  const roommate = useRoommateClient();
  const detail = useResource<{ profile: Profile; restricted: boolean }>(
    "/moderation/profiles/" + encodeURIComponent(target),
  );
  const [historyOffset, setHistoryOffset] = useState(0);
  const history = useResource<History>(
    "/moderation/profiles/" +
      encodeURIComponent(target) +
      "/history?offset=" +
      historyOffset +
      "&limit=20",
  );
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const p = detail.value?.profile;
  if (confirm && p)
    return (
      <Restriction
        profile={p}
        restricted={detail.value?.restricted ?? p.state === "restricted"}
        close={() => setConfirm(false)}
        done={done}
      />
    );
  return (
    <Dialog
      title={
        report
          ? rt("Xem báo cáo", "Review report")
          : rt("Chi tiết hồ sơ", "Profile details")
      }
      wide
      onClose={() => !busy && close()}
    >
      <div className="ra-drawer" data-service="roommate">
        {report && (
          <section className="ra-report">
            <span className="ra-eyebrow">
              {rt("Nội dung báo cáo", "Report details")}
            </span>
            <p>{report.reason}</p>
            <small>
              {timeName(report.created)} · {stateName(report.status)}
            </small>
          </section>
        )}
        <ErrorNotice error={error || detail.error} retry={detail.reload} />
        {detail.loading ? (
          <ContentSkeleton label={rt("Đang tải hồ sơ…", "Loading profile…")} />
        ) : (
          p && (
            <>
              <div className="ra-person">
                <PrivateAvatar id={p.avatar_id} />
                <div>
                  <h3>
                    {p.display_name || rt("Chưa có tên", "Unnamed profile")}
                  </h3>
                  <span className={"ra-badge ra-state-" + p.state}>
                    {stateName(p.state)}
                  </span>
                </div>
              </div>
              <p className="ra-intro">
                {p.introduction ||
                  rt("Chưa có giới thiệu.", "No introduction provided.")}
              </p>
              <dl className="ra-facts">
                <div>
                  <dt>{rt("Mã hồ sơ", "Profile ID")}</dt>
                  <dd className="ra-id">{p.profile_id}</dd>
                </div>
                <div>
                  <dt>{rt("Nhu cầu", "Housing need")}</dt>
                  <dd>{needName(p.facts?.need?.kind)}</dd>
                </div>
                <div>
                  <dt>{rt("Thành phố", "City")}</dt>
                  <dd>{cityName(p.facts?.city)}</dd>
                </div>
                <div>
                  <dt>{rt("Ngân sách", "Budget")}</dt>
                  <dd>{budgetName(p)}</dd>
                </div>
                <div>
                  <dt>{rt("Cơ sở chi phí", "Cost basis")}</dt>
                  <dd>
                    {p.facts?.budget?.fee_basis === "rent_only"
                      ? rt("Chỉ tiền thuê", "Rent only")
                      : p.facts?.budget?.fee_basis === "including_fees"
                        ? rt("Đã gồm phí", "Including fees")
                        : rt("Chưa xác định", "Not specified")}
                  </dd>
                </div>
                <div>
                  <dt>{rt("Thời điểm vào ở", "Move-in")}</dt>
                  <dd>
                    {p.facts?.move_in?.kind === "flexible"
                      ? rt("Linh hoạt", "Flexible")
                      : p.facts?.move_in?.start || "—"}
                  </dd>
                </div>
                <div>
                  <dt>{rt("Cập nhật", "Updated")}</dt>
                  <dd>{timeName(p.updated_at)}</dd>
                </div>
                <div>
                  <dt>{rt("Hạn hoạt động", "Active until")}</dt>
                  <dd>{timeName(p.expires_at)}</dd>
                </div>
              </dl>
              {p.facts?.area_ids?.length ? (
                <p className="rm-hint">
                  {rt("Khu vực: ", "Areas: ")}
                  {p.facts.area_ids
                    .map((id) =>
                      id.startsWith("city:") ? cityName(id.slice(5)) : id,
                    )
                    .join(" · ")}
                </p>
              ) : null}
            </>
          )
        )}
        <section className="ra-history">
          <h3>
            <HistoryIcon size={17} aria-hidden="true" />
            {rt("Lịch sử xử lý", "Moderation history")}
          </h3>
          <ErrorNotice error={history.error} retry={history.reload} />
          {history.loading ? (
            <p role="status">{rt("Đang tải lịch sử…", "Loading history…")}</p>
          ) : history.value?.items.length ? (
            <ol>
              {history.value.items.map((item) => (
                <li key={item.id}>
                  <strong>
                    {(
                      {
                        restrict: rt("Hạn chế tài khoản", "Account restricted"),
                        restore: rt("Khôi phục quyền", "Access restored"),
                        report_review: rt(
                          "Đã xem xét báo cáo",
                          "Report reviewed",
                        ),
                        image_approve: rt(
                          "Duyệt ảnh trước đây",
                          "Legacy photo approval",
                        ),
                        image_reject: rt(
                          "Từ chối ảnh trước đây",
                          "Legacy photo rejection",
                        ),
                      } as Record<string, string>
                    )[item.action] ||
                      rt("Thao tác quản trị", "Moderation action")}
                  </strong>
                  <p>
                    {item.action === "report_review"
                      ? rt(
                          "Báo cáo đã được đánh dấu xem xét.",
                          "The report was marked reviewed.",
                        )
                      : item.reason}
                  </p>
                  <small>
                    {timeName(item.created)} · {rt("Admin: ", "Admin: ")}
                    {item.actor}
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            !history.error && (
              <p className="rm-hint">
                {rt("Chưa có thao tác quản trị.", "No moderation actions yet.")}
              </p>
            )
          )}
          {history.value && history.value.total > 20 && (
            <div className="rm-actions">
              <button
                className="secondary"
                disabled={historyOffset === 0}
                onClick={() => setHistoryOffset((n) => n - 20)}
              >
                {rt("Trước", "Previous")}
              </button>
              <span>
                {Math.floor(historyOffset / 20) + 1} /{" "}
                {Math.ceil(history.value.total / 20)}
              </span>
              <button
                className="secondary"
                disabled={historyOffset + 20 >= history.value.total}
                onClick={() => setHistoryOffset((n) => n + 20)}
              >
                {rt("Sau", "Next")}
              </button>
            </div>
          )}
        </section>
        <footer className="ra-drawer-footer">
          <button className="secondary" disabled={busy} onClick={close}>
            {rt("Đóng", "Close")}
          </button>
          {p && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              {detail.value?.restricted
                ? rt("Khôi phục quyền sử dụng", "Restore service access")
                : rt("Hạn chế tài khoản", "Restrict account")}
            </button>
          )}
          {report?.status === "open" && (
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await roommate(
                    "/moderation/reports/" +
                      encodeURIComponent(report.id) +
                      "/resolve",
                    "POST",
                  );
                  done();
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {rt("Đánh dấu đã xem xét", "Mark reviewed")}
            </button>
          )}
        </footer>
      </div>
    </Dialog>
  );
}
