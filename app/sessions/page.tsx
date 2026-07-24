"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type PortalRole = "viewer" | "operator" | "admin";
type PortalSession = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  role: PortalRole;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
  current: boolean;
};

const roleLabels: Record<PortalRole, string> = {
  viewer: "Наблюдатель",
  operator: "Оператор",
  admin: "Администратор",
};

function formatDate(value: number): string {
  return new Date(value).toLocaleString("ru-RU");
}

function describeAgent(value: string): string {
  if (!value) return "User-Agent не передан";
  const browser = value.includes("Firefox/") ? "Firefox" : value.includes("Edg/") ? "Microsoft Edge" : value.includes("Chrome/") ? "Chrome" : value.includes("Safari/") ? "Safari" : "Другой клиент";
  const system = value.includes("Windows") ? "Windows" : value.includes("Android") ? "Android" : value.includes("iPhone") || value.includes("iPad") ? "iOS/iPadOS" : value.includes("Mac OS") ? "macOS" : value.includes("Linux") ? "Linux" : "неизвестная ОС";
  return `${browser} · ${system}`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<PortalSession[]>([]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | PortalRole>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sessions?limit=500", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить сессии");
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить сессии");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sessions.filter((session) => {
      const matchesQuery = !needle || `${session.username} ${session.displayName} ${session.userAgent}`.toLowerCase().includes(needle);
      return matchesQuery && (role === "all" || session.role === role);
    });
  }, [query, role, sessions]);

  const usersWithSessions = useMemo(() => new Set(sessions.map((session) => session.userId)).size, [sessions]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  async function revoke(session: PortalSession) {
    if (session.current) return;
    if (!window.confirm(`Завершить сессию пользователя «${session.username}»?`)) return;
    setError("");
    const response = await fetch(`/api/auth/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setError(data.error || "Не удалось завершить сессию");
    await load();
    flash("Сессия завершена");
  }

  return (
    <main className="sessions-shell">
      <header className="sessions-header">
        <div>
          <Link href="/access" className="access-back">← Управление доступом</Link>
          <span className="eyebrow">LOCAL SESSIONS</span>
          <h1>Активные сессии</h1>
          <p>Администратор видит время создания, последнюю активность, срок действия и User-Agent. Session tokens не отображаются.</p>
        </div>
        <button className="secondary" disabled={loading} onClick={() => void load()}>{loading ? "Обновление…" : "Обновить"}</button>
      </header>

      {notice && <div className="access-notice">{notice}</div>}
      {error && <div className="access-error">{error}</div>}

      <section className="sessions-stats">
        <article><strong>{sessions.length}</strong><span>Активных сессий</span></article>
        <article><strong>{usersWithSessions}</strong><span>Пользователей онлайн</span></article>
        <article><strong>{sessions.filter((item) => item.current).length}</strong><span>Текущая сессия</span></article>
      </section>

      <section className="sessions-panel">
        <div className="sessions-tools">
          <input aria-label="Поиск сессий" placeholder="Пользователь или User-Agent…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="Фильтр сессий по роли" value={role} onChange={(event) => setRole(event.target.value as "all" | PortalRole)}><option value="all">Все роли</option><option value="viewer">Наблюдатели</option><option value="operator">Операторы</option><option value="admin">Администраторы</option></select>
        </div>

        <div className="sessions-list">
          {filtered.map((session) => (
            <article className={`session-card ${session.current ? "current" : ""}`} key={session.id}>
              <div className="session-user"><span>{session.username.slice(0, 2).toUpperCase()}</span><div><strong>{session.displayName}</strong><small>{session.username} · {roleLabels[session.role]}</small></div>{session.current && <b>Текущая</b>}</div>
              <div className="session-agent"><strong>{describeAgent(session.userAgent)}</strong><code title={session.userAgent}>{session.userAgent || "—"}</code></div>
              <div className="session-dates"><span>Создана <b>{formatDate(session.createdAt)}</b></span><span>Активность <b>{formatDate(session.lastSeenAt)}</b></span><span>Истекает <b>{formatDate(session.expiresAt)}</b></span></div>
              <button className="danger-button" disabled={session.current} title={session.current ? "Завершите текущую сессию кнопкой «Выйти»" : "Завершить эту сессию"} onClick={() => void revoke(session)}>{session.current ? "Текущая сессия" : "Завершить"}</button>
            </article>
          ))}
          {!filtered.length && <div className="access-empty">Активные сессии не найдены</div>}
        </div>
      </section>
    </main>
  );
}