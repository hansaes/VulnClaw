import { useEffect, useRef } from "react";
import { useT } from "../i18n";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  copy: string;
  tone?: "primary" | "danger";
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, copy, tone = "primary", confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const { t } = useT();

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  useEffect(() => {
    if (open) cancelButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="vw-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="vw-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-copy" onMouseDown={(event) => event.stopPropagation()}>
        <span className="vw-kicker">{t("dialog.confirmation_required")}</span>
        <h3 id="confirm-title">{title}</h3>
        <p id="confirm-copy">{copy}</p>
        <div className="vw-btn-row">
          <button ref={cancelButtonRef} type="button" className="vw-btn vw-btn-ghost vw-btn-sm" onClick={onCancel}>
            {t("dialog.cancel")}
          </button>
          <button type="button" className={`vw-btn vw-btn-sm ${tone === "danger" ? "vw-btn-danger" : "vw-btn-primary"}`} onClick={onConfirm}>
            {confirmLabel ?? t("dialog.confirm")}
          </button>
        </div>
      </section>
    </div>
  );
}
