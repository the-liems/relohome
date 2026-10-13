import { useState } from "react";
import { ConfirmDialog } from "../components/Dialog";
import { useResource } from "./useResource";
import { roommate } from "./client";
import { ErrorNotice } from "./ErrorNotice";
import { rt } from "./text";

export function PrivacyPanel({ onErased }: { onErased?: () => void } = {}) {
  const own = useResource<{ version: number | null }>("/me/privacy");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [erase, setErase] = useState(false),
    [notice, setNotice] = useState("");
  return (
    <section className="rm-panel rm-avatar-editor">
      <h2>{rt("Thông tin Roommate của bạn", "Your Roommate data")}</h2>
      <p className="rm-hint">
        {rt(
          "Bạn có thể tải bản thông tin của mình hoặc xóa hồ sơ và nội dung riêng. Lịch sử quota, trạng thái hạn chế và nhật ký xử lý được giữ để vận hành an toàn; backup được xử lý theo chính sách lưu trữ.",
          "Download your own information or erase your profile and private content. Quota history, restrictions and moderation records remain for safe operation; backups follow the retention policy.",
        )}
      </p>
      <ErrorNotice error={error || own.error} retry={own.reload} />
      {notice && <p role="status">{notice}</p>}
      <div className="rm-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const value = await roommate("/me/privacy/export");
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(value, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "relohome-roommate-data.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {rt("Tải thông tin của tôi", "Download my data")}
        </button>
        <button
          className="secondary danger"
          disabled={busy || own.loading || Boolean(own.error)}
          onClick={() => setErase(true)}
        >
          {rt("Xóa thông tin Roommate", "Erase Roommate data")}
        </button>
      </div>
      {erase && (
        <ConfirmDialog
          title={rt("Xóa thông tin Roommate?", "Erase your Roommate data?")}
          action={rt("Xác nhận xóa thông tin", "Confirm erasure")}
          onClose={() => setErase(false)}
          onConfirm={async () => {
            await roommate("/me/privacy/erase", "POST", {
              confirmed: true,
              expected_version: own.value?.version ?? null,
            });
            setErase(false);
            own.reload();
            onErased?.();
            setNotice(
              rt(
                "Đã xóa hồ sơ và nội dung riêng, đồng thời thu hồi quyền liên hệ.",
                "Your profile and private content were erased and contact access was revoked.",
              ),
            );
          }}
        >
          <p>
            {rt(
              "Hồ sơ đăng tìm, ảnh, giới thiệu riêng, tiêu chí và danh sách đã lưu của bạn sẽ được xóa; quyền liên hệ đang mở được thu hồi. Tài khoản ReloHome vẫn sử dụng được các dịch vụ khác.",
              "Your discovery profile, photos, private introduction, criteria and bookmarks will be erased; open contact access will be revoked. Your ReloHome account can still use the other services.",
            )}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
