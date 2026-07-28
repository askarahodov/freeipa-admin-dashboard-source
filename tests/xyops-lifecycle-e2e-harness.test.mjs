import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

function syntaxCheck(path) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  assert.equal(result.status, 0, `${path}: ${result.stderr || result.stdout}`);
}

test("XYOps lifecycle E2E harness is isolated and covers approval, cancellation and results", async () => {
  const [compose, env, mock, spec] = await Promise.all([
    readFile(new URL("../compose.e2e.yaml", import.meta.url), "utf8"),
    readFile(new URL("../.env.e2e.example", import.meta.url), "utf8"),
    readFile(new URL("../e2e/xyops-mock.mjs", import.meta.url), "utf8"),
    readFile(new URL("../e2e/specs/xyops-lifecycle.spec.mjs", import.meta.url), "utf8"),
  ]);

  syntaxCheck(new URL("../e2e/xyops-mock.mjs", import.meta.url));
  syntaxCheck(new URL("../e2e/specs/xyops-lifecycle.spec.mjs", import.meta.url));

  assert.match(compose, /xyops-mock:/);
  assert.match(compose, /http:\/\/127\.0\.0\.1:3902\/health/);
  assert.match(compose, /xyops-mock:\s*\n\s*condition: service_healthy/);
  assert.match(env, /^XYOPS_URL=http:\/\/127\.0\.0\.1:3902$/m);
  assert.match(env, /^XYOPS_API_KEY=e2e-xyops-api-key$/m);

  for (const endpoint of ["get_events/v1", "run_event/v1", "get_active_jobs/v1", "get_jobs/v1", "abort_job/v1"]) {
    assert.match(mock, new RegExp(endpoint.replace("/", "\\/")));
  }
  assert.match(mock, /Lifecycle completed through XYOps mock/);
  assert.match(mock, /status: "cancelled"/);

  assert.match(spec, /role: "operator"/);
  assert.match(spec, /Одобрить/);
  assert.match(spec, /Выполнить в XYOps/);
  assert.match(spec, /Остановить задание/);
  assert.match(spec, /Выходные данные задания/);
  assert.doesNotMatch(env, /https?:\/\/(?!127\.0\.0\.1)/);
});
