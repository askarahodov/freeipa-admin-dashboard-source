import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import {
  FULL_BACKUP_TABLES,
  type FullBackupTable,
} from "./backup-full-domains.ts";
import { PORTAL_BACKUP_DOMAINS } from "./backup-manifest.ts";
import { verifyBackupAdministrator, type FullRestoreSource } from "./recovery-backup-source.ts";
import { RecoveryError } from "./recovery-errors.ts";
import {
  createRecoveryRestorePolicy,
  type RecoveryRestorePolicy,
} from "./recovery-restore-policy.ts";
import {
  backupSqliteDatabase,
  runSqlite,
  verifySqliteIntegrity,
} from "./recovery-sqlite.ts";
import { portalSchemaTriggers } from "./db/portal-schema.ts";

export type RecoveryCandidateChecks = Readonly<{
  integrity: "ok";
  schema: "ok";
  preserved: "ok";
  counts: "ok";
  administrator: "ok";
  encryption: "ok";
  audit: "ok";
}>;

export type RecoveryCandidateVerification = Readonly<{
  checks: RecoveryCandidateChecks;
  counts: Readonly<Record<string, number>>;
}>;

export type RecoveryCandidateResult = Readonly<{
  candidate: Readonly<{
    path: string;
    sha256: string;
    bytes: number;
  }>;
  checks: RecoveryCandidateChecks;
  counts: Readonly<Record<string, number>>;
}>;

export type RecoveryCandidateInput = {
  livePath: string;
  candidatePath: string;
  expectedLiveSha256: string;
  source: FullRestoreSource;
  operationId: string;
  administratorUsername: string;
  administratorPassword: string;
  configEncryptionKey: string;
  schemaVersion: number;
  now?: number;
};

export type RecoveryCandidateVerificationInput = {
  candidatePath: string;
  source: FullRestoreSource;
  policy: RecoveryRestorePolicy;
  operationId: string;
  administratorUsername: string;
  administratorPassword: string;
  configEncryptionKey: string;
  schemaVersion: number;
  now: number;
  expectedSchemaSnapshot: string;
  expectedPreservedSnapshot: string;
};

export type RecoveryCandidateDependencies = {
  fingerprintFile(path: string): Promise<{ sha256: string; bytes: number }>;
  snapshotSchema(path: string): Promise<string>;
  snapshotPreservedState(path: string): Promise<string>;
  backupDatabase(sourcePath: string, destinationPath: string): Promise<{ backup: "ok" }>;
  verifyAdministrator(
    source: FullRestoreSource,
    username: string,
    password: string,
    now: number,
  ): Promise<{ userId: string; username: string }>;
  verifyEncryptedMaterial(
    source: FullRestoreSource,
    configEncryptionKey: string,
  ): Promise<{ settings: "ok"; replays: "ok"; approvals: "ok" }>;
  runTransaction(path: string, script: string): Promise<void>;
  verifyCandidate(input: RecoveryCandidateVerificationInput): Promise<RecoveryCandidateVerification>;
  removeCandidate(path: string): Promise<void>;
};

type RecoveryCandidateVerificationDependencies = Pick<
  RecoveryCandidateDependencies,
  "snapshotSchema" | "snapshotPreservedState" | "verifyAdministrator" | "verifyEncryptedMaterial"
> & {
  runReadOnly(path: string, script: string): Promise<string>;
  verifyIntegrity(path: string): Promise<{ integrity: "ok" }>;
};

const operationPattern = /^recovery_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const MAX_PATH_BYTES = 4_096;

const sourceDefinitions = new Map<string, {
  domain: typeof PORTAL_BACKUP_DOMAINS[number];
  columns: readonly string[];
  primaryKey: readonly string[];
}>();
for (const [domain, definitions] of FULL_BACKUP_TABLES) {
  for (const definition of definitions) {
    if (sourceDefinitions.has(definition.name)) throw new Error("Duplicate full backup table definition");
    sourceDefinitions.set(definition.name, {
      domain,
      columns: definition.columns,
      primaryKey: definition.primaryKey,
    });
  }
}

