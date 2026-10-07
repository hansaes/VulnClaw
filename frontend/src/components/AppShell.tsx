import type { ReactNode } from "react";
import type { TaskRecord } from "../types/api";
import { useT } from "../i18n";
import { Sidebar, type NavItem } from "./Sidebar";
import { Topbar } from "./Topbar";

interface AppShellProps<T extends string> {
  activeView: T;
  nav: NavItem<T>[];
  crumb: string;
  backendUnavailable?: boolean;
  backendError?: string;
  onRetryBackend?: () => void;
  targetCount?: number;
  activeTask: TaskRecord | null;
  onSelectView: (view: T) => void;
  onOpenTaskDetail: () => void;
  onStopTask: () => void;
  children: ReactNode;
}

export function AppShell<T extends string>({
  activeView,
  nav,
  crumb,
  backendUnavailable = false,
  backendError,
  onRetryBackend,
  targetCount,
  activeTask,
  onSelectView,
  onOpenTaskDetail,
  onStopTask,
  children,
}: AppShellProps<T>) {
  const { t } = useT();
  const taskRunning = activeTask?.status === "running" || activeTask?.status === "pending";

  return (
    <div className="vw-app">
      <Sidebar activeView={activeView} nav={nav} onSelectView={onSelectView} />
      <div className="vw-main">
        <Topbar
          crumb={crumb}
          taskRunning={taskRunning}
          taskStatus={activeTask?.status}
          targetCount={targetCount}
        />
        {backendUnavailable && (
          <div style={{ padding: "16px 28px 0" }}>
            <section className="vw-conn-banner" role="status" style={{ margin: 0 }}>
              <div>
                <strong>{t("shell.backend_unavailable")}</strong>
                <span>{t("shell.backend_hint")}{backendError ? ` · ${backendError}` : ""}</span>
              </div>
              {onRetryBackend && (
                <button className="vw-btn vw-btn-ghost vw-btn-sm" onClick={onRetryBackend} type="button">
                  {t("shell.retry")}
                </button>
              )}
            </section>
          </div>
        )}
        {taskRunning && activeTask && (
          <div style={{ padding: "16px 28px 0" }}>
            <div className="vw-task-banner" style={{ margin: 0 }}>
              <span className="vw-badge vw-b-run"><span className="dot" />{t("shell.task_running")}</span>
              <div className="grow">
                <div className="tt vw-mono">{activeTask.target}</div>
                <div className="ts">{activeTask.task_id}</div>
              </div>
              <button type="button" className="vw-btn vw-btn-ghost vw-btn-xs" onClick={onOpenTaskDetail}>
                {t("shell.view_task")}
              </button>
              <button type="button" className="vw-btn vw-btn-danger vw-btn-xs" onClick={onStopTask}>
                {t("shell.stop")}
              </button>
            </div>
          </div>
        )}
        <div className="vw-content">{children}</div>
      </div>
    </div>
  );
}
