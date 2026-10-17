import { useState } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "../components/Dialog";
import { useResource } from "./useResource";
import { useActiveRefresh } from "./useActiveRefresh";
import { useRoommateClient } from "./useRoommateClient";
import { ErrorNotice } from "./ErrorNotice";
import { rt } from "./text";

type Draft = { path: string; method: string; body: Record<string, unknown> };
type Outcome = {
  status: string;
  draft?: Draft;
  result?: { request_id?: string };
};
function replayAllowed(draft: Draft) {
  const routes: Record<string, string[]> = {
    POST: [
      "^/chat/requests$",
      "^/chat/requests/[A-Za-z0-9_.:-]{1,128}/accept$",
      "^/chat/conversations/[A-Za-z0-9_.:-]{1,128}/close$",
      "^/requests$",
      "^/reports$",
      "^/requests/[A-Za-z0-9_.:-]{1,128}/(accept|reject|withdraw|revoke)$",
      "^/moderation/profiles/[A-Za-z0-9_.:-]{1,128}$",
    ],
    PUT: ["^/me/contacts$", "^/blocks/[A-Za-z0-9_.:-]{1,128}$"],
  };
  return (
    (routes[draft.method] || []).some((pattern) =>
      new RegExp(pattern).test(draft.path),
    ) && typeof draft.body.operation_key === "string"
  );
}
export function RecoveryPanel() {
  const roommate = useRoommateClient();
  const data = useResource<{
    items: { operation_key: string; expires_at: string }[];
  }>("/me/operation-drafts");
  const [review, setReview] = useState<{ key: string; value: Outcome } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  useActiveRefresh(data.reload, true, 60000);
  async function check(key: string) {
    setBusy(true);
    setError(null);
    try {
      setReview({
        key,
        value: await roommate<Outcome>(
          "/operation-drafts/" + encodeURIComponent(key),
        ),
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!data.value?.items.length) return null;
  const draft = review?.value.draft;
  const intro = draft?.body.intro as
    { display_name?: string; introduction?: string } | undefined;
  return (
    <aside
      className="rm-reminder"
      aria-label={rt("Thao tác cần kiểm tra", "Actions to reconcile")}
    >
      <strong>
        {rt(
          "Có thao tác trước đó cần kiểm tra",
          "An earlier action needs checking",
        )}
      </strong>
      <p className="rm-hint">
        {rt(
          "Kiểm tra kết quả trước khi gửi lại. Bản xác nhận được lưu riêng, không tự thực hiện thao tác.",
          "Check its outcome before retrying. The reviewed draft is private and is never replayed automatically.",
        )}
      </p>
      <ErrorNotice error={error} />
      <div className="rm-actions">
        {data.value.items.map((item, index) => (
          <button
            key={item.operation_key}
            className="secondary"
            disabled={busy}
            onClick={() => void check(item.operation_key)}
          >
            {rt("Kiểm tra thao tác", "Check action")} {index + 1}
          </button>
        ))}
      </div>
      {review && (
        <Dialog
          title={rt("Xem lại thao tác", "Review earlier action")}
          onClose={() => {
            if (!busy) {
              setReview(null);
              setError(null);
            }
          }}
        >
          <ErrorNotice error={error} />
          {review.value.status === "completed" ? (
            <>
              <p role="status">
                {rt(
                  "Thao tác đã hoàn tất. Không cần gửi lại.",
                  "This action completed. No retry is needed.",
                )}
              </p>
              {review.value.result?.request_id && (
                <Link
                  className="primary"
                  to={
                    "/roommate/requests/" +
                    encodeURIComponent(review.value.result.request_id)
                  }
                >
                  {rt("Xem yêu cầu", "View request")}
                </Link>
              )}
            </>
          ) : (
            draft && (
              <>
                <p>
                  {draft.path === "/requests"
                    ? rt(
                        "Gửi bản giới thiệu tới hồ sơ đã chọn.",
                        "Send the introduction to the selected profile.",
                      )
                    : draft.path.includes("/me/contacts")
                      ? rt(
                          "Cập nhật kênh liên hệ riêng của bạn.",
                          "Update your private contact channel.",
                        )
                      : rt(
                          "Gửi lại thao tác bạn đã xác nhận trước đó.",
                          "Retry the action you previously confirmed.",
                        )}
                </p>
                {intro && (
                  <>
                    <strong>{intro.display_name}</strong>
                    <p className="rm-wrap">{intro.introduction}</p>
                  </>
                )}
                <p className="rm-hint">
                  {rt(
                    "Hệ thống vẫn kiểm tra quyền, thời hạn và thông tin hiện tại. Yêu cầu đã hoàn tất sẽ trả lại kết quả cũ.",
                    "The service rechecks current permissions, deadlines and information. Completed requests return their original result.",
                  )}
                </p>
                <button
                  className="primary"
                  disabled={busy || !replayAllowed(draft)}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const result = await roommate<{ request_id?: string }>(
                        draft.path,
                        draft.method,
                        draft.body,
                      );
                      setReview({
                        key: review.key,
                        value: { status: "completed", result },
                      });
                      data.reload();
                    } catch (e) {
                      setError(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {rt(
                    "Xác nhận gửi lại cùng thao tác",
                    "Confirm retry of the same action",
                  )}
                </button>
              </>
            )
          )}
        </Dialog>
      )}
    </aside>
  );
}
