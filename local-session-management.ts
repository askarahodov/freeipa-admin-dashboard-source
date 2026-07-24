import { ensureLocalAuthTables, type LocalAuthEnv, type LocalPortalRole } from "./local-auth";

export type LocalPortalSessionRecord = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  role: LocalPortalRole;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
};

function publicSession(row: Record<string, unknown>): LocalPortalSessionRecord {
  const rawRole = String(row.role ?? "viewer");
  const role: LocalPortalRole = rawRole === "admin" || rawRole === "operator" ? rawRole : "viewer";
  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? ""),
    username: String(row.username ?? ""),
    displayName: String(row.display_name ?? row.username ?? ""),
    role,
    createdAt: Number(row.created_at ?? 0),
    lastSeenAt: Number(row.last_seen_at ?? 0),
    expiresAt: Number(row.expires_at ?? 0),
    userAgent: String(row.user_agent ?? "").slice(0, 500),
  };
}

export async function listLocalPortalSessions(env: LocalAuthEnv, limit = 200): Promise<LocalPortalSessionRecord[]> {
  await ensureLocalAuthTables(env);
  const now = Date.now();
  await env.DB!.prepare("DELETE FROM portal_sessions WHERE expires_at <= ?").bind(now).run();
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : 200, 500));
  const result = await env.DB!.prepare(`SELECT s.id, s.user_id, s.created_at, s.last_seen_at, s.expires_at, s.user_agent,
    u.username, u.display_name, u.role
    FROM portal_sessions s
    JOIN portal_users u ON u.id = s.user_id
    WHERE s.expires_at > ?
    ORDER BY s.last_seen_at DESC
    LIMIT ?`).bind(now, safeLimit).all<Record<string, unknown>>();
  return (result.results ?? []).map(publicSession).filter((session) => session.id && session.userId && session.username);
}

export async function readLocalPortalSession(env: LocalAuthEnv, id: string): Promise<LocalPortalSessionRecord | null> {
  await ensureLocalAuthTables(env);
  const row = await env.DB!.prepare(`SELECT s.id, s.user_id, s.created_at, s.last_seen_at, s.expires_at, s.user_agent,
    u.username, u.display_name, u.role
    FROM portal_sessions s
    JOIN portal_users u ON u.id = s.user_id
    WHERE s.id = ?`).bind(id).first<Record<string, unknown>>();
  return row ? publicSession(row) : null;
}

export async function revokeLocalPortalSession(env: LocalAuthEnv, id: string): Promise<LocalPortalSessionRecord> {
  const session = await readLocalPortalSession(env, id);
  if (!session) throw new Error("Сессия не найдена или уже завершена");
  await env.DB!.prepare("DELETE FROM portal_sessions WHERE id = ?").bind(id).run();
  return session;
}