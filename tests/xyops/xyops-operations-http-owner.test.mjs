import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("#632 checkpoint B gives run reads, notifications, cancel, and rerun one post-security operations owner", async () => {
  const [freeIpaOwner, operationsOwner, central, runRuntime] = await Promise.all([
    source("worker/freeipa-http-entry.ts"),
    source("worker/operations-http-entry.ts"),
    source("worker/index.ts"),
    source("worker/xyops-run-runtime.ts"),
  ]);

  assert.match(freeIpaOwner, /import integrationRuntime from ["']\.\/operations-http-entry\.ts["']/);
  assert.match(operationsOwner, /import integrationRuntime, \{ handleCatalogRunRequest \} from ["']\.\/index["']/);

  for (const route of [
    "/api/integrations/runs",
    "/api/integrations/notifications",
    "/api/integrations/notifications/read",
  ]) assert.equal(operationsOwner.includes(route), true, `operations owner missing ${route}`);
  assert.match(operationsOwner, /runs\\\/\(\[A-Za-z0-9_-\]\{1,160\}\)\\\/\(cancel\|rerun\)/);
  assert.match(operationsOwner, /runs\\\/\(\[A-Za-z0-9_-\]\{1,160\}\)\\\/files/);

  assert.equal(central.includes('url.pathname === "/api/integrations/notifications"'), false);
  assert.equal(central.includes('url.pathname === "/api/integrations/notifications/read"'), false);
  assert.equal(central.includes('url.pathname === "/api/integrations/runs"'), false);
  assert.equal(central.includes("readRunResultFile"), false);
  assert.equal(central.includes("const runActionMatch"), false);
  assert.equal(central.includes("readRunReplay"), false);
  assert.equal(central.includes("function runStatus"), false);
  assert.equal(central.includes("async function listOperationRuns"), false);
  assert.equal(central.includes("async function syncOperationRuns"), false);
  assert.match(central, /from ["']\.\/xyops-run-runtime\.ts["']/);
  assert.match(central, /import \{[^}]*extractJobStages[^}]*\} from ["\']\.\/xyops-run-runtime\.ts["\']/s);
  assert.match(central, /stages: extractJobStages\(result\)/u);
  assert.match(operationsOwner, /handleCatalogRunRequest/);
  assert.match(operationsOwner, /expectedSchemaVersion: replay\.summary\.schemaVersion/);
  assert.match(operationsOwner, /dangerousConfirmed: actionBody\.confirm === true/);
  assert.match(central, /export async function handleCatalogRunRequest/);

  assert.match(runRuntime, /export function runStatus/);
  assert.match(runRuntime, /export async function listOperationRuns/);
  assert.match(runRuntime, /export async function syncOperationRuns/);
  assert.match(runRuntime, /saveOperationRun/);
  assert.match(runRuntime, /saveRunResult/);
  assert.match(runRuntime, /xyops\.run\.status_changed/);
});

test("canonical route metadata moves the bounded #632 run mutation slice without moving catalog or approvals", async () => {
  const contracts = await source("src/auth/portal-route-contract.ts");
  const line = (id) => contracts.split("\n").find((candidate) => candidate.includes(`id: "${id}"`)) ?? "";

  for (const id of ["xyops.runs.list", "xyops.runs.file", "xyops.runs.cancel", "xyops.runs.rerun", "xyops.notifications.list", "xyops.notifications.read"]) {
    assert.match(line(id), /owner: "worker\/operations-http-entry\.ts"/u, `stale owner for ${id}`);
  }
  for (const id of ["xyops.catalog.run", "xyops.approvals.execute"]) {
    assert.match(line(id), /owner: "worker\/index\.ts"/u, `${id} moved before its bounded slice`);
  }
});

test("operations owner preserves permission and file-proxy safety boundaries", async () => {
  const adapter = await source("worker/operations-http-entry.ts");
  assert.match(adapter, /requirePortalPermission\(request, env, "directory\.read"\)/u);
  assert.match(adapter, /fileUrl\.origin !== xyopsOrigin\.origin/u);
  assert.match(adapter, /redirect: "manual"/u);
  assert.match(adapter, /XYOPS_RESULT_FILE_MAX_BYTES/u);
  assert.match(adapter, /536_870_912/u);
  assert.match(adapter, /x-content-type-options/u);
  assert.match(adapter, /effectiveXyOpsRuntime/u);
});
