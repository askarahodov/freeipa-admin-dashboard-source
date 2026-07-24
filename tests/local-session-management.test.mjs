import assert from "node:assert/strict";
import test from "node:test";

import { listLocalPortalSessions, revokeLocalPortalSession } from "../local-session-management.ts";

class SessionMemoryD1 {
  users = [
    { id: "user-admin", username: "admin", display_name: "Administrator", role: "admin" },
    { id: "user-ops", username: "operator", display_name: "Operator", role: "operator" },
  ];
  sessions = [
    { id: "session-current", user_id: "user-admin", created_at: 100, last_seen_at: 300, expires_at: Date.now() + 60_000, user_agent: "Firefox Linux" },
    { id: "session-ops", user_id: "user-ops", created_at: 200, last_seen_at: 400, expires_at: Date.now() + 120_000, user_agent: "Chrome Windows" },
    { id: "session-expired", user_id: "user-ops", created_at: 50, last_seen_at: 60, expires_at: Date.now() - 1, user_agent: "Old client" },
  ];

  prepare(sql) {
    let values = [];
    const normalized = sql.replace(/\s+/g, " ").trim();
    const joined = (session) => {
      const user = this.users.find((item) => item.id === session.user_id);
      return user ? { ...session, username: user.username, display_name: user.display_name, role: user.role } : null;
    };
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (normalized.startsWith("CREATE ")) return { success: true };
        if (normalized.startsWith("DELETE FROM portal_sessions WHERE expires_at")) {
          this.sessions = this.sessions.filter((item) => item.expires_at > values[0]);
          return { success: true };
        }
        if (normalized.startsWith("DELETE FROM portal_sessions WHERE id")) {
          this.sessions = this.sessions.filter((item) => item.id !== values[0]);
          return { success: true };
        }
        throw new Error(`Unsupported run SQL: ${normalized}`);
      },
      all: async () => {
        if (normalized.includes("FROM portal_sessions s JOIN portal_users u") && normalized.includes("ORDER BY s.last_seen_at DESC")) {
          const rows = this.sessions
            .filter((item) => item.expires_at > values[0])
            .sort((left, right) => right.last_seen_at - left.last_seen_at)
            .slice(0, values[1])
            .map(joined)
            .filter(Boolean);
          return { results: rows };
        }
        throw new Error(`Unsupported all SQL: ${normalized}`);
      },
      first: async () => {
        if (normalized.includes("FROM portal_sessions s JOIN portal_users u") && normalized.includes("WHERE s.id = ?")) {
          const session = this.sessions.find((item) => item.id === values[0]);
          return session ? joined(session) : null;
        }
        throw new Error(`Unsupported first SQL: ${normalized}`);
      },
    };
    return statement;
  }
}

test("lists only active local sessions with safe user metadata", async () => {
  const env = { DB: new SessionMemoryD1() };
  const sessions = await listLocalPortalSessions(env, 50);
  assert.deepEqual(sessions.map((item) => item.id), ["session-ops", "session-current"]);
  assert.equal(sessions[0].username, "operator");
  assert.equal(sessions[0].role, "operator");
  assert.equal(sessions[0].userAgent, "Chrome Windows");
  assert.equal(env.DB.sessions.some((item) => item.id === "session-expired"), false);
  assert.equal("tokenHash" in sessions[0], false);
});

test("revokes one selected session without affecting other sessions", async () => {
  const env = { DB: new SessionMemoryD1() };
  const revoked = await revokeLocalPortalSession(env, "session-ops");
  assert.equal(revoked.username, "operator");
  assert.deepEqual(env.DB.sessions.map((item) => item.id), ["session-current", "session-expired"]);
  await assert.rejects(() => revokeLocalPortalSession(env, "missing-session"), /не найдена/);
});