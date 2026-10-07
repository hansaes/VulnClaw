import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "./components/AppShell";
import type { NavItem } from "./components/Sidebar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ToastHost, type ToastItem, type ToastTone } from "./components/ToastHost";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { MemoryPage } from "./pages/MemoryPage";
import { ChatPage } from "./pages/ChatPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { ReportsPage } from "./pages/ReportsPage";
import { RiskResultsPage } from "./pages/RiskResultsPage";
import { SafetyBoundaryPage } from "./pages/SafetyBoundaryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TaskConsolePage } from "./pages/TaskConsolePage";
import {
  createTask,
  openTaskStream,
  stopTask,
  getAuthStatus,
  logout,
  getTask,
} from "./api/web";
import { useConfigQuery, useTargetsQuery, useTasksQuery } from "./hooks/queries";
import { useT } from "./i18n";
import type { TaskCommand, TaskEvent, TaskOptions, TaskRecord, TaskSummary } from "./types/api";
import { formatTaskTitle } from "./utils/taskLabels";

type AppView = "dashboard" | "home" | "risk" | "memory" | "chat" | "reports" | "boundary" | "history" | "settings" | "advanced";
type SettingsSection = "basic" | "ai" | "checks" | "boundary" | "data" | "python" | "diagnostics";

interface ReportFocus {
  target: string | null;
  path?: string;
  openPreview?: boolean;
}

const HASH_TO_VIEW: Record<string, AppView> = {
  dashboard: "dashboard",
  home: "home",
  risk: "risk",
  memory: "memory",
  chat: "chat",
  reports: "reports",
  boundary: "boundary",
  history: "history",
  settings: "settings",
  advanced: "advanced",
};

