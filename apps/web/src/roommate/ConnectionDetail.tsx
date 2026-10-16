import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, LockKeyhole, Mail } from "lucide-react";
import { Dialog } from "../components/Dialog";
import { ContentSkeleton, EmptyState } from "../components/UiStates";
import { useResource } from "./useResource";
import { useOperation } from "./useOperation";
import { useContactLease } from "./useContactLease";
import { ProfileSummary } from "./ProfileSummary";
import { ContactPicker } from "./ContactPicker";
import { ErrorNotice } from "./ErrorNotice";
import type { Contact, RequestDetail } from "./types";
import { dateLabel, deadlineLabel, rt, stateName } from "./text";
import { ServiceSuggestions } from "../components/ServiceSuggestions";
import { roommate } from "./client";
import { ChatConnectionDetails } from "./ChatConnectionDetails";
export function ConnectionDetail({
  notificationsEnabled = false,
}: {
  notificationsEnabled?: boolean;
}) {
  const { requestId = "" } = useParams(),
    detail = useResource<RequestDetail>(
      "/requests/" + encodeURIComponent(requestId),
    );
  const operation = useOperation();
  const [action, setAction] = useState<string | null>(null),
    [selected, setSelected] = useState<Contact | null>(null),
    [consent, setConsent] = useState(false),
    [showContact, setShowContact] = useState(false);
  useEffect(() => {
    const refresh = () => {
      setShowContact(false);
      if (!operation.disabled) {
        detail.reload();
      }
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [requestId, operation.disabled]);
  const record = detail.value,
    lease = useContactLease(
      requestId,
      showContact && record?.grant_state === "active" && record.available,
    );
  const actionName = (value: string) =>
    ({
      accept: rt("Đồng ý kết nối", "Accept request"),
      reject: rt("Từ chối", "Decline"),
      withdraw: rt("Rút yêu cầu", "Withdraw request"),
      revoke: rt("Thu hồi quyền liên hệ", "Revoke contact access"),
    })[value] || value;
  useEffect(() => {
    if (notificationsEnabled && record?.available)
      void roommate(
        "/requests/" + encodeURIComponent(requestId) + "/read",
        "POST",
        {},
      ).catch(() => {});
  }, [requestId, record?.available, notificationsEnabled]);
  return (
    <section className="rm-detail">
      <Link className="text-button" to="/roommate?tab=inbox">
        <ArrowLeft size={16} aria-hidden="true" />
        {rt("Về yêu cầu kết nối", "Back to requests")}
      </Link>
      <ErrorNotice error={detail.error} retry={detail.reload} />
      {detail.loading && !record ? (
        <ContentSkeleton label={rt("Đang tải yêu cầu…", "Loading request…")} />
      ) : record?.available && record.mode === "chat" ? (
        <ChatConnectionDetails
          key={record.request_id}
          record={record}
          reload={detail.reload}
        />
      ) : record?.available ? (
        <div className="rm-detail-columns">
          <div className="rm-panel">
            <h2>
              {record.direction === "received"
                ? rt(
                    "Bản giới thiệu bạn nhận được",
                    "Introduction you received",
                  )
                : rt("Bản giới thiệu bạn đã gửi", "Introduction you sent")}
            </h2>
            {record.intro && (
              <ProfileSummary
                profile={{ ...record.intro, preferences: {} }}
                full
              />
            )}
            <p className="rm-hint">
              {rt("Đã xem lại khi gửi vào ", "Reviewed when sent on ")}
              {record.intro && dateLabel(record.intro.reviewed_at)}
            </p>
          </div>
          <aside
            className="rm-panel"
            aria-label={rt("Trạng thái và liên hệ", "Status and contact")}
          >
            <h2>{stateName(record.state)}</h2>
            <p className="rm-hint">
              {rt("Mã yêu cầu", "Request ID")}: {record.request_id}
            </p>
            <p>
              {rt("Hạn phản hồi: ", "Reply deadline: ")}
              {deadlineLabel(record.expires_at)}
            </p>
            {record.grant_state && (
              <p>
                {rt("Quyền liên hệ: ", "Contact access: ")}
                {record.grant_state === "active"
                  ? rt("Đang mở", "Open")
                  : stateName(record.grant_state)}
                {record.grant_expires_at &&
                  " · " + deadlineLabel(record.grant_expires_at)}
              </p>
            )}
            {record.grant_state === "active" ? (
              <>
                <button
                  className="secondary full"
                  onClick={() => {
                    setShowContact((v) => !v);
                    if (showContact) lease.reload();
                  }}
                >
                  {showContact
                    ? rt("Ẩn liên hệ", "Hide contact")
                    : rt("Xem liên hệ", "View contact")}
                </button>
                {showContact && (
                  <div className="rm-contact-lease">
                    <LockKeyhole size={18} aria-hidden="true" />
                    <ErrorNotice error={lease.error} retry={lease.reload} />
                    {lease.lease ? (
                      <>
                        <strong>
                          {lease.lease.contact.kind === "phone"
                            ? rt("Điện thoại", "Phone")
                            : "Zalo"}
                        </strong>
                        <p>{lease.lease.contact.value}</p>
                        <small>
                          {rt("Có hiệu lực đến ", "Available until ")}
                          {deadlineLabel(lease.lease.expires_at)}
                        </small>
                      </>
                    ) : (
                      !lease.error && (
                        <p role="status">
                          {rt(
                            "Đang kiểm tra quyền xem liên hệ…",
                            "Checking contact access…",
                          )}
                        </p>
                      )
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="rm-hint">
                <LockKeyhole size={16} aria-hidden="true" />
                {rt(
                  "Liên hệ chỉ mở sau consent của cả hai và trong thời hạn được phép.",
                  "Contact access requires both parties’ consent and a valid access period.",
                )}
              </p>
            )}
            <div className="rm-actions">
              {record.actions?.map((value) => (
                <button
                  className={value === "accept" ? "primary" : "secondary"}
                  key={value}
                  onClick={() => {
                    setAction(value);
                    setConsent(false);
                    setSelected(null);
                  }}
                >
                  {actionName(value)}
                </button>
              ))}
              <button
                className="text-button"
                onClick={() => {
                  setShowContact(false);
                  detail.reload();
                }}
              >
                {rt("Tải lại trạng thái", "Refresh status")}
              </button>
            </div>
            {record.state === "accepted" && record.grant_state === "active" && (
              <ServiceSuggestions service="roommate" />
            )}
          </aside>
        </div>
      ) : (
        !detail.error && (
          <EmptyState
            icon={<Mail />}
            title={rt("Yêu cầu không còn khả dụng", "Request unavailable")}
            text={rt(
              "Không hiển thị lại bản giới thiệu hoặc liên hệ đã mất quyền xem.",
              "Introductions and contacts whose access was withdrawn are not displayed.",
            )}
          />
        )
      )}
      {action && (
        <Dialog
          title={actionName(action)}
          onClose={() => !operation.disabled && setAction(null)}
        >
          <div className="rm-dialog-content">
            <p>
              {action === "accept"
                ? rt(
                    "Bạn đã xem bản giới thiệu. Chọn kênh của mình và chủ động consent để mở liên hệ hai chiều trong 7 ngày.",
                    "Review the introduction, select your own contact and consent to open mutual contact access for 7 days.",
                  )
                : action === "revoke"
                  ? rt(
                      "Cả hai mất quyền xem liên hệ của cặp này. Consent cũ không được khôi phục tự động.",
                      "Both parties lose contact access for this connection. Old consent is not restored automatically.",
                    )
                  : rt(
                      "Thao tác sẽ đóng yêu cầu đang chờ. Hệ thống áp dụng thời gian chờ trước khi gửi lại theo quy định.",
                      "This closes the pending request. A cooldown applies before another request can be sent.",
                    )}
            </p>
            {action === "accept" && (
              <fieldset disabled={operation.disabled}>
                <legend>
                  {rt("Xác nhận chia sẻ", "Sharing confirmation")}
                </legend>
                <ContactPicker
                  selected={selected}
                  select={(c) => {
                    setSelected(c);
                    setConsent(false);
                  }}
                />
                <label className="rm-check rm-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  {rt(
                    "Tôi đồng ý chia sẻ kênh đã chọn với người gửi; quyền hai chiều có hạn 7 ngày và có thể thu hồi.",
                    "I consent to sharing the selected channel with the sender. Mutual access lasts 7 days and can be revoked.",
                  )}
                </label>
              </fieldset>
            )}
            {operation.notice}
            <button
              className="primary"
              disabled={
                operation.disabled ||
                (action === "accept" && (!consent || !selected))
              }
              onClick={() =>
                operation.run(
                  "/requests/" + encodeURIComponent(requestId) + "/" + action,
                  "POST",
                  action === "accept"
                    ? {
                        contact: {
                          channel_id: selected!.channel_id,
                          version: selected!.version,
                        },
                        consent,
                      }
                    : {},
                  () => {
                    setAction(null);
                    setShowContact(false);
                    detail.reload();
                  },
                )
              }
            >
              {operation.busy
                ? rt("Đang xử lý…", "Processing…")
                : actionName(action)}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
