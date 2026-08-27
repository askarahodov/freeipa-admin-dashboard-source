# ADR-0005: Canonical forward-only migration ownership

- Status: Accepted
- Date: 2026-08-27
- Decision owner: schema and migration lifecycle

## Context

The portal stores durable local state in a SQLite/D1-compatible database. Allowing request handlers or feature modules to create or mutate schema ad hoc would make startup, rollback, restore and drift detection non-deterministic.

The implemented migration lifecycle already separates safe additive startup migrations from controlled maintenance-gated migrations and centralizes schema ownership under `db/`.

## Decision

Schema evolution is forward-only and belongs to the canonical migration registry. Request handlers and scheduled jobs are not DDL owners. Safe additive migrations may run automatically at startup; migrations requiring stronger operational control use the controlled maintenance-gated workflow.

Rollback is performed by restoring a compatible data/image state, not by inventing reverse DDL in ordinary request paths.

## Consequences

- schema history has one deterministic owner;
- startup/readiness can fail closed on incompatible schema state;
- restore and recovery workflows can reason about exact migration versions;
- feature code cannot silently repair or mutate schema as a fallback;
- incompatible changes require explicit operational migration planning.

## Canonical evidence / owners

- `db/portal-schema.ts`;
- `db/portal-migration-registry.ts`;
- `db/portal-migrations.ts`;
- `db/portal-controlled-migrations.ts`;
- `worker/schema-migrations-entry.ts`;
- `worker/schema-migrations-boundary.ts`;
- `docs/DATABASE_MIGRATIONS.md`;
- migration and schema contract tests under `tests/`.

## Supersession

No earlier numbered ADR is superseded. A future change to schema ownership or migration directionality must supersede this ADR explicitly.