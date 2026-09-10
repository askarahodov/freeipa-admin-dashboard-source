import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateAuditReport } from "../../scripts/dependency-audit-policy.mjs";

const workflow = readFileSync(new URL("../../.github/workflows/security-scan.yml", import.meta.url), "utf8");

const emptyAllowlist = { schemaVersion: 1, entries: [] };

test("scheduled security workflow is daily, manual, trusted-main-only, and independent of Required CI", () => {
  assert.match(workflow, /schedule:[\s\S]*cron:\s*['"]17 3 \* \* \*['"]/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/u);
  assert.match(workflow, /group:\s*scheduled-security-scan-main/u);
  assert.match(workflow, /cancel-in-progress:\s*false/u);
  assert.match(workflow, /Require trusted main ref[\s\S]{0,420}refs\/heads\/main/u);
  assert.match(workflow, /Checkout trusted main[\s\S]{0,180}ref:\s*main/u);
  assert.match(workflow, /Verify checked out SHA is current workflow SHA/u);
  assert.doesNotMatch(workflow, /Required CI/u);
});

test("scheduled security workflow always refreshes audit, SBOM, and current-image scan", () => {
  assert.match(workflow, /Run live production dependency audit[\s\S]{0,140}npm run security:audit/u);
  assert.match(workflow, /Generate production CycloneDX SBOM[\s\S]{0,260}security:sbom/u);
  assert.match(workflow, /docker buildx build[\s\S]{0,320}--target runtime[\s\S]{0,320}portal-scheduled-security-scan/u);
  assert.match(workflow, /aquasecurity\/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25/u);
  assert.match(workflow, /severity:\s*HIGH,CRITICAL/u);
  assert.match(workflow, /ignore-unfixed:\s*true/u);
  assert.match(workflow, /exit-code:\s*['"]1['"]/u);
  assert.match(workflow, /trivy --version/u);
  assert.match(workflow, /retention-days:\s*14/u);
});

test("scheduled security workflow reads the trusted runtime cache but never writes it", () => {
  assert.match(workflow, /actions\/cache\/restore@v4/u);
  assert.match(workflow, /runtime-buildkit-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('Dockerfile', 'package-lock\.json'\) \}\}-\$\{\{ github\.sha \}\}/u);
  assert.doesNotMatch(workflow, /actions\/cache\/save@v4/u);
  assert.doesNotMatch(workflow, /--cache-to/u);
});

test("dependency audit policy fails a safe fixture containing a non-allowlisted high advisory", () => {
  const report = {
    vulnerabilities: {
      "fixture-package": {
        name: "fixture-package",
        severity: "high",
        via: [
          {
            name: "fixture-package",
            severity: "high",
            title: "Synthetic policy-contract vulnerability",
            url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
          },
        ],
      },
    },
  };

  const result = evaluateAuditReport(report, emptyAllowlist, new Date("2026-09-10T00:00:00Z"));
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].id, "ghsa-aaaa-bbbb-cccc");
  assert.equal(result.allowed.length, 0);
});
