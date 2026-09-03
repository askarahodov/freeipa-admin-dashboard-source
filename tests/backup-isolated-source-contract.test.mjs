import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const productionFiles = [
  "src/backup/restore/backup-restore-selection.ts",
  "src/backup/restore/backup-restore-plan.ts",
  "src/backup/restore/backup-isolated-store.ts",
  "src/backup/restore/backup-isolated-verification.ts",
  "src/backup/restore/backup-isolated-restore.ts",
  "worker/backup-isolated-restore-entry.ts",
];

async function sources() {
  return Promise.all(productionFiles.map(async (path) => ({
    path,
    source: await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
  })));
}

test("isolated restore production modules contain no production mutation or external calls", async () => {
  for (const { path, source } of await sources()) {
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|PRAGMA)\b/i, path);
    assert.doesNotMatch(source, /SELECT\s+\*/i, path);
    assert.doesNotMatch(source, /\bmaintenance\b/i, path);
    assert.doesNotMatch(source, /restore\/commit/i, path);
    assert.doesNotMatch(source, /\bfetch\s*\(/, path);
    assert.doesNotMatch(source, /console\s*\./, path);
    assert.doesNotMatch(source, /CONFIG_ENCRYPTION_KEY/, path);
  }
});

test("isolated store and verifier have no D1 Worker or SQL dependency", async () => {
  for (const path of ["src/backup/restore/backup-isolated-store.ts", "src/backup/restore/backup-isolated-verification.ts"]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /BackupExportEnv|D1Database|\.prepare\s*\(|\bSQL\b/i, path);
  }
});

test("test restore audit source excludes approval and fingerprint material", async () => {
  const source = await readFile(new URL("../worker/backup-isolated-restore-entry.ts", import.meta.url), "utf8");
  const metadataBlocks = [...source.matchAll(/metadata:\s*\{([\s\S]*?)\n\s*\}/g)].map((match) => match[1]).join("\n");
  assert.doesNotMatch(metadataBlocks, /approvalToken|fingerprint|sha256|password|salt|iv|ciphertext|hash|payload/i);
  assert.match(metadataBlocks, /domains/);
  assert.match(metadataBlocks, /durationMs/);
});

test("new route is wired through the existing encrypted backup root only once", async () => {
  const root = await readFile(new URL("../worker/backup-encrypted-root-entry.ts", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../worker/freeipa-group-member-entry.ts", import.meta.url), "utf8");
  assert.equal((root.match(/\/api\/admin\/backups\/import\/encrypted\/test-restore/g) ?? []).length, 1);
  assert.equal((runtime.match(/handleEncryptedBackupRoute/g) ?? []).length >= 1, true);
  assert.equal((runtime.match(/test-restore/g) ?? []).length, 0);
});

test("production D1 access is limited to existing read-only registries and schema inspection", async () => {
  for (const { path, source } of await sources()) {
    if (path === "src/backup/restore/backup-restore-plan.ts") {
      assert.match(source, /exporter\.export/);
      assert.doesNotMatch(source, /env\.DB\.(?:prepare|batch|exec)/);
      continue;
    }
    if (path === "worker/backup-isolated-restore-entry.ts" || path === "src/backup/restore/backup-isolated-restore.ts") {
      assert.doesNotMatch(source, /env\.DB\.(?:prepare|batch|exec)/);
      continue;
    }
    assert.doesNotMatch(source, /env\.DB/);
  }
});
