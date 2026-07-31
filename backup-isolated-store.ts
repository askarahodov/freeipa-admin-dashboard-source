import {
  validateFullBackupDomainPayload,
  type FullBackupDomainPayload,
  type FullBackupTable,
} from "./backup-full-domains.ts";
import {
  PORTAL_BACKUP_DOMAINS,
  canonicalBackupJson,
  type PortalBackupDomain,
} from "./backup-manifest.ts";

export class BackupIsolatedStoreError extends Error {
  readonly code = "backup_test_restore_failed";
  readonly status = 422;

  constructor(message = "Backup test restore staging failed") {
    super(message);
    this.name = "BackupIsolatedStoreError";
  }
}

export type IsolatedRestoreTable = {
  name: string;
  columns: string[];
  primaryKey: string[];
  rows: unknown[][];
};

type StoredDomain = Map<string, IsolatedRestoreTable>;

function cloneTable(table: FullBackupTable): IsolatedRestoreTable {
  return {
    name: table.name,
    columns: [...table.columns],
    primaryKey: [...table.primaryKey],
    rows: table.rows.map((row) => [...row]),
  };
}

function cloneReturnedTable(table: IsolatedRestoreTable): IsolatedRestoreTable {
  return {
    name: table.name,
    columns: [...table.columns],
    primaryKey: [...table.primaryKey],
    rows: table.rows.map((row) => [...row]),
  };
}

function primaryKey(table: FullBackupTable, row: unknown[]): string {
  const values = table.primaryKey.map((column) => {
    const index = table.columns.indexOf(column);
    if (index < 0) throw new BackupIsolatedStoreError();
    return row[index];
  });
  if (values.some((value) => value === null
      || typeof value === "undefined"
      || (typeof value === "string" && value.length === 0))) {
    throw new BackupIsolatedStoreError();
  }
  return canonicalBackupJson(values);
}

function canonicalSelection(domains: readonly PortalBackupDomain[]): PortalBackupDomain[] {
  return PORTAL_BACKUP_DOMAINS.filter((domain) => domains.includes(domain));
}

function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class IsolatedRestoreStore {
  readonly #selectedDomains: PortalBackupDomain[];
  readonly #domains: Map<PortalBackupDomain, StoredDomain>;

  constructor(selectedDomains: PortalBackupDomain[], domains: Map<PortalBackupDomain, StoredDomain>) {
    this.#selectedDomains = [...selectedDomains];
    this.#domains = domains;
  }

  selectedDomains(): PortalBackupDomain[] {
    return [...this.#selectedDomains];
  }

  getTable(domain: PortalBackupDomain, tableName: string): IsolatedRestoreTable | null {
    const table = this.#domains.get(domain)?.get(tableName);
    return table ? cloneReturnedTable(table) : null;
  }

  getTables(domain: PortalBackupDomain): IsolatedRestoreTable[] {
    return [...(this.#domains.get(domain)?.values() ?? [])].map(cloneReturnedTable);
  }

  domainSummary(domain: PortalBackupDomain): { tables: number; records: number } {
    const tables = this.#domains.get(domain);
    if (!tables) return { tables: 0, records: 0 };
    return {
      tables: tables.size,
      records: [...tables.values()].reduce((total, table) => total + table.rows.length, 0),
    };
  }

  summary(): { domains: number; tables: number; records: number } {
    let tables = 0;
    let records = 0;
    for (const domain of this.#selectedDomains) {
      const summary = this.domainSummary(domain);
      tables += summary.tables;
      records += summary.records;
    }
    return { domains: this.#selectedDomains.length, tables, records };
  }
}

export function stageIsolatedRestore(
  payloads: ReadonlyMap<PortalBackupDomain, FullBackupDomainPayload>,
): IsolatedRestoreStore {
  try {
    const selectedDomains = [...payloads.keys()];
    if (selectedDomains.length === 0
        || !sameArray(selectedDomains, canonicalSelection(selectedDomains))) {
      throw new BackupIsolatedStoreError();
    }

    const staged = new Map<PortalBackupDomain, StoredDomain>();
    for (const domain of selectedDomains) {
      const payload = validateFullBackupDomainPayload(domain, payloads.get(domain));
      const tables = new Map<string, IsolatedRestoreTable>();
      for (const table of payload.tables) {
        const keys = new Set<string>();
        for (const row of table.rows) {
          const key = primaryKey(table, row);
          if (keys.has(key)) throw new BackupIsolatedStoreError();
          keys.add(key);
        }
        if (tables.has(table.name)) throw new BackupIsolatedStoreError();
        tables.set(table.name, cloneTable(table));
      }
      staged.set(domain, tables);
    }

    return new IsolatedRestoreStore(selectedDomains, staged);
  } catch (error) {
    if (error instanceof BackupIsolatedStoreError) throw error;
    throw new BackupIsolatedStoreError();
  }
}
