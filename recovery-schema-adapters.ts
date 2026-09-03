import { FULL_BACKUP_TABLES } from "./src/backup/export/backup-full-domains.ts";
import { PORTAL_BACKUP_DOMAINS } from "./src/backup/backup-manifest.ts";
import type { FullRestoreSource } from "./recovery-backup-source.ts";
import { RecoveryError } from "./recovery-errors.ts";

export type RecoverySchemaAdapter = Readonly<{
  sourceVersion: number;
  currentVersion: number;
  transform(source: FullRestoreSource): FullRestoreSource;
}>;

function fail(code: string, message: string): never {
  throw new RecoveryError(code, 5, message);
}

function validateVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail("recovery_schema_adapter_invalid", "Recovery schema adapter request is invalid");
  }
  return Number(value);
}

function assertCanonicalCurrentLayout(): void {
  if (FULL_BACKUP_TABLES.length !== PORTAL_BACKUP_DOMAINS.length) {
    throw new Error("Recovery schema adapter registry does not match canonical backup domains");
  }
  const tables = new Set<string>();
  for (let domainIndex = 0; domainIndex < PORTAL_BACKUP_DOMAINS.length; domainIndex += 1) {
    const expectedDomain = PORTAL_BACKUP_DOMAINS[domainIndex];
    const entry = FULL_BACKUP_TABLES[domainIndex];
    if (!entry || entry[0] !== expectedDomain || entry[1].length === 0) {
      throw new Error("Recovery schema adapter registry does not match canonical backup domains");
    }
    for (const definition of entry[1]) {
      if (!definition.name
          || tables.has(definition.name)
          || definition.columns.length === 0
          || definition.primaryKey.length === 0
          || definition.primaryKey.some((column) => !definition.columns.includes(column))) {
        throw new Error("Recovery schema adapter registry contains an invalid table layout");
      }
      tables.add(definition.name);
    }
  }
}

assertCanonicalCurrentLayout();

function validateSourceForAdapter(
  source: FullRestoreSource,
  sourceVersion: number,
): FullRestoreSource {
  if (!source
      || typeof source !== "object"
      || source.sourceSchemaVersion !== sourceVersion
      || source.domains.length !== PORTAL_BACKUP_DOMAINS.length
      || !source.domains.every((domain, index) => domain === PORTAL_BACKUP_DOMAINS[index])
      || source.payloads.size !== PORTAL_BACKUP_DOMAINS.length) {
    fail("recovery_schema_adapter_invalid", "Recovery schema source is invalid");
  }
  for (const [domain, definitions] of FULL_BACKUP_TABLES) {
    const payload = source.payloads.get(domain);
    if (!payload
        || payload.domain !== domain
        || payload.schemaVersion !== sourceVersion
        || payload.tables.length !== definitions.length) {
      fail("recovery_schema_adapter_invalid", "Recovery schema source is invalid");
    }
    for (let index = 0; index < definitions.length; index += 1) {
      const definition = definitions[index];
      const table = payload.tables[index];
      if (!table
          || table.name !== definition.name
          || table.columns.length !== definition.columns.length
          || !table.columns.every((column, columnIndex) => column === definition.columns[columnIndex])
          || table.primaryKey.length !== definition.primaryKey.length
          || !table.primaryKey.every((column, columnIndex) => column === definition.primaryKey[columnIndex])) {
        fail("recovery_schema_adapter_invalid", "Recovery schema source is invalid");
      }
    }
  }
  return source;
}

function identityAdapter(sourceVersion: number, currentVersion: number): RecoverySchemaAdapter {
  return Object.freeze({
    sourceVersion,
    currentVersion,
    transform(source: FullRestoreSource): FullRestoreSource {
      return validateSourceForAdapter(source, sourceVersion);
    },
  });
}

const adapterRegistry = new Map<string, RecoverySchemaAdapter>([
  ["2:3", identityAdapter(2, 3)],
  ["3:3", identityAdapter(3, 3)],
]);

export function resolveRecoverySchemaAdapter(
  sourceVersionValue: unknown,
  currentVersionValue: unknown,
): RecoverySchemaAdapter {
  const sourceVersion = validateVersion(sourceVersionValue);
  const currentVersion = validateVersion(currentVersionValue);
  if (sourceVersion > currentVersion) {
    fail("recovery_schema_newer_than_runtime", "Backup schema is newer than the recovery runtime");
  }
  const adapter = adapterRegistry.get(`${sourceVersion}:${currentVersion}`);
  if (!adapter) {
    fail("recovery_schema_adapter_unavailable", "Recovery schema adapter is unavailable");
  }
  return adapter;
}
