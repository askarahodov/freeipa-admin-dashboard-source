import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("#632 checkpoint D gives catalog, runs, notifications, and approvals one post-security operations owner", async () => {
  const [freeIpaOwner, operationsOwner, central, runRuntime] = await Promise.all([
    source("worker/freeipa-http-entry.ts"),
    source("worker/operations-http-entry.ts"),
    source("worker/index.ts"),
    source("worker/xyops-run-runtime.ts"),
  ]);

  assert.match(freeIpaOwner, /import integrationRuntime from ["']\.\/operations-http-entry\.ts["']/);
  assert.match(
    operationsOwner,
    /import \{ handleFrameworkRequest \} from ["']\.\/framework-http-entry\.ts["']/,
  );
  assert.match(
    operationsOwner,
    /import \{ loadCatalog, portalCatalog \} from ["']\.\/xyops-catalog-runtime\.ts["']/,
  );
  assert.match(
    operationsOwner,
    /import \{ allowedOperations, automationRoutes, resolveCatalogRuntime \} from ["']\.\/xyops-admin-runtime\.ts["']/,
  );
  assert.match(operationsOwner, /import \{ handleXyOpsAdminRequest \} from ["']\.\/xyops-admin-http\.ts["']/);

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

  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes('url.pathname === "/api/integrations/notifications"'), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes('url.pathname === "/api/integrations/notifications/read"'), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes('url.pathname === "/api/integrations/runs"'), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes('url.pathname === "/api/integrations/approvals"'), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("const approvalActionMatch"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("claimApprovalExecution"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("decideApproval"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("cancelApproval"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("finishApprovalExecution"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("listApprovals"), false);

  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("readRunResultFile"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("const runActionMatch"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("readRunReplay"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("function runStatus"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("async function listOperationRuns"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("async function syncOperationRuns"), false);
  assert.equal(fs.existsSync(centralPath), false);
  assert.doesNotMatch("", /from ["']\.\/xyops-run-runtime\.ts["']/, "central framework tail must not retain catalog/run runtime dependencies");
  assert.match(operationsOwner, /import \{[^}]*extractJobStages[^}]*\} from ["']\.\/xyops-run-runtime\.ts["']/s);
  assert.match(operationsOwner, /stages: extractJobStages\(result\)/u);

  assert.match(operationsOwner, /async function handleCatalogRunRequest/);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("handleCatalogRunRequest"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes('url.pathname === "/api/integrations/catalog"'), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes('url.pathname === "/api/integrations/catalog/history"'), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes('url.pathname === "/api/integrations/catalog/options"'), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes('url.pathname === "/api/integrations/catalog/run"'), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes('url.pathname === "/api/integrations/actions"'), false);
  assert.match(operationsOwner, /expectedSchemaVersion: replay\.summary\.schemaVersion/);
  assert.match(operationsOwner, /dangerousConfirmed: actionBody\.confirm === true/);
  assert.match(operationsOwner, /claimApprovalExecution/);
  assert.match(operationsOwner, /finishApprovalExecution/);
  assert.match(operationsOwner, /headers\.delete\("x-portal-approved-execution"\)/u);
  assert.match(operationsOwner, /resolveCatalogRuntime/);
  assert.match(operationsOwner, /loadCatalog\(runtime\.env, runtime\.xyopsUrl\)/u);
  assert.match(operationsOwner, /currentRequirement\.requiredApprovals/u);
  assert.match(operationsOwner, /handleCatalogRunRequest\([\s\S]*runtime, approvalId\)/u);
  const catalogRuntime = await source("worker/xyops-catalog-runtime.ts");
  assert.equal(fs.existsSync(centralPath), false);
  assert.doesNotMatch("", /export async function loadCatalog/);
  assert.equal(fs.existsSync(centralPath), false);
  assert.doesNotMatch("", /export async function portalCatalog/);
  assert.equal(fs.existsSync(centralPath), false);
  assert.doesNotMatch("", /xyops_catalog_snapshot|xyops_catalog_history|get_events\/v1/);
  assert.match(catalogRuntime, /export async function loadCatalog/);
  assert.match(catalogRuntime, /export async function portalCatalog/);
  assert.match(catalogRuntime, /xyops_catalog_snapshot/);
  assert.match(catalogRuntime, /xyops_catalog_history/);
  assert.match(catalogRuntime, /get_events\/v1/);
  assert.equal(fs.existsSync(centralPath), false);
  assert.match(operationsOwner, /export \{ allowedOperations, automationRoutes, resolveCatalogRuntime \} from ["']\.\/xyops-admin-runtime\.ts["']/);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("async function resolveCatalogRuntime"), false);
  assert.equal(fs.existsSync(centralPath) && fs.readFileSync(centralPath, "utf8").includes("function automationRoutes"), false);

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
