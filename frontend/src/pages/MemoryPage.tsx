import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approveMemoryLesson,
  createMemoryLesson,
  deleteMemoryLesson,
  getMemoryLessons,
  getMemorySummary,
  type LessonCreatePayload,
  type MemoryLesson,
} from "../api/web";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useTargetsQuery } from "../hooks/queries";
import { useT } from "../i18n";

type Tab = "global" | "target";

const SIGNAL_STYLE: Record<string, string> = { success: "vw-b-done", deadend: "vw-b-fail" };
const STATUS_STYLE: Record<string, string> = { pending: "vw-st-open", approved: "vw-st-confirmed", rejected: "vw-st-ignored" };

function LessonCard({ lesson, onApprove, onDelete, busy }: {
  lesson: MemoryLesson;
  onApprove: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const { t } = useT();
  return (
    <div className="vw-mem-card">
      <div className="vw-mem-card-head">
        <span className={`vw-badge ${SIGNAL_STYLE[lesson.signal] ?? "vw-b-done"}`}>
          {lesson.signal === "success" ? t("mem.signal_success") : t("mem.signal_deadend")}
        </span>
        <span className={`vw-st ${STATUS_STYLE[lesson.status] ?? "vw-st-open"}`}>
          {t(`mem.status_${lesson.status}`)}
        </span>
        {lesson.tags.vuln_type && <span className="vw-badge">{lesson.tags.vuln_type}</span>}
        <span className="vw-mem-conf">{t("mem.confidence", { v: String(Math.round(lesson.confidence * 100)) })}</span>
        <span className="vw-mem-actions">
          {lesson.status === "pending" && (
            <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" disabled={busy} onClick={() => onApprove(lesson.id)}>
              {t("mem.approve")}
            </button>
          )}
          <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" disabled={busy} onClick={() => onDelete(lesson.id)}>
            {t("mem.delete")}
          </button>
        </span>
      </div>
      <div className="vw-mem-context">{lesson.context}</div>
      <div className="vw-mem-lesson">{lesson.lesson}</div>
      {lesson.tags.tech.length > 0 && (
        <div className="vw-mem-tags">{lesson.tags.tech.map((x) => <span key={x} className="vw-chip">{x}</span>)}</div>
      )}
    </div>
  );
}

export function MemoryPage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const targetsQuery = useTargetsQuery();
  const [tab, setTab] = useState<Tab>("global");
  const [targetKey, setTargetKey] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summaryQuery = useQuery({ queryKey: ["memory-summary"], queryFn: getMemorySummary });
  const lessonsQuery = useQuery({
    queryKey: ["memory-lessons", tab, targetKey, statusFilter],
    queryFn: () => getMemoryLessons({
      scope: tab === "global" ? "technique" : "target",
      target_key: tab === "target" && targetKey ? targetKey : undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
    }),
  });

  const targetOptions = useMemo(() => {
    const fromSummary = (summaryQuery.data?.targets ?? []).map((x) => x.target_key);
    const fromTargets = (targetsQuery.data ?? []).map((x) => x.target);
    return [...new Set([...fromSummary, ...fromTargets])].sort();
  }, [summaryQuery.data, targetsQuery.data]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["memory-lessons"] }),
      queryClient.invalidateQueries({ queryKey: ["memory-summary"] }),
    ]);
  }

  async function handleApprove(id: string) {
    setBusy(true);
    setError(null);
    try { await approveMemoryLesson(id); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : t("mem.failed")); }
    finally { setBusy(false); }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setBusy(true);
    try { await deleteMemoryLesson(deleteId); setDeleteId(null); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : t("mem.failed")); }
    finally { setBusy(false); }
  }

  const lessons = lessonsQuery.data ?? [];

  return (
    <div>
      <div className="vw-page-head">
        <div>
          <h1>{t("mem.title")}</h1>
          <p>{t("mem.subtitle")}</p>
        </div>
        <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" onClick={() => setFormOpen(true)}>
          {t("mem.add")}
        </button>
      </div>

      {error && <div className="vw-err">{error}</div>}

      <div className="vw-mem-stats">
        <div className="vw-stat">
          <span className="vw-stat-num">{summaryQuery.data?.technique_count ?? "—"}</span>
          <span className="vw-stat-label">{t("mem.global_count")}</span>
        </div>
        <div className="vw-stat">
          <span className="vw-stat-num">{summaryQuery.data?.targets.length ?? "—"}</span>
          <span className="vw-stat-label">{t("mem.targets_count")}</span>
        </div>
      </div>

      <div className="vw-tabs">
        <button type="button" className={`vw-tab ${tab === "global" ? "on" : ""}`} onClick={() => setTab("global")}>
          {t("mem.tab_global")}
        </button>
        <button type="button" className={`vw-tab ${tab === "target" ? "on" : ""}`} onClick={() => setTab("target")}>
          {t("mem.tab_target")}
        </button>
      </div>

      <div className="vw-toolbar">
        {tab === "target" && (
          <select className="vw-input" value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
            <option value="">{t("mem.all_targets")}</option>
            {targetOptions.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
        <select className="vw-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">{t("mem.status_all")}</option>
          <option value="approved">{t("mem.status_approved")}</option>
          <option value="pending">{t("mem.status_pending")}</option>
          <option value="rejected">{t("mem.status_rejected")}</option>
        </select>
      </div>

      {lessonsQuery.isLoading && <div className="vw-empty">{t("mem.loading")}</div>}
      {!lessonsQuery.isLoading && lessons.length === 0 && (
        <div className="vw-tbl-wrap"><div className="vw-empty">{t("mem.empty")}</div></div>
      )}
      <div className="vw-mem-list">
        {lessons.map((l) => (
          <LessonCard key={l.id} lesson={l} busy={busy} onApprove={handleApprove} onDelete={setDeleteId} />
        ))}
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        title={t("mem.delete_title")}
        copy={t("mem.delete_copy")}
        tone="danger"
        confirmLabel={t("mem.delete")}
        onCancel={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />

      {formOpen && <MemoryForm onClose={() => setFormOpen(false)} onSaved={refresh} targetOptions={targetOptions} />}
    </div>
  );
}

function MemoryForm({ onClose, onSaved, targetOptions }: {
  onClose: () => void;
  onSaved: () => Promise<void>;
  targetOptions: string[];
}) {
  const { t } = useT();
  const [scope, setScope] = useState<"technique" | "target">("technique");
  const [targetKey, setTargetKey] = useState(targetOptions[0] ?? "");
  const [signal, setSignal] = useState<"success" | "deadend">("success");
  const [context, setContext] = useState("");
  const [lesson, setLesson] = useState("");
  const [tech, setTech] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!context.trim() || !lesson.trim()) return;
    if (scope === "target" && !targetKey.trim()) { setError(t("mem.need_target")); return; }
    setBusy(true);
    setError(null);
    const payload: LessonCreatePayload = {
      scope,
      target_key: scope === "target" ? targetKey.trim() : undefined,
      signal,
      context: context.trim(),
      lesson: lesson.trim(),
      tech: tech.split(",").map((x) => x.trim()).filter(Boolean),
    };
    try {
      await createMemoryLesson(payload);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mem.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="vw-scrim on" onClick={onClose} />
      <aside className="vw-drawer on" aria-hidden={false}>
        <div className="vw-drawer-head">
          <div style={{ flex: 1 }}><h2>{t("mem.add_title")}</h2></div>
          <button className="vw-icon-btn" type="button" onClick={onClose} aria-label={t("mem.close")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="vw-drawer-body">
          <div className="vw-d-sec">
            <h4>{t("mem.f_scope")}</h4>
            <div className="vw-toolbar" style={{ margin: 0 }}>
              <button type="button" className={`vw-chip ${scope === "technique" ? "on" : ""}`} onClick={() => setScope("technique")}>
                {t("mem.tab_global")}
              </button>
              <button type="button" className={`vw-chip ${scope === "target" ? "on" : ""}`} onClick={() => setScope("target")}>
                {t("mem.tab_target")}
              </button>
            </div>
          </div>
          {scope === "target" && (
            <div className="vw-d-sec">
              <h4>{t("mem.f_target")}</h4>
              <input className="vw-input" style={{ width: "100%" }} value={targetKey} onChange={(e) => setTargetKey(e.target.value)} list="mem-targets" placeholder="example.com" />
              <datalist id="mem-targets">{targetOptions.map((x) => <option key={x} value={x} />)}</datalist>
            </div>
          )}
          <div className="vw-d-sec">
            <h4>{t("mem.f_signal")}</h4>
            <div className="vw-toolbar" style={{ margin: 0 }}>
              <button type="button" className={`vw-chip ${signal === "success" ? "on" : ""}`} onClick={() => setSignal("success")}>
                {t("mem.signal_success")}
              </button>
              <button type="button" className={`vw-chip ${signal === "deadend" ? "on" : ""}`} onClick={() => setSignal("deadend")}>
                {t("mem.signal_deadend")}
              </button>
            </div>
          </div>
          <div className="vw-d-sec">
            <h4>{t("mem.f_context")}</h4>
            <textarea className="vw-input" style={{ width: "100%", minHeight: 80 }} value={context} onChange={(e) => setContext(e.target.value)} placeholder={t("mem.f_context_ph")} />
          </div>
          <div className="vw-d-sec">
            <h4>{t("mem.f_lesson")}</h4>
            <textarea className="vw-input" style={{ width: "100%", minHeight: 100 }} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder={t("mem.f_lesson_ph")} />
          </div>
          <div className="vw-d-sec">
            <h4>{t("mem.f_tech")}</h4>
            <input className="vw-input" style={{ width: "100%" }} value={tech} onChange={(e) => setTech(e.target.value)} placeholder={t("mem.f_tech_ph")} />
          </div>
          {error && <div className="vw-err">{error}</div>}
        </div>
        <div className="vw-drawer-foot">
          <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" disabled={busy || !context.trim() || !lesson.trim()} onClick={handleSave}>
            {busy ? t("mem.saving") : t("mem.save")}
          </button>
          <button className="vw-btn vw-btn-ghost vw-btn-sm" type="button" onClick={onClose}>{t("mem.cancel")}</button>
        </div>
      </aside>
    </>
  );
}