function viewFromHash(): AppView {
  const key = window.location.hash.replace(/^#/, "");
  return HASH_TO_VIEW[key] ?? "dashboard";
}

export function App() {
  const configQuery = useConfigQuery();
  const tasksQuery = useTasksQuery();
  const targetsQuery = useTargetsQuery();
  const queryClient = useQueryClient();
  const { t } = useT();
  const [activeView, setActiveView] = useState<AppView>(() => viewFromHash());
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<TaskRecord | null>(null);
  const [reportFocus, setReportFocus] = useState<ReportFocus | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("basic");
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginRequired, setLoginRequired] = useState(false);
  const [passwordAuthEnabled, setPasswordAuthEnabled] = useState(false);

  const runningCount = useMemo(
    () => (tasksQuery.data ?? []).filter((x) => x.status === "running" || x.status === "pending").length,
    [tasksQuery.data],
  );
  const pendingVulns = useMemo(
    () => (targetsQuery.data ?? []).reduce((n, x) => n + (x.pending_count ?? 0) + (x.candidate_count ?? 0), 0),
    [targetsQuery.data],
  );

  const nav = useMemo<NavItem<AppView>[]>(
    () => [
      { key: "dashboard", label: t("nav.dashboard"), description: t("nav.dashboard_desc"), icon: "dashboard" },
      { key: "home", label: t("nav.scan"), description: t("nav.scan_desc"), icon: "plus" },
      { key: "history", label: t("nav.tasks"), description: t("nav.tasks_desc"), icon: "tasks", badge: runningCount },
      { key: "risk", label: t("nav.findings"), description: t("nav.findings_desc"), icon: "shield", badge: pendingVulns },
      { key: "memory", label: t("nav.memory"), description: t("nav.memory_desc"), icon: "memory" },
      { key: "chat", label: t("nav.chat"), description: t("nav.chat_desc"), icon: "chat" },
      { key: "reports", label: t("nav.reports"), description: t("nav.reports_desc"), icon: "reports" },
      { key: "boundary", label: t("nav.scope"), description: t("nav.scope_desc"), icon: "scope" },
      { key: "settings", label: t("nav.settings"), description: t("nav.settings_desc"), icon: "settings" },
    ],
    [t, runningCount, pendingVulns],
  );

  const crumb = useMemo(
    () => nav.find((n) => n.key === activeView)?.label ?? t("nav.dashboard"),
    [nav, activeView, t],
  );

  const latestEvent = taskEvents.length > 0 ? taskEvents[taskEvents.length - 1] : null;

  useEffect(() => {
    let cancelled = false;
    getAuthStatus()
      .then((st) => {
        if (!cancelled) { setPasswordAuthEnabled(st.password_auth_enabled); setLoginRequired(st.password_auth_enabled && !st.authenticated); }
      })
      .catch(() => { /* backend unreachable — AppShell shows the error */ })
      .finally(() => { if (!cancelled) setAuthChecked(true); });
    return () => { cancelled = true; };
  }, []);

  async function handleLogout() {
    try { await logout(); } catch { /* ignore */ }
    setLoginRequired(true);
  }

  useEffect(() => {
    const handleHashChange = () => setActiveView(viewFromHash());
    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function navigateToView(view: AppView) {
    if (window.location.hash !== `#${view}`) {
      window.location.hash = view;
    }
    setActiveView(view);
  }

  function eventSummary(event: TaskEvent): TaskSummary | null {
    const summary = event.payload.summary;
    return summary && typeof summary === "object" ? (summary as TaskSummary) : null;
  }

  function pushToast(
    tone: ToastTone,
    title: string,
    copy?: string,
    action?: Pick<ToastItem, "actionLabel" | "onAction">,
  ) {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, tone, title, copy, ...action }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4800);
  }

  function refreshTaskData(target: string | null | undefined) {
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["targets"] });
    void queryClient.invalidateQueries({ queryKey: ["constraint-audit"] });
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
    if (target) {
      void queryClient.invalidateQueries({ queryKey: ["target", target] });
      void queryClient.invalidateQueries({ queryKey: ["target-preview", target] });
      void queryClient.invalidateQueries({ queryKey: ["target-snapshots", target] });
    }
  }

  useEffect(() => {
    if (!activeTask) return;
    // A stream is opened even for an already-finished task so the console can show
    // its recorded events. The server replays that history and then closes the
    // connection, and the browser's EventSource reconnects on close - which would
    // replay the terminal event and re-announce it forever. So: only announce a
    // terminal event when this page actually saw the task running, and close the
    // stream as soon as one arrives.
    const wasFinished = ["completed", "failed", "stopped"].includes(activeTask.status);
    let source: EventSource | null = null;
    const closeStream = () => source?.close();
    source = openTaskStream(activeTask.task_id, (event) => {
      setTaskEvents((prev) => [...prev.slice(-79), event]);
      if (event.event === "task_completed") {
        const summary = eventSummary(event);
        setActiveTask((prev) =>
          prev && prev.task_id === event.task_id
            ? { ...prev, status: "completed", summary: summary ?? prev.summary }
            : prev,
        );
        refreshTaskData(summary?.target ?? activeTask.target);
        if (!wasFinished) {
          pushToast(
            "success",
            t("toast.task_finished"),
            t("toast.task_finished_copy"),
            {
              actionLabel: t("toast.open_results"),
              onAction: () => {
                setSelectedTarget(summary?.target ?? activeTask.target);
                navigateToView("risk");
              },
            },
          );
        }
        closeStream();
      }
      if (event.event === "task_failed") {
        setActiveTask((prev) => (prev && prev.task_id === event.task_id ? { ...prev, status: "failed" } : prev));
        refreshTaskData(activeTask.target);
        if (!wasFinished) {
          pushToast("error", t("toast.task_failed"), String(event.payload.message ?? event.payload.error ?? t("toast.task_failed_copy")), {
            actionLabel: t("toast.open_console"),
            onAction: () => navigateToView("advanced"),
          });
        }
        closeStream();
      }
      if (event.event === "task_stopped") {
        setActiveTask((prev) => (prev && prev.task_id === event.task_id ? { ...prev, status: "stopped" } : prev));
        refreshTaskData(activeTask.target);
        if (!wasFinished) {
          pushToast("info", t("toast.task_stopped"), t("toast.task_stopped_copy"));
        }
        closeStream();
      }
    });
    return () => source?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTask?.task_id]);

  async function handleCreateTask(command: TaskCommand, target: string, resume: boolean, options: TaskOptions): Promise<TaskRecord> {
    const task = await createTask(command, target, resume, options);
    setActiveTask(task);
    setSelectedTarget(task.target);
    setTaskEvents([]);
    pushToast("success", t("toast.task_started"), formatTaskTitle(task.command, task.target));
    return task;
  }

  async function handleStopTask() {
    if (!activeTask) return;
    await stopTask(activeTask.task_id);
    setActiveTask((prev) => (prev ? { ...prev, status: "stopped" } : prev));
    refreshTaskData(activeTask.target);
    pushToast("info", t("toast.stop_sent"), t("toast.stop_sent_copy"));
  }

  function openBoundaryForActiveTask() {
    if (activeTask?.target) {
      setSelectedTarget(activeTask.target);
    }
    navigateToView("boundary");
  }

  function openReports(target: string | null = selectedTarget, path?: string, openPreview = false) {
    if (target) {
      setSelectedTarget(target);
    }
    setReportFocus({ target, path, openPreview });
    navigateToView("reports");
  }

  function openSettings(section: SettingsSection = "basic") {
    setSettingsSection(section);
    navigateToView("settings");
  }

  function handleSelectView(view: AppView) {
    if (view === "settings") {
      setSettingsSection("basic");
    }
    navigateToView(view);
  }

  function openTaskDetail(task: TaskRecord) {
    setActiveTask(task);
    setSelectedTarget(task.target);
    setTaskEvents([]);
    navigateToView("advanced");
  }

  async function openTaskById(taskId: string) {
    try {
      const task = await getTask(taskId);
      openTaskDetail(task);
    } catch {
      navigateToView("history");
    }
  }

  if (!authChecked) {
    return (
      <div className="vw-login-wrap">
        <p style={{ color: "var(--muted)" }}>{t("auth.checking")}</p>
      </div>
    );
  }

  if (loginRequired) {
    return <LoginPage onLoggedIn={() => setLoginRequired(false)} />;
  }

  return (
    <AppShell
      activeView={activeView}
      nav={nav}
      crumb={crumb}
      backendUnavailable={configQuery.isError}
      backendError={configQuery.error instanceof Error ? configQuery.error.message : undefined}
      onRetryBackend={() => void configQuery.refetch()}
      targetCount={targetsQuery.data?.length}
      activeTask={activeTask}
      onSelectView={handleSelectView}
      onOpenTaskDetail={() => navigateToView("advanced")}
      onStopTask={() => setStopConfirmOpen(true)}
      onLogout={passwordAuthEnabled ? handleLogout : undefined}
    >
      {activeView === "dashboard" && (
        <DashboardPage
          onNewTask={() => navigateToView("home")}
          onOpenTasks={() => navigateToView("history")}
          onOpenVulns={(target) => {
            setSelectedTarget(target);
            navigateToView("risk");
          }}
          onOpenReports={() => openReports()}
        />
      )}

      {activeView === "home" && (
        <HomePage
          initialTarget={selectedTarget}
          onCreateTask={handleCreateTask}
          onDone={() => navigateToView("history")}
        />
      )}

      {activeView === "history" && (
        <HistoryPage
          onOpenTask={openTaskDetail}
          onNewTask={() => navigateToView("home")}
        />
      )}

      {activeView === "advanced" && (
        <TaskConsolePage
          activeTask={activeTask}
          events={taskEvents}
          tasks={tasksQuery.data ?? []}
          onSelectTask={openTaskDetail}
          onNewTask={() => navigateToView("home")}
          onOpenVulns={(target) => {
            setSelectedTarget(target);
            navigateToView("risk");
          }}
          onBack={() => navigateToView("history")}
        />
      )}

      {activeView === "risk" && (
        <RiskResultsPage
          selectedTarget={selectedTarget}
          onSelectTarget={setSelectedTarget}
          onOpenHome={() => navigateToView("home")}
          onOpenReports={(path) => openReports(selectedTarget, path, Boolean(path))}
          onCreateTask={handleCreateTask}
          onVerifyDone={(task) => openTaskDetail(task)}
          onBulkVerifyDone={() => navigateToView("history")}
        />
      )}

      {activeView === "reports" && <ReportsPage selectedTarget={selectedTarget} focus={reportFocus} />}
      {activeView === "memory" && <MemoryPage />}
      {activeView === "chat" && <ChatPage onOpenTaskDetail={(id) => void openTaskById(id)} />}

      {activeView === "boundary" && (
        <SafetyBoundaryPage
          selectedTarget={selectedTarget}
          activeTask={activeTask}
          onOpenHome={() => navigateToView("home")}
          onOpenSettings={() => openSettings("boundary")}
          onSelectTarget={setSelectedTarget}
        />
      )}

      {activeView === "settings" && <SettingsPage initialSection={settingsSection} onOpenAdvanced={() => navigateToView("advanced")} />}

      <ConfirmDialog
        open={stopConfirmOpen}
        title={t("confirm.stop_scan_title")}
        copy={t("confirm.stop_scan_copy")}
        tone="danger"
        confirmLabel={t("confirm.stop_task_label")}
        onCancel={() => setStopConfirmOpen(false)}
        onConfirm={() => {
          setStopConfirmOpen(false);
          void handleStopTask();
        }}
      />
      <ToastHost toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((toast) => toast.id !== id))} />
    </AppShell>
  );
}
