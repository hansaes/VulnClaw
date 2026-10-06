export type ToastTone = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  copy?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastHostProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  if (!toasts.length) return null;

  return (
    <div className="vw-toast-host" aria-live="polite" aria-relevant="additions removals">
      {toasts.map((toast) => (
        <article key={toast.id} className={`vw-toast vw-toast-${toast.tone}`}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="tt">{toast.title}</div>
            {toast.copy && <div className="tc">{toast.copy}</div>}
            {toast.actionLabel && toast.onAction && (
              <button
                type="button"
                className="vw-toast-action"
                onClick={() => {
                  toast.onAction?.();
                  onDismiss(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
          <button type="button" className="vw-toast-close" aria-label="Close notification" onClick={() => onDismiss(toast.id)}>
            ✕
          </button>
        </article>
      ))}
    </div>
  );
}
