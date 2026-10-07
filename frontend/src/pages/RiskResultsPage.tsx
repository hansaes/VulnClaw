import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { generateTargetReport, rejectFinding } from "../api/web";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useTargetsQuery } from "../hooks/queries";
import { useT, type TFunction } from "../i18n";
import type { TaskCommand, TaskOptions, TaskRecord, TargetView } from "../types/api";
import { formatFindingStatus, formatSeverityLabel } from "../utils/taskLabels";

interface RiskResultsPageProps {
  selectedTarget: string | null;
  onSelectTarget: (target: string | null) => void;
  onOpenHome: () => void;
  onOpenReports: (path?: string) => void;
  onCreateTask: (command: TaskCommand, target: string, resume: boolean, options: TaskOptions) => Promise<TaskRecord>;
  onVerifyDone: (task: TaskRecord) => void;
  onBulkVerifyDone: () => void;
}

interface Finding {
  id: string;
  title: string;
  severity: string;
  sevKey: "critical" | "high" | "medium" | "low" | "info";
  statusKey: "pending" | "verified" | "manual" | "ignored" | "false_positive";
  statusRaw: string;
  evidence: string;
  impact: string;
  recommendation: string;
  type: string;
  target: string;
  cve: string | null;
}

interface VulnGroup {
  target: string;
  findings: Finding[];
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeSeverity(value: unknown): { label: string; key: Finding["sevKey"] } {
  const text = asText(value, "Info").toLowerCase();
  if (text.includes("critical")) return { label: "Critical", key: "critical" };
  if (text.includes("high")) return { label: "High", key: "high" };
  if (text.includes("medium")) return { label: "Medium", key: "medium" };
  if (text.includes("low")) return { label: "Low", key: "low" };
  return { label: asText(value, "Info"), key: "info" };
}

function normalizeStatusKey(value: unknown): Finding["statusKey"] {
  const text = asText(value, "pending").toLowerCase();
  if (text.includes("verif")) return "verified";
  if (text.includes("false") || text.includes("reject")) return "false_positive";
  if (text.includes("dismiss")) return "ignored";
  if (text.includes("manual")) return "manual";
  return "pending";
}

function extractCve(title: string, evidence: string, type: string): string | null {
  const m = `${title} ${evidence} ${type}`.match(/CVE-\d{4}-\d{4,7}/i);
  return m ? m[0].toUpperCase() : null;
}

function extractEvidence(raw: Record<string, unknown>): string {
  const evidence = raw.evidence;
  if (typeof evidence === "string" && evidence.trim()) return evidence;
  if (Array.isArray(evidence) && evidence.length) return evidence.map(String).slice(0, 3).join(" / ");
  return asText(raw.description, "");
}

function extractFindings(target: TargetView, t: TFunction): Finding[] {
  const rawFindings = (target.raw as Record<string, unknown> | undefined)?.findings;
  if (!Array.isArray(rawFindings)) return [];
  return rawFindings.slice(0, 200).map((item, index) => {
    const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const sev = normalizeSeverity(raw.severity);
    const title = asText(raw.title, t("vuln.untitled", { index: String(index + 1) }));
    const evidence = extractEvidence(raw);
    const type = asText(raw.vuln_type, asText(raw.category, ""));
    return {
      id: asText(raw.finding_id, `${target.target}-${index}`),
      title,
      severity: sev.label,
      sevKey: sev.key,
      statusKey: normalizeStatusKey(raw.verification_status ?? raw.lifecycle_status ?? (raw.verified ? "verified" : "pending")),
      statusRaw: asText(raw.verification_status, asText(raw.lifecycle_status, "")),
      evidence,
      impact: asText(raw.impact, asText(raw.risk, "")),
      recommendation: asText(raw.recommendation, asText(raw.remediation, "")),
      type,
      target: target.target,
      cve: extractCve(title, evidence, type),
    };
  });
}

function downloadCsv(filename: string, rows: Finding[], t: TFunction) {
  void t;
  const head = ["id", "title", "severity", "status", "type", "target", "cve"];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const body = rows.map((f) => [f.id, f.title, f.severity, f.statusRaw || f.statusKey, f.type, f.target, f.cve ?? ""].map(esc).join(","));
  const csv = "\uFEFF" + [head.join(","), ...body].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const SEV_ORDER: Record<Finding["sevKey"], number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function RiskResultsPage({ selectedTarget, onSelectTarget, onOpenHome, onOpenReports, onCreateTask, onVerifyDone, onBulkVerifyDone }: RiskResultsPageProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const targetsQuery = useTargetsQuery();

  const [sevFilter, setSevFilter] = useState<string>("all");
  const [stFilter, setStFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // Groups start collapsed so the page stays scannable when several targets
  // have findings.  An explicit entry records any user toggle.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [drawer, setDrawer] = useState<Finding | null>(null);
  const [verifyList, setVerifyList] = useState<Finding[] | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [busyReport, setBusyReport] = useState(false);
  const [markingFalse, setMarkingFalse] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo<VulnGroup[]>(() => {
    const q = query.toLowerCase();
    const out: VulnGroup[] = [];
    for (const target of targetsQuery.data ?? []) {
      if (selectedTarget && target.target !== selectedTarget) continue;
      const findings = extractFindings(target, t)
        .filter((f) => {
          if (sevFilter !== "all" && f.sevKey !== sevFilter) return false;
          if (stFilter !== "all" && f.statusKey !== stFilter) return false;
          if (q && !`${f.title} ${f.id} ${f.type} ${f.cve ?? ""}`.toLowerCase().includes(q)) return false;
          return true;
        })
        .sort((a, b) => SEV_ORDER[a.sevKey] - SEV_ORDER[b.sevKey]);
      if (findings.length) out.push({ target: target.target, findings });
    }
    return out;
  }, [targetsQuery.data, selectedTarget, sevFilter, stFilter, query, t]);

  const allFindings = useMemo(() => groups.flatMap((g) => g.findings), [groups]);
  const totalCount = useMemo(
    () => (targetsQuery.data ?? []).reduce((n, x) => n + (x.findings_count ?? 0), 0),
    [targetsQuery.data],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of allFindings) {
      c.all++;
      c[f.sevKey] = (c[f.sevKey] ?? 0) + 1;
    }
    return c;
  }, [allFindings]);

  const checkedList = useMemo(() => allFindings.filter((f) => checked[f.id]), [allFindings, checked]);

  function toggleGroupAll(group: VulnGroup) {
    const allOn = group.findings.every((f) => checked[f.id]);
    setChecked((prev) => {
      const next = { ...prev };
      for (const f of group.findings) {
        if (allOn) delete next[f.id];
        else next[f.id] = true;
      }
      return next;
    });
  }

  function toggleGroup(target: string) {
    setCollapsed((prev) => ({ ...prev, [target]: !(prev[target] ?? true) }));
  }

  async function handleVerify(list: Finding[]) {
    if (!list.length || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      let last: TaskRecord | null = null;
      for (const f of list) {
        const options: TaskOptions = f.cve ? { cve: f.cve } : {};
        last = await onCreateTask("exploit", f.target, true, options);
      }
      setVerifyList(null);
      setChecked({});
      if (list.length === 1 && last) {
        setNotice(t("vuln.verify_created", { title: list[0].title }));
        onVerifyDone(last);
      } else {
        setNotice(t("vuln.bulk_verified", { count: String(list.length) }));
        onBulkVerifyDone();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("vuln.verify_failed"));
    } finally {
      setVerifying(false);
    }
  }

  async function handleGenerateReport(f: Finding) {
    setBusyReport(true);
    try {
      const res = await generateTargetReport(f.target, "markdown");
      setNotice(t("vuln.report_done"));
      onOpenReports(res.path);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t("vuln.report_failed"));
    } finally {
      setBusyReport(false);
    }
  }

