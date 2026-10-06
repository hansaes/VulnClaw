import { useMemo } from "react";
import { useReportsQuery, useTargetsQuery, useTasksQuery } from "../hooks/queries";
import { useT } from "../i18n";
import type { TaskRecord } from "../types/api";
import { formatTaskStatus } from "../utils/taskLabels";

interface DashboardPageProps {
  onNewTask: () => void;
  onOpenTasks: () => void;
  onOpenVulns: (target: string | null) => void;
  onOpenReports: () => void;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function StatCard({ label, value, sub, icon, tint }: { label: string; value: string | number; sub: React.ReactNode; icon: React.ReactNode; tint: string }) {
  return (
    <div className="vw-card vw-stat">
      <div className="lb">{label}</div>
      <div className="vl">{value}</div>
      <div className="dl">{sub}</div>
      <div className="ic" style={{ background: tint }}>
        {icon}
      </div>
    </div>
  );
}

const ICONS = {
  task: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "var(--green)" }}><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></svg>),
  shield: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "var(--red)" }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>),
  alert: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "var(--orange)" }}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>),
  box: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "var(--blue)" }}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /></svg>),
  check: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "var(--green)" }}><path d="M20 6L9 17l-5-5" /></svg>),
};

function statusColor(status: TaskRecord["status"]): string {
  if (status === "running" || status === "pending" || status === "restoring") return "#34d399";
  if (status === "completed") return "#60a5fa";
  if (status === "failed") return "#f87171";
  return "#94a3b8";
}

