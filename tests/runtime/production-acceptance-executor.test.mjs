import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductionAcceptanceManifest,
  scanProductionAcceptanceReport,
  validateProductionAcceptanceManifest,
} from "../../scripts/production-acceptance-contract.mjs";
import {
  evaluateProductionAcceptanceCheck,
  normalizeAcceptanceBaseUrl,
  renderProductionAcceptanceHtml,
  runProductionAcceptance,
} from "../../scripts/production-acceptance-executor.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const image = `registry.example.test/admin-dashboard@${digest}`;
const commit = "b".repeat(40);

function manifest() {
  return createProductionAcceptanceManifest({ imageReference: image, commitSha: commit });
}

function healthyResponse(check) {
  return {
    status: 200,
    jsonValid: true,
    json: { ...check.requiredJson, ignored: "bounded-extra-field" },
  };
}

test("executor validates the versioned immutable manifest before running", () => {
  const valid = manifest();
  assert.equal(validateProductionAcceptanceManifest(valid).projectName, valid.compose.projectName);

  const destructive = structuredClone(valid);
  destructive.destructive = true;
  assert.throws(() => validateProductionAcceptanceManifest(destructive), /acceptance_manifest_mode_invalid/u);

  const wrongProject = structuredClone(valid);
  wrongProject.compose.projectName = "portal-accept-other";
  assert.throws(() => validateProductionAcceptanceManifest(wrongProject), /acceptance_manifest_project_mismatch/u);

  const mutableExecution = structuredClone(valid);
  mutableExecution.compose.args = mutableExecution.compose.args.filter((arg) => arg !== "--no-build");
  assert.throws(() => validateProductionAcceptanceManifest(mutableExecution), /acceptance_manifest_compose_args_invalid/u);

  const weakenedBaseline = structuredClone(valid);
  weakenedBaseline.baseline[1].requiredJson = { ok: true };
  assert.throws(() => validateProductionAcceptanceManifest(weakenedBaseline), /acceptance_manifest_mismatch/u);

  const injectedEnvironment = structuredClone(valid);
  injectedEnvironment.compose.environment.EXTRA_RUNTIME_OVERRIDE = "1";
  assert.throws(() => validateProductionAcceptanceManifest(injectedEnvironment), /acceptance_manifest_mismatch/u);
});

test("acceptance probes are restricted to loopback targets", () => {
  assert.equal(normalizeAcceptanceBaseUrl("http://127.0.0.1:3001"), "http://127.0.0.1:3001");
  assert.equal(normalizeAcceptanceBaseUrl("http://localhost:3001/health"), "http://localhost:3001");
  assert.throws(
    () => normalizeAcceptanceBaseUrl("https://production.example.test"),
    /acceptance_base_url_not_loopback/u,
  );
  assert.throws(
    () => normalizeAcceptanceBaseUrl("http://admin:secret@127.0.0.1:3001"),
    /acceptance_base_url_invalid/u,
  );
});

test("baseline evaluation requires both status and declared JSON predicates", () => {
  const check = manifest().baseline[0];
  assert.deepEqual(evaluateProductionAcceptanceCheck(check, healthyResponse(check)), {
    passed: true,
    status: 200,
    code: "baseline_ok",
  });
  assert.equal(evaluateProductionAcceptanceCheck(check, {
    status: 503,
    jsonValid: true,
    json: check.requiredJson,
  }).code, "status_mismatch");
  assert.equal(evaluateProductionAcceptanceCheck(check, {
    status: 200,
    jsonValid: true,
    json: { ...check.requiredJson, ok: false },
  }).code, "json_predicate_mismatch");
  assert.equal(evaluateProductionAcceptanceCheck(check, {
    status: 200,
    jsonValid: false,
    json: null,
  }).code, "invalid_json");
});

