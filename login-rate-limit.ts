export type LoginRateLimitEnv = {
  DB?: D1Database;
  PORTAL_CLIENT_IP_SOURCE?: string;
  PORTAL_TRUSTED_PROXY_SECRET?: string;
};

export type LoginRateLimitDecision = {
  limited: boolean;
  retryAfterSeconds: number;
  scope: "client" | "username" | null;
};

const CLIENT_WINDOW_MS = 60_000;
const CLIENT_LIMIT = 20;
const USERNAME_WINDOW_MS = 5 * 60_000;
const USERNAME_LIMIT = 8;
const BASE_COOLDOWN_MS = 1_000;
const MAX_COOLDOWN_MS = 60_000;
const MAX_JITTER_MS = 250;
const RETENTION_MS = 24 * 60 * 60_000;
const UNKNOWN_CLIENT = "unidentified-client";

type RateRow = {
  failures: number;
  window_started_at: number;
  blocked_until: number;
  updated_at: number;
};

function normalizeIp(value: string | null): string {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > 80 || /[\r\n,]/.test(candidate)) return UNKNOWN_CLIENT;
  return candidate.toLowerCase();
}

function secretMatches(expected: string, actual: string): boolean {
  if (!expected || !actual) return false;
  const left = new TextEncoder().encode(expected);
  const right = new TextEncoder().encode(actual);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function normalizeLoginSubject(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().slice(0, 64) || "invalid-login";
}

export function loginClientSubject(request: Request, env: LoginRateLimitEnv): string {
  const source = String(env.PORTAL_CLIENT_IP_SOURCE ?? "none").trim().toLowerCase();
  if (source === "cloudflare") return normalizeIp(request.headers.get("cf-connecting-ip"));
  if (source === "trusted-proxy") {
    const expected = String(env.PORTAL_TRUSTED_PROXY_SECRET ?? "");
    const supplied = request.headers.get("x-portal-proxy-secret") ?? "";
    if (secretMatches(expected, supplied)) {
      const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "";
      return normalizeIp(forwarded);
    }
  }
  return UNKNOWN_CLIENT;
}

async function subjectHash(scope: "client" | "username", subject: string): Promise<string> {
  const input = new TextEncoder().encode(`portal-login-rate-limit:v1:${scope}:${subject}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function policy(scope: "client" | "username"): { windowMs: number; limit: number } {
  return scope === "client"
    ? { windowMs: CLIENT_WINDOW_MS, limit: CLIENT_LIMIT }
    : { windowMs: USERNAME_WINDOW_MS, limit: USERNAME_LIMIT };
}

export function loginCooldownMs(failures: number, limit: number): number {
  if (failures < limit) return 0;
  const exponent = Math.min(6, Math.max(0, failures - limit));
  return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * (2 ** exponent));
}

function jitteredCooldownMs(base: number): number {
  if (base <= 0 || base >= MAX_COOLDOWN_MS) return base;
  const entropy = crypto.getRandomValues(new Uint16Array(1))[0] / 65_535;
  const spread = Math.min(MAX_JITTER_MS, Math.max(1, Math.floor(base / 4)));
  return Math.min(MAX_COOLDOWN_MS, base + Math.floor(entropy * spread));
}

function retryAfterSeconds(blockedUntil: number, now: number): number {
  return Math.max(1, Math.ceil((blockedUntil - now) / 1000));
}

function requireDb(env: LoginRateLimitEnv): D1Database {
  if (!env.DB) throw new Error("login_rate_limit_storage_unavailable");
  return env.DB;
}

async function readRow(env: LoginRateLimitEnv, scope: "client" | "username", hash: string): Promise<RateRow | null> {
  return requireDb(env).prepare(
    "SELECT failures, window_started_at, blocked_until, updated_at FROM portal_login_rate_limits WHERE scope = ? AND subject_hash = ?",
  ).bind(scope, hash).first<RateRow>();
}

async function checkSubject(
  env: LoginRateLimitEnv,
  scope: "client" | "username",
  subject: string,
  now: number,
): Promise<LoginRateLimitDecision> {
  const hash = await subjectHash(scope, subject);
  const row = await readRow(env, scope, hash);
  if (Number(row?.blocked_until ?? 0) <= now) return { limited: false, retryAfterSeconds: 0, scope: null };
  return { limited: true, retryAfterSeconds: retryAfterSeconds(Number(row!.blocked_until), now), scope };
}

export async function checkLoginRateLimit(
  env: LoginRateLimitEnv,
  request: Request,
  usernameValue: unknown,
  now = Date.now(),
): Promise<LoginRateLimitDecision> {
  requireDb(env);
  const client = await checkSubject(env, "client", loginClientSubject(request, env), now);
  const username = await checkSubject(env, "username", normalizeLoginSubject(usernameValue), now);
  if (!client.limited) return username;
  if (!username.limited || client.retryAfterSeconds >= username.retryAfterSeconds) return client;
  return username;
}

async function recordSubjectFailure(
  env: LoginRateLimitEnv,
  scope: "client" | "username",
  subject: string,
  now: number,
): Promise<LoginRateLimitDecision> {
  const hash = await subjectHash(scope, subject);
  const { windowMs, limit } = policy(scope);
  const resetBefore = now - windowMs;
  const row = await requireDb(env).prepare(`INSERT INTO portal_login_rate_limits
      (scope, subject_hash, failures, window_started_at, blocked_until, updated_at)
      VALUES (?, ?, 1, ?, 0, ?)
      ON CONFLICT(scope, subject_hash) DO UPDATE SET
        failures = CASE WHEN window_started_at <= ? THEN 1 ELSE failures + 1 END,
        window_started_at = CASE WHEN window_started_at <= ? THEN ? ELSE window_started_at END,
        updated_at = ?
      RETURNING failures, window_started_at, blocked_until, updated_at`)
    .bind(scope, hash, now, now, resetBefore, resetBefore, now, now)
    .first<RateRow>();
  const failures = Number(row?.failures ?? 1);
  const cooldown = jitteredCooldownMs(loginCooldownMs(failures, limit));
  if (cooldown <= 0) return { limited: false, retryAfterSeconds: 0, scope: null };
  const blockedUntil = now + cooldown;
  await requireDb(env).prepare(
    "UPDATE portal_login_rate_limits SET blocked_until = MAX(blocked_until, ?), updated_at = ? WHERE scope = ? AND subject_hash = ?",
  ).bind(blockedUntil, now, scope, hash).run();
  return { limited: true, retryAfterSeconds: retryAfterSeconds(blockedUntil, now), scope };
}

export async function recordLoginFailure(
  env: LoginRateLimitEnv,
  request: Request,
  usernameValue: unknown,
  now = Date.now(),
): Promise<LoginRateLimitDecision> {
  const db = requireDb(env);
  await db.prepare("DELETE FROM portal_login_rate_limits WHERE updated_at < ?").bind(now - RETENTION_MS).run();
  const client = await recordSubjectFailure(env, "client", loginClientSubject(request, env), now);
  const username = await recordSubjectFailure(env, "username", normalizeLoginSubject(usernameValue), now);
  if (!client.limited) return username;
  if (!username.limited || client.retryAfterSeconds >= username.retryAfterSeconds) return client;
  return username;
}

export async function recordLoginSuccess(
  env: LoginRateLimitEnv,
  usernameValue: unknown,
): Promise<void> {
  const db = requireDb(env);
  const hash = await subjectHash("username", normalizeLoginSubject(usernameValue));
  await db.prepare("DELETE FROM portal_login_rate_limits WHERE scope = 'username' AND subject_hash = ?").bind(hash).run();
}

export async function clearLoginRateLimitForUsername(
  env: LoginRateLimitEnv,
  usernameValue: unknown,
): Promise<void> {
  return recordLoginSuccess(env, usernameValue);
}

export const loginRateLimitContract = Object.freeze({
  clientWindowMs: CLIENT_WINDOW_MS,
  clientLimit: CLIENT_LIMIT,
  usernameWindowMs: USERNAME_WINDOW_MS,
  usernameLimit: USERNAME_LIMIT,
  maxCooldownMs: MAX_COOLDOWN_MS,
  maxJitterMs: MAX_JITTER_MS,
  retentionMs: RETENTION_MS,
});
