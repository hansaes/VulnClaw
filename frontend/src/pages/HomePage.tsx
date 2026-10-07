import { useMemo, useState } from "react";
import type { TaskCommand, TaskOptions, TaskRecord } from "../types/api";
import { useT, type TFunction } from "../i18n";
import { loadUiPreferences } from "../utils/preferences";
import { formatActionList, formatTaskCommand } from "../utils/taskLabels";
import { parseOptionalPort } from "../utils/validation";

type CheckMode = "quick" | "standard" | "deep" | "continuous";

interface HomePageProps {
  initialTarget?: string | null;
  onCreateTask: (command: TaskCommand, target: string, resume: boolean, options: TaskOptions) => Promise<TaskRecord>;
  onDone: () => void;
}

interface ModeDef {
  key: CheckMode;
  title: string;
  copy: string;
  time: string;
  command: TaskCommand;
  allowActions?: string[];
  blockActions?: string[];
}

function buildModes(t: TFunction): ModeDef[] {
  return [
    { key: "quick", title: t("home.mode_quick"), copy: t("home.mode_quick_copy"), time: t("wiz.time_quick"), command: "recon", allowActions: ["recon"], blockActions: ["exploit", "persistent"] },
    { key: "standard", title: t("home.mode_standard"), copy: t("home.mode_standard_copy"), time: t("wiz.time_standard"), command: "run", allowActions: ["recon", "scan"], blockActions: ["post_exploitation"] },
    { key: "deep", title: t("home.mode_deep"), copy: t("home.mode_deep_copy"), time: t("wiz.time_deep"), command: "run", allowActions: ["recon", "scan", "exploit"] },
    { key: "continuous", title: t("home.mode_loop"), copy: t("home.mode_loop_copy"), time: t("wiz.time_continuous"), command: "persistent", allowActions: ["recon", "scan", "persistent"], blockActions: ["post_exploitation"] },
  ];
}

function uniqueActions(actions: Array<string | undefined>): string[] {
  return Array.from(new Set(actions.filter((action): action is string => Boolean(action))));
}

