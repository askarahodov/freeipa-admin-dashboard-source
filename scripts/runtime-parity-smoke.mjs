import assert from "node:assert/strict";

export const COMMON_PARITY_PATHS = ["/health/live", "/api/schema/status"];

const liveKeys = ["contractVersion", "service", "check", "state", "code", "ok"];

function comparableBody(path, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (path === "/health/live") {
    return Object.fromEntries(liveKeys.map((key) => [key, body[key]]));
  }
  if (path === "/api/schema/status") return { code: body.code };
  return body;
}

export function assertCommonParity(legacy, candidate) {
  for (const path of COMMON_PARITY_PATHS) {
    assert.ok(legacy[path], `legacy runtime did not return ${path}`);
    assert.ok(candidate[path], `candidate runtime did not return ${path}`);
    assert.equal(
      candidate[path].status,
      legacy[path].status,
      `${path} status mismatch: legacy=${legacy[path].status} candidate=${candidate[path].status}`,
    );
    assert.deepEqual(
      comparableBody(path, candidate[path].body),
      comparableBody(path, legacy[path].body),
      `${path} body mismatch`,
    );
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export async function probeRuntime(baseUrl, fetchImpl = fetch) {
  const result = {};
  for (const path of COMMON_PARITY_PATHS) {
    const response = await fetchImpl(new URL(path, baseUrl), {
      redirect: "manual",
      headers: { accept: "application/json" },
    });
    result[path] = { status: response.status, body: await readJson(response) };
  }
  return result;
}

async function runCli() {
  const [legacyBaseUrl, candidateBaseUrl] = process.argv.slice(2);
  if (!legacyBaseUrl || !candidateBaseUrl) {
    console.error("Usage: node scripts/runtime-parity-smoke.mjs <legacy-base-url> <candidate-base-url>");
    process.exitCode = 64;
    return;
  }

  const [legacy, candidate] = await Promise.all([
    probeRuntime(legacyBaseUrl),
    probeRuntime(candidateBaseUrl),
  ]);
  assertCommonParity(legacy, candidate);
  console.log(JSON.stringify({ ok: true, paths: COMMON_PARITY_PATHS }));
}

if (process.argv[1]?.endsWith("runtime-parity-smoke.mjs")) {
  await runCli();
}
