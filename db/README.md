# Database module

`db/` owns the canonical portal schema and versioned migration definitions for the local D1/SQLite-compatible store.

## Responsibilities

- define canonical schema and migration inventory;
- classify migrations according to the supported automatic/controlled lifecycle;
- preserve the migration journal and fail-closed schema compatibility contract.

## Non-responsibilities

- request handlers and UI code must not create fallback DDL;
- runtime adapters may host SQLite but must not redefine schema policy;
- docs must not duplicate tables/columns as a second schema registry.

## Canonical references

- `db/portal-schema.ts`
- `db/portal-migration-registry.ts`
- versioned `db/portal-migration-v*.ts` definitions
- `docs/DATABASE_MIGRATIONS.md`
- storage/recovery runbooks
- `docs/adr/ADR-0005-forward-only-migrations.md`

## Verification

Schema or migration changes require the migration/schema contract tests and relevant storage/recovery tests. Controlled migration semantics must remain maintenance-gated and observable through the existing lifecycle contracts.

Update `DATABASE_MIGRATIONS.md`, recovery/storage documentation and ADRs when the durable migration strategy or schema ownership boundary changes.