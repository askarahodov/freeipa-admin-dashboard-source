export type LocalPortalRole = "viewer" | "operator" | "admin";

export type LocalAuthEnv = {
  DB?: D1Database;
  PORTAL_BOOTSTRAP_ADMIN_USERNAME?: string;
  PORTAL_BOOTSTRAP_ADMIN_PASSWORD?: string;
  PORTAL_BOOTSTRAP_ADMIN_NAME?: string;
  PORTAL_SESSION_TTL_HOURS?: string;
};

export type LocalPortalUser = {
  id: string;
  username: string;
  identity: string;
  displayName: string;
  role: LocalPortalRole;
  disabled: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  activeSessions: number;
};

export type LocalSession = {
  id: string;
  userId: string;
  username: string;
  identity: string;
  displayName: string;
  role: LocalPortalRole;
  expiresAt: number;
};

const PASSWORD_ITERATIONS = 210_000;
const SESSION_COOKIE = "portal_session";
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

const createUsersTable = `CREATE TABLE IF NOT EXISTS portal_users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  role TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
)`;

const createSessionsTable = `CREATE TABLE IF NOT EXISTS portal_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
)`;

function role(value: unknown): LocalPortalRole {
  return value === "admin" || value === "operator" ? value : "viewer";
}

function cleanUsername(value: unknown): string {
  const username = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    throw new Error("Логин должен содержать 3–64 символа: латинские буквы, цифры, точку, дефис или подчёркивание");
  }
  return username;
}

function cleanDisplayName(value: unknown, fallback: string): string {
  const name = String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160);
  return name || fallback;
}