test("read-only executor starts exact compose plan, waits for readiness, runs baseline and always tears down", async () => {
  const plan = manifest();
  const commands = [];
  let clock = 0;
  let readinessAttempts = 0;

  const report = await runProductionAcceptance(plan, {
    baseUrl: "http://127.0.0.1:3001",
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    startupTimeoutMs: 5_000,
    probeIntervalMs: 250,
    async runCommand(command, args, options) {
      commands.push({ command, args: [...args], environment: { ...options.environment } });
      clock += 5;
    },
    async requestJson(url) {
      clock += 10;
      const check = plan.baseline.find((item) => item.path === url.pathname);
      assert.ok(check);
      if (check.id === "readiness") {
        readinessAttempts += 1;
        if (readinessAttempts === 1) {
          return { status: 503, jsonValid: true, json: { state: "starting" } };
        }
      }
      return {
        ...healthyResponse(check),
        json: {
          ...check.requiredJson,
          ignored: "https://must-not-be-copied.example.test",
          upstreamSecret: "must-not-be-copied",
        },
      };
    },
    secretValues: ["must-not-be-copied"],
  });

  assert.equal(report.outcome, "passed");
  assert.equal(report.compose.start, "passed");
  assert.equal(report.compose.cleanup, "passed");
  assert.deepEqual(report.failureCodes, []);
  assert.equal(report.checks.length, 4);
  assert.equal(report.checks.find((item) => item.id === "readiness")?.attempts, 2);
  assert.equal(scanProductionAcceptanceReport(report, { secretValues: ["must-not-be-copied"] }).length, 0);
  assert.equal(JSON.stringify(report).includes("must-not-be-copied"), false);
  assert.equal(JSON.stringify(report).includes("https://"), false);

  assert.equal(commands.length, 2);
  assert.equal(commands[0].command, "docker");
  assert.deepEqual(commands[0].args, plan.compose.args.slice(1));
  assert.deepEqual(commands[0].environment, plan.compose.environment);
  assert.deepEqual(commands[1].args.slice(-3), ["down", "--volumes", "--remove-orphans"]);
  assert.equal(commands[1].args.includes(plan.compose.projectName), true);

  const html = renderProductionAcceptanceHtml(report);
  assert.match(html, /Outcome: <strong>passed<\/strong>/u);
  assert.equal(html.includes("https://"), false);
  assert.equal(html.includes("must-not-be-copied"), false);
  assert.match(html, /Failure codes: none/u);
});

test("baseline failure is fail-closed and cleanup still runs", async () => {
  const plan = manifest();
  const commands = [];
  let clock = 0;

  const report = await runProductionAcceptance(plan, {
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    startupTimeoutMs: 1_000,
    probeIntervalMs: 100,
    async runCommand(command, args) {
      commands.push([command, ...args]);
    },
    async requestJson(url) {
      const check = plan.baseline.find((item) => item.path === url.pathname);
      assert.ok(check);
      if (check.id === "dependencies") {
        return {
          status: 200,
          jsonValid: true,
          json: { state: "degraded", code: "dependencies_degraded", ok: false },
        };
      }
      return healthyResponse(check);
    },
  });

  assert.equal(report.outcome, "failed");
  assert.deepEqual(report.failureCodes, ["acceptance_baseline_failed"]);
  assert.equal(report.checks.find((item) => item.id === "dependencies")?.code, "json_predicate_mismatch");
  assert.equal(report.compose.cleanup, "passed");
  assert.equal(commands.length, 2);
  assert.equal(commands[1].includes("down"), true);
});

test("startup timeout records bounded evidence and still tears down", async () => {
  const plan = manifest();
  const commands = [];
  let clock = 0;

  const report = await runProductionAcceptance(plan, {
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    startupTimeoutMs: 250,
    probeIntervalMs: 100,
    async runCommand(command, args) {
      commands.push([command, ...args]);
    },
    async requestJson() {
      clock += 25;
      return { status: 503, jsonValid: true, json: { state: "starting" } };
    },
  });

  assert.equal(report.outcome, "failed");
  assert.deepEqual(report.failureCodes, ["acceptance_baseline_timeout", "acceptance_baseline_failed"]);
  assert.equal(report.checks.find((item) => item.id === "readiness")?.code, "startup_timeout");
  assert.equal(report.compose.cleanup, "passed");
  assert.equal(commands.at(-1).includes("down"), true);
});

test("compose startup or cleanup failures cannot produce a passing report", async () => {
  const plan = manifest();
  let calls = 0;

  const startFailed = await runProductionAcceptance(plan, {
    async runCommand() {
      calls += 1;
      if (calls === 1) throw new Error("raw docker failure");
    },
    async requestJson() {
      assert.fail("probes must not run after compose startup failure");
    },
  });
  assert.equal(startFailed.outcome, "failed");
  assert.equal(startFailed.compose.start, "failed");
  assert.equal(startFailed.compose.cleanup, "passed");
  assert.deepEqual(startFailed.failureCodes, ["acceptance_compose_start_failed"]);
  assert.deepEqual(startFailed.checks, []);

  calls = 0;
  const cleanupFailed = await runProductionAcceptance(plan, {
    async runCommand() {
      calls += 1;
      if (calls === 2) throw new Error("raw cleanup failure");
    },
    async requestJson(url) {
      const check = plan.baseline.find((item) => item.path === url.pathname);
      return healthyResponse(check);
    },
  });
  assert.equal(cleanupFailed.outcome, "failed");
  assert.equal(cleanupFailed.compose.start, "passed");
  assert.equal(cleanupFailed.compose.cleanup, "failed");
  assert.deepEqual(cleanupFailed.failureCodes, ["acceptance_cleanup_failed"]);
  assert.equal(JSON.stringify(cleanupFailed).includes("raw cleanup failure"), false);
});
