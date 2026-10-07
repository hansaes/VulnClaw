import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { rollbackTarget, stopTask } from "../api/web";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ProcessTimeline } from "../components/ProcessTimeline";
import { useTargetSnapshotsQuery, useTargetsQuery } from "../hooks/queries";
import { useT, type TFunction } from "../i18n";
import type { TaskEvent, TaskRecord } from "../types/api";
import {
  formatEventLabel,
  formatEventTone,
  formatPhaseLabel,
  formatTaskCommand,
  formatTaskStatus,
} from "../utils/taskLabels";

type EventFilter = "all" | "key";

type LogView = "process" | "log";

export type TimelineItem =
  | { kind: "step"; key: string; timestamp: string; step: number | null; reason: string; tools: string[]; evidence: string }
  | { kind: "tool"; key: string; timestamp: string; tool: string; args: string }
  | { kind: "result"; key: string; timestamp: string; result: string }
  | { kind: "status"; key: string; timestamp: string; text: string; tone: string };

/** 把原始事件流整理成「执行过程」时间线：思考 → 工具调用 → 工具结果 → 步骤结论。*/
function buildTimeline(list: TaskEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  list.forEach((e, i) => {
    const key = `${e.timestamp}-${e.event}-${i}`;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (e.event === "agent_stream") return; // token 碎片太吵，时间线里跳过（原始日志可看）
    if (e.event === "agent_observation") {
      const tools = Array.isArray(p.tools) ? p.tools.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
      items.push({
        kind: "step", key, timestamp: e.timestamp,
        step: typeof p.step === "number" ? p.step : null,
        reason: str(p.reason), tools, evidence: str(p.evidence),
      });
      return;
    }
    if (e.event === "agent_tool") {
      items.push({ kind: "tool", key, timestamp: e.timestamp, tool: str(p.tool), args: str(p.args) });
      return;
    }
    if (e.event === "agent_tool_result") {
      items.push({ kind: "result", key, timestamp: e.timestamp, result: str(p.result) });
      return;
    }
    items.push({ kind: "status", key, timestamp: e.timestamp, text: eventText(e), tone: formatEventTone(e.event) });
  });
  return items;
}

const KEY_EVENT_KINDS = new Set([
  "error", "ask_user", "ask_user_rejected", "no_path", "no_path_rejected",
  "completed", "complete_rejected", "task_failed", "task_stopped",
  "task_completed", "cycle_completed",
]);

interface TaskConsolePageProps {
  activeTask: TaskRecord | null;
  events: TaskEvent[];
  tasks: TaskRecord[];
  onSelectTask: (task: TaskRecord) => void;
  onNewTask: () => void;
  onOpenVulns: (target: string) => void;
  onBack: () => void;
}

function stageIndex(task: TaskRecord | null): number {
  if (!task) return -1;
  if (task.status === "completed") return 4;
  if (task.status === "failed" || task.status === "stopped") return 2;
  const text = `${task.latest_phase ?? ""}`.toLowerCase();
  if (text.includes("report")) return 3;
  if (text.includes("exploit") || text.includes("verify")) return 2;
  if (text.includes("scan")) return 1;
  if (text.includes("recon")) return 0;
  return 0;
}

/** Read a string field from an event payload (empty string when absent). */
function stringField(item: TaskEvent, key: string): string {
  const value = item.payload[key];
  return typeof value === "string" ? value : "";
}

