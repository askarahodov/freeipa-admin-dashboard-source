import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../db/portal-migrations.ts", import.meta.url);
let source = await readFile(path, "utf8");

function replaceExact(search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`missing:${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`duplicate:${label}`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

replaceExact(
  `import {\n  portalMigrationV1SecondaryStatements,\n  portalMigrationV1Statements,\n  portalMigrationV1TableStatements,\n} from "./portal-migration-v1.ts";\n`,
  `import {\n  portalMigrationV1SecondaryStatements,\n  portalMigrationV1Statements,\n  portalMigrationV1TableStatements,\n} from "./portal-migration-v1.ts";\nimport {\n  acquirePortalMigrationLock,\n  releasePortalMigrationLock,\n  renewPortalMigrationLock,\n} from "./portal-migration-lock.ts";\n`,
  "shared-lock-import",
);

replaceExact(
  `function resultChanges(value: unknown): number {\n  if (!value || typeof value !== "object") return 0;\n  const result = value as { meta?: { changes?: number }; changes?: number };\n  return Number(result.meta?.changes ?? result.changes ?? 0);\n}\n\n`,
  "",
  "private-result-changes",
);

replaceExact(
  `async function acquireLock(db: D1Database, owner: string, options: MigrationOptions): Promise<boolean> {\n  const attempts = Math.max(1, Math.min(Math.trunc(options.maxLockAttempts ?? 5), 20));\n  const ttl = Math.max(1_000, Math.min(Math.trunc(options.lockTtlMs ?? 60_000), 10 * 60_000));\n  const delay = Math.max(0, Math.min(Math.trunc(options.retryDelayMs ?? 50), 1_000));\n  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));\n  for (let attempt = 0; attempt < attempts; attempt += 1) {\n    const now = safeNow(options);\n    await db.prepare("DELETE FROM portal_schema_lock WHERE id = ? AND acquired_at < ?").bind("main", now - ttl).run();\n    const inserted = await db.prepare("INSERT OR IGNORE INTO portal_schema_lock (id, owner, acquired_at) VALUES (?, ?, ?)")\n      .bind("main", owner, now).run();\n    if (resultChanges(inserted) === 1) return true;\n    if (attempt + 1 < attempts && delay > 0) await sleep(delay);\n  }\n  return false;\n}\n\nasync function renewLock(db: D1Database, owner: string, options: MigrationOptions): Promise<boolean> {\n  const updated = await db.prepare("UPDATE portal_schema_lock SET acquired_at = ? WHERE id = ? AND owner = ?")\n    .bind(safeNow(options), "main", owner).run();\n  return resultChanges(updated) === 1;\n}\n\nasync function releaseLock(db: D1Database, owner: string): Promise<void> {\n  await db.prepare("DELETE FROM portal_schema_lock WHERE id = ? AND owner = ?").bind("main", owner).run();\n}\n\n`,
  "",
  "private-lock-functions",
);

const replacements = [
  ["renewLock(", "renewPortalMigrationLock(", 6],
  ["acquireLock(", "acquirePortalMigrationLock(", 1],
  ["releaseLock(", "releasePortalMigrationLock(", 1],
];
for (const [search, replacement, expected] of replacements) {
  const count = source.split(search).length - 1;
  if (count !== expected) throw new Error(`count:${search}:${count}:${expected}`);
  source = source.replaceAll(search, replacement);
}

for (const forbidden of [
  "async function acquireLock(",
  "async function renewLock(",
  "async function releaseLock(",
  "DELETE FROM portal_schema_lock WHERE id = ? AND acquired_at < ?",
  "INSERT OR IGNORE INTO portal_schema_lock",
  "UPDATE portal_schema_lock SET acquired_at",
]) {
  if (source.includes(forbidden)) throw new Error(`forbidden:${forbidden}`);
}

await writeFile(path, source, "utf8");
