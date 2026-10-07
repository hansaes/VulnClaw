import { useEffect, useMemo, useState } from "react";
import { generateTargetReport } from "../api/web";
import { useTargetQuery, useTargetsQuery } from "../hooks/queries";
import { useT, type TFunction } from "../i18n";
import type { TargetView } from "../types/api";
import { formatFindingStatus, formatSeverityLabel } from "../utils/taskLabels";

interface RiskResultsPageProps {
  selectedTarget: string | null;
  onSelectTarget: (target: string | null) => void;
  onOpenHome: () => void;
  onOpenReports: (path?: string) => void;
}

interface Finding {
  id: string;
  title: string;
  severity: string;
  sevKey: "critical" | "high" | "medium" | "low" | "info";
  status: string;
  statusKey: "pending" | "verified" | "manual" | "ignored";
  evidence: string;
  impact: string;
  recommendation: string;
  type: string;
  target: string;
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

function normalizeStatus(value: unknown): { raw: string; key: Finding["statusKey"] } {
  const text = asText(value, "pending").toLowerCase();
  if (text.includes("verif")) return { raw: text, key: "verified" };
  if (text.includes("dismiss") || text.includes("false")) return { raw: text, key: "ignored" };
  if (text.includes("manual")) return { raw: text, key: "manual" };
  return { raw: text, key: "pending" };
}

function extractEvidence(raw: Record<string, unknown>): string {
  const evidence = raw.evidence;
  if (typeof evidence === "string" && evidence.trim()) return evidence;
  if (Array.isArray(evidence) && evidence.length) return evidence.map(String).slice(0, 3).join(" / ");
  return asText(raw.description, "");
}

function extractFindings(target: TargetView | undefined | null, t: TFunction): Finding[] {
  const rawFindings = (target?.raw as Record<string, unknown> | undefined)?.findings;
  if (!Array.isArray(rawFindings) || !target) return [];
  return rawFindings.slice(0, 200).map((item, index) => {
    const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const sev = normalizeSeverity(raw.severity);
    const st = normalizeStatus(raw.verification_status ?? raw.lifecycle_status ?? (raw.verified ? "verified" : "pending"));
    return {
      id: asText(raw.finding_id, `${target.target}-${index}`),
      title: asText(raw.title, t("vuln.untitled", { index: String(index + 1) })),
      severity: sev.label,
      sevKey: sev.key,
      status: asText(raw.verification_status, asText(raw.lifecycle_status, "")),
      statusKey: st.key,
      evidence: extractEvidence(raw),
      impact: asText(raw.impact, asText(raw.risk, "")),
      recommendation: asText(raw.recommendation, asText(raw.remediation, "")),
      type: asText(raw.vuln_type, asText(raw.category, "")),
      target: target.target,
    };
  });
}

function downloadCsv(filename: string, rows: Finding[], t: TFunction) {
  const head = ["id", "title", "severity", "status", "type", "target"];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const body = rows.map((f) => [f.id, f.title, f.severity, formatFindingStatus(f.status), f.type, f.target].map(esc).join(","));
  const csv = "\uFEFF" + [head.join(","), ...body].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const SEV_ORDER: Record<Finding["sevKey"], number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function RiskResultsPage({ selectedTarget, onSelectTarget, onOpenHome, onOpenReports }: RiskResultsPageProps) {
  const { t } = useT();
  const targetsQuery = useTargetsQuery();
  const targetQuery = useTargetQuery(selectedTarget);

  const [sevFilter, setSevFilter] = useState<string>("all");
  const [stFilter, setStFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [drawer, setDrawer] = useState<Finding | null>(null);
  const [busyReport, setBusyReport] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTarget && targetsQuery.data?.length) {
      onSelectTarget(targetsQuery.data[0].target);
    }
  }, [selectedTarget, targetsQuery.data, onSelectTarget]);

  useEffect(() => {
    setChecked({});
    setDrawer(null);
  }, [selectedTarget]);

