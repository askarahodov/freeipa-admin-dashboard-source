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

test("FreeIPA read/query/export/bulk/member HTTP behavior has one compatibility owner", async () => {
  const adapter = await source("worker/freeipa-http-entry.ts");
  assert.match(adapter, /import sessionRuntime from ["']\.\/session-management-entry["']/);
  for (const route of [
    "/api/integrations/users",
    "/api/integrations/users/export.csv",
    "/api/integrations/groups",
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

test("base FreeIPA reads and RPC no longer live in the central Worker", async () => {
  const central = await source("worker/index.ts");
  const adapter = await source("worker/freeipa-http-entry.ts");
  const baseRead = await source("worker/freeipa-base-read.ts");
  const rpc = await source("worker/freeipa-rpc.ts");
  const settingsRuntime = await source("worker/integration-settings-runtime.ts");

  assert.equal(central.includes("handleFreeIpaBaseRead"), false);
  assert.equal(central.includes('url.pathname === "/api/integrations/users"'), false);
  assert.equal(central.includes('url.pathname === "/api/integrations/groups"'), false);
  assert.equal(central.includes("function freeIpaNetworkError"), false);
  assert.equal(central.includes("async function ipaRpc"), false);
  assert.equal(central.includes("async function encryptSecrets"), false);
  assert.equal(central.includes("async function decryptSecrets"), false);
  assert.match(central, /decryptIntegrationSecrets as decryptSecrets/);
  assert.match(central, /encryptIntegrationSecrets as encryptSecrets/);

  assert.match(adapter, /readFreeIpaUsers/);
  assert.match(adapter, /readFreeIpaGroups/);
  assert.match(adapter, /effectiveFreeIpaRuntime/);
  assert.equal(baseRead.includes("/api/integrations/"), false, "base read helper must remain HTTP-route neutral");
  assert.equal(rpc.includes("IPA_NODE_GATEWAY_URL"), true);
  assert.equal(rpc.includes("/ipa/session/login_password"), true);
  assert.equal(settingsRuntime.includes("SELECT config_json, encrypted_secrets, updated_at FROM app_settings"), true);
  assert.equal(settingsRuntime.includes("decryptIntegrationSecrets"), true);
  assert.equal(central.includes('url.pathname === "/api/integrations/freeipa/actions"'), true, "mutation ownership must remain in index until B2");
});

test("canonical route metadata points FreeIPA routes at their current owners", async () => {
  const contracts = await source("src/auth/portal-route-contract.ts");
  const expectedOwners = new Map([
    ["freeipa.users.list", "worker/freeipa-http-entry.ts"],
    ["freeipa.groups.list", "worker/freeipa-http-entry.ts"],
    ["freeipa.users.export", "worker/freeipa-http-entry.ts"],
    ["freeipa.groups.members", "worker/freeipa-http-entry.ts"],
    ["freeipa.bulk", "worker/freeipa-http-entry.ts"],
    ["freeipa.actions", "worker/index.ts"],
  ]);
  for (const [id, owner] of expectedOwners) {
    const line = contracts.split("\n").find((candidate) => candidate.includes(`id: "${id}"`));
    assert.ok(line, `missing route contract ${id}`);
    assert.equal(line.includes(`owner: "${owner}"`), true, `stale owner for ${id}`);
  }
});
