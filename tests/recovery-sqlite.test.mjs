import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  backupSqliteDatabase,
  checkpointSqlite,
  runSqlite,
  verifySqliteIntegrity,
} from "../src/recovery/foundation/recovery-sqlite.ts";

const fakeSqliteSource = `#!/usr/bin/env node
const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  if (input.includes("RAW_ERROR")) {
    process.stderr.write("raw-secret-database-path");
    process.exit(1);
  }
  if (input.includes("LARGE_OUTPUT")) {
    process.stdout.write("x".repeat(4096));
    return;
  }
  if (input.includes("SLOW_QUERY")) {
    setTimeout(() => process.stdout.write("late\\n"), 5000);
    return;
  }
  if (input.includes("PRAGMA wal_checkpoint(TRUNCATE)")) {
    process.stdout.write("0|0|0\\n");
    return;
  }
  if (input.includes("PRAGMA integrity_check")) {
    process.stdout.write(process.env.FAKE_INTEGRITY || "ok\\n");
    return;
  }
  const backup = input.match(/\\.backup\\s+"((?:[^"\\\\]|\\\\.)*)"/);
  if (backup) {
    const destination = backup[1].replace(/\\\\([\\\\"])/g, "$1");
    fs.copyFileSync(process.argv.at(-1), destination);
    return;
  }
  if (input.includes("SELECT 42")) process.stdout.write("42\\n");
});
`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "portal-recovery-sqlite-"));
  const binary = join(root, "sqlite3");
  const database = join(root, "portal.sqlite");
  await writeFile(binary, fakeSqliteSource, { mode: 0o755 });
  await chmod(binary, 0o755);
  await writeFile(database, "SQLite format 3\0fixture", { mode: 0o600 });
  return { root, binary, database };
}

async function expectCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error && error.code === code && !String(error.message).includes("raw-secret"),
  );
}

test("runs bounded sqlite scripts without a shell", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));

  const result = await runSqlite({
    databasePath: value.database,
    mode: "read-only",
    script: "SELECT 42;",
    maxOutputBytes: 1024,
  }, { sqlitePath: value.binary });
  assert.equal(result.stdout, "42\n");
});

test("normalizes raw sqlite failures", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));

  await expectCode(runSqlite({
    databasePath: value.database,
    mode: "read-only",
    script: "RAW_ERROR",
  }, { sqlitePath: value.binary }), "recovery_sqlite_failed");
});

test("kills sqlite on stdout overflow and timeout", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));

  await expectCode(runSqlite({
    databasePath: value.database,
    mode: "read-only",
    script: "LARGE_OUTPUT",
    maxOutputBytes: 64,
  }, { sqlitePath: value.binary }), "recovery_sqlite_output_too_large");

  await expectCode(runSqlite({
    databasePath: value.database,
    mode: "read-only",
    script: "SLOW_QUERY",
  }, { sqlitePath: value.binary, timeoutMs: 30 }), "recovery_sqlite_timeout");
});

test("creates an exclusive sqlite backup through the bounded adapter", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const destination = join(value.root, "copy.sqlite");

  await backupSqliteDatabase(value.database, destination, { sqlitePath: value.binary });
  assert.equal(await readFile(destination, "utf8"), "SQLite format 3\0fixture");
  await expectCode(
    backupSqliteDatabase(value.database, destination, { sqlitePath: value.binary }),
    "recovery_sqlite_destination_exists",
  );
});

test("returns only aggregate checkpoint and integrity outcomes", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));

  assert.deepEqual(await checkpointSqlite(value.database, { sqlitePath: value.binary }), {
    checkpoint: "ok",
    busy: 0,
    logFrames: 0,
    checkpointedFrames: 0,
  });
  assert.deepEqual(await verifySqliteIntegrity(value.database, { sqlitePath: value.binary }), {
    integrity: "ok",
  });
  await expectCode(
    verifySqliteIntegrity(value.database, { sqlitePath: value.binary, env: { FAKE_INTEGRITY: "corrupt row detail\n" } }),
    "recovery_sqlite_integrity_failed",
  );
});

test("rejects malformed paths modes scripts and limits before spawn", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const cases = [
    { databasePath: "relative.sqlite", mode: "read-only", script: "SELECT 1" },
    { databasePath: value.database, mode: "other", script: "SELECT 1" },
    { databasePath: value.database, mode: "read-only", script: "a\0b" },
    { databasePath: value.database, mode: "read-only", script: "SELECT 1", maxOutputBytes: 0 },
  ];
  for (const input of cases) {
    await expectCode(runSqlite(input, { sqlitePath: value.binary }), "recovery_sqlite_request_invalid");
  }
});
