import { t as uiText } from "../uiPreferences";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = ref.current!;
    const active = document.activeElement as HTMLElement;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = "";
      active?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"dialog " + (wide ? "dialog-wide" : "")}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close.current();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={uiText("Đóng")}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

// Destructive confirmation: keeps the dialog open with the server's reason when the action fails.
export function ConfirmDialog({
  title,
  children,
  action,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  action: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog title={title} onClose={() => !busy && onClose()}>
      <div className="confirm-body">{children}</div>
      {error && (
        <p className="notice error" role="alert">
          {uiText(error)}
        </p>
      )}
      <div className="form-actions">
        <button className="secondary" disabled={busy} onClick={onClose}>
          {uiText("Hủy")}
        </button>
        <button
          className="primary danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <span className="spinner small" />} {action}
        </button>
      </div>
    </Dialog>
  );
}
