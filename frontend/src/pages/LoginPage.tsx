import { useState } from "react";
import { login } from "../api/web";
import { useT } from "../i18n";

interface LoginPageProps {
  onLoggedIn: () => void;
}

export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const { t } = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.login_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vw-login-wrap">
      <form className="vw-login-card" onSubmit={handleSubmit}>
        <div className="vw-login-brand">
          <span className="vw-login-logo">V</span>
          <div>
            <h1>VulnClaw</h1>
            <p>{t("auth.subtitle")}</p>
          </div>
        </div>
        <label className="vw-field">
          <span>{t("auth.username")}</span>
          <input
            className="vw-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label className="vw-field">
          <span>{t("auth.password")}</span>
          <input
            className="vw-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="vw-err">{error}</div>}
        <button className="vw-btn vw-btn-primary" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? t("auth.logging_in") : t("auth.login")}
        </button>
        <p className="vw-login-hint">{t("auth.hint")}</p>
      </form>
    </div>
  );
}
