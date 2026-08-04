import { FULL_BACKUP_TABLES } from "./backup-full-domains.ts";
import { PORTAL_BACKUP_DOMAINS, type PortalBackupDomain } from "./backup-manifest.ts";
import { RecoveryError } from "./recovery-errors.ts";

export const RECOVERY_VALIDATE_ONLY_TABLES = Object.freeze([
  "portal_sessions",
  "portal_role_assignments",
] as const);

export const RECOVERY_PRESERVE_TABLES = Object.freeze([
  "portal_schema_migrations",
  "portal_schema_lock",
  "portal_maintenance_state",
] as const);

export const RECOVERY_CLEAR_TABLES = Object.freeze([
  "portal_backup_restore_stages",
] as const);

const canonicalBackupTables = Object.freeze(
  FULL_BACKUP_TABLES.flatMap(([, tables]) => tables.map((table) => table.name)),
);

const validateOnly = new Set<string>(RECOVERY_VALIDATE_ONLY_TABLES);
const replaceTables = Object.freeze(canonicalBackupTables.filter((table) => !validateOnly.has(table)));

export type RecoveryRestorePolicy = {
  selectedDomains: PortalBackupDomain[];
  replaceTables: string[];
  validateOnlyTables: string[];
  preserveTables: string[];
  clearTables: string[];
  insertOrder: string[];
  deleteOrder: string[];
};

function exactArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fail(code: string, message: string): never {
  throw new RecoveryError(code, 2, message);
}

export function createRecoveryRestorePolicy(input: {
  selectedDomains: readonly string[];
  backupTables: readonly string[];
}): RecoveryRestorePolicy {
  if (!exactArray(input.selectedDomains, PORTAL_BACKUP_DOMAINS)) {
    fail("recovery_backup_incomplete", "Complete encrypted backup is required");
  }
  if (!exactArray(input.backupTables, canonicalBackupTables)) {
    fail("recovery_backup_layout_invalid", "Backup table layout is incompatible");
  }

  return {
    selectedDomains: [...PORTAL_BACKUP_DOMAINS],
    replaceTables: [...replaceTables],
    validateOnlyTables: [...RECOVERY_VALIDATE_ONLY_TABLES],
    preserveTables: [...RECOVERY_PRESERVE_TABLES],
    clearTables: [...RECOVERY_CLEAR_TABLES],
    insertOrder: [...replaceTables],
    deleteOrder: [...replaceTables].reverse(),
  };
}