function fail(code: string, message: string, exitCode = 9): never {
  throw new RecoveryError(code, exitCode, message);
}

function safePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && isAbsolute(value)
    && !value.includes("\0")
    && new TextEncoder().encode(value).byteLength <= MAX_PATH_BYTES;
}

function exactArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sourceTable(source: FullRestoreSource, name: string): FullBackupTable {
  const definition = sourceDefinitions.get(name);
  const payload = definition ? source.payloads.get(definition.domain) : undefined;
  const table = payload?.tables.find((item) => item.name === name);
  if (!definition
      || !table
      || !exactArray(table.columns, definition.columns)
      || !exactArray(table.primaryKey, definition.primaryKey)) {
    fail("recovery_candidate_payload_invalid", "Recovery candidate payload is invalid");
  }
  return table;
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    fail("recovery_candidate_policy_invalid", "Recovery candidate policy is invalid");
  }
  return `"${value}"`;
}

export function encodeRecoverySqliteLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? "0" : String(value);
  fail("recovery_candidate_payload_invalid", "Recovery candidate payload is invalid");
}

function rowMap(table: FullBackupTable, keys: readonly string[]): Map<string, unknown[]> {
  const indexes = keys.map((key) => table.columns.indexOf(key));
  if (indexes.some((index) => index < 0)) {
    fail("recovery_candidate_payload_invalid", "Recovery candidate payload is invalid");
  }
  const output = new Map<string, unknown[]>();
  for (const row of table.rows) {
    const key = JSON.stringify(indexes.map((index) => row[index]));
    if (output.has(key)) fail("recovery_candidate_payload_invalid", "Recovery candidate payload is invalid");
    output.set(key, row);
  }
  return output;
}

export function validateRecoveryRbacProjection(
  source: FullRestoreSource,
): { rbac: "ok"; users: number } {
  const users = sourceTable(source, "portal_users");
  const projection = sourceTable(source, "portal_role_assignments");
  const userRows = rowMap(users, ["id"]);
  const projectionRows = rowMap(projection, ["id"]);
  const userIndexes = {
    id: users.columns.indexOf("id"),
    username: users.columns.indexOf("username"),
    role: users.columns.indexOf("role"),
    disabled: users.columns.indexOf("disabled"),
  };
  const projectionIndexes = {
    id: projection.columns.indexOf("id"),
    username: projection.columns.indexOf("username"),
    role: projection.columns.indexOf("role"),
    disabled: projection.columns.indexOf("disabled"),
  };
  if ([...Object.values(userIndexes), ...Object.values(projectionIndexes)].some((index) => index < 0)
      || userRows.size !== projectionRows.size) {
    fail("recovery_candidate_rbac_invalid", "Recovery RBAC projection is invalid");
  }
  for (const user of userRows.values()) {
    const projected = projectionRows.get(JSON.stringify([user[userIndexes.id]]));
    if (!projected
        || projected[projectionIndexes.username] !== user[userIndexes.username]
        || projected[projectionIndexes.role] !== user[userIndexes.role]
        || projected[projectionIndexes.disabled] !== user[userIndexes.disabled]) {
      fail("recovery_candidate_rbac_invalid", "Recovery RBAC projection is invalid");
    }
  }
  return { rbac: "ok", users: userRows.size };
}

function validatePolicy(source: FullRestoreSource, policy: RecoveryRestorePolicy): void {
  const backupTables = FULL_BACKUP_TABLES.flatMap(([, tables]) => tables.map((table) => table.name));
  const expected = createRecoveryRestorePolicy({
    selectedDomains: source.domains,
    backupTables,
  });
  for (const key of [
    "selectedDomains",
    "replaceTables",
    "validateOnlyTables",
    "preserveTables",
    "clearTables",
    "insertOrder",
    "deleteOrder",
  ] as const) {
    if (!exactArray(policy[key], expected[key])) {
      fail("recovery_candidate_policy_invalid", "Recovery candidate policy is invalid");
    }
  }
}

