"use client";

import { useEffect, useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (response.ok && data.authenticated) {
          window.location.replace("/");
          return;
        }
        setSetupRequired(data.setupRequired === true);
      })
      .catch(() => setError("Локальная аутентификация недоступна"))
      .finally(() => setChecking(false));
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось выполнить вход");
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить вход");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="local-auth-screen">
      <form className="local-auth-card" onSubmit={submit}>
        <div className="local-auth-logo">◇</div>
        <span className="eyebrow">Admin Dashboard Softrust</span>
        <h1>Вход в портал</h1>
        <p>Используйте внутреннюю учётную запись портала. Пользователи FreeIPA не используются для аутентификации.</p>

        {setupRequired && (
          <div className="ds-field-group ds-field-error">
            <span className="ds-field-helper">⚠</span>
            <div><strong className="ds-field-error-title">Требуется настройка администратора</strong><p>Первый администратор ещё не создан. Задайте <code>PORTAL_BOOTSTRAP_ADMIN_USERNAME</code> и <code>PORTAL_BOOTSTRAP_ADMIN_PASSWORD</code> в <code>.env</code>, затем перезапустите контейнер.</p></div>
          </div>
        )}

        <div className="ds-field">
          <label className="ds-field-label" htmlFor="portal-login-username">Логин</label>
          <input id="portal-login-username" className="ds-input" autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
        </div>
        <div className="ds-field">
          <label className="ds-field-label" htmlFor="portal-login-password">Пароль</label>
          <input id="portal-login-password" className="ds-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </div>

        {error && <div className="local-auth-error" role="alert">{error}</div>}
        <button className="ds-btn ds-btn-primary" disabled={loading || checking || setupRequired}>
          {checking ? "Проверка…" : loading ? "Вход…" : "Войти"}
        </button>
      </form>
    </main>
  );
}
