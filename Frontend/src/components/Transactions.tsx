import { t as uiText } from "../uiPreferences";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Data } from "../types";
import { dateTime, money, safeUrl } from "../api";
import { Dialog } from "./Dialog";

export function Receipts({ receipts }: { receipts: Data[] }) {
  return (
    <div>
      {receipts.map((r) => {
        const link = safeUrl(
          r.details?.shared_link ||
            r.details?.tracking_url ||
            r.details?.tracking_link,
        );
        return (
          <section className="receipt" key={r.action_id || r.receipt_id}>
            <div>
              <strong>
                {r.kind === "cancel_order"
                  ? uiText("Kết quả hủy đơn")
                  : r.kind === "update_order"
                    ? uiText("Kết quả cập nhật đơn")
                    : uiText("Biên nhận dịch vụ")}
              </strong>
              <p>
                {r.provider} · {r.receipt_id} · {r.status}
              </p>
              <p>
                {money(r.amount_vnd)}{" "}
                {r.source_kind === "sandbox"
                  ? uiText("· Môi trường sandbox")
                  : ""}
              </p>
              {link && (
                <a
                  className="text-button"
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                >
                  {uiText("Theo dõi đơn ")}
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function PendingPayment({
  pending,
  threadId,
  busy,
  onCheck,
}: {
  pending: Data;
  threadId: string;
  busy: boolean;
  onCheck: () => Promise<void>;
}) {
  const [now, setNow] = useState(Date.now()),
    [error, setError] = useState(""),
    [qr, setQr] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);
  const expired =
    !Number.isFinite(Date.parse(pending.expires_at)) ||
    Date.parse(pending.expires_at) <= now;
  const link = safeUrl(pending.pay_url);
  return (
    <section className="approval-card">
      <h3>{uiText("Thanh toán đang chờ xác minh")}</h3>
      <p className="price">
        {money(pending.amount_vnd)}{" "}
        {pending.source_kind === "sandbox" ? "· Sandbox" : ""}
      </p>
      <p>
        {uiText("Hạn thanh toán: ")}
        {dateTime(pending.expires_at)}
      </p>
      {expired ? (
        <p className="notice amber">
          {uiText(
            "Link đã hết hạn. Kiểm tra trạng thái để đối chiếu kết quả với nhà cung cấp.",
          )}
        </p>
      ) : (
        <div className="form-actions">
          {link && (
            <a className="primary" href={link} target="_blank" rel="noreferrer">
              {uiText("Mở trang thanh toán ")}
              <ExternalLink size={15} />
            </a>
          )}
          {pending.qr_code && (
            <button className="secondary" onClick={() => setQr(true)}>
              {uiText("Mở mã QR")}
            </button>
          )}
        </div>
      )}
      <p className="muted">
        {uiText(
          "Chỉ xác nhận đã thanh toán sau khi kiểm tra với nhà cung cấp.",
        )}
      </p>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          setError("");
          onCheck().catch((e) => setError(e.message));
        }}
      >
        {uiText("Kiểm tra thanh toán")}
      </button>
      {error && (
        <p className="notice error" role="alert">
          {uiText(error)}
        </p>
      )}
      {qr && (
        <Dialog
          title={uiText("Quét mã thanh toán")}
          onClose={() => setQr(false)}
        >
          <img
            className="qr-image"
            src={`/web/api/threads/${encodeURIComponent(threadId)}/payment/qr.svg`}
            alt={uiText("Mã QR thanh toán từ nhà cung cấp")}
          />
          <p>
            {money(pending.amount_vnd)} · {dateTime(pending.expires_at)}
          </p>
        </Dialog>
      )}
    </section>
  );
}