function insertStatement(tableName: string, table: FullBackupTable): string | null {
  if (table.rows.length === 0) return null;
  const columns = table.columns.map(quoteIdentifier).join(", ");
  const rows = table.rows.map((row) => {
    if (!Array.isArray(row) || row.length !== table.columns.length) {
      fail("recovery_candidate_payload_invalid", "Recovery candidate payload is invalid");
    }
    return `(${row.map(encodeRecoverySqliteLiteral).join(", ")})`;
  }).join(",\n");
  return `INSERT INTO ${quoteIdentifier(tableName)} (${columns}) VALUES\n${rows};`;
}

function auditStatement(input: {
  operationId: string;
  schemaVersion: number;
  source: FullRestoreSource;
  now: number;
  auditId: string;
}): string {
  const audit = sourceTable(input.source, "portal_audit_events");
  const values: Record<string, unknown> = {
    id: input.auditId,
    created_at: input.now,
    correlation_id: input.operationId,
    actor_identity: "offline-recovery",
    actor_role: "admin",
    actor_groups_json: "[]",
    action: "portal.full_restore.candidate_verified",
    resource_type: "portal_database",
    resource_id: input.operationId,
    event_id: null,
    schema_version: String(input.schemaVersion),
    approval_id: null,
    run_id: null,
    job_id: null,
    outcome: "success",
    error_code: null,
    metadata_json: JSON.stringify({
      records: input.source.totalRecords,
      sourceSchemaVersion: input.source.sourceSchemaVersion,
    }),
  };
  const row = audit.columns.map((column) => {
    if (!Object.hasOwn(values, column)) {
      fail("recovery_candidate_payload_invalid", "Recovery candidate payload is invalid");
    }
    return values[column];
  });
  return insertStatement("portal_audit_events", { ...audit, rows: [row] })!;
}

export function buildRecoveryCandidateScript(input: {
  source: FullRestoreSource;
  policy: RecoveryRestorePolicy;
  operationId: string;
  schemaVersion: number;
  now: number;
  auditId?: string;
}): string {
  if (!input
      || typeof input !== "object"
      || !operationPattern.test(input.operationId)
      || !Number.isSafeInteger(input.schemaVersion)
      || input.schemaVersion < 1
      || !Number.isSafeInteger(input.now)
      || input.now < 0) {
    fail("recovery_candidate_request_invalid", "Recovery candidate request is invalid", 2);
  }
  validatePolicy(input.source, input.policy);
  validateRecoveryRbacProjection(input.source);
  const auditId = input.auditId ?? `audit_${randomUUID()}`;
  if (typeof auditId !== "string" || !auditId.length || auditId.length > 255 || auditId.includes("\0")) {
    fail("recovery_candidate_request_invalid", "Recovery candidate request is invalid", 2);
  }

  const statements = [
    "PRAGMA foreign_keys = OFF;",
    "BEGIN IMMEDIATE;",
    ...portalSchemaTriggers.map((trigger) => `DROP TRIGGER IF EXISTS ${quoteIdentifier(trigger.name)};`),
    ...input.policy.clearTables.map((table) => `DELETE FROM ${quoteIdentifier(table)};`),
    "DELETE FROM \"portal_sessions\";",
    ...input.policy.deleteOrder.map((table) => `DELETE FROM ${quoteIdentifier(table)};`),
  ];
  for (const tableName of input.policy.insertOrder) {
    const statement = insertStatement(tableName, sourceTable(input.source, tableName));
    if (statement) statements.push(statement);
  }
  statements.push(
    ...portalSchemaTriggers.map((trigger) => `${trigger.sql};`),
    auditStatement({ ...input, auditId }),
    "COMMIT;",
    "PRAGMA foreign_keys = ON;",
  );
  return `${statements.join("\n")}\n`;
}

async function fingerprintRecoveryFile(path: string): Promise<{ sha256: string; bytes: number }> {
  if (!safePath(path)) fail("recovery_candidate_request_invalid", "Recovery candidate request is invalid", 2);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      hash.update(buffer);
    }
  } catch {
    fail("recovery_candidate_failed", "Recovery candidate operation failed");
  }
  if (!Number.isSafeInteger(bytes) || bytes < 1) fail("recovery_candidate_failed", "Recovery candidate operation failed");
  return { sha256: hash.digest("hex"), bytes };
}

