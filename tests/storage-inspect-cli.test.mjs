import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStorageInspectCli,
  runStorageInspectCli,
  StorageInspectCliError,
} from "../storage-inspect-cli.ts";

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

test("CLI parser accepts only a portal origin, bounded timeout and environment token", () => {
  const options = parseStorageInspectCli(
    ["--url", "https://portal.test", "--timeout-ms", "1500"],
    { ADMIN_TOKEN: "service-token-sentinel" },
  );
  assert.deepEqual(options, {
    portalUrl: "https://portal.test",
    adminToken: "service-token-sentinel",
    timeoutMs: 1500,
  });

  assert.deepEqual(
    parseStorageInspectCli([], {
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

test("CLI parser rejects token arguments and unsafe or ambiguous URLs", () => {
  const cases = [
    { argv: [], env: {}, code: "storage_inspect_admin_token_required" },
    { argv: ["--token", "secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_inspect_token_argument_forbidden" },
    { argv: ["--admin-token=secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_inspect_token_argument_forbidden" },
    { argv: ["--header", "x-admin-token: secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_inspect_token_argument_forbidden" },
    { argv: ["--url", "ftp://portal.test"], env: { ADMIN_TOKEN: "env" }, code: "storage_inspect_url_invalid" },
    { argv: ["--url", "https://user:password@portal.test"], env: { ADMIN_TOKEN: "env" }, code: "storage_inspect_url_invalid" },
    { argv: ["--url", "https://portal.test/private/path"], env: { ADMIN_TOKEN: "env" }, code: "storage_inspect_url_invalid" },
    { argv: ["--url", "https://portal.test?token=secret"], env: { ADMIN_TOKEN: "env" }, code: "storage_inspect_url_invalid" },
    { argv: ["--timeout-ms", "499"], env: { ADMIN_TOKEN: "env" }, code: "storage_inspect_timeout_invalid" },
    { argv: ["--timeout-ms", "30001"], env: { ADMIN_TOKEN: "env" }, code: "storage_inspect_timeout_invalid" },
    { argv: ["--unknown"], env: { ADMIN_TOKEN: "env" }, code: "storage_inspect_argument_unknown" },
  ];

  for (const entry of cases) {
    assert.throws(
      () => parseStorageInspectCli(entry.argv, entry.env),
      (error) => error instanceof StorageInspectCliError && error.code === entry.code,
    );
  }
});

test("CLI fetches the exact storage endpoint and prints sanitized JSON", async () => {
  const calls = [];
  const payload = {
    contractVersion: "1",
    state: "healthy",
    database: { available: true },
  };
  const result = await runStorageInspectCli(
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
  assert.equal(calls[0].url, "https://portal.test/api/admin/storage/status");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers.accept, "application/json");
  assert.equal(calls[0].init.headers["x-admin-token"], "service-token-sentinel");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("degraded is inspectable while unavailable produces a nonzero support result", async () => {
  for (const [payload, status, exitCode] of [
    [{ contractVersion: "1", state: "degraded", code: "storage_size_unavailable" }, 200, 0],
    [{ contractVersion: "1", state: "unavailable", code: "storage_database_unavailable" }, 503, 2],
  ]) {
    const result = await runStorageInspectCli(
      { portalUrl: "https://portal.test", adminToken: "env-token", timeoutMs: 1000 },
      { fetchImpl: async () => jsonResponse(payload, status) },
    );
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${JSON.stringify(payload, null, 2)}\n`);
  }
});

test("authentication and server failures never print raw response bodies", async () => {
  const secret = "internal-url.example bearer-token-sentinel raw-stack-sentinel";
  for (const [status, code, exitCode] of [
    [401, "storage_inspect_unauthorized", 3],
    [403, "storage_inspect_unauthorized", 3],
    [500, "storage_inspect_server_error", 2],
  ]) {
    const result = await runStorageInspectCli(
      { portalUrl: "https://portal.test", adminToken: "env-token", timeoutMs: 1000 },
      { fetchImpl: async () => jsonResponse({ error: secret }, status) },
    );
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${JSON.stringify({ ok: false, code })}\n`);
    assert.equal(result.stderr.includes(secret), false);
  }
});

test("non-JSON, redirects, timeout and network errors use fixed safe codes", async () => {
  const secret = "database-password-sentinel raw-upstream-body";
  const cases = [
    {
      fetchImpl: async () => new Response(secret, { status: 200, headers: { "content-type": "text/plain" } }),
      code: "storage_inspect_protocol_error",
      exitCode: 5,
    },
    {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: `https://${secret}.example` } }),
      code: "storage_inspect_protocol_error",
      exitCode: 5,
    },
    {
      fetchImpl: async () => { const error = new Error(secret); error.name = "AbortError"; throw error; },
      code: "storage_inspect_timeout",
      exitCode: 4,
    },
    {
      fetchImpl: async () => { throw new Error(secret); },
      code: "storage_inspect_network_error",
      exitCode: 4,
    },
  ];

  for (const entry of cases) {
    const result = await runStorageInspectCli(
      { portalUrl: "https://portal.test", adminToken: "env-token", timeoutMs: 1000 },
      { fetchImpl: entry.fetchImpl },
    );
    assert.equal(result.exitCode, entry.exitCode);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${JSON.stringify({ ok: false, code: entry.code })}\n`);
    assert.equal(result.stderr.includes(secret), false);
  }
});
