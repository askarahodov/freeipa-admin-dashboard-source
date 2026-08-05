import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStorageIntegrityInspectCli,
  runStorageIntegrityInspectCli,
  StorageIntegrityInspectCliError,
} from "../storage-integrity-inspect-cli.ts";

function validPayload(state = "healthy") {
  const unavailable = state === "unavailable";
  const degraded = state === "degraded";
  return {
    contractVersion: "1",
    generatedAt: 1_754_400_000_000,
    durationMs: 12,
    state,
    quickCheck: unavailable
      ? { state: "unavailable", code: "storage_quick_check_unavailable" }
      : degraded
        ? { state: "failed", code: "storage_quick_check_failed" }
        : { state: "healthy", code: "storage_quick_check_ok" },
    indexes: unavailable
      ? { expected: 19, present: 0, missing: 0, mismatched: 0, unexpected: 0, code: "storage_indexes_unavailable" }
      : degraded
        ? { expected: 19, present: 18, missing: 1, mismatched: 0, unexpected: 0, code: "storage_indexes_degraded" }
        : { expected: 19, present: 19, missing: 0, mismatched: 0, unexpected: 0, code: "storage_indexes_ready" },
    correlationId: "cor_abcdef0123456789abcdef0123456789",
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

test("integrity CLI parser accepts only a portal origin, bounded timeout and environment token", () => {
  assert.deepEqual(
    parseStorageIntegrityInspectCli(
      ["--url", "https://portal.test", "--timeout-ms", "1500"],
      { ADMIN_TOKEN: "service-token-sentinel" },
    ),
    {
      portalUrl: "https://portal.test",
      adminToken: "service-token-sentinel",
      timeoutMs: 1500,
    },
  );

  assert.deepEqual(
    parseStorageIntegrityInspectCli([], {
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

test("integrity CLI parser rejects secret arguments and unsafe or ambiguous URLs", () => {
  const cases = [
    { argv: [], env: {}, code: "storage_integrity_inspect_admin_token_required" },
    { argv: ["--token", "secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_token_argument_forbidden" },
    { argv: ["--admin-token=secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_token_argument_forbidden" },
    { argv: ["--header", "x-admin-token: secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_token_argument_forbidden" },
    { argv: ["--cookie=session=secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_token_argument_forbidden" },
    { argv: ["--url", "ftp://portal.test"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_url_invalid" },
    { argv: ["--url", "https://user:password@portal.test"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_url_invalid" },
    { argv: ["--url", "https://portal.test/private/path"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_url_invalid" },
    { argv: ["--url", "https://portal.test?token=secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_url_invalid" },
    { argv: ["--url", "https://portal.test/#secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_url_invalid" },
    { argv: ["--timeout-ms", "499"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_timeout_invalid" },
    { argv: ["--timeout-ms", "30001"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_timeout_invalid" },
    { argv: ["--unknown"], env: { ADMIN_TOKEN: "env" }, code: "storage_integrity_inspect_argument_unknown" },
  ];

  for (const entry of cases) {
    assert.throws(
      () => parseStorageIntegrityInspectCli(entry.argv, entry.env),
      (error) => error instanceof StorageIntegrityInspectCliError && error.code === entry.code,
    );
  }
});

test("integrity CLI posts to the exact endpoint and prints only validated report JSON", async () => {
  const calls = [];
  const payload = validPayload("healthy");
  const result = await runStorageIntegrityInspectCli(
    {
      portalUrl: "https://portal.test",
      adminToken: "service-token-sentinel",
      timeoutMs: 1500,
    },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse(payload);
      },
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${JSON.stringify(payload, null, 2)}\n`);
  assert.equal(result.stdout.includes("service-token-sentinel"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://portal.test/api/admin/storage/integrity/check");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers.accept, "application/json");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.equal(calls[0].init.headers["x-admin-token"], "service-token-sentinel");
  assert.equal(calls[0].init.body, "{}");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("degraded is inspectable while unavailable produces support exit code 2", async () => {
  for (const [payload, status, exitCode] of [
    [validPayload("degraded"), 200, 0],
    [validPayload("unavailable"), 503, 2],
  ]) {
    const result = await runStorageIntegrityInspectCli(
      { portalUrl: "https://portal.test", adminToken: "env-token", timeoutMs: 1000 },
      { fetchImpl: async () => jsonResponse(payload, status) },
    );
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${JSON.stringify(payload, null, 2)}\n`);
  }
});

test("invalid integrity contracts are rejected without printing raw payload fields", async () => {
  const invalidPayloads = [
    { contractVersion: "2", state: "healthy" },
    { ...validPayload(), durationMs: -1 },
    { ...validPayload(), quickCheck: { state: "healthy", code: "raw-private-code" } },
    { ...validPayload(), indexes: { ...validPayload().indexes, missing: 10_001 } },
    { ...validPayload(), correlationId: "private-url.example" },
  ];

  for (const payload of invalidPayloads) {
    const result = await runStorageIntegrityInspectCli(
      { portalUrl: "https://portal.test", adminToken: "env-token", timeoutMs: 1000 },
      { fetchImpl: async () => jsonResponse(payload) },
    );
    assert.equal(result.exitCode, 5);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${JSON.stringify({ ok: false, code: "storage_integrity_inspect_protocol_error" })}\n`);
    assert.equal(result.stderr.includes("raw-private-code"), false);
    assert.equal(result.stderr.includes("private-url.example"), false);
  }
});

test("authentication and server failures never print raw response bodies", async () => {
  const secret = "internal-url.example bearer-token-sentinel raw-stack-sentinel";
  for (const [status, code, exitCode] of [
    [401, "storage_integrity_inspect_unauthorized", 3],
    [403, "storage_integrity_inspect_unauthorized", 3],
    [500, "storage_integrity_inspect_server_error", 2],
  ]) {
    const result = await runStorageIntegrityInspectCli(
      { portalUrl: "https://portal.test", adminToken: "env-token", timeoutMs: 1000 },
      { fetchImpl: async () => jsonResponse({ error: secret }, status) },
    );
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${JSON.stringify({ ok: false, code })}\n`);
    assert.equal(result.stderr.includes(secret), false);
  }
});

test("non-JSON redirects timeout and network errors use fixed safe codes", async () => {
  const secret = "database-password-sentinel raw-upstream-body";
  const cases = [
    {
      fetchImpl: async () => new Response(secret, { status: 200, headers: { "content-type": "text/plain" } }),
      code: "storage_integrity_inspect_protocol_error",
      exitCode: 5,
    },
    {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: `https://${secret}.example` } }),
      code: "storage_integrity_inspect_protocol_error",
      exitCode: 5,
    },
    {
      fetchImpl: async () => { const error = new Error(secret); error.name = "AbortError"; throw error; },
      code: "storage_integrity_inspect_timeout",
      exitCode: 4,
    },
    {
      fetchImpl: async () => { throw new Error(secret); },
      code: "storage_integrity_inspect_network_error",
      exitCode: 4,
    },
  ];

  for (const entry of cases) {
    const result = await runStorageIntegrityInspectCli(
      { portalUrl: "https://portal.test", adminToken: "env-token", timeoutMs: 1000 },
      { fetchImpl: entry.fetchImpl },
    );
    assert.equal(result.exitCode, entry.exitCode);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${JSON.stringify({ ok: false, code: entry.code })}\n`);
    assert.equal(result.stderr.includes(secret), false);
  }
});
