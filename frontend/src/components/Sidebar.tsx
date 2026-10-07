import { useT } from "../i18n";

export type NavIconKey =
  | "dashboard" | "plus" | "tasks" | "shield" | "reports" | "scope" | "settings" | "box";

export interface NavItem<T extends string> {
  key: T;
  label: string;
  description: string;
  icon: NavIconKey;
  badge?: number;
}

interface SidebarProps<T extends string> {
  activeView: T;
  nav: NavItem<T>[];
  onSelectView: (view: T) => void;
}

function Icon({ name }: { name: NavIconKey }) {
  const p = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 } as const;
  switch (name) {
    case "dashboard":
      return (<svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>);
    case "plus":
      return (<svg {...p} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></svg>);
    case "tasks":
      return (<svg {...p}><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></svg>);
    case "shield":
      return (<svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>);
    case "reports":
      return (<svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg>);
    case "scope":
      return (<svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>);
    case "box":
      return (<svg {...p}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /></svg>);
    case "settings":
    default:
      return (<svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></svg>);
  }
}

export function Sidebar<T extends string>({ activeView, nav, onSelectView }: SidebarProps<T>) {
  const { t } = useT();
  const ops = nav.filter((n) => !["settings"].includes(n.key as string));
  const manage = nav.filter((n) => ["settings"].includes(n.key as string));

  const renderItem = (item: NavItem<T>) => (
    <button
      key={item.key}
      type="button"
      className={`vw-nav-item ${activeView === item.key ? "active" : ""}`}
      onClick={() => onSelectView(item.key)}
      title={item.description || item.label}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {typeof item.badge === "number" && item.badge > 0 && (
        <span className="vw-nav-badge">{item.badge > 99 ? "99+" : item.badge}</span>
      )}
    </button>
  );

  return (
    <aside className="vw-side" id="vw-sidebar">
      <div className="vw-brand">
        <div className="vw-brand-mark">V</div>
        <div className="vw-brand-name">{t("brand.name")}<small>SECURITY CONSOLE</small></div>
      </div>

      <div className="vw-nav-sec">{t("nav.section_ops")}</div>
      {ops.map(renderItem)}
      {manage.length > 0 && (
        <>
          <div className="vw-nav-sec">{t("nav.section_manage")}</div>
          {manage.map(renderItem)}
        </>
      )}

      <div className="vw-side-foot">
        <div className="vw-user">
          <div className="vw-avatar">{t("nav.user_initial")}</div>
          <div>
            <div className="nm">{t("nav.user_name")}</div>
            <div className="rl">{t("nav.user_role")}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
