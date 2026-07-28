import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

function syntaxCheck(url) {
  const path = fileURLToPath(url);
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  assert.equal(result.status, 0, `${path}: ${result.stderr || result.stdout}`);
}

test("XYOps lifecycle E2E harness is isolated and covers approval, cancellation and results", async () => {
  const mockUrl = new URL("../e2e/xyops-mock.mjs", import.meta.url);
  const specUrl = new URL("../e2e/specs/xyops-lifecycle.spec.mjs", import.meta.url);
  const [compose, env, mock, spec] = await Promise.all([
    readFile(new URL("../compose.e2e.yaml", import.meta.url), "utf8"),
    readFile(new URL("../.env.e2e.example", import.meta.url), "utf8"),
    readFile(mockUrl, "utf8"),
    readFile(specUrl, "utf8"),
  ]);

  syntaxCheck(mockUrl);
  syntaxCheck(specUrl);

  assert.match(compose, /xyops-mock:/);
  assert.match(compose, /\$\$\{XYOPS_URL\}\/health/);
  assert.match(compose, /xyops-mock:\s*\n\s*condition: service_healthy/);
  assert.match(env, /^XYOPS_URL=http:\/\/127\.0\.0\.1:3902$/m);
  assert.match(env, /^XYOPS_API_KEY=e2e-xyops-api-key$/m);

  for (const endpoint of ["get_events/v1", "run_event/v1", "get_active_jobs/v1", "get_jobs/v1", "abort_job/v1"]) {
    assert.match(mock, new RegExp(endpoint.replace("/", "\\/")));
  }
  assert.match(mock, /Lifecycle completed through XYOps mock/);
  assert.match(mock, /status: "cancelled"/);
  assert.match(mock, /maxBodyBytes = 64 \* 1024/);
  assert.match(mock, /Request body is too large/);
  assert.match(mock, /XYOPS_MOCK_API_KEY is required/);

  assert.match(spec, /process\.env\.XYOPS_URL/);
  assert.match(spec, /127\.0\.0\.1/);
  assert.doesNotMatch(spec, /127\.0\.0\.1:3902/);
  assert.match(spec, /Runs API failed/);
  assert.match(spec, /XYOps mock reset failed/);
  assert.match(spec, /role: "operator"/);
  assert.match(spec, /Одобрить/);
  assert.match(spec, /Выполнить в XYOps/);
  assert.match(spec, /Остановить задание/);
  assert.match(spec, /Выходные данные задания/);
  assert.doesNotMatch(env, /https?:\/\/(?!127\.0\.0\.1)/);
});
