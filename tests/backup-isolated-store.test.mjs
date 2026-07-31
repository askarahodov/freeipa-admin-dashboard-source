import test from "node:test";
import assert from "node:assert/strict";

import { FULL_BACKUP_TABLES } from "../backup-full-domains.ts";
import {
  BackupIsolatedStoreError,
  stageIsolatedRestore,
} from "../backup-isolated-store.ts";

function payload(domain, rowsByTable = {}) {
  const definitions = FULL_BACKUP_TABLES.find(([item]) => item === domain)[1];
  return {
    domain,
    schemaVersion: 1,
    tables: definitions.map((table) => ({
      name: table.name,
      columns: [...table.columns],
      primaryKey: [...table.primaryKey],
      rows: rowsByTable[table.name] ?? [],
    })),
  };
}

test("stages exact validated table bundles into a fresh request-scoped store", () => {
  const settings = payload("settings", {
    app_settings: [["main", "{}", "encrypted", 10]],
  });
  const localAuth = payload("local-auth", {
    portal_users: [["u1", "admin", "Admin", "hash", "salt", 210000, "admin", 0, 0, null, 1, 2, null]],
  });
  const store = stageIsolatedRestore(new Map([
    ["settings", settings],
    ["local-auth", localAuth],
  ]));

  assert.deepEqual(store.selectedDomains(), ["settings", "local-auth"]);
  assert.deepEqual(store.summary(), { domains: 2, tables: 7, records: 2 });
  assert.deepEqual(store.domainSummary("settings"), { tables: 5, records: 1 });
  assert.deepEqual(store.getTable("settings", "app_settings").rows, [["main", "{}", "encrypted", 10]]);

  settings.tables[0].rows[0][1] = '{"changed":true}';
  assert.deepEqual(store.getTable("settings", "app_settings").rows, [["main", "{}", "encrypted", 10]]);

  const returned = store.getTable("settings", "app_settings");
  returned.rows[0][1] = '{"mutated":true}';
  assert.deepEqual(store.getTable("settings", "app_settings").rows, [["main", "{}", "encrypted", 10]]);
});

test("rejects non-canonical domain order and invalid payloads without a partial store", () => {
  const cases = [
    new Map([
      ["local-auth", payload("local-auth")],
      ["settings", payload("settings")],
    ]),
    new Map([["settings", { ...payload("settings"), domain: "audit" }]]),
    new Map([["settings", { ...payload("settings"), tables: [] }]]),
  ];

  for (const candidate of cases) {
    assert.throws(
      () => stageIsolatedRestore(candidate),
      (error) => error instanceof BackupIsolatedStoreError
        && error.code === "backup_test_restore_failed"
        && error.status === 422,
    );
  }
});

test("rechecks primary-key uniqueness while staging", () => {
  const settings = payload("settings", {
    app_settings: [
      ["main", "{}", "encrypted-a", 1],
      ["main", "{}", "encrypted-b", 2],
    ],
  });
  assert.throws(
    () => stageIsolatedRestore(new Map([["settings", settings]])),
    (error) => error instanceof BackupIsolatedStoreError
      && error.code === "backup_test_restore_failed",
  );
});

test("returns null and zero counts for unavailable tables and domains", () => {
  const store = stageIsolatedRestore(new Map([["audit", payload("audit")]]));
  assert.equal(store.getTable("audit", "missing"), null);
  assert.equal(store.getTable("settings", "app_settings"), null);
  assert.deepEqual(store.domainSummary("settings"), { tables: 0, records: 0 });
});