function eventText(item: TaskEvent): string {
  if (item.event === "agent_tool") {
    const tool = stringField(item, "tool");
    const args = stringField(item, "args");
    if (tool) return args ? `${tool}(${args})` : tool;
  }
  for (const key of ["text", "message", "reason", "question", "error"]) {
    const value = item.payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return formatEventLabel(item.event);
}

function eventTools(item: TaskEvent): string[] {
  const raw = item.payload.tools;
  if (!Array.isArray(raw)) return [];
  return raw.filter((tool): tool is string => typeof tool === "string" && tool.length > 0);
}

function matchesFilter(item: TaskEvent, filter: EventFilter): boolean {
  if (filter === "all") return true;
  return KEY_EVENT_KINDS.has(item.event);
}

function formatTime(value: string | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function TaskConsolePage({ activeTask, events, tasks, onSelectTask, onNewTask, onOpenVulns, onBack }: TaskConsolePageProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [followFeed, setFollowFeed] = useState(true);
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [logView, setLogView] = useState<LogView>("process");
  const [search, setSearch] = useState("");
  const [stopOpen, setStopOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const feedRef = useRef<HTMLDivElement | null>(null);

  const snapshotsQuery = useTargetSnapshotsQuery(activeTask?.target ?? null);
  const targetsQuery = useTargetsQuery();
  const [pendingRollbackId, setPendingRollbackId] = useState<string | null>(null);
  const [busySnapshot, setBusySnapshot] = useState<string | null>(null);
  const [snapMsg, setSnapMsg] = useState<string | null>(null);

  const idx = stageIndex(activeTask);
  const [selStage, setSelStage] = useState<number>(2);
  useEffect(() => { setSelStage(idx >= 0 ? Math.min(idx, 3) : 2); }, [activeTask?.task_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const feedEvents = useMemo(() => {
    const q = search.toLowerCase();
    // 执行过程视图下固定看全部事件（关键事件过滤会把步骤筛掉）
    const effFilter = logView === "process" ? "all" : eventFilter;
    const filtered = events
      .filter((e) => matchesFilter(e, effFilter))
      .filter((e) => !q || eventText(e).toLowerCase().includes(q) || e.event.toLowerCase().includes(q));
    // Fold consecutive model-output deltas into one growing line, so streamed
    // text reads as prose instead of one fragment per token batch.
    const merged: TaskEvent[] = [];
    for (const item of filtered) {
      const prev = merged[merged.length - 1];
      const sameStream =
        item.event === "agent_stream" &&
        prev?.event === "agent_stream" &&
        stringField(prev, "type") === stringField(item, "type");
      if (sameStream) {
        merged[merged.length - 1] = {
          ...item,
          payload: {
            ...item.payload,
            text: `${stringField(prev, "text")}${stringField(item, "text")}`,
          },
        };
      } else {
        merged.push(item);
      }
    }
    return merged.slice(-200);
  }, [events, eventFilter, logView, search]);

  const timelineItems = useMemo(() => buildTimeline(feedEvents), [feedEvents]);

  // Sub-agent view: latest state per agent plus per-group member progress.
  const subagents = useMemo(() => {
    const agents = new Map<string, { name: string; status: string; type: string }>();
    const groups = new Map<string, { name: string; done: number; total: number; waves: number }>();
    const num = (event: TaskEvent, key: string) => {
      const value = event.payload[key];
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    };
    for (const event of events) {
      if (event.event === "subagent") {
        const id = stringField(event, "agent_id");
        if (id) {
          agents.set(id, {
            name: stringField(event, "name") || id,
            status: stringField(event, "status"),
            type: stringField(event, "agent_type"),
          });
        }
      } else if (event.event === "group_progress") {
        const id = stringField(event, "group_id") || stringField(event, "name");
        if (id) {
          groups.set(id, {
            name: stringField(event, "name") || id,
            done: num(event, "member_done"),
            total: num(event, "member_total"),
            waves: num(event, "wave_count"),
          });
        }
      }
    }
    const list = [...agents.values()];
    const isRunning = (status: string) => status === "running" || status === "pending";
    return {
      total: list.length,
      running: list.filter((a) => isRunning(a.status)).length,
      finished: list.filter((a) => !isRunning(a.status)).length,
      items: list.slice(-6),
      groups: [...groups.values()],
    };
  }, [events]);

  useEffect(() => {
    const node = feedRef.current;
    if (followFeed && node) node.scrollTop = node.scrollHeight;
  }, [feedEvents, followFeed]);

  const stages = useMemo(() => {
    const s = activeTask?.summary;
    return [
      { key: "recon", detail: activeTask ? t("detail.stage_recon_d", { steps: String(s?.executed_steps ?? "—") }) : "" },
      { key: "scan", detail: t("detail.stage_scan_d", { count: String((s?.candidate_count ?? 0) + (s?.pending_count ?? 0)) }) },
      { key: "exploit", detail: t("detail.stage_exploit_d", { verified: String(s?.verified_count ?? 0), pending: String(s?.pending_count ?? 0) }) },
      { key: "report", detail: activeTask?.status === "completed" ? t("detail.stage_report_done") : t("detail.stage_report_wait") },
    ];
  }, [activeTask, t]);

  const stageOutputs = useMemo(() => {
    const s = activeTask?.summary;
    const rows: { k: string; v: string }[][] = [
      [
        { k: t("detail.out_phase"), v: formatPhaseLabel(activeTask?.latest_phase) },
        { k: t("detail.out_steps"), v: String(s?.executed_steps ?? "—") },
      ],
      [
        { k: t("detail.out_candidates"), v: String(s?.candidate_count ?? "—") },
        { k: t("detail.out_pending"), v: String(s?.pending_count ?? "—") },
      ],
      [
        { k: t("detail.out_verified"), v: String(s?.verified_count ?? "—") },
        { k: t("detail.out_quarantined"), v: String(s?.quarantined_count ?? "—") },
      ],
      activeTask?.status === "completed"
        ? [{ k: t("detail.out_status"), v: t("detail.out_done") }]
        : [{ k: t("detail.out_status"), v: t("detail.out_waiting") }],
    ];
    return rows;
  }, [activeTask, t]);

  async function handleStop() {
    if (!activeTask) return;
    try {
      await stopTask(activeTask.task_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.stop_failed"));
    } finally {
      setStopOpen(false);
    }
  }

  async function handleRollback(snapshotId: string) {
    if (!activeTask) return;
    setBusySnapshot(snapshotId);
    try {
      await rollbackTarget(activeTask.target, snapshotId);
      setSnapMsg(t("detail.rollback_done", { target: activeTask.target }));
      await Promise.all([snapshotsQuery.refetch(), targetsQuery.refetch()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.snapshot_restore_failed"));
    } finally {
      setBusySnapshot(null);
    }
  }

  const findings = activeTask?.summary
    ? (activeTask.summary.verified_count ?? 0) + (activeTask.summary.pending_count ?? 0)
    : null;
  const stoppable = activeTask?.status === "running" || activeTask?.status === "pending";

  return (
    <div>
      <button type="button" className="vw-back" onClick={onBack}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        {t("detail.back")}
      </button>

      {!activeTask && (
        <div className="vw-card">
          <h3>{t("detail.no_task_title")}</h3>
          <div className="sub">{t("detail.no_task_sub")}</div>
          <div className="vw-toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
            {tasks.slice(0, 6).map((x) => (
              <button key={x.task_id} type="button" className="vw-chip" onClick={() => onSelectTask(x)}>
                {x.target} · {formatTaskCommand(x.command)}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" onClick={onNewTask}>{t("detail.new_task")}</button>
          </div>
        </div>
      )}

      {activeTask && (
        <>
          <div className="vw-detail-head">
            <div className="tt">
              <h2>{activeTask.target} · {formatTaskCommand(activeTask.command)}</h2>
              <div className="tg">{activeTask.task_id} · {t("detail.started_at", { time: formatTime(activeTask.started_at ?? activeTask.created_at) })}</div>
            </div>
            <span className={`vw-badge ${stoppable ? "vw-b-run" : activeTask.status === "completed" ? "vw-b-done" : activeTask.status === "failed" ? "vw-b-fail" : "vw-b-pause"}`}>
              {stoppable && <span className="dot" />}
              {formatTaskStatus(activeTask.status)}
            </span>
            <div className="acts">
              {stoppable && (
                <button className="vw-btn vw-btn-ghost vw-btn-sm" type="button" onClick={() => setStopOpen(true)}>
                  {t("detail.pause")}
                </button>
              )}
              <button className="vw-btn vw-btn-ghost vw-btn-sm" type="button" onClick={() => onOpenVulns(activeTask.target)}>
                {t("detail.view_findings")}
              </button>
              <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" onClick={onNewTask}>
                {t("detail.new_task")}
              </button>
            </div>
          </div>

          {error && <div className="vw-err">{error}</div>}

          <div className="vw-pipeline">
            {stages.map((s, i) => {
              const done = idx > i || idx === 4;
              const active = idx === i && idx < 4;
              const todo = idx < i;
              return (
                <div
                  key={s.key}
                  className={`vw-stage ${done ? "done" : ""} ${active ? "active" : ""} ${todo ? "todo" : ""} ${selStage === i ? "sel" : ""}`}
                  onClick={() => setSelStage(i)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setSelStage(i)}
                >
                  <div className="sn">STAGE 0{i + 1}</div>
                  <div className="nm">
                    {active && <span className="pulse" />}
                    {t(`detail.stage_${s.key}`)}
                    {done && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M20 6L9 17l-5-5" /></svg>
                    )}
                  </div>
                  <div className="dt">{s.detail}</div>
                  {active && <div className="bar"><i style={{ width: "62%" }} /></div>}
                </div>
              );
            })}
          </div>

          <div className="vw-stage-output">
            <h4>{t(`detail.stage_${stages[selStage].key}`)} · {t("detail.stage_output")}</h4>
            {stageOutputs[selStage].map((r) => (
              <div className="vw-out-row" key={r.k}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M20 6L9 17l-5-5" /></svg>
                <span className="k">{r.k}</span>
                <span className="v">{r.v}</span>
              </div>
            ))}
          </div>

          <div className="vw-detail-grid">
            <div className="vw-term">
              <div className="vw-term-head">
                <div className="t">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 17l6-6-6-6M12 19h8" /></svg>
                  {t("detail.live_log")}
                </div>
                <div className="ctl">
                  <div className="vw-seg" role="tablist" aria-label={t("detail.live_log")}>
                    <button
                      type="button" role="tab" aria-selected={logView === "process"}
                      className={logView === "process" ? "on" : ""}
                      onClick={() => setLogView("process")}
                    >
                      {t("detail.view_process")}
                    </button>
                    <button
                      type="button" role="tab" aria-selected={logView === "log"}
                      className={logView === "log" ? "on" : ""}
                      onClick={() => setLogView("log")}
                    >
                      {t("detail.view_log")}
                    </button>
                  </div>
                  {logView === "log" && (
                    <select className="vw-input" value={eventFilter} onChange={(e) => setEventFilter(e.target.value as EventFilter)}>
                      <option value="all">{t("detail.filter_all")}</option>
                      <option value="key">{t("detail.filter_key")}</option>
                    </select>
                  )}
                  <input className="vw-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("detail.search_ph")} />
                  <button type="button" className="vw-btn vw-btn-ghost vw-btn-xs" onClick={() => setFollowFeed((v) => !v)} title={t("detail.follow_hint")}>
                    {t("detail.follow")}{followFeed ? t("detail.on") : t("detail.off")}
                  </button>
                </div>
              </div>
              <div
                className="vw-term-body"
                ref={feedRef}
                onScroll={(e) => {
                  const node = e.currentTarget;
                  const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
                  if (!atBottom && followFeed) setFollowFeed(false);
                }}
              >
                <div className="ln"><span className="ts">{formatTime(activeTask.created_at)}</span> <span className="dim">{t("detail.log_task", { id: activeTask.task_id.slice(0, 8) })}</span></div>
                <div className="ln"><span className="ts">{formatTime(activeTask.created_at)}</span> <span className="dim">{t("detail.log_target", { target: activeTask.target })}</span></div>
                {logView === "process" ? (
                  <>
                    <ProcessTimeline items={timelineItems} expandedRows={expandedRows} onToggle={(key) => setExpandedRows((p) => ({ ...p, [key]: !p[key] }))} />
                    {timelineItems.length === 0 && (
                      <div className="vw-tl-empty"><span className="dim">{t("detail.no_process_events")}</span></div>
                    )}
                  </>
                ) : (
                <>
                {feedEvents.map((item, i) => {
                  const key = `${item.timestamp}-${item.event}-${i}`;
                  const tone = formatEventTone(item.event);
                  const text = eventText(item);
                  const tools = eventTools(item);
                  const long = text.length > 180;
                  const expanded = Boolean(expandedRows[key]);
                  const cls = tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "danger" ? "err" : tone === "info" ? "inf" : "dim";
                  return (
                    <div className="ln" key={key}>
                      <span className="ts">{new Date(item.timestamp).toLocaleTimeString()}</span>{" "}
                      <span className={cls}>
                        {long && !expanded ? text.slice(0, 180) + "…" : text}
                      </span>
                      {tools.length > 0 && <span className="dim"> [{tools.slice(0, 4).join(", ")}]</span>}
                      {long && (
                        <span className="inf" style={{ cursor: "pointer", marginLeft: 8 }}
                          onClick={() => setExpandedRows((p) => ({ ...p, [key]: !p[key] }))}>
                          {expanded ? t("detail.collapse") : t("detail.expand")}
                        </span>
                      )}
                    </div>
                  );
                })}
                {!feedEvents.length && <div className="ln"><span className="dim">{t("detail.no_events")}</span></div>}
                </>
                )}
              </div>
              <div className="vw-term-foot">
                <span>{t("detail.events_count", { count: String(feedEvents.length) })}</span>
                <span className="vw-mono">{activeTask.task_id.slice(0, 8)}</span>
                <span style={{ color: stoppable ? "var(--green)" : "var(--faint)" }}>
                  {stoppable ? `● ${t("detail.streaming")}` : `● ${t("detail.ended")}`}
                </span>
              </div>
            </div>

            <div className="vw-side-stack">
              <div className="vw-card">
                <h3>{t("detail.subagents_title")}</h3>
                <div style={{ marginTop: 6 }}>
                  <div className="vw-kv">
                    <span className="k">{t("detail.subagents_running")}</span>
                    <span className="v" style={{ color: subagents.running ? "var(--green)" : "var(--faint)" }}>
                      {subagents.running}
                    </span>
                  </div>
                  <div className="vw-kv">
                    <span className="k">{t("detail.subagents_done")}</span>
                    <span className="v">{subagents.finished}</span>
                  </div>
                  <div className="vw-kv">
                    <span className="k">{t("detail.subagents_total")}</span>
                    <span className="v">{subagents.total}</span>
                  </div>
                </div>
                {subagents.groups.map((group) => (
                  <div className="vw-kv" key={group.name}>
                    <span className="k">{group.name}</span>
                    <span className="v vw-mono">
                      {t("detail.members", { done: String(group.done), total: String(group.total) })}
                      {group.waves > 0 ? ` · ${t("detail.waves", { count: String(group.waves) })}` : ""}
                    </span>
                  </div>
                ))}
                {subagents.items.map((agent) => (
                  <div className="vw-kv" key={agent.name}>
                    <span className="k" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background:
                            agent.status === "running" || agent.status === "pending"
                              ? "var(--green)"
                              : "var(--faint)",
                        }}
                      />
                      {agent.name}
                    </span>
                    <span className="v">{agent.type} · {agent.status}</span>
                  </div>
                ))}
                {!subagents.total && (
                  <div className="vw-kv">
                    <span className="k" style={{ color: "var(--faint)" }}>{t("detail.subagents_none")}</span>
                  </div>
                )}
              </div>

              <div className="vw-card">
                <h3>{t("detail.task_info")}</h3>
                <div style={{ marginTop: 6 }}>
                  <div className="vw-kv"><span className="k">{t("detail.k_target")}</span><span className="v vw-mono">{activeTask.target}</span></div>
                  <div className="vw-kv"><span className="k">{t("detail.k_command")}</span><span className="v">{formatTaskCommand(activeTask.command)}</span></div>
                  <div className="vw-kv"><span className="k">{t("detail.k_phase")}</span><span className="v">{formatPhaseLabel(activeTask.latest_phase)}</span></div>
                  <div className="vw-kv"><span className="k">{t("detail.k_findings")}</span><span className="v">{findings === null ? "—" : findings}</span></div>
                  <div className="vw-kv"><span className="k">{t("detail.k_status")}</span><span className="v">{formatTaskStatus(activeTask.status)}</span></div>
                  {activeTask.error && <div className="vw-kv"><span className="k">{t("detail.k_error")}</span><span className="v" style={{ color: "var(--red)" }}>{activeTask.error}</span></div>}
                </div>
                <div style={{ marginTop: 12 }}>
                  <button className="vw-btn vw-btn-ghost vw-btn-sm" type="button" style={{ width: "100%", justifyContent: "center" }} onClick={() => onOpenVulns(activeTask.target)}>
                    {t("detail.view_findings")}
                  </button>
                </div>
              </div>

              <div className="vw-card">
                <h3>{t("detail.switch_task")}</h3>
                <div className="sub">{t("detail.switch_hint")}</div>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                  {tasks.slice(0, 10).map((x) => (
                    <button
                      key={x.task_id}
                      type="button"
                      className={`vw-chip ${x.task_id === activeTask.task_id ? "on" : ""}`}
                      style={{ justifyContent: "flex-start" }}
                      onClick={() => onSelectTask(x)}
                    >
                      <span className="vw-mono" style={{ fontSize: 12 }}>{x.target}</span>
                    </button>
                  ))}
                  {!tasks.length && <div className="sub">{t("detail.no_tasks")}</div>}
                </div>
              </div>

              <div className="vw-card">
                <h3>{t("detail.snapshots")}</h3>
                <div className="sub">{t("detail.snapshots_sub")}</div>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {(snapshotsQuery.data ?? []).slice(0, 5).map((s) => (
                    <div className="vw-kv" key={s.snapshot_id}>
                      <span className="k vw-mono" style={{ fontSize: 12 }}>{s.snapshot_id.slice(0, 12)}</span>
                      <button
                        type="button"
                        className="vw-btn vw-btn-ghost vw-btn-xs"
                        disabled={busySnapshot === s.snapshot_id}
                        onClick={() => setPendingRollbackId(s.snapshot_id)}
                      >
                        {busySnapshot === s.snapshot_id ? t("detail.restoring") : t("detail.rollback")}
                      </button>
                    </div>
                  ))}
                  {!(snapshotsQuery.data ?? []).length && <div className="sub">{t("detail.no_snapshots")}</div>}
                </div>
                {snapMsg && <div className="vw-ok-box" style={{ marginTop: 10, marginBottom: 0 }}>{snapMsg}</div>}
              </div>
            </div>
          </div>

          <ConfirmDialog
            open={stopOpen}
            title={t("detail.confirm_stop_title")}
            copy={t("detail.confirm_stop_copy", { target: activeTask.target })}
            tone="danger"
            confirmLabel={t("detail.stop")}
            onCancel={() => setStopOpen(false)}
            onConfirm={() => { setStopOpen(false); void handleStop(); }}
          />
          <ConfirmDialog
            open={Boolean(pendingRollbackId)}
            title={t("detail.confirm_rollback_title")}
            copy={t("detail.confirm_rollback_copy")}
            tone="danger"
            confirmLabel={t("detail.rollback")}
            onCancel={() => setPendingRollbackId(null)}
            onConfirm={() => {
              const id = pendingRollbackId;
              setPendingRollbackId(null);
              if (id) void handleRollback(id);
            }}
          />
        </>
      )}
    </div>
  );
}
