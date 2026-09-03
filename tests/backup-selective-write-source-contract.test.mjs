import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sourceUrl = new URL("../src/backup/restore/backup-selective-write-plan.ts", import.meta.url);

test("selective restore write planner uses only fixed guarded DML", () => {
  const source = fs.readFileSync(sourceUrl, "utf8");
  assert.equal(source.includes("FULL_BACKUP_TABLES"), true);
  assert.equal(source.includes("validateFullBackupDomainPayload"), true);
  assert.equal(source.includes("portal_backup_restore_stages"), true);
  assert.equal(source.includes("status = 'committing'"), true);
  assert.equal(source.includes("portal_audit_events"), true);

  assert.doesNotMatch(source, /SELECT\s+\*/i);
  assert.doesNotMatch(source, /\bREPLACE\b/i);
  assert.doesNotMatch(source, /\bCREATE\s+(?:TABLE|INDEX|TRIGGER)\b/i);
  assert.doesNotMatch(source, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(source, /\bDROP\s+(?:TABLE|INDEX|TRIGGER)\b/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+portal_audit_events/i);
  assert.doesNotMatch(source, /UPDATE\s+portal_audit_events/i);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+portal_sessions/i);
  assert.doesNotMatch(source, /portal_role_assignments/);
  assert.doesNotMatch(source, /console\.|fetch\s*\(/);
  assert.doesNotMatch(source, /CONFIG_ENCRYPTION_KEY/);
});

test("SQL identifiers originate from the fixed full backup registry, not request fields", () => {
  const source = fs.readFileSync(sourceUrl, "utf8");
  assert.equal(source.includes("definitionsByDomain"), true);
  assert.equal(source.includes("descriptor.name"), true);
  assert.equal(source.includes("descriptor.columns"), true);
  assert.doesNotMatch(source, /table\.name/);
  assert.doesNotMatch(source, /table\.columns\.join/);
  assert.doesNotMatch(source, /input\.(?:table|column|sql)/);
});
