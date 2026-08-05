import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rules = fs.readFileSync(new URL("../monitoring/prometheus-health-alerts.yml", import.meta.url), "utf8");

const exportedMetrics = new Set([
  "portal_health_live",
  "portal_health_ready",
  "portal_health_readiness_check",
  "portal_health_schema_version",
  "portal_health_schema_latest_version",
  "portal_health_schema_lag",
  "portal_build_info",
  "portal_health_contract_info",
  "portal_health_dependency_contract_info",
]);

function expressions() {
  return Array.from(rules.matchAll(/^\s*expr:\s*(.+)$/gm), (match) => match[1]);
}

test("alert rules define bounded sustained local health alerts", () => {
  for (const alert of [
    "PortalHealthMetricsMissing",
    "PortalNotReady",
    "PortalSchemaLagging",
    "PortalEncryptionUnavailable",
    "PortalGatewayUnavailable",
  ]) assert.match(rules, new RegExp(`alert: ${alert}`));

  assert.match(rules, /for: 2m/);
  assert.match(rules, /for: 5m/);
  assert.match(rules, /severity: critical/);
  assert.match(rules, /severity: warning/);
});

test("rules reference only metrics emitted by the baseline endpoint", () => {
  const found = new Set();
  for (const expression of expressions()) {
    for (const name of expression.match(/portal_[a-z0-9_]+/g) ?? []) found.add(name);
  }
  assert.ok(found.size > 0);
  for (const name of found) assert.equal(exportedMetrics.has(name), true, `unknown metric in alert rules: ${name}`);
});

test("rules use only fixed readiness labels and never encode external details", () => {
  assert.match(rules, /check="encryption"/);
  assert.match(rules, /check="gateway"/);
  for (const forbidden of [
    "username",
    "hostname",
    "url=",
    "run_id",
    "resource",
    "freeipa",
    "xyops",
    "api_key",
    "token",
    "password",
    "restart",
    "kubectl",
    "docker",
  ]) assert.equal(rules.toLowerCase().includes(forbidden), false, `forbidden alert content: ${forbidden}`);
});

test("rules include operator guidance without deployment actions", () => {
  assert.match(rules, /summary:/);
  assert.match(rules, /description:/);
  assert.match(rules, /runbook_url:/);
  assert.equal(rules.includes("command:"), false);
  assert.equal(rules.includes("webhook:"), false);
});
