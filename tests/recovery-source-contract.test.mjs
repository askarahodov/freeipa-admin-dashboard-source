import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = [
  "recovery-errors.ts",
  "recovery-paths.ts",
  "recovery-secrets.ts",
];

const forbiddenBypassNames = [
  "--force-running",
  "--ignore-lock",
  "--skip-recovery-point",
  "--ignore-checksum",
  "--ignore-schema",
];

test("recovery input modules stay isolated from Worker runtime composition", async () => {
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("worker/"), false, `${file} imports Worker runtime`);
    assert.equal(source.includes("maintenance-control"), false, `${file} imports maintenance HTTP composition`);
    assert.equal(source.includes("service-admin-root-entry"), false, `${file} imports service-admin root`);
  }
});

test("recovery input modules contain no bypass flags or secret logging", async () => {
  const source = (await Promise.all(files.map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")))).join("\n");
  for (const forbidden of forbiddenBypassNames) {
    assert.equal(source.includes(forbidden), false, `recovery input source contains ${forbidden}`);
  }
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\s*\([^)]*(?:secret|password|key)/i);
  assert.doesNotMatch(source, /process\.argv[^\n]*(?:secret|password|key)/i);
});
