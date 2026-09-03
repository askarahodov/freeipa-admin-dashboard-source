import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const canonicalName = "Admin Dashboard Softrust";
const legacyDisplayName = "FreeIPA Admin Dashboard";

test("package and primary UI expose the canonical product display name", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.name, "freeipa-admin-dashboard", "technical package id is a compatibility identifier");
  assert.equal(pkg.displayName, canonicalName);

  for (const path of ["app/layout.tsx", "app/page.tsx", "app/login/page.tsx", "worker/health-diagnostics-ui.ts"]) {
    const source = read(path);
    assert.equal(source.includes(canonicalName), true, `${path} must expose the canonical product name`);
    assert.equal(source.includes(legacyDisplayName), false, `${path} must not expose the legacy product display name`);
  }
});

test("active documentation has one canonical product name", () => {
  for (const path of [
    "README.md",
    "docs/README.md",
    "docs/DOCUMENTATION_POLICY.md",
    "docs/GLOSSARY.md",
    "docs/SOURCE_OF_TRUTH.md",
    "docs/HEALTH_METRICS.md",
    "docs/STORAGE_STATUS.md",
    "docs/ai/README.md",
  ]) {
    const document = read(path);
    assert.equal(document.includes(legacyDisplayName), false, `${path} contains the legacy product display name`);
  }

  assert.match(read("README.md"), /^# Admin Dashboard Softrust$/m);
  assert.match(read("docs/SOURCE_OF_TRUTH.md"), /Admin Dashboard Softrust/);
  assert.match(read("docs/GLOSSARY.md"), /\*\*Admin Dashboard Softrust/);
});

test("compatibility identifiers are not renamed by the branding change", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.name, "freeipa-admin-dashboard");
  assert.match(read("src/backup/backup-manifest.ts"), /freeipa-admin-dashboard-backup/);
  assert.match(read("worker/health-contracts.ts"), /freeipa-admin-dashboard/);
  assert.match(read("app/settings-storage.js"), /freeipa-admin-dashboard-settings/);
});
