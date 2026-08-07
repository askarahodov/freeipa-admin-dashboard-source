import assert from "node:assert/strict";
import test from "node:test";

import {
  portalMigrationOperationsTable,
  portalMigrationV4SecondaryStatements,
  portalMigrationV4Statements,
  portalMigrationV4TableStatements,
} from "../db/portal-migration-v4.ts";

const expectedColumns = [
  "id",
  "operation_id",
  "maintenance_operation_id",
  "from_version",
  "target_version",
  "total_count",
  "applied_count",
  "state",
  "created_at",
  "started_at",
  "updated_at",
  "completed_at",
  "failure_code",
];

test("v4 defines one bounded canonical migration operation table", () => {
  assert.equal(portalMigrationOperationsTable.name, "portal_migration_operations");
  assert.deepEqual(portalMigrationOperationsTable.columns.map((column) => column.name), expectedColumns);
  assert.deepEqual(portalMigrationV4TableStatements, [portalMigrationOperationsTable.sql]);
  assert.deepEqual(portalMigrationV4SecondaryStatements, []);
  assert.deepEqual(portalMigrationV4Statements, [portalMigrationOperationsTable.sql]);
});

test("v4 SQL constrains singleton identity, states, counts and timestamps", () => {
  const sql = portalMigrationOperationsTable.sql.replace(/\s+/g, " ").toLowerCase();
  assert.match(sql, /id text primary key not null check\s*\(id = 'main'\)/);
  assert.match(sql, /state text not null check\s*\(state in \('running', 'succeeded', 'failed', 'interrupted', 'reconciled'\)\)/);
  assert.match(sql, /from_version integer not null check\s*\(from_version >= 0\)/);
  assert.match(sql, /target_version integer not null check\s*\(target_version >= from_version\)/);
  assert.match(sql, /total_count integer not null check\s*\(total_count between 0 and 1000\)/);
  assert.match(sql, /applied_count integer not null check\s*\(applied_count between 0 and total_count\)/);
  for (const field of ["created_at", "started_at", "updated_at"]) {
    assert.match(sql, new RegExp(`${field} integer not null check\\s*\\(${field} >= 0\\)`));
  }
  assert.match(sql, /completed_at integer check\s*\(completed_at is null or completed_at >= 0\)/);
  assert.match(sql, /failure_code text check\s*\(failure_code is null or length\(failure_code\) between 1 and 80\)/);
});

test("v4 schema stores no credentials, actors or migration internals", () => {
  const joined = expectedColumns.join(" ");
  for (const forbidden of [
    "actor",
    "group",
    "secret",
    "token",
    "owner",
    "sql",
    "checksum",
    "migration_name",
    "backup",
    "path",
    "request",
  ]) {
    assert.equal(joined.includes(forbidden), false, forbidden);
  }
});
