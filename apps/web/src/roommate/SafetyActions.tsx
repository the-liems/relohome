import { RequiredMark } from "../components/RequiredMark";
import { useState } from "react";
import { Dialog } from "../components/Dialog";
import { useOperation } from "./useOperation";
import { rt } from "./text";
export function SafetyActions({
  id,
  hidden,
}: {
  id: string;
  hidden: () => void;
}) {
  const [mode, setMode] = useState<"block" | "report" | null>(null),
    [reason, setReason] = useState(""),
    [reported, setReported] = useState(false);
  const operation = useOperation();
  return (
    <>
      <div className="rm-actions">
        <button className="text-button" onClick={() => setMode("block")}>
          {rt("Chặn hồ sơ", "Block profile")}
        </button>
        <button className="text-button" onClick={() => setMode("report")}>
          {rt("Báo cáo", "Report")}
        </button>
      </div>
      {reported && (
        <p role="status">
          {rt(
            "Đã gửi báo cáo để kiểm tra. Người này chưa bị chặn.",
            "Your report was submitted for review. This person has not been blocked.",
          )}
        </p>
      )}
      {mode && (
        <Dialog
          title={
            mode === "block"
              ? rt("Chặn người này?", "Block this person?")
              : rt("Báo cáo hồ sơ", "Report profile")
          }
          onClose={() => !operation.disabled && setMode(null)}
        >
          <div className="rm-dialog-content">
            <p>
              {mode === "block"
                ? rt(
                    "Hai bên không còn thấy hồ sơ của nhau. Yêu cầu đang chờ, chat và quyền xem liên hệ sẽ đóng. Bỏ chặn không tự khôi phục kết nối.",
                    "Both profiles become hidden from each other. Pending requests, chat and contact access close. Unblocking does not restore the connection.",
                  )
                : rt(
                    "Báo cáo được gửi riêng để kiểm tra; không tự chặn người này.",
                    "Reports are privately reviewed; reporting does not automatically block the person.",
                  )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                operation.run(
                  mode === "block"
                    ? "/blocks/" + encodeURIComponent(id)
                    : "/reports",
                  mode === "block" ? "PUT" : "POST",
                  mode === "block"
                    ? { selected: true }
                    : { profile_id: id, reason },
                  () => {
                    setMode(null);
                    if (mode === "block") hidden();
                    else setReported(true);
                  },
                );
              }}
            >
              {mode === "report" && (
                <label>
                  <span className="field-label">{rt("Lý do báo cáo", "Report reason")}<RequiredMark /></span>
                  <textarea
                    required
                    maxLength={1000}
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
              {operation.notice}
              <button className="primary" disabled={operation.disabled}>
                {operation.busy
                  ? rt("Đang xử lý…", "Processing…")
                  : mode === "block"
                    ? rt("Xác nhận chặn", "Confirm block")
                    : rt("Gửi báo cáo", "Submit report")}
              </button>
            </form>
          </div>
        </Dialog>
      )}
    </>
  );
}
