import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const gatePath = new URL("../worker/maintenance-mode-root-entry.ts", import.meta.url);
const schemaRootPath = new URL("../worker/schema-migrations-entry.ts", import.meta.url);
const serviceRootPath = new URL("../worker/service-admin-root-entry.ts", import.meta.url);
const repositoryPath = new URL("../maintenance-repository.ts", import.meta.url);
const controlEntryPath = new URL("../worker/maintenance-control-entry.ts", import.meta.url);
const modePath = new URL("../maintenance-mode.ts", import.meta.url);

function source(url) {
  return fs.readFileSync(url, "utf8");
}

test("schema readiness composes the maintenance gate outside service-admin authorization", () => {
  const schemaRoot = source(schemaRootPath);
  const gate = source(gatePath);
  const serviceRoot = source(serviceRootPath);

  assert.equal(schemaRoot.includes('import rootRuntime from "./maintenance-mode-root-entry.ts"'), true);
  assert.equal(gate.includes('import rootRuntime from "./service-admin-root-entry.ts"'), true);
  assert.equal(serviceRoot.includes('import rootRuntime from "./maintenance-control-root-entry"'), true);
  assert.equal(gate.includes("x-admin-token"), false);
  assert.equal(gate.includes("serviceAdminTokenAuthorized"), false);
  assert.equal(gate.includes("loadMaintenanceState"), true);
  assert.equal(gate.includes("portal_maintenance_active"), true);
  assert.equal(gate.includes('"Retry-After", "60"'), true);
  assert.equal(gate.includes("x-portal-maintenance-state"), true);
});

test("maintenance production modules do not access backup crypto filesystems or encryption configuration", () => {
  const combined = [source(gatePath), source(repositoryPath), source(controlEntryPath), source(modePath)].join("\n");
  assert.doesNotMatch(combined, /CONFIG_ENCRYPTION_KEY/);
  assert.doesNotMatch(combined, /backup-encrypted|decryptEncrypted|validateEncryptedBackup|createSelectiveRecoveryPoint/);
  assert.doesNotMatch(combined, /node:(?:fs|path|child_process)|from\s+["']fs["']|Deno\.|Bun\.|process\.cwd/);
  assert.doesNotMatch(combined, /console\.(?:log|warn|error|debug|info)/);
  assert.doesNotMatch(combined, /WRANGLER_LOG|\.wrangler|sqlite|fsync|rename\s*\(/i);
});

test("maintenance repository mutates only its singleton and session revocation allowlist", () => {
  const repository = source(repositoryPath);
  const mutations = [...repository.matchAll(/(?:INSERT(?:\s+OR\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)]
    .map((match) => match[1].toLowerCase());
  assert.ok(mutations.length > 0);
  assert.deepEqual([...new Set(mutations)].sort(), ["portal_maintenance_state", "portal_sessions"]);
  assert.equal(repository.includes("DELETE FROM portal_sessions WHERE EXISTS"), true);
  assert.doesNotMatch(repository, /DELETE\s+FROM\s+portal_maintenance_state/i);
});

test("gate allows only bounded recovery control surfaces during maintenance", () => {
  const gate = source(gatePath);
  for (const path of [
    "/api/maintenance/status",
    "/api/integrations/health",
    "/api/schema/status",
  ]) assert.equal(gate.includes(`"${path}"`), true, path);
  assert.equal(gate.includes("MAINTENANCE_CONTROL_PATHS"), true);
  assert.equal(gate.includes("request.method"), false, "gate must not duplicate control authorization");
  assert.equal(gate.includes("rootRuntime.scheduled"), true);
});