async function snapshotRecoverySchema(path: string): Promise<string> {
  const result = await runSqlite({
    databasePath: path,
    mode: "read-only",
    script: `SELECT type || '|' || quote(name) || '|' || quote(tbl_name) || '|' || quote(sql)
FROM sqlite_master
WHERE name NOT LIKE 'sqlite_%'
ORDER BY type, name;`,
  });
  return result.stdout;
}

async function snapshotRecoveryPreservedState(path: string): Promise<string> {
  const result = await runSqlite({
    databasePath: path,
    mode: "read-only",
    script: `SELECT 'migration|' || quote(version) || '|' || quote(name) || '|' || quote(checksum) || '|' || quote(applied_at) || '|' || quote(execution_ms)
FROM portal_schema_migrations ORDER BY version;
SELECT 'maintenance|' || quote(id) || '|' || quote(state) || '|' || quote(operation_id) || '|' || quote(controller_secret_hash) || '|' || quote(updated_at)
FROM portal_maintenance_state ORDER BY id;`,
  });
  return result.stdout;
}

async function defaultRunTransaction(path: string, script: string): Promise<void> {
  await runSqlite({ databasePath: path, mode: "read-write", script, maxOutputBytes: 65_536 }, { timeoutMs: 300_000 });
}

async function defaultRunReadOnly(path: string, script: string): Promise<string> {
  return (await runSqlite({ databasePath: path, mode: "read-only", script })).stdout;
}

async function defaultVerifyEncryptedMaterial(): Promise<{ settings: "ok"; replays: "ok"; approvals: "ok" }> {
  fail("recovery_candidate_dependency_missing", "Recovery candidate dependency is unavailable");
}

function completeDependencies(
  supplied: Partial<RecoveryCandidateDependencies>,
): RecoveryCandidateDependencies {
  const combined: Partial<RecoveryCandidateDependencies> = {
    fingerprintFile: fingerprintRecoveryFile,
    snapshotSchema: snapshotRecoverySchema,
    snapshotPreservedState: snapshotRecoveryPreservedState,
    backupDatabase: backupSqliteDatabase,
    verifyAdministrator: verifyBackupAdministrator,
    verifyEncryptedMaterial: defaultVerifyEncryptedMaterial,
    runTransaction: defaultRunTransaction,
    verifyCandidate: (input) => verifyRecoveryCandidate(input, {
      snapshotSchema: combined.snapshotSchema!,
      snapshotPreservedState: combined.snapshotPreservedState!,
      verifyAdministrator: combined.verifyAdministrator!,
      verifyEncryptedMaterial: combined.verifyEncryptedMaterial!,
      runReadOnly: defaultRunReadOnly,
      verifyIntegrity: verifySqliteIntegrity,
    }),
    removeCandidate: (path) => rm(path, { force: true }),
    ...supplied,
  };
  const names: Array<keyof RecoveryCandidateDependencies> = [
    "fingerprintFile",
    "snapshotSchema",
    "snapshotPreservedState",
    "backupDatabase",
    "verifyAdministrator",
    "verifyEncryptedMaterial",
    "runTransaction",
    "verifyCandidate",
    "removeCandidate",
  ];
  if (names.some((name) => typeof combined[name] !== "function")) {
    fail("recovery_candidate_dependency_missing", "Recovery candidate dependency is unavailable");
  }
  return combined as RecoveryCandidateDependencies;
}

function validateCandidateInput(input: RecoveryCandidateInput): number {
  const now = input?.now ?? Date.now();
  if (!input
      || typeof input !== "object"
      || !safePath(input.livePath)
      || !safePath(input.candidatePath)
      || dirname(input.livePath) !== dirname(input.candidatePath)
      || input.livePath === input.candidatePath
      || !hashPattern.test(input.expectedLiveSha256)
      || !operationPattern.test(input.operationId)
      || typeof input.administratorUsername !== "string"
      || !input.administratorUsername.length
      || typeof input.administratorPassword !== "string"
      || !input.administratorPassword.length
      || typeof input.configEncryptionKey !== "string"
      || !input.configEncryptionKey.length
      || !Number.isSafeInteger(input.schemaVersion)
      || input.schemaVersion < 1
      || !Number.isSafeInteger(now)
      || now < 0) {
    fail("recovery_candidate_request_invalid", "Recovery candidate request is invalid", 2);
  }
  return now;
}

