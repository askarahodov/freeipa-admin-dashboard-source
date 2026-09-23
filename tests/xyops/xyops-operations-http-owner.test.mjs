import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("#632/#635 give operations and framework fallback explicit owners without a central Worker tail", async () => {
  const [freeIpaOwner, operationsOwner, runRuntime, catalogRuntime] = await Promise.all([
    source("worker/freeipa-http-entry.ts"),
    source("worker/operations-http-entry.ts"),
    source("worker/xyops-run-runtime.ts"),
    source("worker/xyops-catalog-runtime.ts"),
  ]);
  const centralPath = path.join(repoRoot, "worker/index.ts");

  assert.equal(fs.existsSync(centralPath), false, "retired central Worker tail must stay absent");
  assert.match(freeIpaOwner, /import integrationRuntime from ["']\.\/operations-http-entry\.ts["']/);
  assert.match(operationsOwner, /import \{ handleFrameworkRequest \} from ["']\.\/framework-http-entry\.ts["']/);
  assert.match(operationsOwner, /import \{ loadCatalog, portalCatalog \} from ["']\.\/xyops-catalog-runtime\.ts["']/);
  assert.match(operationsOwner, /import \{ allowedOperations, automationRoutes, resolveCatalogRuntime \} from ["']\.\/xyops-admin-runtime\.ts["']/);
  assert.match(operationsOwner, /import \{ handleXyOpsAdminRequest \} from ["']\.\/xyops-admin-http\.ts["']/);
  assert.match(operationsOwner, /return handleFrameworkRequest\(request, sourceEnv, ctx\)/);
  assert.doesNotMatch(operationsOwner, /from ["']\.\/index(?:\.ts)?["']/);

  for (const route of [
    "/api/integrations/catalog",
    "/api/integrations/catalog/history",
    "/api/integrations/catalog/options",
    "/api/integrations/catalog/run",
    "/api/integrations/actions",
    "/api/integrations/runs",
    "/api/integrations/notifications",
    "/api/integrations/notifications/read",
    "/api/integrations/approvals",
  ]) assert.equal(operationsOwner.includes(route), true, `operations owner missing ${route}`);

  assert.match(operationsOwner, /runs\\\/\(\[A-Za-z0-9_-\]\{1,160\}\)\\\/\(cancel\|rerun\)/);
  assert.match(operationsOwner, /runs\\\/\(\[A-Za-z0-9_-\]\{1,160\}\)\\\/files/);
  assert.match(operationsOwner, /approvals\\\/\(\[A-Za-z0-9_-\]\{1,160\}\)\\\/\(approve\|reject\|cancel\|execute\)/);
  assert.match(operationsOwner, /async function handleCatalogRunRequest/);
  assert.match(operationsOwner, /expectedSchemaVersion: replay\.summary\.schemaVersion/);
  assert.match(operationsOwner, /dangerousConfirmed: actionBody\.confirm === true/);
  assert.match(operationsOwner, /claimApprovalExecution/);
  assert.match(operationsOwner, /finishApprovalExecution/);
  assert.match(operationsOwner, /headers\.delete\("x-portal-approved-execution"\)/u);
  assert.match(operationsOwner, /resolveCatalogRuntime/);
  assert.match(operationsOwner, /loadCatalog\(runtime\.env, runtime\.xyopsUrl\)/u);
  assert.match(operationsOwner, /currentRequirement\.requiredApprovals/u);
  assert.match(operationsOwner, /handleCatalogRunRequest\([\s\S]*runtime, approvalId\)/u);
  assert.match(operationsOwner, /import \{[^}]*extractJobStages[^}]*\} from ["']\.\/xyops-run-runtime\.ts["']/s);
  assert.match(operationsOwner, /stages: extractJobStages\(result\)/u);

  assert.match(catalogRuntime, /export async function loadCatalog/);
  assert.match(catalogRuntime, /export async function portalCatalog/);
  assert.match(catalogRuntime, /xyops_catalog_snapshot/);
  assert.match(catalogRuntime, /xyops_catalog_history/);
  assert.match(catalogRuntime, /get_events\/v1/);

  assert.match(runRuntime, /export function runStatus/);
  assert.match(runRuntime, /export async function listOperationRuns/);
  assert.match(runRuntime, /export async function syncOperationRuns/);
  assert.match(runRuntime, /saveOperationRun/);
  assert.match(runRuntime, /saveRunResult/);
  assert.match(runRuntime, /xyops\.run\.status_changed/);
});

test("canonical route metadata keeps user operations ownership and moves administration to the explicit admin owner", async () => {
  const contracts = await source("src/auth/portal-route-contract.ts");
  const line = (id) => contracts.split("\n").find((candidate) => candidate.includes(`id: "${id}"`)) ?? "";

  for (const id of [
    "xyops.catalog.read",
    "xyops.catalog.history",
    "xyops.catalog.options",
    "xyops.catalog.run",
    "xyops.runs.list",
    "xyops.runs.file",
    "xyops.runs.cancel",
    "xyops.runs.rerun",
    "xyops.notifications.list",
    "xyops.notifications.read",
    "xyops.approvals.list",
    "xyops.approvals.approve",
    "xyops.approvals.reject",
    "xyops.approvals.cancel",
    "xyops.approvals.execute",
  ]) {
    assert.match(line(id), /owner: "worker\/operations-http-entry\.ts"/u, `stale owner for ${id}`);
  }

  for (const id of [
    "xyops.routes.read",
    "xyops.routes.update",
    "xyops.presentation.read",
    "xyops.presentation.update",
    "xyops.catalog-policies.read",
    "xyops.catalog-policies.update",
    "xyops.approval-policies.read",
    "xyops.approval-policies.update",
  ]) {
    assert.match(line(id), /owner: "worker\/xyops-admin-http\.ts"/u, `stale admin owner for ${id}`);
  }
});

test("operations owner preserves permission, approval, and file-proxy safety boundaries", async () => {
  const adapter = await source("worker/operations-http-entry.ts");
  assert.match(adapter, /requirePortalPermission\(request, env, "directory\.read"\)/u);
  assert.match(adapter, /"xyops\.approve" : "xyops\.run"/u);
  assert.match(adapter, /allowedSecretFields/u);
  assert.match(adapter, /event\.schemaVersion !== claimed\.spec\.schemaVersion/u);
  assert.match(adapter, /catalogEventAllowed/u);
  assert.match(adapter, /approvalRequirement/u);
  assert.match(adapter, /fileUrl\.origin !== xyopsOrigin\.origin/u);
  assert.match(adapter, /redirect: "manual"/u);
  assert.match(adapter, /XYOPS_RESULT_FILE_MAX_BYTES/u);
  assert.match(adapter, /536_870_912/u);
  assert.match(adapter, /x-content-type-options/u);
  assert.match(adapter, /effectiveXyOpsRuntime/u);
});
