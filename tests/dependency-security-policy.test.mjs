import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

function versionTuple(value) {
  return String(value ?? "").replace(/^[^0-9]*/u, "").split(".").slice(0, 3).map((part) => Number(part) || 0);
}

function versionAtLeast(actual, expected) {
  const left = versionTuple(actual);
  const right = versionTuple(expected);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

test("production dependency graph uses patched Next and Sharp versions", () => {
  assert.equal(versionAtLeast(packageJson.dependencies.next, "16.3.0"), true, `next=${packageJson.dependencies.next}`);
  const nextPackage = lock.packages?.["node_modules/next"];
  assert.equal(versionAtLeast(nextPackage?.version, "16.3.0"), true, `locked next=${nextPackage?.version}`);

  const productionSharp = Object.entries(lock.packages ?? {})
    .filter(([path, metadata]) => path.endsWith("/sharp") && metadata?.dev !== true)
    .map(([, metadata]) => metadata.version);
  assert.equal(productionSharp.length > 0, true, "production Sharp package is missing from lockfile");
  for (const version of productionSharp) assert.equal(versionAtLeast(version, "0.35.0"), true, `production sharp=${version}`);
});

test("package scripts expose deterministic production audit and lockfile-only SBOM commands", () => {
  assert.equal(packageJson.scripts?.["security:audit"], "node scripts/dependency-audit-policy.mjs");
  assert.equal(packageJson.scripts?.["security:sbom"], "npm sbom --omit=dev --package-lock-only --sbom-format=cyclonedx");
  assert.equal(existsSync(new URL("../scripts/dependency-audit-policy.mjs", import.meta.url)), true);
  assert.equal(existsSync(new URL("../security/audit-allowlist.json", import.meta.url)), true);
});

test("CI makes dependency security a required aggregate gate, validates the installed graph and publishes an SBOM", () => {
  assert.match(ci, /\n  dependency-security:\n/u);
  assert.match(ci, /npm run security:audit/u);
  assert.match(ci, /npm run(?:\s+--silent)?\s+security:sbom/u);
  assert.match(ci, /name:\s*npm-production-sbom/u);
  assert.match(ci, /name:\s*Validate production dependency tree[\s\S]{0,120}npm ls --omit=dev/u);
  assert.match(ci, /needs:\s*\[[^\]]*dependency-security[^\]]*\]/u);
  assert.match(ci, /SECURITY_RESULT:\s*\$\{\{ needs\.dependency-security\.result \}\}/u);
});

test("CI scans the built runtime image with a pinned Trivy action", () => {
  assert.match(ci, /\n  container-security:\n/u);
  assert.match(ci, /docker build --target runtime -t portal-security-scan/u);
  assert.match(ci, /aquasecurity\/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25/u);
  assert.match(ci, /severity:\s*['"]?HIGH,CRITICAL['"]?/u);
  assert.match(ci, /ignore-unfixed:\s*true/u);
  assert.match(ci, /name:\s*runtime-image-security-scan/u);
  assert.match(ci, /CONTAINER_RESULT:\s*\$\{\{ needs\.container-security\.result \}\}/u);
});
