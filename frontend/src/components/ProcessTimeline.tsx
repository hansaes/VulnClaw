import { useT } from "../i18n";
import type { TimelineItem } from "../pages/TaskConsolePage";

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString();
}

function Preview({ text, expanded, onToggle, max = 160 }: {
  text: string; expanded: boolean; onToggle: () => void; max?: number;
}) {
  const { t } = useT();
  if (!text) return null;
  const long = text.length > max;
  return (
    <div className="vw-tl-body">
      <pre className={`vw-tl-pre ${expanded ? "full" : ""}`}>
        {long && !expanded ? text.slice(0, max) + "…" : text}
      </pre>
      {long && (
        <button type="button" className="vw-tl-toggle" onClick={onToggle}>
          {expanded ? t("detail.collapse") : t("detail.expand")}
        </button>
      )}
    </div>
  );
}

export function ProcessTimeline({ items, expandedRows, onToggle }: {
  items: TimelineItem[];
  expandedRows: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const { t } = useT();
  return (
    <div className="vw-timeline">
      {items.map((item) => {
        const expanded = Boolean(expandedRows[item.key]);
        const toggle = () => onToggle(item.key);
        if (item.kind === "step") {
          return (
            <div className="vw-tl-step" key={item.key}>
              <div className="vw-tl-head">
                <span className="vw-tl-ico">🧠</span>
                <strong>{t("detail.step_n", { n: String(item.step ?? "–") })}</strong>
                <span className="vw-tl-ts">{fmtTime(item.timestamp)}</span>
              </div>
              {item.reason && <p className="vw-tl-reason">{item.reason}</p>}
              {item.tools.length > 0 && (
                <div className="vw-tl-tools">
                  {item.tools.map((tool) => (
                    <span className="vw-tl-chip" key={tool}>🔧 {tool}</span>
                  ))}
                </div>
              )}
              {item.evidence && (
                <div className="vw-tl-evidence">
                  <span className="vw-tl-ev-label">{t("detail.tl_evidence")}</span>
                  <span>{item.evidence}</span>
                </div>
              )}
            </div>
          );
        }
        if (item.kind === "tool") {
          return (
            <div className="vw-tl-item" key={item.key}>
              <div className="vw-tl-row" onClick={item.args ? toggle : undefined} style={item.args ? { cursor: "pointer" } : undefined}>
                <span className="vw-tl-ico">🔧</span>
                <code className="vw-tl-tool-name">{item.tool || t("detail.tl_tool")}</code>
                <span className="vw-tl-ts">{fmtTime(item.timestamp)}</span>
                {item.args && <span className="vw-tl-toggle">{expanded ? t("detail.collapse") : t("detail.expand")}</span>}
              </div>
              <Preview text={item.args} expanded={expanded} onToggle={toggle} max={200} />
            </div>
          );
        }
        if (item.kind === "result") {
          return (
            <div className="vw-tl-item vw-tl-result" key={item.key}>
              <div className="vw-tl-row" onClick={toggle} style={{ cursor: "pointer" }}>
                <span className="vw-tl-ico">📥</span>
                <span className="vw-tl-muted">{t("detail.tl_result")}</span>
                <span className="vw-tl-ts">{fmtTime(item.timestamp)}</span>
                <span className="vw-tl-toggle">{expanded ? t("detail.collapse") : t("detail.expand")}</span>
              </div>
              <Preview text={item.result} expanded={expanded} onToggle={toggle} max={200} />
            </div>
          );
        }
        return (
          <div className="vw-tl-status" key={item.key}>
            <span className={`vw-tl-dot ${item.tone}`} />
            <span className="vw-tl-ts">{fmtTime(item.timestamp)}</span>
            <span>{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}
