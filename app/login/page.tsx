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
        <span className="eyebrow">LOCAL ADMIN PORTAL</span>
        <h1>Вход в портал</h1>
        <p>Используйте внутреннюю учётную запись портала. Пользователи FreeIPA не используются для аутентификации.</p>

        {setupRequired && (
          <div className="local-auth-warning">
            Первый администратор ещё не создан. Задайте <code>PORTAL_BOOTSTRAP_ADMIN_USERNAME</code> и <code>PORTAL_BOOTSTRAP_ADMIN_PASSWORD</code> в <code>.env</code>, затем перезапустите контейнер.
          </div>
        )}

        <label>
          Логин
          <input autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
        </label>
        <label>
          Пароль
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>

        {error && <div className="local-auth-error">{error}</div>}
        <button className="primary" disabled={loading || checking || setupRequired}>
          {checking ? "Проверка…" : loading ? "Вход…" : "Войти"}
        </button>
      </form>
    </main>
  );
}