export function HomePage({ initialTarget, onCreateTask, onDone }: HomePageProps) {
  const { t } = useT();
  const preferences = loadUiPreferences();
  const MODES = useMemo(() => buildModes(t), [t]);

  const [step, setStep] = useState(1);
  const [targetsText, setTargetsText] = useState(initialTarget ?? "");
  const [mode, setMode] = useState<CheckMode>(() => preferences.defaultCheckMode);
  const [resume, setResume] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [onlyPort, setOnlyPort] = useState(preferences.defaultBoundary.onlyPort);
  const [onlyHost, setOnlyHost] = useState(preferences.defaultBoundary.onlyHost);
  const [onlyPath, setOnlyPath] = useState(preferences.defaultBoundary.onlyPath);
  const [blockedHost, setBlockedHost] = useState(preferences.defaultBoundary.blockedHost);
  const [blockedPath, setBlockedPath] = useState(preferences.defaultBoundary.blockedPath);
  const [cve, setCve] = useState("");
  const [maxRounds, setMaxRounds] = useState<number | "">("");
  const [authed, setAuthed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState(0);

  const targets = useMemo(
    () => targetsText.split("\n").map((x) => x.trim()).filter(Boolean),
    [targetsText],
  );
  const selectedMode = useMemo(() => MODES.find((m) => m.key === mode) ?? MODES[1], [MODES, mode]);
  const effectiveAllow = uniqueActions([...selectedMode.allowActions ?? [], selectedMode.command]);
  const effectiveBlock = uniqueActions(selectedMode.blockActions ?? []).filter((a) => a !== selectedMode.command);

  function buildOptions(): TaskOptions {
    return {
      max_rounds: maxRounds === "" ? undefined : maxRounds,
      only_port: parseOptionalPort(onlyPort),
      only_host: onlyHost.trim() || undefined,
      only_path: onlyPath.trim() || undefined,
      blocked_host: blockedHost.trim() || undefined,
      blocked_path: blockedPath.trim() || undefined,
      cve: cve.trim() || undefined,
      allow_actions: effectiveAllow,
      block_actions: effectiveBlock,
    };
  }

  async function handleLaunch() {
    if (!targets.length || !authed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const options = buildOptions();
      let n = 0;
      for (const target of targets) {
        await onCreateTask(selectedMode.command, target, resume, options);
        n++;
      }
      setCreatedCount(n);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.failed_to_start"));
    } finally {
      setSubmitting(false);
    }
  }

  const canNext1 = targets.length > 0;

  return (
    <div>
      <div className="vw-page-head">
        <div>
          <h1>{t("wiz.title")}</h1>
          <p>{t("wiz.subtitle")}</p>
        </div>
      </div>

      <div className="vw-card" style={{ maxWidth: 860 }}>
        <div className="vw-steps">
          {[1, 2, 3].map((i) => (
            <span key={i} style={{ display: "contents" }}>
              <div className={`vw-step ${step === i ? "cur" : ""} ${step > i ? "done" : ""}`}>
                <span className="n">
                  {step > i ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M20 6L9 17l-5-5" /></svg>
                  ) : i}
                </span>
                {t(`wiz.step${i}`)}
              </div>
              {i < 3 && <div className="vw-step-line" />}
            </span>
          ))}
        </div>

        {step === 1 && (
          <div>
            <label className="vw-flabel" htmlFor="wiz-targets">{t("wiz.targets_label")}</label>
            <textarea
              id="wiz-targets"
              className="vw-input vw-mono"
              rows={4}
              value={targetsText}
              onChange={(e) => setTargetsText(e.target.value)}
              placeholder={"mall-prod.example.com\napi.pay.example.com\n192.168.10.0/24"}
            />
            <div className="sub" style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
              {targets.length > 0
                ? t("wiz.targets_count", { count: String(targets.length) })
                : t("wiz.targets_hint")}
            </div>
            <label className="vw-check" style={{ marginTop: 16 }}>
              <input type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} />
              <span>{t("wiz.resume")}</span>
            </label>
          </div>
        )}

        {step === 2 && (
          <div>
            <label className="vw-flabel">{t("wiz.strategy_label")}</label>
            <div className="vw-opt-cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`vw-opt ${mode === m.key ? "sel" : ""}`}
                  onClick={() => setMode(m.key)}
                >
                  <h4>{m.title}</h4>
                  <p>{m.copy}</p>
                  <div className="tm">{m.time} · {formatTaskCommand(m.command)}</div>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="vw-btn vw-btn-ghost vw-btn-sm"
              style={{ marginTop: 16 }}
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              {advancedOpen ? t("wiz.advanced_hide") : t("wiz.advanced_show")}
            </button>
            {advancedOpen && (
              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="vw-flabel">{t("wiz.only_host")}</label>
                  <input className="vw-input vw-mono" value={onlyHost} onChange={(e) => setOnlyHost(e.target.value)} placeholder="example.com" />
                </div>
                <div>
                  <label className="vw-flabel">{t("wiz.only_port")}</label>
                  <input className="vw-input vw-mono" value={onlyPort} onChange={(e) => setOnlyPort(e.target.value)} placeholder="443" inputMode="numeric" />
                </div>
                <div>
                  <label className="vw-flabel">{t("wiz.only_path")}</label>
                  <input className="vw-input vw-mono" value={onlyPath} onChange={(e) => setOnlyPath(e.target.value)} placeholder="/admin" />
                </div>
                <div>
                  <label className="vw-flabel">{t("wiz.cve")}</label>
                  <input className="vw-input vw-mono" value={cve} onChange={(e) => setCve(e.target.value)} placeholder="CVE-2024-xxxx" />
                </div>
                <div>
                  <label className="vw-flabel">{t("wiz.block_host")}</label>
                  <input className="vw-input vw-mono" value={blockedHost} onChange={(e) => setBlockedHost(e.target.value)} />
                </div>
                <div>
                  <label className="vw-flabel">{t("wiz.max_rounds")}</label>
                  <input className="vw-input vw-mono" type="number" value={maxRounds} onChange={(e) => setMaxRounds(e.target.value ? Number(e.target.value) : "")} placeholder={t("wiz.backend_default")} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label className="vw-flabel">{t("wiz.block_path")}</label>
                  <input className="vw-input vw-mono" value={blockedPath} onChange={(e) => setBlockedPath(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <table className="vw-sum-tbl">
              <tbody>
                <tr><td>{t("wiz.sum_targets")}</td><td className="vw-mono">{targets.length > 1 ? `${targets[0]} ${t("wiz.sum_etc", { count: String(targets.length) })}` : targets[0] ?? "—"}</td></tr>
                <tr><td>{t("wiz.sum_mode")}</td><td>{selectedMode.title} ({formatTaskCommand(selectedMode.command)})</td></tr>
                <tr><td>{t("wiz.sum_time")}</td><td className="vw-mono">{selectedMode.time}</td></tr>
                <tr><td>{t("wiz.sum_allow")}</td><td>{formatActionList(effectiveAllow)}</td></tr>
                {effectiveBlock.length > 0 && <tr><td>{t("wiz.sum_block")}</td><td>{formatActionList(effectiveBlock)}</td></tr>}
                <tr><td>{t("wiz.sum_resume")}</td><td>{resume ? t("wiz.yes") : t("wiz.no")}</td></tr>
              </tbody>
            </table>
            <label className="vw-check" style={{ marginTop: 18 }}>
              <input type="checkbox" checked={authed} onChange={(e) => setAuthed(e.target.checked)} />
              <span>{t("wiz.auth_confirm")}</span>
            </label>
            {error && <div className="vw-err" style={{ marginTop: 14 }}>{error}</div>}
            {createdCount > 0 && <div className="vw-ok-box" style={{ marginTop: 14 }}>{t("wiz.created", { count: String(createdCount) })}</div>}
          </div>
        )}

        <div className="vw-modal-foot" style={{ padding: "18px 0 0", borderTop: "none" }}>
          <button
            type="button"
            className="vw-btn vw-btn-ghost vw-btn-sm"
            style={{ visibility: step === 1 ? "hidden" : "visible" }}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            {t("wiz.prev")}
          </button>
          {step < 3 ? (
            <button
              type="button"
              className="vw-btn vw-btn-primary vw-btn-sm"
              disabled={step === 1 && !canNext1}
              onClick={() => setStep((s) => Math.min(3, s + 1))}
            >
              {t("wiz.next")}
            </button>
          ) : (
            <button
              type="button"
              className="vw-btn vw-btn-primary vw-btn-sm"
              disabled={!authed || !targets.length || submitting}
              onClick={handleLaunch}
            >
              {submitting ? t("wiz.launching") : t("wiz.launch", { count: String(targets.length) })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