  const findings = useMemo(
    () => extractFindings(targetQuery.data, t).sort((a, b) => SEV_ORDER[a.sevKey] - SEV_ORDER[b.sevKey]),
    [targetQuery.data, t],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: findings.length, critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of findings) c[f.sevKey] = (c[f.sevKey] ?? 0) + 1;
    return c;
  }, [findings]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return findings.filter((f) => {
      if (sevFilter !== "all" && f.sevKey !== sevFilter) return false;
      if (stFilter !== "all" && f.statusKey !== stFilter) return false;
      if (q && !`${f.title} ${f.id} ${f.type}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [findings, sevFilter, stFilter, query]);

  const checkedList = useMemo(() => filtered.filter((f) => checked[f.id]), [filtered, checked]);
  const allChecked = filtered.length > 0 && filtered.every((f) => checked[f.id]);

  function toggleAll() {
    if (allChecked) setChecked({});
    else {
      const next: Record<string, boolean> = {};
      filtered.forEach((f) => { next[f.id] = true; });
      setChecked(next);
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
  ];
  const stBadge: Record<Finding["statusKey"], string> = {
    pending: "vw-st-open", verified: "vw-st-confirmed", manual: "vw-st-fixing", ignored: "vw-st-ignored",
  };

  return (
    <div>
      <div className="vw-page-head">
        <div>
          <h1>{t("vuln.title")}</h1>
          <p>{t("vuln.subtitle", { count: String(findings.length) })}</p>
        </div>
        <button
          className="vw-btn vw-btn-ghost vw-btn-sm"
          type="button"
          disabled={!filtered.length}
          onClick={() => downloadCsv(`vulns-${selectedTarget ?? "all"}.csv`, filtered, t)}
        >
          {t("vuln.export")}
        </button>
      </div>

      {notice && <div className="vw-ok-box">{notice}</div>}

      <div className="vw-toolbar">
        <select className="vw-input" value={selectedTarget ?? ""} onChange={(e) => onSelectTarget(e.target.value || null)}>
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
        <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" onClick={() => downloadCsv("vulns-selected.csv", checkedList, t)}>
          {t("vuln.export_selected")}
        </button>
        <button className="vw-btn vw-btn-ghost vw-btn-xs" style={{ marginLeft: "auto" }} type="button" onClick={() => setChecked({})}>
          {t("vuln.clear_sel")}
        </button>
      </div>

      <div className="vw-tbl-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" className="vw-rowchk" checked={allChecked} onChange={toggleAll} aria-label={t("vuln.select_all")} /></th>
              <th>{t("vuln.col_sev")}</th>
              <th>{t("vuln.col_title")}</th>
              <th>{t("vuln.col_type")}</th>
              <th>{t("vuln.col_status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
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
                  <div className="vw-t-sub">{f.id}</div>
                </td>
                <td style={{ color: "var(--muted)" }}>{f.type || "—"}</td>
                <td><span className={`vw-st ${stBadge[f.statusKey]}`}>{formatFindingStatus(f.statusKey === "pending" && !f.status ? "pending" : f.status || f.statusKey)}</span></td>
                <td><button className="vw-btn vw-btn-ghost vw-btn-xs" type="button">{t("vuln.detail")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!targetQuery.isLoading && filtered.length === 0 && (
          <div className="vw-empty">
            {findings.length === 0 ? t("vuln.empty") : t("vuln.no_match")}
            {findings.length === 0 && (
              <div style={{ marginTop: 12 }}>
                <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" onClick={onOpenHome}>{t("vuln.new_task")}</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={`vw-scrim ${drawer ? "on" : ""}`} onClick={() => setDrawer(null)} />
      <aside className={`vw-drawer ${drawer ? "on" : ""}`} aria-hidden={!drawer}>
        {drawer && (
          <>
            <div className="vw-drawer-head">
              <div style={{ flex: 1 }}>
                <h2>{drawer.title}</h2>
                <div className="meta">
                  <span className={`vw-sev vw-sev-${drawer.sevKey}`}>{formatSeverityLabel(drawer.severity)}</span>
                  <span className="vw-mono" style={{ fontSize: 12.5, color: "var(--muted)" }}>{drawer.id}</span>
                  <span className={`vw-st ${stBadge[drawer.statusKey]}`}>{formatFindingStatus(drawer.status || drawer.statusKey)}</span>
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
              <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" disabled={busyReport} onClick={() => handleGenerateReport(drawer)}>
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
