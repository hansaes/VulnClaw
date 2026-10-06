import { useEffect, useMemo, useRef, useState } from "react";
import { createTask, stopTask } from "../api/web";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useTasksQuery } from "../hooks/queries";
import { useT, type TFunction } from "../i18n";
import type { TaskCommand, TaskEvent, TaskOptions, TaskRecord } from "../types/api";
import {
  formatActionLabel,
  formatActionList,
  formatConstraintSummary,
  formatEventLabel,
  formatEventTone,
  formatPhaseLabel,
  formatTaskCommand,
  formatTaskStatus,
  formatTaskTitle,
} from "../utils/taskLabels";
import { parseOptionalPort } from "../utils/validation";

function buildActionOptions(t: TFunction) {
  return [
    { value: "recon", copy: t("home.action_recon_copy") },
    { value: "scan", copy: t("home.action_scan_copy") },
    { value: "exploit", copy: t("home.action_exploit_copy") },
    { value: "persistent", copy: t("home.action_persistent_copy") },
    { value: "post_exploitation", copy: t("home.action_post_exploit_copy") },
  ];
}

type EventFilter = "all" | "tools" | "subagents" | "key";

const SUBAGENT_EVENT_KINDS = new Set(["subagent", "group_progress"]);
const KEY_EVENT_KINDS = new Set([
  "error",
  "ask_user",
  "ask_user_rejected",
  "no_path",
  "no_path_rejected",
  "completed",
  "complete_rejected",
  "task_failed",
  "task_stopped",
]);

/** Tool names carried by an observation event. */
function eventTools(item: TaskEvent): string[] {
  const raw = item.payload.tools;
  if (!Array.isArray(raw)) return [];
  return raw.filter((tool): tool is string => typeof tool === "string" && tool.length > 0);
}

function matchesFilter(item: TaskEvent, filter: EventFilter): boolean {
  if (filter === "all") return true;
  if (filter === "tools") return item.event === "agent_observation" || eventTools(item).length > 0;
  if (filter === "subagents") return SUBAGENT_EVENT_KINDS.has(item.event);
  return KEY_EVENT_KINDS.has(item.event);
}

/** The single line the feed shows for an event (payload text first, label as fallback). */
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

