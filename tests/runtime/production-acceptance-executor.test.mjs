import assert from "node:assert/strict";
import test from "node:test";

import { createProductionAcceptanceManifest } from "../../scripts/production-acceptance-contract.mjs";
import {
  acceptanceCleanupCommand,
  evaluateAcceptanceCheck,
  executeProductionAcceptance,
  normalizeProductionAcceptanceTarget,
  productionAcceptanceCommandEnvironment,
  renderProductionAcceptanceHtml,
  validateProductionAcceptanceManifest,
} from "../../scripts/production-acceptance-executor-core.mjs";

const digest = `sha256:${"c".repeat(64)}`;
const image = `registry.example.test/admin-dashboard@${digest}`;
const commit = "d".repeat(40);

function manifest() {
  return JSON.parse(JSON.stringify(createProductionAcceptanceManifest({ imageReference: image, commitSha: commit })));
}

function healthyResponse(check) {
  return { status: 200, json: { ...check.requiredJson } };
}

test("executor accepts only the exact versioned read-only manifest contract", () => {
  const plan = manifest();
  assert.equal(validateProductionAcceptanceManifest(plan).image.digest, digest);

  const mutated = manifest();
  mutated.destructive = true;
  assert.throws(() => validateProductionAcceptanceManifest(mutated), /acceptance_manifest_mode_invalid/u);

  const changed = manifest();
  changed.baseline[0].requiredJson.state = "degraded";
  assert.throws(() => validateProductionAcceptanceManifest(changed), /acceptance_manifest_mismatch/u);
});

test("acceptance execution target is forced to the local loopback publication boundary", () => {
  assert.deepEqual(normalizeProductionAcceptanceTarget("http://127.0.0.1:3001"), {
    baseUrl: "http://127.0.0.1:3001",
    port: "3001",
    composeEnvironment: {
      DASHBOARD_BIND_ADDRESS: "127.0.0.1",
      DASHBOARD_PORT: "3001",
    },
  });
  assert.deepEqual(normalizeProductionAcceptanceTarget("http://localhost:3100"), {
    baseUrl: "http://127.0.0.1:3100",
    port: "3100",
    composeEnvironment: {
      DASHBOARD_BIND_ADDRESS: "127.0.0.1",
      DASHBOARD_PORT: "3100",
    },
  });
  assert.deepEqual(normalizeProductionAcceptanceTarget("http://[::1]"), {
    baseUrl: "http://127.0.0.1:3001",
    port: "3001",
    composeEnvironment: {
      DASHBOARD_BIND_ADDRESS: "127.0.0.1",
      DASHBOARD_PORT: "3001",
    },
  });

  assert.throws(
    () => normalizeProductionAcceptanceTarget("https://127.0.0.1:3001"),
    /acceptance_base_url_protocol_invalid/u,
  );
  assert.throws(
    () => normalizeProductionAcceptanceTarget("http://production.example.test:3001"),
    /acceptance_base_url_loopback_required/u,
  );
  assert.throws(
    () => normalizeProductionAcceptanceTarget("http://admin:secret@127.0.0.1:3001"),
    /acceptance_base_url_credentials_forbidden/u,
  );
  assert.throws(
    () => normalizeProductionAcceptanceTarget("http://127.0.0.1:3001/health/ready"),
    /acceptance_base_url_path_invalid/u,
  );
  assert.throws(
    () => normalizeProductionAcceptanceTarget("http://127.0.0.1:3001/?target=other"),
    /acceptance_base_url_query_forbidden/u,
  );
  assert.throws(
    () => normalizeProductionAcceptanceTarget("http://127.0.0.1:3001/#fragment"),
    /acceptance_base_url_fragment_forbidden/u,
  );
});

test("acceptance command environment overrides ambient exposure with the normalized loopback target", () => {
  const target = normalizeProductionAcceptanceTarget("http://localhost:3100");
  const environment = productionAcceptanceCommandEnvironment(
    {
      DASHBOARD_BIND_ADDRESS: "0.0.0.0",
      DASHBOARD_PORT: "9999",
      KEEP_AMBIENT: "yes",
    },
    {
      PORTAL_IMAGE: "registry.example.test/image@sha256:test",
      DASHBOARD_BIND_ADDRESS: "192.0.2.10",
    },
    target,
  );

  assert.equal(environment.KEEP_AMBIENT, "yes");
  assert.equal(environment.PORTAL_IMAGE, "registry.example.test/image@sha256:test");
  assert.equal(environment.DASHBOARD_BIND_ADDRESS, "127.0.0.1");
  assert.equal(environment.DASHBOARD_PORT, "3100");
});

