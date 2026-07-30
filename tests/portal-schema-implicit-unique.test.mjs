import assert from "node:assert/strict";
import test from "node:test";

import { portalSchemaTables } from "../db/portal-schema.ts";
import { classifyAdditionalCanonicalSchemaDrift } from "../db/portal-migrations-hardened.ts";

function canonicalTable(name) {
  const table = portalSchemaTables.find((item) => item.name === name);
  assert.ok(table, `missing canonical table ${name}`);
  return table;
}

test("rejects an additional inline UNIQUE constraint on a canonical table", () => {
  const users = canonicalTable("portal_users");
  const actualSql = users.sql.replace(/\)\s*$/, ", display_name TEXT UNIQUE)");

  const drift = classifyAdditionalCanonicalSchemaDrift([{
    name: "portal_users",
    type: "table",
    tbl_name: "portal_users",
    sql: actualSql,
  }]);

  assert.deepEqual(drift, ["table:portal_users:unexpected_unique_constraint"]);
});

test("rejects an additional table-level UNIQUE constraint on a canonical table", () => {
  const users = canonicalTable("portal_users");
  const actualSql = users.sql.replace(/\)\s*$/, ", UNIQUE(display_name))");

  const drift = classifyAdditionalCanonicalSchemaDrift([{
    name: "PORTAL_USERS",
    type: "table",
    tbl_name: "PORTAL_USERS",
    sql: actualSql,
  }]);

  assert.deepEqual(drift, ["table:PORTAL_USERS:unexpected_unique_constraint"]);
});

test("accepts the canonical UNIQUE constraint set unchanged", () => {
  const users = canonicalTable("portal_users");

  const drift = classifyAdditionalCanonicalSchemaDrift([{
    name: "portal_users",
    type: "table",
    tbl_name: "portal_users",
    sql: users.sql,
  }]);

  assert.deepEqual(drift, []);
});
