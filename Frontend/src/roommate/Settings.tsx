import { useState } from "react";
import { LockKeyhole, UserRound } from "lucide-react";
import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/UiStates";
import { ContactPicker } from "./ContactPicker";
import { useResource } from "./useResource";
import { useOperation } from "./useOperation";
import { ErrorNotice } from "./ErrorNotice";
import { rt } from "./text";
import type { Contact } from "./types";
import { PrivacyPanel } from "./PrivacyPanel";

export function RoommateSettings() {
  const [revision, setRevision] = useState(0);
  return (
    <>
      {revision > 0 && (
        <p role="status">
          {rt(
            "Đã xóa hồ sơ và thông tin riêng Roommate.",
            "Your Roommate profile and private information were erased.",
          )}
        </p>
      )}
      <SettingsContent
        key={revision}
        erased={() => setRevision((value) => value + 1)}
      />
    </>
  );
}

function SettingsContent({ erased }: { erased: () => void }) {
  const [selected, setSelected] = useState<Contact | null>(null),
    [remove, setRemove] = useState<Contact | null>(null);
  const contacts = useResource<{ channels: Contact[] }>("/me/contacts");
  const blocks = useResource<{ items: { profile_id: string }[] }>("/me/blocks");
  const operation = useOperation();
  return (
    <div className="rm-detail-columns">
      <section className="rm-panel">
        <h2>{rt("Liên hệ và quyền riêng tư", "Contacts and privacy")}</h2>
        <p className="rm-hint">
          {rt(
            "Liên hệ được giữ riêng và chỉ chia sẻ khi hai bên đồng ý.",
            "Contacts stay private and are shared only with mutual consent.",
          )}
        </p>
        <ContactPicker selected={selected} select={setSelected} />
        <h3>{rt("Xóa kênh không còn dùng", "Remove a contact channel")}</h3>
        <ErrorNotice error={contacts.error} retry={contacts.reload} />
        <div className="rm-channel-list">
          {contacts.value?.channels
            .filter((c) => c.value)
            .map((c) => (
              <div key={c.channel_id}>
                <span>
                  {c.kind === "phone" ? rt("Điện thoại", "Phone") : "Zalo"}:{" "}
                  {c.value}
                </span>
                <button
                  className="text-button danger"
                  onClick={() => setRemove(c)}
                >
                  {rt("Xóa kênh", "Remove channel")}
                </button>
              </div>
            ))}
        </div>
        {remove && (
          <Dialog
            title={rt("Xóa kênh liên hệ?", "Remove contact channel?")}
            onClose={() => !operation.disabled && setRemove(null)}
          >
            <p>
              {rt(
                "Yêu cầu và quyền liên hệ dùng kênh này sẽ đóng.",
                "Requests and contact access using this channel will close.",
              )}
            </p>
            {operation.notice}
            <div className="rm-actions">
              <button
                className="secondary"
                disabled={operation.disabled}
                onClick={() => setRemove(null)}
              >
                {rt("Quay lại", "Back")}
              </button>
              <button
                className="primary danger"
                disabled={operation.disabled}
                onClick={() =>
                  operation.run(
                    "/me/contacts",
                    "PUT",
                    {
                      kind: remove.kind,
                      value: null,
                      expected_version: remove.version,
                    },
                    () => {
                      setRemove(null);
                      setSelected(null);
                      contacts.reload();
                    },
                  )
                }
              >
                {rt("Xóa kênh", "Remove channel")}
              </button>
            </div>
          </Dialog>
        )}
      </section>
      <section className="rm-panel">
        <h2>{rt("Người đã chặn", "Blocked users")}</h2>
        <p className="rm-hint">
          {rt(
            "Bỏ chặn không tự mở lại yêu cầu hoặc quyền liên hệ cũ.",
            "Unblocking does not restore old requests or contact access.",
          )}
        </p>
        <ErrorNotice error={blocks.error} retry={blocks.reload} />
        {!remove && operation.notice}
        {blocks.value?.items.length ? (
          <ul className="rm-settings-list">
            {blocks.value.items.map((item) => (
              <li key={item.profile_id}>
                <UserRound size={18} aria-hidden="true" />
                <span>
                  {rt("Tài khoản", "Account")} · {item.profile_id.slice(0, 8)}
                </span>
                <button
                  className="secondary"
                  disabled={operation.disabled}
                  onClick={() =>
                    operation.run(
                      "/blocks/" + encodeURIComponent(item.profile_id),
                      "PUT",
                      { selected: false },
                      () => blocks.reload(),
                    )
                  }
                >
                  {rt("Bỏ chặn", "Unblock")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          !blocks.loading &&
          !blocks.error && (
            <EmptyState
              icon={<LockKeyhole />}
              title={rt("Chưa chặn ai", "No blocked users")}
              text={rt(
                "Bạn có thể chặn từ trang hồ sơ hoặc yêu cầu kết nối.",
                "You can block someone from a profile or connection request.",
              )}
            />
          )
        )}
      </section>
      <PrivacyPanel onErased={erased} />
    </div>
  );
}
