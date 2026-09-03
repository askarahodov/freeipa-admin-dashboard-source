import assert from "node:assert/strict";
import test from "node:test";

import {
  checkLoginRateLimit,
  loginClientSubject,
  loginCooldownMs,
  loginRateLimitContract,
  normalizeLoginSubject,
  recordLoginFailure,
  recordLoginSuccess,
} from "../login-rate-limit.ts";

class RateLimitMemoryD1 {
  rows = new Map();

  prepare(sql) {
    let values = [];
    const normalized = sql.replace(/\s+/g, " ").trim();
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (normalized.startsWith("CREATE TABLE IF NOT EXISTS portal_login_rate_limits")) return { success: true };
        if (normalized.startsWith("DELETE FROM portal_login_rate_limits WHERE updated_at <")) {
          for (const [key, row] of this.rows) if (row.updated_at < values[0]) this.rows.delete(key);
          return { success: true };
        }
        if (normalized.startsWith("DELETE FROM portal_login_rate_limits WHERE scope = 'username'")) {
          this.rows.delete(`username:${values[0]}`);
          return { success: true };
        }
        if (normalized.startsWith("UPDATE portal_login_rate_limits SET blocked_until")) {
          const key = `${values[2]}:${values[3]}`;
          const row = this.rows.get(key);
          if (row) {
            row.blocked_until = Math.max(row.blocked_until, values[0]);
            row.updated_at = values[1];
          }
          return { success: true };
        }
        throw new Error(`Unsupported run SQL: ${normalized}`);
      },
      first: async () => {
        if (normalized.startsWith("SELECT failures, window_started_at")) {
          return this.rows.get(`${values[0]}:${values[1]}`) ?? null;
        }
        if (normalized.startsWith("INSERT INTO portal_login_rate_limits")) {
          const [scope, hash, now, updatedAt, resetBeforeA, resetBeforeB, resetAt, nextUpdatedAt] = values;
          const key = `${scope}:${hash}`;
          const existing = this.rows.get(key);
          if (!existing) {
            const row = { failures: 1, window_started_at: now, blocked_until: 0, updated_at: updatedAt };
            this.rows.set(key, row);
            return { ...row };
          }
          const reset = existing.window_started_at <= resetBeforeA || existing.window_started_at <= resetBeforeB;
          existing.failures = reset ? 1 : existing.failures + 1;
          if (reset) existing.window_started_at = resetAt;
          existing.updated_at = nextUpdatedAt;
          return { ...existing };
        }
        throw new Error(`Unsupported first SQL: ${normalized}`);
      },
    };
    return statement;
  }
}

const request = (headers = {}) => new Request("https://portal.example/api/auth/login", { headers });

test("normalizes usernames without preserving attacker-controlled case or whitespace", () => {
  assert.equal(normalizeLoginSubject("  Admin.User  "), "admin.user");
  assert.equal(normalizeLoginSubject(""), "invalid-login");
});

test("does not trust forwarded IP headers unless the proxy boundary is explicitly authenticated", () => {
  const forged = request({ "x-forwarded-for": "203.0.113.90" });
  assert.equal(loginClientSubject(forged, {}), "unidentified-client");
  assert.equal(loginClientSubject(forged, { PORTAL_CLIENT_IP_SOURCE: "trusted-proxy", PORTAL_TRUSTED_PROXY_SECRET: "expected" }), "unidentified-client");

  const trusted = request({ "x-forwarded-for": "203.0.113.90, 10.0.0.2", "x-portal-proxy-secret": "expected" });
  assert.equal(loginClientSubject(trusted, { PORTAL_CLIENT_IP_SOURCE: "trusted-proxy", PORTAL_TRUSTED_PROXY_SECRET: "expected" }), "203.0.113.90");
});

test("supports an explicit Cloudflare edge client identity mode", () => {
  const edge = request({ "cf-connecting-ip": "2001:db8::10", "x-forwarded-for": "198.51.100.44" });
  assert.equal(loginClientSubject(edge, { PORTAL_CLIENT_IP_SOURCE: "cloudflare" }), "2001:db8::10");
});

test("cooldown grows exponentially but remains bounded", () => {
  const limit = loginRateLimitContract.usernameLimit;
  assert.equal(loginCooldownMs(limit - 1, limit), 0);
  assert.equal(loginCooldownMs(limit, limit), 1_000);
  assert.equal(loginCooldownMs(limit + 1, limit), 2_000);
  assert.equal(loginCooldownMs(limit + 20, limit), loginRateLimitContract.maxCooldownMs);
});

test("persists username throttling across limiter instances and recovers after cooldown", async () => {
  const DB = new RateLimitMemoryD1();
  const env = { DB };
  const now = 1_000_000;
  let decision;
  for (let index = 0; index < loginRateLimitContract.usernameLimit; index += 1) {
    decision = await recordLoginFailure(env, request(), "Admin01", now + index);
  }
  assert.equal(decision.limited, true);
  assert.equal(decision.scope, "username");
  assert.ok(decision.retryAfterSeconds >= 1);

  const persisted = await checkLoginRateLimit({ DB }, request(), "admin01", now + 100);
  assert.equal(persisted.limited, true);

  const recovered = await checkLoginRateLimit({ DB }, request(), "admin01", now + loginRateLimitContract.maxCooldownMs + 10_000);
  assert.equal(recovered.limited, false);
});

test("successful authentication clears only the username limiter state", async () => {
  const DB = new RateLimitMemoryD1();
  const env = { DB };
  for (let index = 0; index < loginRateLimitContract.usernameLimit; index += 1) {
    await recordLoginFailure(env, request(), "operator01", 2_000_000 + index);
  }
  assert.equal((await checkLoginRateLimit(env, request(), "operator01", 2_000_100)).limited, true);
  await recordLoginSuccess(env, "operator01");
  assert.equal((await checkLoginRateLimit(env, request(), "operator01", 2_000_100)).limited, false);
});

test("concurrent failures cannot lose increments below the username threshold", async () => {
  const DB = new RateLimitMemoryD1();
  const env = { DB };
  const outcomes = await Promise.all(Array.from(
    { length: loginRateLimitContract.usernameLimit },
    (_, index) => recordLoginFailure(env, request(), "parallel01", 3_000_000 + index),
  ));
  assert.equal(outcomes.some((item) => item.limited && item.scope === "username"), true);
});

test("cleanup removes stale counters while retaining active windows", async () => {
  const DB = new RateLimitMemoryD1();
  DB.rows.set("stale:row", { failures: 99, window_started_at: 0, blocked_until: 0, updated_at: 1 });
  await recordLoginFailure({ DB }, request(), "cleanup01", loginRateLimitContract.retentionMs + 10_000);
  assert.equal(DB.rows.has("stale:row"), false);
});