function numberField(item: TaskEvent, key: string): number | null {
  const value = item.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(item: TaskEvent, key: string): string {
  const value = item.payload[key];
  return typeof value === "string" ? value : "";
}


interface TaskConsolePageProps {
  activeTask: TaskRecord | null;
  events: TaskEvent[];
  onTaskCreated: (task: TaskRecord) => void;
  onEvent: (event: TaskEvent) => void;
  onFocusTarget: (target: string) => void;
}

export function TaskConsolePage({
  activeTask,
  events,
  onTaskCreated,
  onFocusTarget,
}: TaskConsolePageProps) {
  const { t } = useT();
  const ACTION_OPTIONS = useMemo(() => buildActionOptions(t), [t]);
  const tasksQuery = useTasksQuery();
  const [command, setCommand] = useState<TaskCommand>("persistent");
  const [target, setTarget] = useState("");
  const [resume, setResume] = useState(true);
  const [maxRounds, setMaxRounds] = useState<number | "">("");
  const [roundsPerCycle, setRoundsPerCycle] = useState<number | "">("");
  const [maxCycles, setMaxCycles] = useState<number | "">("");
  const [cve, setCve] = useState("");
  const [cmd, setCmd] = useState("");
  const [onlyPort, setOnlyPort] = useState("");
  const [onlyHost, setOnlyHost] = useState("");
  const [onlyPath, setOnlyPath] = useState("");
  const [blockedHost, setBlockedHost] = useState("");
  const [blockedPath, setBlockedPath] = useState("");
  const [allowActions, setAllowActions] = useState<string[]>([]);
  const [blockActions, setBlockActions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRunOpen, setConfirmRunOpen] = useState(false);
  const [confirmStopOpen, setConfirmStopOpen] = useState(false);

  const [followFeed, setFollowFeed] = useState(true);
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const feedRef = useRef<HTMLDivElement | null>(null);

  const feedEvents = useMemo(
    () => events.filter((item) => matchesFilter(item, eventFilter)).slice(-200),
    [events, eventFilter],
  );
  const requiresRunConfirmation = command === "exploit" || command === "persistent";
  const scopePreview = formatConstraintSummary({
    only_port: onlyPort.trim() || undefined,
    only_host: onlyHost.trim() || undefined,
    only_path: onlyPath.trim() || undefined,
    blocked_host: blockedHost.trim() || undefined,
    blocked_path: blockedPath.trim() || undefined,
    allow_actions: allowActions.length ? allowActions : undefined,
    block_actions: blockActions.length ? blockActions : undefined,
  });
  const runConfirmCopy = t("console.confirm_raw_copy", {
    target: target.trim() || t("home.confirm_not_set"),
    command: `${formatTaskCommand(command)} (${command})`,
    scope: scopePreview,
  });

  useEffect(() => {
    const node = feedRef.current;
    if (followFeed && node) node.scrollTop = node.scrollHeight;
  }, [feedEvents, followFeed]);

  function toggleRow(key: string) {
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleAction(
    value: string,
    selected: string[],
    setSelected: (next: string[]) => void,
    oppositeSelected?: string[],
    setOppositeSelected?: (next: string[]) => void,
  ) {
    const isSelected = selected.includes(value);
    setSelected(isSelected ? selected.filter((item) => item !== value) : [...selected, value]);
    if (!isSelected && oppositeSelected && setOppositeSelected) {
      setOppositeSelected(oppositeSelected.filter((item) => item !== value));
    }
  }

  function buildTaskOptions(): TaskOptions {
    return {
      max_rounds: maxRounds === "" ? undefined : maxRounds,
      rounds_per_cycle: roundsPerCycle === "" ? undefined : roundsPerCycle,
      max_cycles: maxCycles === "" ? undefined : maxCycles,
      cve: cve.trim() || undefined,
      cmd: cmd.trim() || undefined,
      only_port: parseOptionalPort(onlyPort),
      only_host: onlyHost.trim() || undefined,
      only_path: onlyPath.trim() || undefined,
      blocked_host: blockedHost.trim() || undefined,
      blocked_path: blockedPath.trim() || undefined,
      allow_actions: allowActions.length ? allowActions : undefined,
      block_actions: blockActions.length ? blockActions : undefined,
    };
  }

  function handleRunRequest() {
    try {
      setError(null);
      buildTaskOptions();
      if (requiresRunConfirmation) {
        setConfirmRunOpen(true);
        return;
      }
      void handleRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.invalid_task_params"));
    }
  }

  async function handleRun() {
    try {
      setSubmitting(true);
      setError(null);
      const task = await createTask(command, target, resume, buildTaskOptions());
      onTaskCreated(task);
      onFocusTarget(task.target);
      await tasksQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.failed_to_start"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStop() {
    if (!activeTask) return;
    try {
      await stopTask(activeTask.task_id);
      await tasksQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.stop_failed"));
    }
  }

  return (
    <section className="card">
      <header className="card-header">
        <div>
          <h3>{t("console.title")}</h3>
          <p>{t("console.description")}</p>
        </div>
        <span className="status-badge">{formatTaskStatus(activeTask?.status)}</span>
      </header>

      <div className="form-grid">
        <label className="field">
          <span>{t("console.command")}</span>
          <select value={command} onChange={(event) => setCommand(event.target.value as TaskCommand)}>
            <option value="run">{t("command.run")}</option>
            <option value="recon">{t("command.recon")}</option>
            <option value="scan">{t("command.scan")}</option>
            <option value="exploit">{t("command.exploit")}</option>
            <option value="persistent">{t("command.persistent")}</option>
          </select>
          <small>{t("console.api_command", { command })}</small>
        </label>

        <label className="field field-wide">
          <span>{t("console.target")}</span>
          <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="https://target.example" />
        </label>

        <label className="check-row">
          <input checked={resume} onChange={(event) => setResume(event.target.checked)} type="checkbox" />
          <span>{t("console.resume_state")}</span>
        </label>
        <label className="field">
          <span>{t("console.max_rounds")}</span>
          <input type="number" value={maxRounds} onChange={(event) => setMaxRounds(event.target.value ? Number(event.target.value) : "")} placeholder={t("console.backend_default")} />
        </label>
        <label className="field">
          <span>{t("console.rounds_per_cycle")}</span>
          <input type="number" value={roundsPerCycle} onChange={(event) => setRoundsPerCycle(event.target.value ? Number(event.target.value) : "")} placeholder={t("console.continuous_only")} />
        </label>
        <label className="field">
          <span>{t("console.max_cycles")}</span>
          <input type="number" value={maxCycles} onChange={(event) => setMaxCycles(event.target.value ? Number(event.target.value) : "")} placeholder={t("console.continuous_only")} />
        </label>
        <label className="field">
          <span>{t("console.cve_hint")}</span>
          <input value={cve} onChange={(event) => setCve(event.target.value)} placeholder="CVE-2024-xxxx" />
        </label>
        <label className="field">
          <span>{t("console.port_only")}</span>
          <input inputMode="numeric" value={onlyPort} onChange={(event) => setOnlyPort(event.target.value)} placeholder="443" />
        </label>
        <label className="field">
          <span>{t("console.host_only")}</span>
          <input value={onlyHost} onChange={(event) => setOnlyHost(event.target.value)} placeholder="example.com" />
        </label>
        <label className="field field-wide">
          <span>{t("console.path_only")}</span>
          <input value={onlyPath} onChange={(event) => setOnlyPath(event.target.value)} placeholder="/admin" />
        </label>
        <label className="field">
          <span>{t("console.block_host")}</span>
          <input value={blockedHost} onChange={(event) => setBlockedHost(event.target.value)} placeholder="staging.example.com" />
        </label>
        <label className="field">
          <span>{t("console.block_path")}</span>
          <input value={blockedPath} onChange={(event) => setBlockedPath(event.target.value)} placeholder="/internal" />
        </label>
        <div className="field field-wide">
          <span>{t("console.allow_actions")}</span>
          <div className="action-choice-grid">
            {ACTION_OPTIONS.map((action) => (
              <button
                key={`advanced-allow-${action.value}`}
                type="button"
                className={`action-choice ${allowActions.includes(action.value) ? "selected-item" : ""}`}
                onClick={() => toggleAction(action.value, allowActions, setAllowActions, blockActions, setBlockActions)}
              >
                <strong>{formatActionLabel(action.value)}</strong>
                <span>{action.copy}</span>
              </button>
            ))}
          </div>
          <small>{formatActionList(allowActions, t("console.no_allow_list"))}</small>
        </div>
        <div className="field field-wide">
          <span>{t("console.block_actions")}</span>
          <div className="action-choice-grid">
            {ACTION_OPTIONS.map((action) => (
              <button
                key={`advanced-block-${action.value}`}
                type="button"
                className={`action-choice action-choice-block ${blockActions.includes(action.value) ? "selected-item" : ""}`}
                onClick={() => toggleAction(action.value, blockActions, setBlockActions, allowActions, setAllowActions)}
              >
                <strong>{formatActionLabel(action.value)}</strong>
                <span>{action.copy}</span>
              </button>
            ))}
          </div>
          <small>{formatActionList(blockActions, t("console.no_block_list"))}</small>
        </div>
        <label className="field field-wide">
          <span>{t("console.command_hint")}</span>
          <input value={cmd} onChange={(event) => setCmd(event.target.value)} placeholder="verification command, for example id" />
        </label>
      </div>

      <div className="button-row">
        <button className="primary-btn" disabled={submitting || !target.trim()} onClick={handleRunRequest} type="button">
          {submitting ? t("console.launching") : t("console.launch_raw")}
        </button>
        <button className="secondary-btn" disabled={!activeTask || activeTask.status !== "running"} onClick={() => setConfirmStopOpen(true)} type="button">
          {t("console.stop_task")}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <ConfirmDialog
        open={confirmRunOpen}
        title={t("console.confirm_raw_title")}
        copy={runConfirmCopy}
        tone="danger"
        confirmLabel={t("console.launch")}
        onCancel={() => setConfirmRunOpen(false)}
        onConfirm={() => {
          setConfirmRunOpen(false);
          void handleRun();
        }}
      />

      <ConfirmDialog
        open={confirmStopOpen}
        title={t("console.confirm_stop_title")}
        copy={t("console.confirm_stop_copy", {
          target: activeTask?.target ?? t("boundary.unknown"),
          task: activeTask ? formatTaskTitle(activeTask.command, activeTask.target) : "None",
        })}
        tone="danger"
        confirmLabel={t("console.stop")}
        onCancel={() => setConfirmStopOpen(false)}
        onConfirm={() => {
          setConfirmStopOpen(false);
          void handleStop();
        }}
      />

      <div className="split-grid inner-grid">
        <article className="card inset-card">
          <h4>{t("console.task_log")}</h4>
          <p className="panel-hint">{t("console.task_log_hint")}</p>
          <div className="list list-scroll">
            {tasksQuery.data?.slice(0, 8).map((task) => (
              <button
                key={task.task_id}
                type="button"
                className={`list-item list-button ${activeTask?.task_id === task.task_id ? "selected-item" : ""}`}
                onClick={() => {
                  onTaskCreated(task);
                  onFocusTarget(task.target);
                }}
              >
                <strong>{formatTaskTitle(task.command, task.target)}</strong>
                <span>{formatTaskStatus(task.status)}</span>
                <span className="muted-inline">{task.latest_phase ? formatPhaseLabel(task.latest_phase) : task.created_at}</span>
                {task.summary?.constraints && Object.keys(task.summary.constraints).length > 0 && (
                  <span className="muted-inline">{formatConstraintSummary(task.summary.constraints)}</span>
                )}
              </button>
            ))}
            {!tasksQuery.data?.length && <div className="empty-state">{t("console.no_tasks")}</div>}
          </div>
        </article>

        <article className="card inset-card">
          <h4>{t("console.live_events")}</h4>
          <p className="panel-hint">{t("console.live_events_hint")}</p>

          <div className="feed-toolbar">
            <div className="feed-filters">
              {(["all", "tools", "subagents", "key"] as EventFilter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`feed-filter ${eventFilter === value ? "selected-item" : ""}`}
                  onClick={() => setEventFilter(value)}
                >
                  {t(`console.filter_${value}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`feed-follow ${followFeed ? "selected-item" : ""}`}
              onClick={() => setFollowFeed((prev) => !prev)}
            >
              {followFeed ? t("console.follow") : t("console.follow_paused")}
            </button>
          </div>

          <div
            className="terminal terminal-scroll activity-feed"
            ref={feedRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
              if (!atBottom && followFeed) setFollowFeed(false);
            }}
          >
            {activeTask ? (
              <>
                <div className="terminal-line">{t("console.task_id", { id: activeTask.task_id })}</div>
                <div className="terminal-line">{t("console.command_line", { command: formatTaskCommand(activeTask.command), raw: activeTask.command })}</div>
                <div className="terminal-line">{t("console.target_line", { target: activeTask.target })}</div>
                <div className="terminal-line dim">{t("console.phase_line", { phase: formatPhaseLabel(activeTask.latest_phase) })}</div>
                {activeTask.summary?.constraints && Object.keys(activeTask.summary.constraints).length > 0 && (
                  <div className="terminal-line dim">{t("console.boundary_line", { boundary: formatConstraintSummary(activeTask.summary.constraints) })}</div>
                )}
              </>
            ) : (
              <div className="terminal-line dim">{t("console.no_running")}</div>
            )}

            {activeTask && !feedEvents.length && <div className="terminal-line dim">{t("console.no_events")}</div>}

            {feedEvents.map((item, index) => {
              const key = `${item.timestamp}-${item.event}-${index}`;
              const tone = formatEventTone(item.event);

              if (item.event === "group_progress") {
                const total = numberField(item, "member_total") ?? 0;
                const done = numberField(item, "member_done") ?? 0;
                const failed = numberField(item, "member_failed") ?? 0;
                const waves = numberField(item, "wave_count") ?? 0;
                const evidence = numberField(item, "evidence_count") ?? 0;
                const name = stringField(item, "name") || formatEventLabel(item.event);
                const goal = stringField(item, "goal");
                return (
                  <div key={key} className={`activity-row activity-group tone-${tone}`}>
                    <div className="activity-head">
                      <span className="activity-label">{formatEventLabel(item.event)}</span>
                      <span className="terminal-time">{new Date(item.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="activity-title">{name}</div>
                    {goal && <div className="activity-goal">{goal}</div>}
                    <div className="activity-meta">
                      <span>{t("console.members", { done: String(done), total: String(total) })}</span>
                      {failed > 0 && <span className="tone-danger">{t("console.members_failed", { count: String(failed) })}</span>}
                      {waves > 0 && <span>{t("console.waves", { count: String(waves) })}</span>}
                      {evidence > 0 && <span>{t("console.evidence", { count: String(evidence) })}</span>}
                    </div>
                  </div>
                );
              }

              const text = eventText(item);
              const tools = eventTools(item);
              const step = numberField(item, "step");
              const phase = stringField(item, "phase");
              const long = text.length > 180;
              const expanded = Boolean(expandedRows[key]);
              return (
                <div key={key} className={`activity-row tone-${tone}`}>
                  <div className="activity-head">
                    <span className="terminal-time">{new Date(item.timestamp).toLocaleTimeString()}</span>
                    <span className="activity-label">{formatEventLabel(item.event)}</span>
                    {step !== null && <span className="activity-step">#{step}</span>}
                    {phase && <span className="activity-phase">{formatPhaseLabel(phase)}</span>}
                  </div>
                  <div
                    className={`activity-text ${long && !expanded ? "clamped" : ""} ${long ? "clickable" : ""}`}
                    onClick={long ? () => toggleRow(key) : undefined}
                  >
                    {text}
                  </div>
                  {tools.length > 0 && (
                    <div className="tool-chips">
                      {tools.slice(0, 8).map((tool) => (
                        <span key={tool} className="tool-chip">{tool}</span>
                      ))}
                      {tools.length > 8 && (
                        <span className="tool-chip more">{t("console.tools_more", { count: String(tools.length - 8) })}</span>
                      )}
                    </div>
                  )}
                  {long && (
                    <button type="button" className="activity-toggle" onClick={() => toggleRow(key)}>
                      {expanded ? t("console.collapse") : t("console.expand")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </article>
      </div>
    </section>
  );
}
