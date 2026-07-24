"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type PortalRole = "viewer" | "operator" | "admin";
type RoleFilter = "all" | PortalRole;
type StateFilter = "all" | "active" | "disabled" | "locked";
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

type PasswordDialog = {
  user: LocalAuthUser;
  password: string;
  confirmation: string;
  submitting: boolean;
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
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  const [passwordDialog, setPasswordDialog] = useState<PasswordDialog | null>(null);
  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    confirmation: "",
    role: "viewer" as PortalRole,
  });

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
      const loadedAt = Date.now();
      const items: LocalAuthUser[] = Array.isArray(usersData.users) ? usersData.users.map((user: LocalAuthUser) => ({
        ...user,
        lockedUntil: user.lockedUntil && user.lockedUntil > loadedAt ? user.lockedUntil : null,
      })) : [];
      setSession(sessionData);
      setUsers(items);
      setEditingNames(Object.fromEntries(items.map((user) => [user.id, user.displayName])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить управление доступом");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery = !normalized || `${user.username} ${user.displayName} ${user.identity} ${user.role}`.toLowerCase().includes(normalized);
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const locked = Boolean(user.lockedUntil);
      const matchesState = stateFilter === "all"
        || (stateFilter === "active" && !user.disabled && !locked)
        || (stateFilter === "disabled" && user.disabled)
        || (stateFilter === "locked" && locked);
      return matchesQuery && matchesRole && matchesState;
    });
  }, [query, roleFilter, stateFilter, users]);

  const stats = useMemo(() => ({
    total: users.length,
    admins: users.filter((user) => user.role === "admin" && !user.disabled).length,
    operators: users.filter((user) => user.role === "operator" && !user.disabled).length,
    locked: users.filter((user) => Boolean(user.lockedUntil)).length,
    sessions: users.reduce((sum, user) => sum + user.activeSessions, 0),
  }), [users]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (form.password !== form.confirmation) {
      setError("Пароль и подтверждение не совпадают");
      return;
    }
    try {
      const response = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          displayName: form.displayName,
          password: form.password,
          role: form.role,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось создать пользователя");
      setForm({ username: "", displayName: "", password: "", confirmation: "", role: "viewer" });
      await load();
      flash("Локальный пользователь создан");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать пользователя");
    }
  }

  async function updateUser(user: LocalAuthUser, patch: Record<string, unknown>, successMessage = "Пользователь обновлён") {
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
      flash(successMessage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить пользователя");
    }
  }

  async function saveDisplayName(user: LocalAuthUser) {
    const displayName = String(editingNames[user.id] ?? "").trim();
    if (!displayName) return setError("Отображаемое имя не может быть пустым");
    await updateUser(user, { displayName }, "Отображаемое имя обновлено");
  }

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordDialog) return;
    if (passwordDialog.password.length < 12) return setError("Пароль должен содержать не менее 12 символов");
    if (passwordDialog.password !== passwordDialog.confirmation) return setError("Пароль и подтверждение не совпадают");
    setError("");
    setPasswordDialog({ ...passwordDialog, submitting: true });
    try {
      const response = await fetch(`/api/auth/users/${passwordDialog.user.id}/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: passwordDialog.password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось сменить пароль");
      setPasswordDialog(null);
      await load();
      flash("Пароль изменён, активные сессии отозваны");
    } catch (cause) {
      setPasswordDialog((current) => current ? { ...current, submitting: false } : current);
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
          <Link href="/" className="access-back">← Вернуться в портал</Link>
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
        <article><strong>{stats.total}</strong><span>Всего пользователей</span></article>
        <article><strong>{stats.admins}</strong><span>Активных администраторов</span></article>
        <article><strong>{stats.operators}</strong><span>Активных операторов</span></article>
        <article><strong>{stats.locked}</strong><span>Заблокировано входов</span></article>
        <article><strong>{stats.sessions}</strong><span>Активных сессий</span></article>
      </section>

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
        <label>Пароль<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={12} autoComplete="new-password" required /><small>От 12 до 256 символов</small></label>
        <label>Подтверждение<input type="password" value={form.confirmation} onChange={(event) => setForm({ ...form, confirmation: event.target.value })} minLength={12} autoComplete="new-password" required /></label>
        <label>Роль<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as PortalRole })}><option value="viewer">Наблюдатель</option><option value="operator">Оператор</option><option value="admin">Администратор</option></select></label>
        <button className="primary">Создать</button>
      </form>

      <section className="access-panel">
        <div className="access-section-title">
          <div><span className="eyebrow">USERS</span><h2>Локальные пользователи</h2></div>
          <div className="access-tools">
            <input aria-label="Поиск локальных пользователей" placeholder="Поиск…" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select aria-label="Фильтр по роли" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}><option value="all">Все роли</option><option value="viewer">Наблюдатели</option><option value="operator">Операторы</option><option value="admin">Администраторы</option></select>
            <select aria-label="Фильтр по состоянию" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as StateFilter)}><option value="all">Все состояния</option><option value="active">Активные</option><option value="disabled">Отключённые</option><option value="locked">Заблокированные</option></select>
            <button className="secondary" onClick={() => void load()} disabled={loading}>{loading ? "Обновление…" : "Обновить"}</button>
          </div>
        </div>
        <div className="access-users">
          {filtered.map((user) => {
            const own = user.id === session?.user?.id;
            const locked = Boolean(user.lockedUntil);
            const displayNameChanged = String(editingNames[user.id] ?? "").trim() !== user.displayName;
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
                  <label>Отображаемое имя<input value={editingNames[user.id] ?? user.displayName} onChange={(event) => setEditingNames({ ...editingNames, [user.id]: event.target.value })} /></label>
                  <button className="secondary" disabled={!displayNameChanged} onClick={() => void saveDisplayName(user)}>Сохранить имя</button>
                  <label>Роль<select value={user.role} disabled={own} onChange={(event) => void updateUser(user, { role: event.target.value }, "Роль пользователя обновлена")}><option value="viewer">Наблюдатель</option><option value="operator">Оператор</option><option value="admin">Администратор</option></select></label>
                  <label className="access-switch"><input type="checkbox" checked={!user.disabled} disabled={own} onChange={(event) => void updateUser(user, { disabled: !event.target.checked }, event.target.checked ? "Пользователь включён" : "Пользователь отключён")} /> Активен</label>
                </div>
                <div className="access-user-meta"><span>Последний вход: <b>{formatDate(user.lastLoginAt)}</b></span><span>Активные сессии: <b>{user.activeSessions}</b></span><span>Неудачные попытки: <b>{user.failedAttempts}</b></span>{locked && <span>Блокировка до: <b>{formatDate(user.lockedUntil)}</b></span>}</div>
                <div className="access-user-actions">
                  <button className="secondary" onClick={() => setPasswordDialog({ user, password: "", confirmation: "", submitting: false })}>Сменить пароль</button>
                  {locked && <button className="secondary" onClick={() => void updateUser(user, { disabled: false }, "Пользователь разблокирован")}>Разблокировать</button>}
                  <button className="secondary" disabled={user.activeSessions < 1} onClick={() => void revokeSessions(user)}>Отозвать сессии</button>
                  <button className="danger-button" disabled={own} onClick={() => void deleteUser(user)}>Удалить</button>
                </div>
              </article>
            );
          })}
          {!filtered.length && <div className="access-empty">Пользователи не найдены</div>}
        </div>
      </section>

      {passwordDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !passwordDialog.submitting && setPasswordDialog(null)}>
          <form className="modal" onSubmit={submitPassword} onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Закрыть" disabled={passwordDialog.submitting} onClick={() => setPasswordDialog(null)}>×</button>
            <div><span className="eyebrow">PASSWORD RESET</span><h2>Сменить пароль</h2><p>Пользователь: <strong>{passwordDialog.user.username}</strong>. После сохранения все его активные сессии будут отозваны.</p></div>
            <label>Новый пароль<input type="password" minLength={12} maxLength={256} autoComplete="new-password" value={passwordDialog.password} onChange={(event) => setPasswordDialog({ ...passwordDialog, password: event.target.value })} required /><small>От 12 до 256 символов</small></label>
            <label>Подтверждение пароля<input type="password" minLength={12} maxLength={256} autoComplete="new-password" value={passwordDialog.confirmation} onChange={(event) => setPasswordDialog({ ...passwordDialog, confirmation: event.target.value })} required /></label>
            <div className="modal-actions"><button className="secondary" type="button" disabled={passwordDialog.submitting} onClick={() => setPasswordDialog(null)}>Отмена</button><button className="primary" disabled={passwordDialog.submitting}>{passwordDialog.submitting ? "Сохранение…" : "Сменить пароль"}</button></div>
          </form>
        </div>
      )}
    </main>
  );
}