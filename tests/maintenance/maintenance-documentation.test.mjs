import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("maintenance runbook documents the complete recovery operating contract", () => {
  const runbookUrl = new URL("../docs/operations/MAINTENANCE_MODE.md", import.meta.url);
  assert.equal(fs.existsSync(runbookUrl), true, "docs/operations/MAINTENANCE_MODE.md must exist");
  const runbook = fs.readFileSync(runbookUrl, "utf8");

  for (const endpoint of [
    "/api/admin/maintenance/status",
    "/api/admin/maintenance/prepare",
    "/api/admin/maintenance/enter",
    "/api/admin/maintenance/verification/smoke",
    "/api/admin/maintenance/verification/start",
    "/api/admin/maintenance/exit",
    "/api/admin/maintenance/complete",
    "/api/admin/maintenance/cancel",
    "/api/maintenance/status",
  ]) assert.equal(runbook.includes(endpoint), true, endpoint);

  for (const contract of [
    "controllerSecret",
    "не возвращает actor groups, controller secret или его hash",
    "отзывает локальные sessions",
    "scheduled-задачи",
    "fail-closed",
    "перезапуск",
    "OFFLINE_FULL_RESTORE.md",
    "atomic swap",
    "maintenance-recover",
    "не выключается автоматически",
  ]) assert.equal(runbook.includes(contract), true, contract);
});

test("README exposes current recovery capabilities and links authoritative runbooks", () => {
  const readme = read("../README.md");

  for (const capability of [
    "selective production restore",
    "persistent maintenance mode",
    "destructive offline full restore",
  ]) assert.equal(readme.toLowerCase().includes(capability), true, capability);

  for (const ownerDocument of [
    "docs/MAINTENANCE_MODE.md",
    "docs/OFFLINE_FULL_RESTORE.md",
    "docs/operations/DATABASE_MIGRATIONS.md",
  ]) assert.equal(readme.includes(ownerDocument), true, ownerDocument);

  // Exact maintenance/restore endpoint inventories belong to their active runbooks,
  // not to the root overview. This protects README from becoming a duplicated API reference.
  const maintenance = read("../docs/operations/MAINTENANCE_MODE.md");
  for (const endpoint of [
    "/api/admin/maintenance/status",
    "/api/admin/maintenance/prepare",
    "/api/admin/maintenance/enter",
    "/api/admin/maintenance/verification/start",
    "/api/admin/maintenance/exit",
    "/api/admin/maintenance/complete",
    "/api/admin/maintenance/cancel",
    "/api/maintenance/status",
  ]) assert.equal(maintenance.includes(endpoint), true, endpoint);
});

test("roadmap records the completed PR 70 through PR 72 recovery sequence", () => {
  const roadmap = read("../docs/PRODUCT_ROADMAP.md");
  assert.equal(roadmap.includes("[x] #37 PR #70: selective production restore"), true);
  assert.equal(roadmap.includes("[x] #37 PR #71: persistent maintenance mode foundation"), true);
  assert.equal(roadmap.includes("[x] #37 PR #72: destructive full restore"), true);
  assert.equal(roadmap.includes("[x] #37 PR #72: CLI/offline recovery"), true);
});

test("backup plan records maintenance and offline recovery as complete", () => {
  const plan = read("../docs/superpowers/plans/2026-07-30-portal-backup-restore.md");
  assert.equal(plan.includes("PR #69 — selected-domain preview plan and isolated in-memory test restore: merged"), true);
  assert.equal(plan.includes("PR #70 — selective production restore: merged"), true);
  assert.equal(plan.includes("PR #71 — persistent maintenance mode foundation: merged"), true);
  assert.equal(plan.includes("PR #72 — destructive full restore and CLI/offline recovery: current"), true);
  assert.equal(plan.includes("### PR 7 — persistent maintenance mode foundation — complete"), true);
  assert.equal(plan.includes("### PR 8 — destructive full restore and offline recovery — complete"), true);
  assert.equal(plan.includes("docs/OFFLINE_FULL_RESTORE.md"), true);
});
