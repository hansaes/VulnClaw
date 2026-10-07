import { useMemo, useState } from "react";
import { useTasksQuery } from "../hooks/queries";
import { useT } from "../i18n";
import type { TaskRecord } from "../types/api";
import { formatTaskCommand, formatTaskStatus } from "../utils/taskLabels";

interface HistoryPageProps {
  onOpenTask: (task: TaskRecord) => void;
  onNewTask: () => void;
}

type StatusFilter = "all" | "run" | "queue" | "done" | "fail";

function stageIndex(task: TaskRecord): number {
  if (task.status === "completed") return 4;
  if (task.status === "failed" || task.status === "stopped") return 2;
  const text = `${task.latest_phase ?? ""}`.toLowerCase();
  if (text.includes("report")) return 3;
  if (text.includes("exploit") || text.includes("verify")) return 2;
  if (text.includes("scan")) return 1;
  return 0;
}

function statusBadge(status: TaskRecord["status"]): string {
  if (status === "running" || status === "restoring") return "vw-b-run";
  if (status === "pending") return "vw-b-queue";
  if (status === "completed") return "vw-b-done";
  if (status === "failed") return "vw-b-fail";
  return "vw-b-pause";
}

function isRunningLike(s: TaskRecord["status"]): boolean {
  return s === "running" || s === "restoring";
}

function formatElapsed(task: TaskRecord, t: (k: string) => string): string {
  const start = task.started_at ?? task.created_at;
  const end = task.completed_at ?? (isRunningLike(task.status) || task.status === "pending" ? new Date().toISOString() : undefined);
  if (!start || !end) return "—";
  const ms = +new Date(end) - +new Date(start);
  if (Number.isNaN(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60000);
  if (m < 60) return t("task.minutes").replace("{count}", String(m));
  const h = Math.floor(m / 60);
  return t("task.hours_minutes").replace("{h}", String(h)).replace("{m}", String(m % 60));
}

function MiniPipeline({ task }: { task: TaskRecord }) {
  const idx = stageIndex(task);
  const interrupted = task.status === "failed" || task.status === "stopped";
  return (
    <div className="vw-mp" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className={i < idx ? "done" : i === idx && !interrupted && idx < 4 ? "act" : ""} />
      ))}
      <span>
        {task.status === "completed" ? "100%" : interrupted ? "—" : `${Math.round((idx / 4) * 100)}%`}
      </span>
    </div>
  );
}

export function HistoryPage({ onOpenTask, onNewTask }: HistoryPageProps) {
  const { t } = useT();
  const tasksQuery = useTasksQuery();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const tasks = useMemo(() => {
    const all = [...(tasksQuery.data ?? [])].sort(
      (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
    );
    return all.filter((x) => {
      if (filter === "run" && !isRunningLike(x.status)) return false;
      if (filter === "queue" && x.status !== "pending") return false;
      if (filter === "done" && x.status !== "completed") return false;
      if (filter === "fail" && x.status !== "failed") return false;
      if (query) {
        const q = query.toLowerCase();
        if (!`${x.target} ${x.task_id} ${formatTaskCommand(x.command)}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tasksQuery.data, filter, query]);

  const counts = useMemo(() => {
    const all = tasksQuery.data ?? [];
    return {
      all: all.length,
      run: all.filter((x) => isRunningLike(x.status)).length,
      queue: all.filter((x) => x.status === "pending").length,
      done: all.filter((x) => x.status === "completed").length,
      fail: all.filter((x) => x.status === "failed").length,
    };
  }, [tasksQuery.data]);

  const chips: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: t("task.filter_all"), count: counts.all },
    { key: "run", label: t("task.filter_running"), count: counts.run },
    { key: "queue", label: t("task.filter_queued"), count: counts.queue },
    { key: "done", label: t("task.filter_done"), count: counts.done },
    { key: "fail", label: t("task.filter_failed"), count: counts.fail },
  ];

  return (
    <div>
      <div className="vw-page-head">
        <div>
          <h1>{t("task.title")}</h1>
          <p>{t("task.subtitle")}</p>
        </div>
        <button className="vw-btn vw-btn-primary" type="button" onClick={onNewTask}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14" /></svg>
          {t("task.new_task")}
        </button>
      </div>

      <div className="vw-toolbar">
        <input
          className="vw-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("task.search_ph")}
        />
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`vw-chip ${filter === c.key ? "on" : ""}`}
            onClick={() => setFilter(c.key)}
          >
            {c.label}<b>{c.count}</b>
          </button>
        ))}
      </div>

      {tasksQuery.isError && <div className="vw-err">{t("task.load_failed")}</div>}

      <div className="vw-tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("task.col_task")}</th>
              <th>{t("task.col_strategy")}</th>
              <th>{t("task.col_progress")}</th>
              <th>{t("task.col_findings")}</th>
              <th>{t("task.col_status")}</th>
              <th>{t("task.col_elapsed")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((x) => {
              const findings = x.summary
                ? Math.max(
                    x.summary.findings_count ?? 0,
                    (x.summary.verified_count ?? 0)
                      + (x.summary.pending_count ?? 0)
                      + (x.summary.candidate_count ?? 0)
                      + (x.summary.quarantined_count ?? 0),
                  )
                : null;
              return (
                <tr key={x.task_id} className="vw-row" onClick={() => onOpenTask(x)}>
                  <td>
                    <div className="vw-t-title">{x.target} · {formatTaskCommand(x.command)}</div>
                    <div className="vw-t-sub">{x.task_id.slice(0, 8)}</div>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{formatTaskCommand(x.command)}</td>
                  <td><MiniPipeline task={x} /></td>
                  <td>{findings === null ? <span style={{ color: "var(--faint)" }}>—</span> : <span className="vw-badge vw-b-fail">{findings}</span>}</td>
                  <td>
                    <span className={`vw-badge ${statusBadge(x.status)}`}>
                      {isRunningLike(x.status) && <span className="dot" />}
                      {formatTaskStatus(x.status)}
                    </span>
                  </td>
                  <td className="vw-mono" style={{ color: "var(--muted)" }}>{formatElapsed(x, t)}</td>
                  <td><button className="vw-btn vw-btn-ghost vw-btn-xs" type="button">{t("task.view")}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!tasksQuery.isLoading && tasks.length === 0 && (
          <div className="vw-empty">
            {t("task.empty")}
            <div style={{ marginTop: 12 }}>
              <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" onClick={onNewTask}>{t("task.new_task")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
