import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("user browser exposes RBAC-aware bulk controls and filtered CSV export", () => {
  const component = fs.readFileSync(new URL("../app/FreeIpaUserBrowser.tsx", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../worker/freeipa-user-bulk-entry.ts", import.meta.url), "utf8");
  const topWorker = fs.readFileSync(new URL("../worker/freeipa-group-member-entry.ts", import.meta.url), "utf8");
  const serviceRoot = fs.readFileSync(new URL("../worker/service-admin-root-entry.ts", import.meta.url), "utf8");
  const vite = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.equal(component.includes("/api/integrations/freeipa/bulk"), true);
  assert.equal(component.includes("/api/integrations/users/export.csv"), true);
  assert.equal(component.includes("/api/integrations/freeipa/actions"), false);
  assert.equal(component.includes("canWrite && payload?.mode === \"live\""), true);
  assert.equal(component.includes("Выбрать текущую страницу"), true);
  assert.equal(component.includes("Подтвердите массовую операцию"), true);
  assert.equal(component.includes("maxBulkUsers = 50"), true);
  assert.equal(component.includes("bulkResult.results.filter"), true);

  assert.equal(worker.includes("preflightWrite"), true);
  assert.equal(worker.includes("permissions.includes(\"freeipa.write\")"), true);
  assert.equal(worker.includes("maxBulkUsers = 50"), true);
  assert.equal(worker.includes("bulkConcurrency = 3"), true);
  assert.equal(worker.includes("207"), true);
  assert.equal(worker.includes("csvCell"), true);
  assert.equal(worker.includes("queryRuntime.fetch"), true);
  assert.equal(worker.includes("/api/integrations/freeipa/actions"), true);

  assert.equal(topWorker.includes("./freeipa-user-bulk-entry"), true);
  assert.equal(topWorker.includes("return bulkRuntime.fetch"), true);
  assert.equal(serviceRoot.includes('import rootRuntime from "./freeipa-group-member-entry"'), true);
  assert.equal(vite.includes("worker/service-admin-root-entry.ts"), true);
  assert.equal(layout.includes("freeipa-user-bulk.css"), true);
});
