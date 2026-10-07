import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "../i18n";

interface ModelProfile {
  id: string;
  label: string;
  provider: string;
  model: string;
  base_url: string;
  api_key_configured: boolean;
}

interface ProfilesResponse {
  profiles: ModelProfile[];
  active_id: string;
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

export function ModelProfilesBlock({ onChanged }: { onChanged: () => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
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

  async function handleActivate(id: string) {
    setBusy(true);
    setError(null);
    try {
      await req(`/api/model-profiles/${encodeURIComponent(id)}/activate`, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("models.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("models.delete_confirm"))) return;
    setBusy(true);
    setError(null);
    try {
      await req(`/api/model-profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("models.failed"));
    } finally {
      setBusy(false);
    }
  }

  const data = profilesQuery.data;

  return (
    <div className="vw-models-block">
      <div className="vw-models-head">
        <div>
          <h3>{t("models.title")}</h3>
          <p>{t("models.subtitle")}</p>
        </div>
        <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" onClick={() => setFormOpen(true)}>
          {t("models.add")}
        </button>
      </div>
      {error && <div className="vw-err">{error}</div>}
      {profilesQuery.isLoading && <p style={{ color: "var(--muted)" }}>{t("models.loading")}</p>}
      {data && data.profiles.length === 0 && (
        <p style={{ color: "var(--muted)" }}>{t("models.empty")}</p>
      )}
      <div className="vw-models-list">
        {(data?.profiles ?? []).map((p) => {
          const active = data?.active_id === p.id;
          return (
            <div key={p.id} className={`vw-model-card ${active ? "active" : ""}`}>
              <div className="vw-model-info">
                <strong>{p.label || p.model}</strong>
                {active && <span className="vw-badge vw-b-run">{t("models.active")}</span>}
                {p.api_key_configured && <span className="vw-badge vw-b-done">API key</span>}
                <div className="vw-model-meta vw-mono">{p.provider} · {p.model}</div>
                {p.base_url && <div className="vw-model-meta vw-mono">{p.base_url}</div>}
              </div>
              <div className="vw-model-actions">
                {!active && (
                  <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" disabled={busy} onClick={() => handleActivate(p.id)}>
                    {t("models.activate")}
                  </button>
                )}
                <button className="vw-btn vw-btn-ghost vw-btn-xs" type="button" disabled={busy} onClick={() => handleDelete(p.id)}>
                  {t("models.delete")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {formOpen && (
        <ModelProfileForm
          onClose={() => setFormOpen(false)}
          onSaved={async () => { setFormOpen(false); await refresh(); }}
        />
      )}
    </div>
  );
}

function ModelProfileForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useT();
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!model.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await req("/api/model-profiles", {
        method: "POST",
        body: JSON.stringify({
          label: label.trim(),
          provider: provider.trim() || "openai",
          model: model.trim(),
          base_url: baseUrl.trim(),
          api_key: apiKey,
        }),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("models.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vw-models-form">
      <div className="form-grid">
        <label className="field">
          <span>{t("models.f_label")}</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("models.f_label_ph")} />
        </label>
        <label className="field">
          <span>{t("models.f_provider")}</span>
          <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="openai" />
        </label>
        <label className="field">
          <span>{t("models.f_model")}</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" />
        </label>
        <label className="field">
          <span>{t("models.f_base_url")}</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </label>
        <label className="field field-wide">
          <span>{t("models.f_api_key")}</span>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" autoComplete="off" />
        </label>
      </div>
      {error && <div className="vw-err">{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="vw-btn vw-btn-primary vw-btn-sm" type="button" disabled={busy || !model.trim()} onClick={handleSave}>
          {busy ? t("models.saving") : t("models.save")}
        </button>
        <button className="vw-btn vw-btn-ghost vw-btn-sm" type="button" onClick={onClose}>{t("models.cancel")}</button>
      </div>
    </div>
  );
}
