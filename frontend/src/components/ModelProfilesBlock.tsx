import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "../i18n";
import { useProvidersQuery } from "../hooks/queries";
import { previewProviderModels } from "../api/web";

type ModelRole = "thinking" | "execution" | "both";

interface ModelProfile {
  id: string;
  label: string;
  provider: string;
  model: string;
  base_url: string;
  api_key_configured: boolean;
  role: ModelRole;
}

interface ProfilesResponse {
  profiles: ModelProfile[];
  active_id: string;
  dual_model_enabled: boolean;
  thinking_id: string;
  thinking_configured: boolean;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json() as { detail?: string }).detail ?? ""; } catch { /* ignore */ }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const AVATAR_COLORS = ["#7c6cf0", "#2f9e6e", "#d97706", "#0ea5e9", "#e05299", "#64748b"];

function avatarColor(provider: string): string {
  let h = 0;
  for (const c of provider) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function ModelProfilesBlock({ onChanged }: { onChanged: () => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ModelProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ["model-profiles"],
    queryFn: () => req<ProfilesResponse>("/api/model-profiles"),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["model-profiles"] });
    onChanged();
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("models.failed"));
    } finally {
      setBusy(false);
    }
  }

  const handleRole = (id: string, role: ModelRole) =>
    run(() => req(`/api/model-profiles/${encodeURIComponent(id)}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }));

  const handleActivate = (id: string) =>
    run(() => req(`/api/model-profiles/${encodeURIComponent(id)}/activate`, { method: "POST" }));

  const handleDelete = (id: string) => {
    if (!window.confirm(t("models.delete_confirm"))) return;
    void run(() => req(`/api/model-profiles/${encodeURIComponent(id)}`, { method: "DELETE" }));
  };

  const handleDualToggle = (enabled: boolean) =>
    run(() => req("/api/model-profiles/dual-model", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }));

  const data = profilesQuery.data;
  const profiles = data?.profiles ?? [];
  const thinkingProfile = profiles.find((p) => p.role === "thinking") ?? null;
  const executionProfile = profiles.find((p) => p.id === data?.active_id) ?? null;

  return (
    <div className="vw-models-block">
      <div className="vw-models-head">
        <div>
          <h3>{t("models.title")}</h3>
          <p>{t("models.subtitle")}</p>
        </div>
        <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" onClick={() => { setEditing(null); setFormOpen(true); }}>
          {t("models.add")}
        </button>
      </div>

      {error && <div className="vw-err">{error}</div>}

      {/* 双模型模式横幅 */}
      <div className={`vw-dual-banner ${data?.dual_model_enabled ? "on" : ""}`}>
        <div className="vw-dual-main">
          <div className="vw-dual-title-row">
            <span className="vw-dual-icon">🧠⚡</span>
            <strong>{t("models.dual_title")}</strong>
            <button
              type="button"
              role="switch"
              aria-checked={!!data?.dual_model_enabled}
              className={`vw-switch ${data?.dual_model_enabled ? "on" : ""}`}
              disabled={busy || profilesQuery.isLoading}
              onClick={() => handleDualToggle(!data?.dual_model_enabled)}
            >
              <span className="vw-switch-knob" />
            </button>
          </div>
          <p className="vw-dual-sub">{t("models.dual_subtitle")}</p>
          <div className="vw-dual-slots">
            <div className="vw-dual-slot thinking">
              <span className="vw-dual-slot-label">🧠 {t("models.thinking")}</span>
              <span className="vw-dual-slot-value vw-mono">
                {thinkingProfile ? (thinkingProfile.label || thinkingProfile.model) : t("models.not_set")}
              </span>
            </div>
            <div className="vw-dual-slot execution">
              <span className="vw-dual-slot-label">⚡ {t("models.execution")}</span>
              <span className="vw-dual-slot-value vw-mono">
                {executionProfile ? (executionProfile.label || executionProfile.model) : t("models.not_set")}
              </span>
            </div>
          </div>
          <p className="vw-dual-hint">{t("models.dual_hint")}</p>
        </div>
      </div>

      {profilesQuery.isLoading && <p style={{ color: "var(--muted)" }}>{t("models.loading")}</p>}
      {data && profiles.length === 0 && (
        <p style={{ color: "var(--muted)" }}>{t("models.empty")}</p>
      )}

      <div className="vw-models-grid">
        {profiles.map((p) => {
          const active = data?.active_id === p.id;
          const isThinking = p.role === "thinking";
          return (
            <div key={p.id} className={`vw-model-card2 ${active ? "active" : ""}`}>
              <div className="vw-model-top">
                <span className="vw-avatar" style={{ background: avatarColor(p.provider || p.model) }}>
                  {(p.provider || p.model || "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="vw-model-title">
                  <strong>{p.label || p.model}</strong>
                  <div className="vw-model-badges">
                    {active && <span className="vw-badge vw-b-run">{t("models.active")}</span>}
                    {isThinking && <span className="vw-badge vw-b-think">🧠 {t("models.thinking")}</span>}
                    {p.role === "execution" && <span className="vw-badge vw-b-exec">⚡ {t("models.execution")}</span>}
                    <span className={`vw-keydot ${p.api_key_configured ? "ok" : ""}`} title={p.api_key_configured ? t("models.key_ok") : t("models.key_missing")} />
                  </div>
                </div>
              </div>
              <div className="vw-model-meta vw-mono">{p.provider} · {p.model}</div>
              {p.base_url && <div className="vw-model-meta vw-mono vw-muted-ellipsis">{p.base_url}</div>}
              <div className="vw-model-actions2">
                {!isThinking && (
                  <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" disabled={busy} onClick={() => handleRole(p.id, "thinking")}>
                    {t("models.role_thinking")}
                  </button>
                )}
                {!active && (
                  <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" disabled={busy} onClick={() => handleRole(p.id, "execution")}>
                    {t("models.role_execution")}
                  </button>
                )}
                <span className="vw-flex-spacer" />
                <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" disabled={busy} onClick={() => { setEditing(p); setFormOpen(true); }}>
                  {t("models.edit")}
                </button>
                <button className="vw-btn vw-btn-ghost vw-btn-xs vw-danger-text" type="button" disabled={busy} onClick={() => handleDelete(p.id)}>
                  {t("models.delete")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {formOpen && (
        <ModelProfileForm
          initial={editing}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSaved={async () => { setFormOpen(false); setEditing(null); await refresh(); }}
        />
      )}
    </div>
  );
}

function ModelProfileForm({
  initial, onClose, onSaved,
}: {
  initial: ModelProfile | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useT();
  const providersQuery = useProvidersQuery();
  const presets = providersQuery.data?.providers ?? [];

  const [label, setLabel] = useState(initial?.label ?? "");
  const [provider, setProvider] = useState(initial?.provider ?? "openai");
  const [model, setModel] = useState(initial?.model ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [role, setRole] = useState<ModelRole>(initial?.role ?? "both");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelList, setModelList] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);

  const isPreset = presets.some((pr) => pr.id === provider);

  function onProviderSelect(value: string) {
    setProvider(value);
    const preset = presets.find((pr) => pr.id === value);
    if (preset?.base_url) setBaseUrl(preset.base_url);
    setModelList([]);
    setFetchMsg(null);
  }

  async function handleFetchModels() {
    if (!apiKey.trim()) {
      setFetchMsg(t("models.fetch_need_key"));
      return;
    }
    setFetchingModels(true);
    setFetchMsg(null);
    try {
      const res = await previewProviderModels({
        provider: provider.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey,
      });
      if (res.models.length > 0) {
        setModelList(res.models);
        setFetchMsg(t("models.fetch_ok", { count: String(res.models.length) }));
        if (!model.trim() || !res.models.includes(model.trim())) {
          setModel(res.models[0]);
        }
      } else {
        setFetchMsg(res.detail || t("models.fetch_empty"));
      }
    } catch (err) {
      setFetchMsg(err instanceof Error ? err.message : t("models.fetch_failed"));
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleSave() {
    if (!model.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        label: label.trim(),
        provider: provider.trim() || "openai",
        model: model.trim(),
        base_url: baseUrl.trim(),
        role,
        ...(apiKey ? { api_key: apiKey } : {}),
      };
      if (initial) {
        await req(`/api/model-profiles/${encodeURIComponent(initial.id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await req("/api/model-profiles", { method: "POST", body: JSON.stringify(body) });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("models.failed"));
    } finally {
      setBusy(false);
    }
  }

  const datalistId = `vw-model-list-${initial?.id ?? "new"}`;

  return (
    <div className="vw-modal-overlay" onClick={onClose}>
      <div className="vw-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vw-modal-head">
          <strong>{initial ? t("models.modal_edit") : t("models.modal_add")}</strong>
          <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" onClick={onClose}>✕</button>
        </div>
        <div className="vw-modal-body">
          <div className="form-grid">
            <label className="field">
              <span>{t("models.f_label")}</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("models.f_label_ph")} />
            </label>
            <label className="field">
              <span>{t("models.f_provider")}</span>
              <select value={isPreset ? provider : "__custom__"} onChange={(e) => onProviderSelect(e.target.value)}>
                {presets.map((pr) => (
                  <option key={pr.id} value={pr.id}>{pr.label || pr.id}</option>
                ))}
                <option value="__custom__">{t("models.provider_custom")}</option>
              </select>
            </label>
            {!isPreset && (
              <label className="field field-wide">
                <span>{t("models.f_provider_id")}</span>
                <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="openai" />
              </label>
            )}
            <label className="field field-wide">
              <span>{t("models.f_base_url")}</span>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
            </label>
            <div className="field field-wide">
              <span>{t("models.f_api_key")}{initial ? `（${t("models.key_keep")}）` : ""}</span>
              <div className="vw-key-row">
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" autoComplete="off" />
                <button
                  className="vw-btn vw-btn-ghost vw-btn-sm" type="button"
                  disabled={fetchingModels || !apiKey.trim()}
                  onClick={handleFetchModels}
                >
                  {fetchingModels ? t("models.fetching") : t("models.fetch_models")}
                </button>
              </div>
              {fetchMsg && <small className={modelList.length > 0 ? "vw-ok-text" : "vw-muted-text"}>{fetchMsg}</small>}
            </div>
            <label className="field">
              <span>{t("models.f_model")}</span>
              <input
                value={model} onChange={(e) => setModel(e.target.value)}
                placeholder={modelList.length > 0 ? t("models.f_model_pick") : "gpt-4o"}
                list={datalistId} autoComplete="off"
              />
              {modelList.length > 0 && (
                <datalist id={datalistId}>
                  {modelList.map((m) => <option key={m} value={m} />)}
                </datalist>
              )}
            </label>
            <label className="field">
              <span>{t("models.f_role")}</span>
              <select value={role} onChange={(e) => setRole(e.target.value as ModelRole)}>
                <option value="both">{t("models.role_both")}</option>
                <option value="thinking">🧠 {t("models.thinking")}</option>
                <option value="execution">⚡ {t("models.execution")}</option>
              </select>
            </label>
          </div>
          {error && <div className="vw-err">{error}</div>}
        </div>
        <div className="vw-modal-foot">
          <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" disabled={busy || !model.trim()} onClick={handleSave}>
            {busy ? t("models.saving") : t("models.save")}
          </button>
          <button className="vw-btn vw-btn-ghost vw-btn-sm" type="button" onClick={onClose}>{t("models.cancel")}</button>
        </div>
      </div>
    </div>
  );
}
