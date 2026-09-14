import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function source(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

async function exists(relativePath) {
  try {
    await stat(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

test("FreeIPA query/bulk/member HTTP behavior has one compatibility owner", async () => {
  const adapter = await source("worker/freeipa-http-entry.ts");
  assert.match(adapter, /import sessionRuntime from ["']\.\/session-management-entry["']/);
  for (const route of [
    "/api/integrations/users",
    "/api/integrations/users/export.csv",
    "/api/integrations/groups/members",
    "/api/integrations/freeipa/bulk",
  ]) assert.equal(adapter.includes(route), true, `missing consolidated route: ${route}`);

  for (const retired of [
    "worker/freeipa-user-query-entry.ts",
    "worker/freeipa-user-bulk-entry.ts",
    "worker/freeipa-group-member-entry.ts",
  ]) assert.equal(await exists(retired), false, `retired FreeIPA wrapper returned: ${retired}`);
});

test("backup predispatch is not owned by the FreeIPA adapter", async () => {
  const adapter = await source("worker/freeipa-http-entry.ts");
  const backupRoot = await source("worker/backup-selective-restore-root-entry.ts");
  assert.equal(adapter.includes("handleEncryptedBackupRoute"), false);
  assert.equal(adapter.includes("handleBackupImportPreviewRoute"), false);
  assert.match(backupRoot, /import rootRuntime from ["']\.\/freeipa-http-entry\.ts["']/);
  assert.equal(backupRoot.includes("handleEncryptedBackupRoute"), true);
  assert.equal(backupRoot.includes("handleBackupImportPreviewRoute"), true);
});

test("canonical route metadata points consolidated FreeIPA routes at the new owner", async () => {
  const contracts = await source("src/auth/portal-route-contract.ts");
  for (const id of ["freeipa.users.export", "freeipa.groups.members", "freeipa.bulk"]) {
    const line = contracts.split("\n").find((candidate) => candidate.includes(`id: "${id}"`));
    assert.ok(line, `missing route contract ${id}`);
    assert.equal(line.includes('owner: "worker/freeipa-http-entry.ts"'), true, `stale owner for ${id}`);
  }
});