function validatePassword(value: unknown): string {
  const password = String(value ?? "");
  if (password.length < 12 || password.length > 256) throw new Error("Пароль должен содержать от 12 до 256 символов");
  return password;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function derivePassword(password: string, salt: Uint8Array, iterations = PASSWORD_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function cookieValue(request: Request, name: string): string {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function sessionTtlMs(env: LocalAuthEnv): number {
  const hours = Number(env.PORTAL_SESSION_TTL_HOURS ?? 12);
  return Math.max(1, Math.min(Number.isFinite(hours) ? hours : 12, 168)) * 60 * 60 * 1000;
}

export function localIdentity(username: string): string {
  return `${username}@local.portal`;
}

export async function ensureLocalAuthTables(env: LocalAuthEnv): Promise<void> {
  if (!env.DB) throw new Error("Локальная база данных недоступна");
  await env.DB.prepare(createUsersTable).run();
  await env.DB.prepare(createSessionsTable).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS portal_sessions_user_idx ON portal_sessions(user_id)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS portal_sessions_expires_idx ON portal_sessions(expires_at)").run();
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(24));
  return { hash: await derivePassword(password, salt), salt: bytesToBase64(salt), iterations: PASSWORD_ITERATIONS };
}

async function userCount(env: LocalAuthEnv): Promise<number> {
  await ensureLocalAuthTables(env);
  const row = await env.DB!.prepare("SELECT COUNT(*) AS count FROM portal_users").first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function bootstrapLocalAdmin(env: LocalAuthEnv): Promise<{ created: boolean; userCount: number }> {
  const count = await userCount(env);
  if (count > 0) return { created: false, userCount: count };
  const usernameValue = env.PORTAL_BOOTSTRAP_ADMIN_USERNAME?.trim();
  const passwordValue = env.PORTAL_BOOTSTRAP_ADMIN_PASSWORD;
  if (!usernameValue || !passwordValue) return { created: false, userCount: 0 };
  await createLocalUser(env, {
    username: usernameValue,
    displayName: env.PORTAL_BOOTSTRAP_ADMIN_NAME || "Локальный администратор",
    password: passwordValue,
    role: "admin",
  }, true);
  return { created: true, userCount: 1 };
}

function publicUser(row: Record<string, unknown>): LocalPortalUser {
  const username = String(row.username ?? "");
  return {
    id: String(row.id ?? ""),
    username,
    identity: localIdentity(username),
    displayName: String(row.display_name ?? username),
    role: role(row.role),
    disabled: Number(row.disabled ?? 0) === 1,
    failedAttempts: Number(row.failed_attempts ?? 0),
    lockedUntil: row.locked_until == null ? null : Number(row.locked_until),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
    activeSessions: Number(row.active_sessions ?? 0),
  };
}

export async function listLocalUsers(env: LocalAuthEnv): Promise<LocalPortalUser[]> {
  await bootstrapLocalAdmin(env);
  const result = await env.DB!.prepare(`SELECT u.id, u.username, u.display_name, u.role, u.disabled, u.failed_attempts, u.locked_until, u.created_at, u.updated_at, u.last_login_at,
    (SELECT COUNT(*) FROM portal_sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS active_sessions
    FROM portal_users u ORDER BY u.username ASC`).bind(Date.now()).all<Record<string, unknown>>();
  return (result.results ?? []).map(publicUser).filter((user) => user.id && user.username);
}

export async function createLocalUser(env: LocalAuthEnv, input: { username: unknown; displayName?: unknown; password: unknown; role?: unknown }, bootstrap = false): Promise<LocalPortalUser> {
  await ensureLocalAuthTables(env);
  const username = cleanUsername(input.username);
  const password = validatePassword(input.password);
  const selectedRole = bootstrap ? "admin" : role(input.role);
  const displayName = cleanDisplayName(input.displayName, username);
  const credentials = await hashPassword(password);
  const now = Date.now();
  const id = crypto.randomUUID();
  try {
    await env.DB!.prepare("INSERT INTO portal_users (id, username, display_name, password_hash, password_salt, password_iterations, role, disabled, failed_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)")
      .bind(id, username, displayName, credentials.hash, credentials.salt, credentials.iterations, selectedRole, now, now).run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new Error("Пользователь с таким логином уже существует");
    throw error;
  }
  return { id, username, identity: localIdentity(username), displayName, role: selectedRole, disabled: false, failedAttempts: 0, lockedUntil: null, createdAt: now, updatedAt: now, lastLoginAt: null, activeSessions: 0 };
}

async function activeAdminCount(env: LocalAuthEnv, excludingId = ""): Promise<number> {
  await ensureLocalAuthTables(env);
  const row = await env.DB!.prepare("SELECT COUNT(*) AS count FROM portal_users WHERE role = 'admin' AND disabled = 0 AND id <> ?").bind(excludingId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function readUser(env: LocalAuthEnv, id: string): Promise<LocalPortalUser | null> {
  await ensureLocalAuthTables(env);
  const row = await env.DB!.prepare("SELECT id, username, display_name, role, disabled, failed_attempts, locked_until, created_at, updated_at, last_login_at, 0 AS active_sessions FROM portal_users WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? publicUser(row) : null;
}

export async function updateLocalUser(env: LocalAuthEnv, id: string, input: { displayName?: unknown; role?: unknown; disabled?: unknown }): Promise<LocalPortalUser> {
  const current = await readUser(env, id);
  if (!current) throw new Error("Пользователь не найден");
  const nextRole = input.role === undefined ? current.role : role(input.role);
  const nextDisabled = input.disabled === undefined ? current.disabled : input.disabled === true;
  if (current.role === "admin" && (nextRole !== "admin" || nextDisabled) && await activeAdminCount(env, id) < 1) {
    throw new Error("Нельзя удалить или отключить последнего активного администратора");
  }
  const displayName = input.displayName === undefined ? current.displayName : cleanDisplayName(input.displayName, current.username);
  const now = Date.now();
  await env.DB!.prepare("UPDATE portal_users SET display_name = ?, role = ?, disabled = ?, failed_attempts = CASE WHEN ? = 0 THEN 0 ELSE failed_attempts END, locked_until = CASE WHEN ? = 0 THEN NULL ELSE locked_until END, updated_at = ? WHERE id = ?")
    .bind(displayName, nextRole, nextDisabled ? 1 : 0, nextDisabled ? 1 : 0, nextDisabled ? 1 : 0, now, id).run();
  if (nextDisabled) await revokeLocalUserSessions(env, id);
  return { ...current, displayName, role: nextRole, disabled: nextDisabled, updatedAt: now, activeSessions: nextDisabled ? 0 : current.activeSessions };
}

export async function resetLocalUserPassword(env: LocalAuthEnv, id: string, passwordValue: unknown): Promise<void> {
  const current = await readUser(env, id);
  if (!current) throw new Error("Пользователь не найден");
  const credentials = await hashPassword(validatePassword(passwordValue));
  await env.DB!.prepare("UPDATE portal_users SET password_hash = ?, password_salt = ?, password_iterations = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
    .bind(credentials.hash, credentials.salt, credentials.iterations, Date.now(), id).run();
  await revokeLocalUserSessions(env, id);
}

export async function deleteLocalUser(env: LocalAuthEnv, id: string): Promise<void> {
  const current = await readUser(env, id);
  if (!current) throw new Error("Пользователь не найден");
  if (current.role === "admin" && await activeAdminCount(env, id) < 1) throw new Error("Нельзя удалить последнего активного администратора");
  await revokeLocalUserSessions(env, id);
  await env.DB!.prepare("DELETE FROM portal_users WHERE id = ?").bind(id).run();
}

export async function authenticateLocalUser(env: LocalAuthEnv, usernameValue: unknown, passwordValue: unknown, userAgent = ""): Promise<{ session: LocalSession; token: string; maxAge: number }> {
  await bootstrapLocalAdmin(env);
  const username = cleanUsername(usernameValue);
  const password = String(passwordValue ?? "");
  const row = await env.DB!.prepare("SELECT id, username, display_name, password_hash, password_salt, password_iterations, role, disabled, failed_attempts, locked_until FROM portal_users WHERE username = ?").bind(username).first<Record<string, unknown>>();
  if (!row) throw new Error("Неверный логин или пароль");
  const now = Date.now();
  if (Number(row.disabled ?? 0) === 1) throw new Error("Учётная запись отключена");
  if (Number(row.locked_until ?? 0) > now) throw new Error("Учётная запись временно заблокирована после неудачных попыток входа");
  const actual = await derivePassword(password, base64ToBytes(String(row.password_salt ?? "")), Number(row.password_iterations ?? PASSWORD_ITERATIONS));
  if (!constantTimeEqual(actual, String(row.password_hash ?? ""))) {
    const attempts = Number(row.failed_attempts ?? 0) + 1;
    const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? now + LOCK_DURATION_MS : null;
    await env.DB!.prepare("UPDATE portal_users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?").bind(lockedUntil ? 0 : attempts, lockedUntil, now, row.id).run();
    throw new Error(lockedUntil ? "Учётная запись временно заблокирована после неудачных попыток входа" : "Неверный логин или пароль");
  }
  const rawToken = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(rawToken);
  const ttl = sessionTtlMs(env);
  const session: LocalSession = {
    id: crypto.randomUUID(),
    userId: String(row.id),
    username,
    identity: localIdentity(username),
    displayName: String(row.display_name ?? username),
    role: role(row.role),
    expiresAt: now + ttl,
  };
  await env.DB!.prepare("DELETE FROM portal_sessions WHERE expires_at <= ?").bind(now).run();
  await env.DB!.prepare("INSERT INTO portal_sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(session.id, session.userId, tokenHash, now, now, session.expiresAt, userAgent.slice(0, 240)).run();
  await env.DB!.prepare("UPDATE portal_users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?").bind(now, now, session.userId).run();
  return { session, token: rawToken, maxAge: Math.floor(ttl / 1000) };
}

export function localSessionCookie(request: Request, token: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function clearLocalSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function resolveLocalSession(env: LocalAuthEnv, request: Request): Promise<LocalSession | null> {
  if (!env.DB) return null;
  await bootstrapLocalAdmin(env);
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const row = await env.DB.prepare(`SELECT s.id, s.user_id, s.expires_at, u.username, u.display_name, u.role, u.disabled
    FROM portal_sessions s JOIN portal_users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).bind(tokenHash).first<Record<string, unknown>>();
  if (!row || Number(row.disabled ?? 0) === 1 || Number(row.expires_at ?? 0) <= now) {
    if (row?.id) await env.DB.prepare("DELETE FROM portal_sessions WHERE id = ?").bind(row.id).run();
    return null;
  }
  await env.DB.prepare("UPDATE portal_sessions SET last_seen_at = ? WHERE id = ?").bind(now, row.id).run();
  const username = String(row.username ?? "");
  return { id: String(row.id), userId: String(row.user_id), username, identity: localIdentity(username), displayName: String(row.display_name ?? username), role: role(row.role), expiresAt: Number(row.expires_at) };
}

export async function revokeLocalSession(env: LocalAuthEnv, request: Request): Promise<void> {
  if (!env.DB) return;
  await ensureLocalAuthTables(env);
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM portal_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export async function revokeLocalUserSessions(env: LocalAuthEnv, userId: string): Promise<void> {
  if (!env.DB) return;
  await ensureLocalAuthTables(env);
  await env.DB.prepare("DELETE FROM portal_sessions WHERE user_id = ?").bind(userId).run();
}

export async function localAuthState(env: LocalAuthEnv): Promise<{ persistenceAvailable: boolean; userCount: number; setupRequired: boolean }> {
  if (!env.DB) return { persistenceAvailable: false, userCount: 0, setupRequired: true };
  const bootstrap = await bootstrapLocalAdmin(env);
  return { persistenceAvailable: true, userCount: bootstrap.userCount, setupRequired: bootstrap.userCount === 0 };
}
