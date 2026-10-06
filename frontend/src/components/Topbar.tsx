import { useT } from "../i18n";
import { formatTaskStatus } from "../utils/taskLabels";

interface TopbarProps {
  crumb: string;
  taskRunning: boolean;
  taskStatus?: string | null;
  targetCount?: number;
}

export function Topbar({ crumb, taskRunning, taskStatus, targetCount }: TopbarProps) {
  const { t } = useT();

  return (
    <header className="vw-topbar">
      <button
        type="button"
        className="vw-icon-btn vw-hamb"
        aria-label={t("shell.menu")}
        onClick={() => document.getElementById("vw-sidebar")?.classList.toggle("open")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M3 12h18M3 18h18" /></svg>
      </button>
      <div className="vw-crumb">VulnClaw / <b>{crumb}</b></div>
      <div className="vw-topbar-right">
        {typeof targetCount === "number" && (
          <span className="vw-badge vw-b-done">{t("topbar.targets", { count: String(targetCount) })}</span>
        )}
        <span className={`vw-badge ${taskRunning ? "vw-b-run" : "vw-b-done"}`}>
          {taskRunning && <span className="dot" />}
          {taskStatus ? formatTaskStatus(taskStatus) : t("topbar.idle")}
        </span>
      </div>
    </header>
  );
}