export function DashboardPage({ onNewTask, onOpenTasks, onOpenVulns, onOpenReports }: DashboardPageProps) {
  const { t } = useT();
  const tasksQuery = useTasksQuery();
  const targetsQuery = useTargetsQuery();
  const reportsQuery = useReportsQuery();

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const targets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data]);

  const running = tasks.filter((x) => x.status === "running" || x.status === "pending" || x.status === "restoring");
  const done = tasks.filter((x) => x.status === "completed");
  const pendingFindings = targets.reduce((n, x) => n + (x.pending_count ?? 0) + (x.candidate_count ?? 0), 0);
  const verifiedFindings = targets.reduce((n, x) => n + (x.verified_count ?? 0), 0);

  const trend = useMemo(() => {
    const days: { label: string; count: number; title: string }[] = [];
    const today = startOfDay(new Date());
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const count = tasks.filter((x) => {
        const c = new Date(x.created_at).getTime();
        return !Number.isNaN(c) && c >= d.getTime() && c < next.getTime();
      }).length;
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      days.push({ label, count, title: `${label} · ${t("dash.tasks_created", { count: String(count) })}` });
    }
    return days;
  }, [tasks, t]);

  const maxTrend = Math.max(1, ...trend.map((d) => d.count));

  const statusDist = useMemo(() => {
    const groups: { key: string; label: string; count: number; color: string }[] = [
      { key: "running", label: t("dash.st_running"), count: 0, color: "#34d399" },
      { key: "completed", label: t("dash.st_completed"), count: 0, color: "#60a5fa" },
      { key: "failed", label: t("dash.st_failed"), count: 0, color: "#f87171" },
      { key: "other", label: t("dash.st_other"), count: 0, color: "#94a3b8" },
    ];
    for (const x of tasks) {
      if (x.status === "running" || x.status === "pending" || x.status === "restoring") groups[0].count++;
      else if (x.status === "completed") groups[1].count++;
      else if (x.status === "failed") groups[2].count++;
      else groups[3].count++;
    }
    return groups;
  }, [tasks, t]);

  const donut = useMemo(() => {
    const total = Math.max(1, tasks.length);
    let acc = 0;
    return statusDist.map((g) => {
      const frac = (g.count / total) * 100;
      const offset = 25 - acc;
      acc += frac;
      return { ...g, dash: `${frac} ${100 - frac}`, offset };
    });
  }, [statusDist, tasks.length]);

  const todos = useMemo(
    () => [...targets].filter((x) => (x.pending_count ?? 0) + (x.candidate_count ?? 0) > 0)
      .sort((a, b) => (b.pending_count + b.candidate_count) - (a.pending_count + a.candidate_count))
      .slice(0, 5),
    [targets],
  );

  const feed = useMemo(() => {
    const items: { time: string; color: string; text: React.ReactNode }[] = [];
    [...tasks].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 4).forEach((x) => {
      items.push({
        time: x.created_at,
        color: statusColor(x.status),
        text: (<>{t("dash.feed_task")} <b className="vw-mono">{x.task_id.slice(0, 8)}</b> · {x.target} — {formatTaskStatus(x.status)}</>),
      });
    });
    (reportsQuery.data ?? []).slice(0, 3).forEach((r) => {
      items.push({
        time: r.modified_at ?? "",
        color: "#60a5fa",
        text: (<>{t("dash.feed_report")} <b className="vw-mono">{r.name}</b></>),
      });
    });
    return items.sort((a, b) => +new Date(b.time) - +new Date(a.time)).slice(0, 6);
  }, [tasks, reportsQuery.data, t]);

  const todayStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", weekday: "long" });

  return (
    <div>
      <div className="vw-page-head">
        <div>
          <h1>{t("dash.title")}</h1>
          <p>{todayStr}</p>
        </div>
        <button className="vw-btn vw-btn-primary" type="button" onClick={onNewTask}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14" /></svg>
          {t("dash.new_task")}
        </button>
      </div>

      <div className="vw-grid4">
        <StatCard label={t("dash.running_tasks")} value={running.length} sub={t("dash.tasks_total", { count: String(tasks.length) })} icon={ICONS.task} tint="rgba(52,211,153,.12)" />
        <StatCard label={t("dash.pending_findings")} value={pendingFindings} sub={t("dash.verified_findings", { count: String(verifiedFindings) })} icon={ICONS.shield} tint="rgba(248,113,113,.12)" />
        <StatCard label={t("dash.targets")} value={targets.length} sub={t("dash.targets_sub")} icon={ICONS.box} tint="rgba(96,165,250,.12)" />
        <StatCard label={t("dash.completed_tasks")} value={done.length} sub={t("dash.completed_sub")} icon={ICONS.check} tint="rgba(52,211,153,.12)" />
      </div>

      <div className="vw-grid2">
        <div className="vw-card">
          <h3>{t("dash.trend_title")}</h3>
          <div className="sub">{t("dash.trend_sub")}</div>
          <div className="vw-bars">
            {trend.map((d) => (
              <div className="vw-bar-col" key={d.label} title={d.title}>
                <i style={{ height: `${Math.max(3, (d.count / maxTrend) * 120)}px`, background: d.count ? "var(--accent)" : "rgba(148,163,184,.18)" }} />
                <span>{d.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="vw-card">
          <h3>{t("dash.status_title")}</h3>
          <div className="sub">{t("dash.status_sub", { count: String(tasks.length) })}</div>
          <div className="vw-donut-wrap">
            <svg width="130" height="130" viewBox="0 0 42 42" role="img">
              <circle cx="21" cy="21" r="15.9" fill="none" stroke="rgba(148,163,184,.12)" strokeWidth="7" />
              {donut.map((g) => (
                <circle key={g.key} cx="21" cy="21" r="15.9" fill="none" stroke={g.color} strokeWidth="7"
                  strokeDasharray={g.dash} strokeDashoffset={g.offset} strokeLinecap="round" />
              ))}
              <text x="21" y="24" textAnchor="middle" fill="#e8edf4" fontSize="9" fontWeight="700">{tasks.length}</text>
            </svg>
            <div className="vw-legend">
              {statusDist.map((g) => (
                <div className="li" key={g.key}><span className="sw" style={{ background: g.color }} />{g.label}<b>{g.count}</b></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="vw-grid2">
        <div className="vw-card">
          <h3>{t("dash.todo_title")}</h3>
          <div className="sub">{t("dash.todo_sub")}</div>
          <div style={{ marginTop: 8 }}>
            {todos.length === 0 && <div className="vw-empty">{t("dash.todo_empty")}</div>}
            {todos.map((x) => {
              const n = (x.pending_count ?? 0) + (x.candidate_count ?? 0);
              return (
                <div className="vw-todo-row" key={x.target}>
                  <span className="vw-sev vw-sev-high">{t("dash.pending_badge")}</span>
                  <div className="ti">
                    <div className="tn">{x.target}</div>
                    <div className="tm2">{t("dash.pending_detail", { pending: String(x.pending_count ?? 0), candidate: String(x.candidate_count ?? 0) })}</div>
                  </div>
                  <span className="vw-badge vw-b-fail">{n}</span>
                  <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" onClick={() => onOpenVulns(x.target)}>
                    {t("dash.review")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="vw-card">
          <h3>{t("dash.feed_title")}</h3>
          <div className="sub">{t("dash.feed_sub")}</div>
          <div style={{ marginTop: 8 }}>
            {feed.length === 0 && <div className="vw-empty">{t("dash.feed_empty")}</div>}
            {feed.map((f, i) => (
              <div className="vw-feed-item" key={i}>
                <span className="fd" style={{ background: f.color }} />
                <div>
                  <div>{f.text}</div>
                  <div className="ft">{f.time ? new Date(f.time).toLocaleString() : ""}</div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" onClick={onOpenTasks}>{t("dash.all_tasks")}</button>
              <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" onClick={onOpenReports}>{t("dash.all_reports")}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