function sourceBackupTables(): string[] {
  return FULL_BACKUP_TABLES.flatMap(([, tables]) => tables.map((table) => table.name));
}

export async function buildRecoveryCandidate(
  input: RecoveryCandidateInput,
  suppliedDependencies: Partial<RecoveryCandidateDependencies> = {},
): Promise<RecoveryCandidateResult> {
  const now = validateCandidateInput(input);
  const dependencies = completeDependencies(suppliedDependencies);
  const policy = createRecoveryRestorePolicy({
    selectedDomains: input.source.domains,
    backupTables: sourceBackupTables(),
  });
  let candidateCreated = false;
  try {
    const before = await dependencies.fingerprintFile(input.livePath);
    if (before.sha256 !== input.expectedLiveSha256 || before.bytes < 1) {
      fail("recovery_live_database_changed", "Live recovery database changed");
    }
    const expectedSchemaSnapshot = await dependencies.snapshotSchema(input.livePath);
    const expectedPreservedSnapshot = await dependencies.snapshotPreservedState(input.livePath);
    await dependencies.verifyAdministrator(
      input.source,
      input.administratorUsername,
      input.administratorPassword,
      now,
    );
    const encryption = await dependencies.verifyEncryptedMaterial(input.source, input.configEncryptionKey);
    if (encryption.settings !== "ok" || encryption.replays !== "ok" || encryption.approvals !== "ok") {
      fail("recovery_candidate_encryption_invalid", "Recovery candidate encryption verification failed");
    }
    validateRecoveryRbacProjection(input.source);
    await dependencies.backupDatabase(input.livePath, input.candidatePath);
    candidateCreated = true;
    const afterClone = await dependencies.fingerprintFile(input.livePath);
    if (afterClone.sha256 !== input.expectedLiveSha256 || afterClone.bytes !== before.bytes) {
      fail("recovery_live_database_changed", "Live recovery database changed");
    }
    const script = buildRecoveryCandidateScript({
      source: input.source,
      policy,
      operationId: input.operationId,
      schemaVersion: input.schemaVersion,
      now,
    });
    await dependencies.runTransaction(input.candidatePath, script);
    const verification = await dependencies.verifyCandidate({
      candidatePath: input.candidatePath,
      source: input.source,
      policy,
      operationId: input.operationId,
      administratorUsername: input.administratorUsername,
      administratorPassword: input.administratorPassword,
      configEncryptionKey: input.configEncryptionKey,
      schemaVersion: input.schemaVersion,
      now,
      expectedSchemaSnapshot,
      expectedPreservedSnapshot,
    });
    const fingerprint = await dependencies.fingerprintFile(input.candidatePath);
    if (!hashPattern.test(fingerprint.sha256) || !Number.isSafeInteger(fingerprint.bytes) || fingerprint.bytes < 1) {
      fail("recovery_candidate_failed", "Recovery candidate operation failed");
    }
    return Object.freeze({
      candidate: Object.freeze({ path: input.candidatePath, ...fingerprint }),
      checks: verification.checks,
      counts: verification.counts,
    });
  } catch (error) {
    if (candidateCreated) await dependencies.removeCandidate(input.candidatePath).catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    fail("recovery_candidate_failed", "Recovery candidate operation failed");
  }
}

