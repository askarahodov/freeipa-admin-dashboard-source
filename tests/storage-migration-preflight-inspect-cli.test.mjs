import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStorageMigrationPreflightInspectCli,
  runStorageMigrationPreflightInspectCli,
  StorageMigrationPreflightInspectCliError,
} from "../src/storage/migration/preflight/storage-migration-preflight-inspect-cli.ts";

function validPayload(state = "ready") {
  const notRequired = state === "not_required";
  const blocked = state === "blocked";
  const unavailable = state === "unavailable";
  return {
    contractVersion: "1",
    generatedAt: 1_754_400_000_000,
    durationMs: 12,
    state,
    decision: state === "ready" ? "allow" : "deny",
    code: state === "ready"
      ? "migration_preflight_ready"
      : notRequired
        ? "migration_preflight_not_required"
        : blocked
          ? "migration_backup_missing"
          : "migration_preflight_unavailable",
    pendingMigrationCount: notRequired || unavailable ? 0 : 1,
    schema: unavailable
      ? { state: "unavailable", currentVersion: null, latestVersion: 4, code: "migration_schema_unavailable" }
      : { state: "ready", currentVersion: notRequired ? 4 : 3, latestVersion: 4, code: "migration_schema_ready" },
    journal: unavailable
      ? { state: "unavailable", appliedCount: 0, pendingCount: 0, code: "migration_journal_unavailable" }
      : { state: "valid", appliedCount: notRequired ? 4 : 3, pendingCount: notRequired ? 0 : 1, code: "migration_journal_valid" },
    integrity: notRequired
      ? { state: "not_required", code: "migration_quick_check_not_required" }
      : unavailable
        ? { state: "unavailable", code: "migration_quick_check_unavailable" }
        : { state: "healthy", code: "migration_quick_check_ok" },
    backup: notRequired
      ? { state: "not_required", ageMs: null, maxAgeMs: 86_400_000, code: "migration_backup_not_required" }
      : unavailable
        ? { state: "unavailable", ageMs: null, maxAgeMs: 86_400_000, code: "migration_backup_unavailable" }
        : blocked
          ? { state: "missing", ageMs: null, maxAgeMs: 86_400_000, code: "migration_backup_missing" }
          : { state: "ready", ageMs: 500, maxAgeMs: 86_400_000, code: "migration_backup_ready" },
    lock: notRequired
      ? { state: "not_required", blocking: false, ageMs: null, ttlMs: 60_000, code: "migration_lock_not_required" }
      : unavailable
        ? { state: "unavailable", blocking: true, ageMs: null, ttlMs: 60_000, code: "migration_lock_unavailable" }
        : { state: "available", blocking: false, ageMs: null, ttlMs: 60_000, code: "migration_lock_available" },
    correlationId: "cor_abcdef0123456789abcdef0123456789",
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

const options = {
  portalUrl: "https://portal.test",
  adminToken: "service-token-sentinel",
  timeoutMs: 1500,
};

test("migration preflight CLI parser accepts only portal origin timeout and environment token", () => {
  assert.deepEqual(
    parseStorageMigrationPreflightInspectCli(
      ["--url", "https://portal.test", "--timeout-ms", "1500"],
      { ADMIN_TOKEN: "service-token-sentinel" },
    ),
    options,
  );
  assert.deepEqual(
    parseStorageMigrationPreflightInspectCli([], {
      PORTAL_URL: "http://127.0.0.1:3001/",
      ADMIN_TOKEN: "environment-only-token",
    }),
    {
      portalUrl: "http://127.0.0.1:3001",
      adminToken: "environment-only-token",
      timeoutMs: 5000,
    },
  );
});

test("migration preflight CLI parser rejects secret arguments unsafe URLs and invalid bounds", () => {
  const cases = [
    { argv: [], env: {}, code: "storage_migration_preflight_inspect_admin_token_required" },
    { argv: ["--token", "secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_migration_preflight_inspect_token_argument_forbidden" },
    { argv: ["--admin-token=secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_migration_preflight_inspect_token_argument_forbidden" },
    { argv: ["--header", "x-admin-token: secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_migration_preflight_inspect_token_argument_forbidden" },
    { argv: ["--cookie=session=secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_migration_preflight_inspect_token_argument_forbidden" },
    { argv: ["--url", "ftp://portal.test"], env: { ADMIN_TOKEN: "env" }, code: "storage_migration_preflight_inspect_url_invalid" },
    { argv: ["--url", "https://user:password@portal.test"], env: { ADMIN_TOKEN: "env" }, code: "storage_migration_preflight_inspect_url_invalid" },
    { argv: ["--url", "https://portal.test/private"], env: { ADMIN_TOKEN: "env" }, code: "storage_migration_preflight_inspect_url_invalid" },
    { argv: ["--url", "https://portal.test?token=secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_migration_preflight_inspect_url_invalid" },
    { argv: ["--timeout-ms", "499"], env: { ADMIN_TOKEN: "env" }, code: "storage_migration_preflight_inspect_timeout_invalid" },
    { argv: ["--timeout-ms", "30001"], env: { ADMIN_TOKEN: "env" }, code: "storage_migration_preflight_inspect_timeout_invalid" },
    { argv: ["--unknown"], env: { ADMIN_TOKEN: "env" }, code: "storage_migration_preflight_inspect_argument_unknown" },
  ];
  for (const entry of cases) {
    assert.throws(
      () => parseStorageMigrationPreflightInspectCli(entry.argv, entry.env),
      (error) => error instanceof StorageMigrationPreflightInspectCliError && error.code === entry.code,
    );
  }
});

test("migration preflight CLI posts exact empty request and prints validated report only", async () => {
  const calls = [];
  const payload = validPayload("ready");
  const result = await runStorageMigrationPreflightInspectCli(options, {
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(payload);
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${JSON.stringify(payload, null, 2)}\n`);
  assert.equal(result.stdout.includes(options.adminToken), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://portal.test/api/admin/storage/migrations/preflight");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers.accept, "application/json");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.equal(calls[0].init.headers["x-admin-token"], options.adminToken);
  assert.equal(calls[0].init.body, "{}");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("ready and not-required exit zero while blocked and unavailable exit two", async () => {
  for (const [state, status, exitCode] of [
    ["ready", 200, 0],
    ["not_required", 200, 0],
    ["blocked", 200, 2],
    ["unavailable", 503, 2],
  ]) {
    const payload = validPayload(state);
    const result = await runStorageMigrationPreflightInspectCli(options, {
      fetchImpl: async () => jsonResponse(payload, status),
    });
    assert.equal(result.exitCode, exitCode, state);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${JSON.stringify(payload, null, 2)}\n`);
  }
});

test("strict validator rejects extra fields inconsistent decisions and unsafe bounded values", async () => {
  const invalidPayloads = [
    { ...validPayload(), extra: "raw-private-field" },
    { ...validPayload(), decision: "deny" },
    { ...validPayload(), code: "migration_backup_missing" },
    { ...validPayload(), pendingMigrationCount: 10_001 },
    { ...validPayload(), durationMs: 60_001 },
    { ...validPayload(), correlationId: "https://private.example/token" },
    { ...validPayload(), journal: { ...validPayload().journal, pendingCount: 2 } },
    { ...validPayload(), backup: { ...validPayload().backup, ageMs: null } },
    { ...validPayload("not_required"), lock: { ...validPayload("not_required").lock, blocking: true } },
    { ...validPayload("unavailable"), schema: { ...validPayload("unavailable").schema, currentVersion: 3 } },
  ];
  for (const payload of invalidPayloads) {
    const result = await runStorageMigrationPreflightInspectCli(options, {
      fetchImpl: async () => jsonResponse(payload, payload.state === "unavailable" ? 503 : 200),
    });
    assert.equal(result.exitCode, 5);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${JSON.stringify({ ok: false, code: "storage_migration_preflight_inspect_protocol_error" })}\n`);
    assert.equal(result.stderr.includes("raw-private-field"), false);
    assert.equal(result.stderr.includes("private.example"), false);
  }
});

test("valid held stale and unsupported block reports preserve fixed state invariants", async () => {
  const held = validPayload("blocked");
  held.code = "migration_lock_held";
  held.backup = { state: "ready", ageMs: 1000, maxAgeMs: 86_400_000, code: "migration_backup_ready" };
  held.lock = { state: "held", blocking: true, ageMs: 1000, ttlMs: 60_000, code: "migration_lock_held" };

  const unsupported = validPayload("blocked");
  unsupported.code = "migration_quick_check_unsupported";
  unsupported.integrity = { state: "unsupported", code: "migration_quick_check_unsupported" };
  unsupported.backup = { state: "ready", ageMs: 1000, maxAgeMs: 86_400_000, code: "migration_backup_ready" };

  const stale = validPayload("ready");
  stale.lock = { state: "stale", blocking: false, ageMs: 60_001, ttlMs: 60_000, code: "migration_lock_stale" };

  for (const payload of [held, unsupported, stale]) {
    const result = await runStorageMigrationPreflightInspectCli(options, {
      fetchImpl: async () => jsonResponse(payload),
    });
    assert.equal(result.exitCode, payload.state === "ready" ? 0 : 2);
    assert.equal(result.stderr, "");
  }
});

test("authentication server redirect content timeout and network failures use fixed safe codes", async () => {
  const secret = "private-url.example bearer-token raw-stack";
  const cases = [
    { response: jsonResponse({ error: secret }, 401), code: "storage_migration_preflight_inspect_unauthorized", exitCode: 3 },
    { response: jsonResponse({ error: secret }, 403), code: "storage_migration_preflight_inspect_unauthorized", exitCode: 3 },
    { response: jsonResponse({ error: secret }, 500), code: "storage_migration_preflight_inspect_server_error", exitCode: 2 },
    { response: new Response(null, { status: 302, headers: { location: `https://${secret}` } }), code: "storage_migration_preflight_inspect_protocol_error", exitCode: 5 },
    { response: new Response(secret, { status: 200, headers: { "content-type": "text/plain" } }), code: "storage_migration_preflight_inspect_protocol_error", exitCode: 5 },
  ];
  for (const entry of cases) {
    const result = await runStorageMigrationPreflightInspectCli(options, {
      fetchImpl: async () => entry.response,
    });
    assert.equal(result.exitCode, entry.exitCode);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${JSON.stringify({ ok: false, code: entry.code })}\n`);
    assert.equal(result.stderr.includes(secret), false);
  }

  for (const [name, code] of [
    ["AbortError", "storage_migration_preflight_inspect_timeout"],
    ["Error", "storage_migration_preflight_inspect_network_error"],
  ]) {
    const result = await runStorageMigrationPreflightInspectCli(options, {
      fetchImpl: async () => { const error = new Error(secret); error.name = name; throw error; },
    });
    assert.equal(result.exitCode, 4);
    assert.equal(result.stderr, `${JSON.stringify({ ok: false, code })}\n`);
    assert.equal(result.stderr.includes(secret), false);
  }
});
