import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const policyUrl = new URL("../scripts/dependency-audit-policy.mjs", import.meta.url);

const report = {
  auditReportVersion: 2,
  vulnerabilities: {
    sharp: {
      name: "sharp",
      severity: "high",
      via: [{
        source: 1100001,
        title: "Inherited libvips vulnerability",
        url: "https://github.com/advisories/GHSA-f88m-g3jw-g9cj",
        severity: "high",
      }],
    },
    postcss: {
      name: "postcss",
      severity: "moderate",
      via: [{ source: 1100002, title: "Moderate fixture", severity: "moderate" }],
    },
  },
  metadata: { vulnerabilities: { high: 1, critical: 0 } },
};

async function policy() {
  assert.equal(existsSync(policyUrl), true, "dependency audit policy script must exist");
  return import(`${policyUrl.href}?test=${Date.now()}-${Math.random()}`);
}

test("high and critical production advisories block by default", async () => {
  const { evaluateAuditReport } = await policy();
  const result = evaluateAuditReport(report, { schemaVersion: 1, entries: [] }, new Date("2026-08-07T00:00:00Z"));
  assert.deepEqual(result.blocked.map((finding) => finding.id), ["ghsa-f88m-g3jw-g9cj"]);
  assert.equal(result.allowed.length, 0);
});

test("a temporary exception requires exact package, owner, reason and future expiry", async () => {
  const { evaluateAuditReport } = await policy();
  const allowlist = {
    schemaVersion: 1,
    entries: [{
      id: "GHSA-f88m-g3jw-g9cj",
      package: "sharp",
      owner: "security-team",
      reason: "Temporary compatibility investigation with tracked remediation.",
      expires: "2026-08-31",
    }],
  };
  const result = evaluateAuditReport(report, allowlist, new Date("2026-08-07T00:00:00Z"));
  assert.equal(result.blocked.length, 0);
  assert.deepEqual(result.allowed.map((finding) => finding.id), ["ghsa-f88m-g3jw-g9cj"]);
});

test("expired, malformed and stale exceptions are rejected", async () => {
  const { validateAllowlist, evaluateAuditReport } = await policy();
  assert.throws(() => validateAllowlist({ schemaVersion: 1, entries: [{ id: "GHSA-x", package: "sharp", owner: "", reason: "short", expires: "2026-08-01" }] }, new Date("2026-08-07T00:00:00Z")));

  const stale = {
    schemaVersion: 1,
    entries: [{
      id: "GHSA-unused-unused-unused",
      package: "sharp",
      owner: "security-team",
      reason: "Tracked temporary exception that no longer matches a finding.",
      expires: "2026-08-31",
    }],
  };
  assert.throws(() => evaluateAuditReport(report, stale, new Date("2026-08-07T00:00:00Z")), /stale allowlist/u);
});

test("moderate advisories do not trip the high-critical merge gate", async () => {
  const { evaluateAuditReport } = await policy();
  const moderateOnly = structuredClone(report);
  delete moderateOnly.vulnerabilities.sharp;
  const result = evaluateAuditReport(moderateOnly, { schemaVersion: 1, entries: [] }, new Date("2026-08-07T00:00:00Z"));
  assert.equal(result.blocked.length, 0);
  assert.equal(result.allowed.length, 0);
});