function parseCounts(stdout: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of stdout.trim().split(/\r?\n/u).filter(Boolean)) {
    const separator = line.lastIndexOf("|");
    const table = separator > 0 ? line.slice(0, separator) : "";
    const count = separator > 0 ? Number(line.slice(separator + 1)) : Number.NaN;
    if (!sourceDefinitions.has(table)
        && table !== "portal_sessions"
        && table !== "portal_backup_restore_stages") {
      fail("recovery_candidate_counts_invalid", "Recovery candidate counts are invalid");
    }
    if (!table || Object.hasOwn(counts, table) || !Number.isSafeInteger(count) || count < 0) {
      fail("recovery_candidate_counts_invalid", "Recovery candidate counts are invalid");
    }
    counts[table] = count;
  }
  return counts;
}

function countScript(policy: RecoveryRestorePolicy): string {
  const tables = [...policy.replaceTables, "portal_sessions", ...policy.clearTables];
  return tables.map((table) => `SELECT '${table}|' || count(*) FROM ${quoteIdentifier(table)};`).join("\n");
}

export async function verifyRecoveryCandidate(
  input: RecoveryCandidateVerificationInput,
  dependencies: RecoveryCandidateVerificationDependencies,
): Promise<RecoveryCandidateVerification> {
  if (!input
      || typeof input !== "object"
      || !safePath(input.candidatePath)
      || !operationPattern.test(input.operationId)
      || !Number.isSafeInteger(input.schemaVersion)
      || input.schemaVersion < 1
      || typeof input.expectedSchemaSnapshot !== "string"
      || typeof input.expectedPreservedSnapshot !== "string") {
    fail("recovery_candidate_request_invalid", "Recovery candidate request is invalid", 2);
  }
  try {
    await dependencies.verifyIntegrity(input.candidatePath);
    const foreignKeys = await dependencies.runReadOnly(input.candidatePath, "PRAGMA foreign_key_check;");
    if (foreignKeys.trim()) fail("recovery_candidate_foreign_key_invalid", "Recovery candidate foreign keys are invalid");
    if (await dependencies.snapshotSchema(input.candidatePath) !== input.expectedSchemaSnapshot) {
      fail("recovery_candidate_schema_invalid", "Recovery candidate schema is invalid");
    }
    if (await dependencies.snapshotPreservedState(input.candidatePath) !== input.expectedPreservedSnapshot) {
      fail("recovery_candidate_preserved_state_invalid", "Recovery candidate preserved state is invalid");
    }
    const counts = parseCounts(await dependencies.runReadOnly(input.candidatePath, countScript(input.policy)));
    for (const table of input.policy.replaceTables) {
      const sourceCount = input.source.tableCounts[table];
      const expected = table === "portal_audit_events" ? sourceCount + 1 : sourceCount;
      if (!Number.isSafeInteger(sourceCount) || counts[table] !== expected) {
        fail("recovery_candidate_counts_invalid", "Recovery candidate counts are invalid");
      }
    }
    if (counts.portal_sessions !== 0
        || input.policy.clearTables.some((table) => counts[table] !== 0)) {
      fail("recovery_candidate_runtime_state_invalid", "Recovery candidate runtime state is invalid");
    }
    await dependencies.verifyAdministrator(
      input.source,
      input.administratorUsername,
      input.administratorPassword,
      input.now,
    );
    const encryption = await dependencies.verifyEncryptedMaterial(input.source, input.configEncryptionKey);
    if (encryption.settings !== "ok" || encryption.replays !== "ok" || encryption.approvals !== "ok") {
      fail("recovery_candidate_encryption_invalid", "Recovery candidate encryption verification failed");
    }
    const audit = await dependencies.runReadOnly(
      input.candidatePath,
      `SELECT count(*) FROM portal_audit_events WHERE action = 'portal.full_restore.candidate_verified' AND resource_id = ${encodeRecoverySqliteLiteral(input.operationId)};`,
    );
    if (audit.trim() !== "1") fail("recovery_candidate_audit_invalid", "Recovery candidate audit verification failed");
    return Object.freeze({
      checks: Object.freeze({
        integrity: "ok",
        schema: "ok",
        preserved: "ok",
        counts: "ok",
        administrator: "ok",
        encryption: "ok",
        audit: "ok",
      }),
      counts: Object.freeze({ ...counts }),
    });
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_candidate_verification_failed", "Recovery candidate verification failed");
  }
}
