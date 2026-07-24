"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PortalRole = "viewer" | "operator" | "admin";
type LocalAuthUser = {
  id: string;
  username: string;
  identity: string;
  displayName: string;
  role: PortalRole;
  disabled: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  activeSessions: number;
};

type SessionState = {
  authenticated: boolean;
  user?: { id: string; username: string; displayName: string; role: PortalRole };
};

const roleLabels: Record<PortalRole, string> = {
  viewer: "Наблюдатель",
  operator: "Оператор",
  admin: "Администратор",
};

const permissions: Record<PortalRole, string[]> = {
  viewer: ["Просмотр пользователей, групп, каталога и операций"],
  operator: ["Все права наблюдателя", "Изменения FreeIPA", "Запуск процессов XYOps"],
  admin: ["Все права оператора", "Удаление объектов", "Согласование процессов", "Настройки, аудит и RBAC"],
};

function formatDate(value: number | null): string {
  return value ? new Date(value).toLocaleString("ru-RU") : "не выполнялся";
}

export default function AccessPage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [users, setUsers] = useState<LocalAuthUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "viewer" as PortalRole });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [sessionResponse, usersResponse] = await Promise.all([
        fetch("/api/auth/session", { cache: "no-store" }),
        fetch("/api/auth/users", { cache: "no-store" }),
      ]);
      const [sessionData, usersData] = await Promise.all([
        sessionResponse.json().catch(() => ({})),
        usersResponse.json().catch(() => ({})),
      ]);
      if (!sessionResponse.ok) throw new Error(sessionData.error || "Требуется повторный вход");
      if (!usersResponse.ok) throw new Error(usersData.error || "Не удалось загрузить пользователей");
      setSession(sessionData);
      setUsers(Array.isArray(usersData.users) ? usersData.users : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить управление доступом");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return users;
    return users.filter((user) => `${user.username} ${user.displayName} ${user.role}`.toLowerCase().includes(normalized));
  }, [query, users]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось создать пользователя");
      setForm({ username: "", displayName: "", password: "", role: "viewer" });
      await load();
      flash("Локальный пользователь создан");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать пользователя");
    }
  }

  async function updateUser(user: LocalAuthUser, patch: Record<string, unknown>) {
    setError("");
    try {
      const response = await fetch(`/api/auth/users/${user.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось обновить пользователя");
      await load();
      flash("Права пользователя обновлены");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить пользователя");
    }
  }

  async function resetPassword(user: LocalAuthUser) {
    const password = window.prompt(`Новый пароль для ${user.username}. Минимум 12 символов.`);
    if (!password) return;
    setError("");
    try {
      const response = await fetch(`/api/auth/users/${user.id}/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось сменить пароль");
      await load();
      flash("Пароль изменён, активные сессии отозваны");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сменить пароль");
    }
  }

  async function revokeSessions(user: LocalAuthUser) {
    setError("");
    const response = await fetch(`/api/auth/users/${user.id}/sessions`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setError(data.error || "Не удалось отозвать сессии");
    await load();
    flash("Все сессии пользователя отозваны");
  }

  async function deleteUser(user: LocalAuthUser) {
    if (!window.confirm(`Удалить локального пользователя «${user.username}»?`)) return;
    setError("");
    const response = await fetch(`/api/auth/users/${user.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setError(data.error || "Не удалось удалить пользователя");
    await load();
    flash("Пользователь удалён");
  }

  if (loading && !session) return <main className="access-shell"><section className="access-panel"><h1>Управление доступом</h1><p>Загрузка локальной базы пользователей…</p></section></main>;

  return (
    <main className="access-shell">
      <header className="access-topbar">
        <div>
          <a href="/" className="access-back">← Вернуться в портал</a>
          <span className="eyebrow">LOCAL RBAC</span>
          <h1>Управление доступом</h1>
          <p>Внутренние пользователи портала. Учётные записи и группы FreeIPA не предоставляют доступ автоматически.</p>
        </div>
        <div className="access-current">
          <strong>{session?.user?.displayName}</strong>
          <span>{session?.user?.username}</span>
          <small>{session?.user?.role ? roleLabels[session.user.role] : ""}</small>
        </div>
      </header>

      {notice && <div className="access-notice">{notice}</div>}
      {error && <div className="access-error">{error}</div>}

      <section className="access-panel access-role-guide">
        {(Object.keys(roleLabels) as PortalRole[]).map((role) => (
          <article key={role}>
            <strong>{roleLabels[role]}</strong>
            {permissions[role].map((item) => <span key={item}>{item}</span>)}
          </article>
        ))}
      </section>

      <form className="access-panel access-create-form" onSubmit={createUser}>
        <div className="access-section-title"><div><span className="eyebrow">NEW USER</span><h2>Создать пользователя портала</h2></div></div>
        <label>Логин<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="operator01" required /></label>
        <label>Отображаемое имя<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Оператор портала" /></label>
        <label>Пароль<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={12} required /></label>
        <label>Роль<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as PortalRole })}><option value="viewer">Наблюдатель</option><option value="operator">Оператор</option><option value="admin">Администратор</option></select></label>
        <button className="primary">Создать</button>
      </form>

      <section className="access-panel">
        <div className="access-section-title">
          <div><span className="eyebrow">USERS</span><h2>Локальные пользователи</h2></div>
          <div className="access-tools"><input placeholder="Поиск…" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="secondary" onClick={() => void load()} disabled={loading}>{loading ? "Обновление…" : "Обновить"}</button></div>
        </div>
        <div className="access-users">
          {filtered.map((user) => {
            const own = user.id === session?.user?.id;
            const locked = Boolean(user.lockedUntil && user.lockedUntil > Date.now());
            return (
              <article className={`access-user-card ${user.disabled ? "disabled" : ""}`} key={user.id}>
                <div className="access-user-summary">
                  <div className="access-avatar">{user.username.slice(0, 2).toUpperCase()}</div>
                  <div><strong>{user.displayName}</strong><span>{user.username}</span><small>{user.identity}</small></div>
                  {own && <b className="access-badge">Текущая сессия</b>}
                  {user.disabled && <b className="access-badge danger">Отключён</b>}
                  {locked && <b className="access-badge warning">Временно заблокирован</b>}
                </div>
                <div className="access-user-controls">
                  <label>Роль<select value={user.role} disabled={own} onChange={(event) => void updateUser(user, { role: event.target.value })}><option value="viewer">Наблюдатель</option><option value="operator">Оператор</option><option value="admin">Администратор</option></select></label>
                  <label className="access-switch"><input type="checkbox" checked={!user.disabled} disabled={own} onChange={(event) => void updateUser(user, { disabled: !event.target.checked })} /> Активен</label>
                </div>
                <div className="access-user-meta"><span>Последний вход: <b>{formatDate(user.lastLoginAt)}</b></span><span>Активные сессии: <b>{user.activeSessions}</b></span><span>Неудачные попытки: <b>{user.failedAttempts}</b></span>{locked && <span>Блокировка до: <b>{formatDate(user.lockedUntil)}</b></span>}</div>
                <div className="access-user-actions"><button className="secondary" onClick={() => void resetPassword(user)}>Сменить пароль</button><button className="secondary" onClick={() => void revokeSessions(user)}>Отозвать сессии</button><button className="danger-button" disabled={own} onClick={() => void deleteUser(user)}>Удалить</button></div>
              </article>
            );
          })}
          {!filtered.length && <div className="access-empty">Пользователи не найдены</div>}
        </div>
      </section>
    </main>
  );
}