  const sevChips = [
    { key: "all", label: t("vuln.sev_all"), count: counts.all },
    { key: "critical", label: t("vuln.sev_critical"), count: counts.critical ?? 0 },
    { key: "high", label: t("vuln.sev_high"), count: counts.high ?? 0 },
    { key: "medium", label: t("vuln.sev_medium"), count: counts.medium ?? 0 },
    { key: "low", label: t("vuln.sev_low"), count: counts.low ?? 0 },
  ];
  const stChips = [
    { key: "all", label: t("vuln.st_all") },
    { key: "pending", label: t("vuln.st_pending") },
    { key: "verified", label: t("vuln.st_verified") },
    { key: "manual", label: t("vuln.st_manual") },
    { key: "ignored", label: t("vuln.st_ignored") },
    { key: "false_positive", label: t("vuln.st_false") },
  ];
  const stBadge: Record<Finding["statusKey"], string> = {
    pending: "vw-st-open", verified: "vw-st-confirmed", manual: "vw-st-fixing", ignored: "vw-st-ignored", false_positive: "vw-st-false",
  };

  const verifyCves = (verifyList ?? []).map((f) => f.cve).filter(Boolean) as string[];

  async function handleMarkFalse(finding: Finding) {
    if (markingFalse) return;
    setMarkingFalse(finding.id);
    setError(null);
    try {
      await rejectFinding(finding.target, finding.id, t("vuln.false_positive_reason"));
      await queryClient.invalidateQueries({ queryKey: ["targets"] });
      setDrawer(null);
      setNotice(t("vuln.marked_false_positive"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("vuln.mark_false_failed"));
    } finally {
      setMarkingFalse(null);
    }
  }

  return (
    <div>
      <div className="vw-page-head">
        <div>
          <h1>{t("vuln.title")}</h1>
          <p>{t("vuln.subtitle_grouped", { groups: String(groups.length), count: String(allFindings.length) })}</p>
        </div>
        <button
          className="vw-btn vw-btn-ghost vw-btn-sm"
          type="button"
          disabled={!allFindings.length}
          onClick={() => downloadCsv(`vulns-${selectedTarget ?? "all"}.csv`, allFindings, t)}
        >
          {t("vuln.export")}
        </button>
      </div>

      {notice && <div className="vw-ok-box">{notice}</div>}
      {error && <div className="vw-err">{error}</div>}

      <div className="vw-toolbar">
        <select className="vw-input" value={selectedTarget ?? ""} onChange={(e) => onSelectTarget(e.target.value || null)}>
          <option value="">{t("vuln.all_targets")}</option>
          {(targetsQuery.data ?? []).map((x) => (
            <option key={x.target} value={x.target}>{x.target}</option>
          ))}
        </select>
        <input className="vw-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("vuln.search_ph")} />
      </div>
      <div className="vw-toolbar" style={{ marginTop: -6 }}>
        {sevChips.map((c) => (
          <button key={c.key} type="button" className={`vw-chip ${sevFilter === c.key ? "on" : ""}`} onClick={() => setSevFilter(c.key)}>
            {c.label}<b>{c.count}</b>
          </button>
        ))}
      </div>
      <div className="vw-toolbar" style={{ marginTop: -6 }}>
        {stChips.map((c) => (
          <button key={c.key} type="button" className={`vw-chip ${stFilter === c.key ? "on" : ""}`} onClick={() => setStFilter(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className={`vw-bulk-bar ${checkedList.length ? "on" : ""}`}>
        <span>{t("vuln.selected", { count: String(checkedList.length) })}</span>
        <button className="vw-btn vw-btn-primary vw-btn-xs" type="button" onClick={() => setVerifyList(checkedList)}>
          {t("vuln.verify_selected")}
        </button>
        <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" onClick={() => downloadCsv("vulns-selected.csv", checkedList, t)}>
          {t("vuln.export_selected")}
        </button>
        <button className="vw-btn vw-btn-ghost vw-btn-xs" style={{ marginLeft: "auto" }} type="button" onClick={() => setChecked({})}>
          {t("vuln.clear_sel")}
        </button>
      </div>

      {groups.map((group) => {
        const isCollapsed = collapsed[group.target] ?? true;
        const groupAllChecked = group.findings.every((f) => checked[f.id]);
        const crit = group.findings.filter((f) => f.sevKey === "critical" || f.sevKey === "high").length;
        return (
          <div className="vw-tbl-wrap" key={group.target} style={{ marginBottom: 16 }}>
            <div
              className="vw-group-head"
              onClick={() => toggleGroup(group.target)}
              role="button"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              onKeyDown={(e) => e.key === "Enter" && toggleGroup(group.target)}
            >
              <span onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox" className="vw-rowchk" checked={groupAllChecked}
                  onChange={toggleGroupAll.bind(null, group)}
                  aria-label={t("vuln.select_group", { target: group.target })}
                />
              </span>
              <span className="vw-group-target vw-mono">{group.target}</span>
              <span className="vw-badge vw-b-done">{t("vuln.findings_count", { count: String(group.findings.length) })}</span>
              {crit > 0 && <span className="vw-badge vw-b-fail">{t("vuln.high_risk", { count: String(crit) })}</span>}
              <span className="vw-group-chev">{isCollapsed ? "▶" : "▼"}</span>
            </div>
            {!isCollapsed && (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }} />
                    <th>{t("vuln.col_sev")}</th>
                    <th>{t("vuln.col_title")}</th>
                    <th>{t("vuln.col_type")}</th>
                    <th>{t("vuln.col_status")}</th>
                    <th style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {group.findings.map((f) => (
                    <tr key={f.id} className="vw-row" onClick={() => setDrawer(f)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox" className="vw-rowchk" checked={Boolean(checked[f.id])}
                          onChange={() => setChecked((p) => ({ ...p, [f.id]: !p[f.id] }))}
                          aria-label={f.title}
                        />
                      </td>
                      <td><span className={`vw-sev vw-sev-${f.sevKey}`}>{formatSeverityLabel(f.severity)}</span></td>
                      <td>
                        <div className="vw-t-title">{f.title}</div>
                        <div className="vw-t-sub">{f.cve ?? f.id}</div>
                      </td>
                      <td style={{ color: "var(--muted)" }}>{f.type || "—"}</td>
                      <td><span className={`vw-st ${stBadge[f.statusKey]}`}>{formatFindingStatus(f.statusRaw || f.statusKey)}</span></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {f.statusKey !== "false_positive" && (
                          <button
                            className="vw-btn vw-btn-ghost vw-btn-xs" type="button"
                            onClick={(e) => { e.stopPropagation(); setVerifyList([f]); }}
                          >
                            {t("vuln.verify")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {!targetsQuery.isLoading && groups.length === 0 && (
        <div className="vw-tbl-wrap">
          <div className="vw-empty">
            {totalCount === 0 ? t("vuln.empty") : t("vuln.no_match")}
            {totalCount === 0 && (
              <div style={{ marginTop: 12 }}>
                <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" onClick={onOpenHome}>{t("vuln.new_task")}</button>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={verifyList !== null}
        title={t("vuln.verify_title")}
        copy={
          verifyList && verifyList.length === 1
            ? t("vuln.verify_copy_one", { title: verifyList[0].title, target: verifyList[0].target, cve: verifyList[0].cve ?? t("vuln.no_cve") })
            : t("vuln.verify_copy_many", { count: String(verifyList?.length ?? 0), cves: verifyCves.length ? verifyCves.join(", ") : t("vuln.no_cve") })
        }
        tone="primary"
        confirmLabel={verifying ? t("vuln.verifying") : t("vuln.verify_launch")}
        onCancel={() => { if (!verifying) setVerifyList(null); }}
        onConfirm={() => { if (verifyList) void handleVerify(verifyList); }}
      />

      <div className={`vw-scrim ${drawer ? "on" : ""}`} onClick={() => setDrawer(null)} />
      <aside className={`vw-drawer ${drawer ? "on" : ""}`} aria-hidden={!drawer}>
        {drawer && (
          <>
            <div className="vw-drawer-head">
              <div style={{ flex: 1 }}>
                <h2>{drawer.title}</h2>
                <div className="meta">
                  <span className={`vw-sev vw-sev-${drawer.sevKey}`}>{formatSeverityLabel(drawer.severity)}</span>
                  <span className="vw-mono" style={{ fontSize: 12.5, color: "var(--muted)" }}>{drawer.cve ?? drawer.id}</span>
                  <span className={`vw-st ${stBadge[drawer.statusKey]}`}>{formatFindingStatus(drawer.statusRaw || drawer.statusKey)}</span>
                </div>
              </div>
              <button className="vw-icon-btn" type="button" onClick={() => setDrawer(null)} aria-label={t("vuln.close")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="vw-drawer-body">
              <div className="vw-d-sec">
                <h4>{t("vuln.d_info")}</h4>
                <div className="vw-kv"><span className="k">{t("vuln.d_target")}</span><span className="v vw-mono">{drawer.target}</span></div>
                <div className="vw-kv"><span className="k">{t("vuln.d_type")}</span><span className="v">{drawer.type || "—"}</span></div>
                {drawer.cve && <div className="vw-kv"><span className="k">CVE</span><span className="v vw-mono">{drawer.cve}</span></div>}
              </div>
              {drawer.evidence && (
                <div className="vw-d-sec">
                  <h4>{t("vuln.d_evidence")}</h4>
                  <div className="vw-code">{drawer.evidence}</div>
                </div>
              )}
              {drawer.impact && (
                <div className="vw-d-sec">
                  <h4>{t("vuln.d_impact")}</h4>
                  <p>{drawer.impact}</p>
                </div>
              )}
              {drawer.recommendation && (
                <div className="vw-d-sec">
                  <h4>{t("vuln.d_fix")}</h4>
                  <p>{drawer.recommendation}</p>
                </div>
              )}
            </div>
            <div className="vw-drawer-foot">
              {drawer.statusKey !== "false_positive" && (
                <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" onClick={() => { setDrawer(null); setVerifyList([drawer]); }}>
                  {t("vuln.verify")}
                </button>
              )}
              {drawer.statusKey !== "ignored" && drawer.statusKey !== "false_positive" && (
                <button
                  className="vw-btn vw-btn-ghost vw-btn-sm"
                  type="button"
                  disabled={markingFalse === drawer.id}
                  onClick={() => void handleMarkFalse(drawer)}
                >
                  {markingFalse === drawer.id ? t("vuln.marking_false") : t("vuln.mark_false")}
                </button>
              )}
              <button className="vw-btn vw-btn-ghost vw-btn-sm" type="button" disabled={busyReport} onClick={() => handleGenerateReport(drawer)}>
                {busyReport ? t("vuln.reporting") : t("vuln.gen_report")}
              </button>
              <button className="vw-btn vw-btn-ghost vw-btn-sm" type="button" onClick={() => downloadCsv(`vuln-${drawer.id}.csv`, [drawer], t)}>
                {t("vuln.export_one")}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
