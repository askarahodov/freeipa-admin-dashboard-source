import assert from "node:assert/strict";
import test from "node:test";

import { authenticateLocalUser, createLocalUser, localSessionCookie, resetLocalUserPassword, resolveLocalSession, updateLocalUser } from "../local-auth.ts";

class LocalAuthMemoryD1 {
  users = [];
  sessions = [];

  prepare(sql) {
    let values = [];
    const normalized = sql.replace(/\s+/g, " ").trim();
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (normalized.startsWith("CREATE ")) return { success: true };
        if (normalized.startsWith("INSERT INTO portal_users")) {
          if (this.users.some((item) => item.username === values[1])) throw new Error("UNIQUE constraint failed");
          this.users.push({ id: values[0], username: values[1], display_name: values[2], password_hash: values[3], password_salt: values[4], password_iterations: values[5], role: values[6], disabled: 0, failed_attempts: 0, locked_until: null, created_at: values[7], updated_at: values[8], last_login_at: null });
          return { success: true };
        }
        if (normalized.startsWith("INSERT INTO portal_sessions")) {
          this.sessions.push({ id: values[0], user_id: values[1], token_hash: values[2], created_at: values[3], last_seen_at: values[4], expires_at: values[5], user_agent: values[6] });
          return { success: true };
        }
        if (normalized.startsWith("DELETE FROM portal_sessions WHERE expires_at")) {
          this.sessions = this.sessions.filter((item) => item.expires_at > values[0]); return { success: true };
        }
        if (normalized.startsWith("DELETE FROM portal_sessions WHERE token_hash")) {
          this.sessions = this.sessions.filter((item) => item.token_hash !== values[0]); return { success: true };
        }
        if (normalized.startsWith("DELETE FROM portal_sessions WHERE user_id")) {
          this.sessions = this.sessions.filter((item) => item.user_id !== values[0]); return { success: true };
        }
        if (normalized.startsWith("DELETE FROM portal_sessions WHERE id")) {
          this.sessions = this.sessions.filter((item) => item.id !== values[0]); return { success: true };
        }
        if (normalized.startsWith("DELETE FROM portal_users WHERE id")) {
          this.users = this.users.filter((item) => item.id !== values[0]); return { success: true };
        }
        if (normalized.startsWith("UPDATE portal_sessions SET last_seen_at")) {
          const row = this.sessions.find((item) => item.id === values[1]); if (row) row.last_seen_at = values[0]; return { success: true };
        }
        if (normalized.startsWith("UPDATE portal_users SET failed_attempts = 0, locked_until = NULL, last_login_at")) {
          const row = this.users.find((item) => item.id === values[2]); Object.assign(row, { failed_attempts: 0, locked_until: null, last_login_at: values[0], updated_at: values[1] }); return { success: true };
        }
        if (normalized.startsWith("UPDATE portal_users SET failed_attempts = ?, locked_until")) {
          const row = this.users.find((item) => item.id === values[3]); Object.assign(row, { failed_attempts: values[0], locked_until: values[1], updated_at: values[2] }); return { success: true };
        }
        if (normalized.startsWith("UPDATE portal_users SET password_hash")) {
          const row = this.users.find((item) => item.id === values[4]); Object.assign(row, { password_hash: values[0], password_salt: values[1], password_iterations: values[2], failed_attempts: 0, locked_until: null, updated_at: values[3] }); return { success: true };
        }
        if (normalized.startsWith("UPDATE portal_users SET display_name")) {
          const row = this.users.find((item) => item.id === values[6]); Object.assign(row, { display_name: values[0], role: values[1], disabled: values[2], updated_at: values[5] }); return { success: true };
        }
        throw new Error(`Unsupported run SQL: ${normalized}`);
      },
      first: async () => {
        if (normalized.startsWith("SELECT COUNT(*) AS count FROM portal_users WHERE role")) return { count: this.users.filter((item) => item.role === "admin" && item.disabled === 0 && item.id !== values[0]).length };
        if (normalized.startsWith("SELECT COUNT(*) AS count FROM portal_users")) return { count: this.users.length };
        if (normalized.includes("FROM portal_users WHERE username = ?")) return this.users.find((item) => item.username === values[0]) ?? null;
        if (normalized.includes("FROM portal_users WHERE id = ?")) return this.users.find((item) => item.id === values[0]) ?? null;
        if (normalized.includes("FROM portal_sessions s JOIN portal_users u")) {
          const session = this.sessions.find((item) => item.token_hash === values[0]);
          const user = session && this.users.find((item) => item.id === session.user_id);
          return session && user ? { ...session, username: user.username, display_name: user.display_name, role: user.role, disabled: user.disabled } : null;
        }
        throw new Error(`Unsupported first SQL: ${normalized}`);
      },
      all: async () => ({ results: [] }),
    };
    return statement;
  }
}

const env = () => ({ DB: new LocalAuthMemoryD1(), PORTAL_SESSION_TTL_HOURS: "4" });

test("creates a local user, authenticates with PBKDF2 and resolves an HttpOnly session", async () => {
  const context = env();
  const user = await createLocalUser(context, { username: "operator01", displayName: "Operator", password: "correct-horse-battery", role: "operator" });
  assert.equal(user.role, "operator");
  assert.notEqual(context.DB.users[0].password_hash, "correct-horse-battery");
  assert.ok(context.DB.users[0].password_salt);

  const login = await authenticateLocalUser(context, "operator01", "correct-horse-battery", "node-test");
  const cookie = localSessionCookie(new Request("http://portal.local/api/auth/login"), login.token, login.maxAge);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const request = new Request("http://portal.local/api/auth/session", { headers: { cookie: cookie.split(";")[0] } });
  const session = await resolveLocalSession(context, request);
  assert.equal(session?.username, "operator01");
  assert.equal(session?.role, "operator");
});

test("protects the last active administrator", async () => {
  const context = env();
  const admin = await createLocalUser(context, { username: "admin01", password: "admin-password-strong", role: "admin" });
  await assert.rejects(() => updateLocalUser(context, admin.id, { role: "viewer" }), /последнего активного администратора/);
  const second = await createLocalUser(context, { username: "admin02", password: "second-admin-password", role: "admin" });
  const changed = await updateLocalUser(context, admin.id, { role: "viewer" });
  assert.equal(changed.role, "viewer");
  assert.equal(second.role, "admin");
});

test("password reset revokes sessions and invalidates the old password", async () => {
  const context = env();
  const user = await createLocalUser(context, { username: "viewer01", password: "initial-password-strong", role: "viewer" });
  await authenticateLocalUser(context, "viewer01", "initial-password-strong");
  assert.equal(context.DB.sessions.length, 1);
  await resetLocalUserPassword(context, user.id, "replacement-password-strong");
  assert.equal(context.DB.sessions.length, 0);
  await assert.rejects(() => authenticateLocalUser(context, "viewer01", "initial-password-strong"), /Неверный логин или пароль/);
  const login = await authenticateLocalUser(context, "viewer01", "replacement-password-strong");
  assert.equal(login.session.username, "viewer01");
});