test("baseline evaluator requires both expected status and required JSON predicates", () => {
  const check = manifest().baseline[0];
  assert.equal(evaluateAcceptanceCheck(check, healthyResponse(check)).outcome, "passed");
  assert.deepEqual(evaluateAcceptanceCheck(check, { status: 503, json: check.requiredJson }), {
    id: check.id,
    outcome: "failed",
    code: "status_mismatch",
    status: 503,
  });
  assert.deepEqual(evaluateAcceptanceCheck(check, { status: 200, json: { ...check.requiredJson, ok: false } }), {
    id: check.id,
    outcome: "failed",
    code: "predicate_mismatch",
    status: 200,
  });
});

test("executor starts exact compose plan, checks baseline and always tears down isolated project", async () => {
  const plan = manifest();
  const commands = [];
  const report = await executeProductionAcceptance({
    manifest: plan,
    runCommand: async (command, environment) => {
      commands.push({ command: [...command], environment: { ...environment } });
    },
    probe: async (check) => healthyResponse(check),
    now: (() => {
      const values = [new Date("2026-09-23T08:00:00.000Z"), new Date("2026-09-23T08:00:01.000Z")];
      return () => values.shift() ?? new Date("2026-09-23T08:00:01.000Z");
    })(),
  });

  assert.equal(report.outcome, "passed");
  assert.equal(report.failureCode, null);
  assert.equal(report.checks.length, 4);
  assert.equal(report.checks.every((check) => check.outcome === "passed"), true);
  assert.deepEqual(commands[0].command, plan.compose.args);
  assert.deepEqual(commands[1].command, acceptanceCleanupCommand(plan));
  assert.deepEqual(commands[0].environment, plan.compose.environment);
  assert.deepEqual(report.cleanup, { outcome: "passed", code: "cleanup_complete" });
});

test("executor retries unhealthy startup and reports bounded timeout without leaking probe details", async () => {
  const plan = manifest();
  const commands = [];
  let clock = 0;
  const report = await executeProductionAcceptance({
    manifest: plan,
    runCommand: async (command) => commands.push([...command]),
    probe: async (check) => ({ status: 503, json: { ...check.requiredJson, state: "degraded", detail: "private" } }),
    now: () => new Date(1_000 + clock),
    sleep: async () => { clock += 50; },
    startupTimeoutMs: 100,
    probeIntervalMs: 50,
  });

  assert.equal(report.outcome, "failed");
  assert.equal(report.failureCode, "acceptance_baseline_timeout");
  assert.equal(report.checks.every((check) => check.outcome === "failed"), true);
  assert.equal(JSON.stringify(report).includes("private"), false);
  assert.deepEqual(commands.at(-1), acceptanceCleanupCommand(plan));
});

test("executor sanitizes command failures and still attempts cleanup", async () => {
  const plan = manifest();
  let calls = 0;
  const report = await executeProductionAcceptance({
    manifest: plan,
    runCommand: async () => {
      calls += 1;
      if (calls === 1) throw new Error("registry password=do-not-report");
    },
    probe: async () => {
      throw new Error("should not run");
    },
  });

  assert.equal(calls, 2);
  assert.equal(report.outcome, "failed");
  assert.equal(report.failureCode, "acceptance_compose_start_failed");
  assert.equal(JSON.stringify(report).includes("do-not-report"), false);
  assert.deepEqual(report.cleanup, { outcome: "passed", code: "cleanup_complete" });
});

test("cleanup failure is release-blocking even after a healthy baseline", async () => {
  const plan = manifest();
  let calls = 0;
  const report = await executeProductionAcceptance({
    manifest: plan,
    runCommand: async () => {
      calls += 1;
      if (calls === 2) throw new Error("docker cleanup stderr");
    },
    probe: async (check) => healthyResponse(check),
  });

  assert.equal(report.outcome, "failed");
  assert.equal(report.failureCode, "acceptance_cleanup_failed");
  assert.deepEqual(report.cleanup, { outcome: "failed", code: "cleanup_failed" });
});

test("HTML evidence renders only the already-sanitized bounded report", async () => {
  const plan = manifest();
  const report = await executeProductionAcceptance({
    manifest: plan,
    runCommand: async () => {},
    probe: async (check) => healthyResponse(check),
  });
  const html = renderProductionAcceptanceHtml(report);
  assert.match(html, /Production acceptance: passed/u);
  assert.match(html, new RegExp(commit, "u"));
  assert.equal(html.includes("http://"), false);
  assert.equal(html.includes("registry.example.test"), false);
});
