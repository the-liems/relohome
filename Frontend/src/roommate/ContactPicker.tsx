import { useState } from "react";
import { useResource } from "./useResource";
import { useOperation } from "./useOperation";
import type { Contact } from "./types";
import { ErrorNotice } from "./ErrorNotice";
import { rt } from "./text";
export function ContactPicker({
  selected,
  select,
}: {
  selected: Contact | null;
  select: (contact: Contact | null) => void;
}) {
  const channels = useResource<{ channels: Contact[] }>("/me/contacts");
  const operation = useOperation();
  const [kind, setKind] = useState<"phone" | "zalo">("phone"),
    [value, setValue] = useState("");
  const existing = channels.value?.channels.find((c) => c.kind === kind);
  return (
    <fieldset className="rm-contact-picker">
      <legend>{rt("Kênh liên hệ của bạn", "Your contact channel")}</legend>
      <p className="rm-hint">
        {rt(
          "Chỉ chia sẻ kênh đã chọn sau khi cả hai đồng ý. Đây là thông tin tự cung cấp, chưa xác minh.",
          "Only the selected channel is shared after both parties agree. This is self-provided, unverified information.",
        )}
      </p>
      <ErrorNotice error={channels.error} retry={channels.reload} />
      {channels.loading && (
        <p role="status">
          {rt("Đang tải kênh liên hệ…", "Loading contact channels…")}
        </p>
      )}
      {channels.value?.channels
        .filter((c) => c.value)
        .map((c) => (
          <label className="rm-check" key={c.channel_id}>
            <input
              type="radio"
              name="roommate-contact"
              checked={
                selected?.channel_id === c.channel_id &&
                selected.version === c.version
              }
              onChange={() => select(c)}
            />
            {c.kind === "phone" ? rt("Điện thoại", "Phone") : "Zalo"}: {c.value}
          </label>
        ))}
      <details className="rm-disclosure">
        <summary>
          {rt("Thêm / cập nhật liên hệ", "Add / update a contact")}
        </summary>
        <div className="rm-fields">
          <label>
            {rt("Loại kênh", "Channel type")}
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as "phone" | "zalo");
                setValue("");
              }}
            >
              <option value="phone">{rt("Điện thoại", "Phone")}</option>
              <option value="zalo">Zalo</option>
            </select>
          </label>
          <label>
            {rt("Liên hệ riêng tư", "Private contact")}
            <input
              type="text"
              maxLength={128}
              value={value}
              autoComplete="off"
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === "phone" ? "09xxxxxxxx" : "zalo.me/…"}
            />
          </label>
        </div>
        <p className="rm-hint">
          {rt(
            "Đổi kênh sẽ đóng yêu cầu/quyền đang dùng phiên bản cũ của kênh đó.",
            "Updating a channel closes requests and access using its previous version.",
          )}
        </p>
        {operation.notice}
        <button
          type="button"
          className="secondary"
          disabled={operation.disabled || !value.trim() || channels.loading}
          onClick={() =>
            operation.run(
              "/me/contacts",
              "PUT",
              {
                kind,
                value: value.trim(),
                expected_version: existing?.version ?? null,
              },
              () => {
                select(null);
                setValue("");
                channels.reload();
              },
            )
          }
        >
          {operation.busy
            ? rt("Đang lưu…", "Saving…")
            : rt("Lưu liên hệ", "Save contact")}
        </button>
      </details>
    </fieldset>
  );
}
