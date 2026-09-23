import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  acceptanceProjectName,
  assertProductionAcceptanceReportSafe,
  createProductionAcceptanceManifest,
  parseImmutableImageReference,
  scanProductionAcceptanceReport,
} from "../../scripts/production-acceptance-contract.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const image = `registry.example.test/admin-dashboard@${digest}`;
const commit = "b".repeat(40);

test("production acceptance requires an immutable sha256 image reference", () => {
  assert.deepEqual(parseImmutableImageReference(image), {
    reference: image,
    repository: "registry.example.test/admin-dashboard",
    digest,
  });
  assert.throws(
    () => parseImmutableImageReference("registry.example.test/admin-dashboard:latest"),
    /acceptance_image_digest_required/u,
  );
  assert.throws(
    () => parseImmutableImageReference("registry.example.test/admin-dashboard@sha256:abc"),
    /acceptance_image_digest_invalid/u,
  );
});

test("acceptance manifest derives an isolated compose project and read-only baseline", () => {
  const manifest = createProductionAcceptanceManifest({ imageReference: image, commitSha: commit });
  assert.equal(manifest.mode, "read-only-baseline");
  assert.equal(manifest.destructive, false);
  assert.equal(manifest.source.commitSha, commit);
  assert.equal(manifest.compose.projectName, acceptanceProjectName(digest));
  assert.equal(manifest.compose.expectedDataVolume, `${manifest.compose.projectName}_dashboard-data`);
  assert.equal(manifest.compose.serviceEnvFile, ".env.acceptance");
  assert.deepEqual(manifest.compose.environment, {
    PORTAL_IMAGE: image,
    PORTAL_SERVICE_ENV_FILE: ".env.acceptance",
  });
  assert.equal(manifest.compose.args.includes("--no-build"), true);
  assert.equal(manifest.compose.args.at(-1), "dashboard");
  assert.deepEqual(
    manifest.baseline.map((check) => [check.method, check.path]),
    [
      ["GET", "/health/live"],
      ["GET", "/health/ready"],
      ["GET", "/health/dependencies"],
      ["GET", "/api/maintenance/status"],
    ],
  );
  assert.equal(assertProductionAcceptanceReportSafe(manifest), true);
});

test("compose service env file is overrideable without changing the local default", () => {
  const compose = fs.readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8");
  assert.match(compose, /env_file:\s*\n\s*- \$\{PORTAL_SERVICE_ENV_FILE:-\.env\}/u);
});

test("report safety scan blocks secret-shaped keys, credential markers, secret values and URLs", () => {
  const findings = scanProductionAcceptanceReport({
    summary: "authorization: Bearer hidden",
    adminToken: "[REDACTED]",
    detail: "portal_session=abc",
    target: "https://internal.example.test",
    nested: { value: "known-secret" },
  }, { secretValues: ["known-secret"] });

  const codes = findings.map((finding) => finding.code);
  assert.equal(codes.includes("sensitive_report_key"), true);
  assert.equal(codes.includes("credential_marker_present"), true);
  assert.equal(codes.includes("url_present_in_report"), true);
  assert.equal(codes.includes("secret_value_present"), true);
  assert.throws(
    () => assertProductionAcceptanceReportSafe({ password: "redacted" }),
    /acceptance_report_redaction_failed/u,
  );
});

test("harmless release evidence remains report-safe", () => {
  const report = {
    schemaVersion: 1,
    outcome: "passed",
    source: { commitSha: commit },
    image: { digest },
    environment: { label: "staging-a" },
    checks: [{ id: "liveness", outcome: "passed", code: "http_200" }],
  };
  assert.deepEqual(scanProductionAcceptanceReport(report), []);
});
