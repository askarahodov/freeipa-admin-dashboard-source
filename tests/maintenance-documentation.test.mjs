import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("maintenance runbook documents the complete safe operating contract", () => {
  const runbookUrl = new URL("../docs/MAINTENANCE_MODE.md", import.meta.url);
  assert.equal(fs.existsSync(runbookUrl), true, "docs/MAINTENANCE_MODE.md must exist");
  const runbook = fs.readFileSync(runbookUrl, "utf8");

  for (const endpoint of [
    "/api/admin/maintenance/status",
    "/api/admin/maintenance/prepare",
    "/api/admin/maintenance/enter",
    "/api/admin/maintenance/verification/start",
    "/api/admin/maintenance/exit",
    "/api/admin/maintenance/complete",
    "/api/admin/maintenance/cancel",
    "/api/maintenance/status",
  ]) assert.equal(runbook.includes(endpoint), true, endpoint);

  for (const contract of [
    "controllerSecret",
    "не восстанавливается сервером",
    "отзывает все активные сессии",
    "scheduled-задачи",
    "fail-closed",
    "перезапуска",
    "не выполняет destructive full restore",
    "не заменяет SQLite-файл",
  ]) assert.equal(runbook.includes(contract), true, contract);
});

test("README exposes maintenance and completed selective restore surfaces", () => {
  const readme = read("../README.md");
  for (const endpoint of [
    "/api/admin/backups/import/encrypted/prepare-commit",
    "/api/admin/backups/import/encrypted/commit",
    "/api/admin/backups/import/encrypted/cancel",
    "/api/admin/maintenance/status",
    "/api/admin/maintenance/prepare",
    "/api/admin/maintenance/enter",
    "/api/admin/maintenance/verification/start",
    "/api/admin/maintenance/exit",
    "/api/admin/maintenance/complete",
    "/api/admin/maintenance/cancel",
    "/api/maintenance/status",
  ]) assert.equal(readme.includes(endpoint), true, endpoint);

  assert.equal(readme.includes("portal_maintenance_state"), true);
  assert.equal(readme.includes("отзывает все локальные сессии"), true);
  assert.equal(readme.includes("блокирует обычный API и scheduled-задачи"), true);
  assert.equal(readme.includes("maintenance.manage"), true);
  assert.equal(readme.includes("docs/MAINTENANCE_MODE.md"), true);
});

test("roadmap records PR 70 and PR 71 while keeping offline destructive recovery open", () => {
  const roadmap = read("../docs/PRODUCT_ROADMAP.md");
  assert.equal(roadmap.includes("[x] #37 PR #70: selective production restore"), true);
  assert.equal(roadmap.includes("[x] #37 PR #71: persistent maintenance mode foundation"), true);
  assert.equal(roadmap.includes("[ ] #37: destructive full restore"), true);
  assert.equal(roadmap.includes("[ ] #37: CLI/offline recovery"), true);
});

test("backup plan advances maintenance foundation and leaves offline restore for the next PR", () => {
  const plan = read("../docs/superpowers/plans/2026-07-30-portal-backup-restore.md");
  assert.equal(plan.includes("PR #69 — selected-domain preview plan and isolated in-memory test restore: merged"), true);
  assert.equal(plan.includes("PR #70 — selective production restore: merged"), true);
  assert.equal(plan.includes("PR #71 — persistent maintenance mode foundation: current"), true);
  assert.equal(plan.includes("### PR 7 — persistent maintenance mode foundation — current"), true);
  assert.equal(plan.includes("### PR 8 — destructive full restore and offline recovery"), true);
});
