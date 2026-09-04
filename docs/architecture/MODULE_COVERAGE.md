# Module documentation coverage

This document is the canonical map for module-level documentation coverage. It complements `PROJECT_STRUCTURE.md`; it does not replace code, tests, route registries, permission registries, schema or configuration owners.

## Coverage policy

A module gets a local `README.md` when at least one of these is true:

- it owns a production/runtime or security boundary whose misuse can break startup, persistence, authorization or recovery;
- it has non-obvious allowed dependency direction;
- contributors repeatedly need a scoped test/documentation checklist before changing it.

Central coverage in this document is sufficient when the module is mostly presentation, orchestration tooling or tests whose behavior is already discoverable from code and existing active documentation. Local README files must stay short and point to canonical owners instead of copying volatile inventories.

## Coverage matrix

| Module | Coverage | Purpose / owner | Dependency direction | Primary verification / docs impact |
| --- | --- | --- | --- | --- |
| `app/` | Central | Browser-facing UI composition and presentation contracts. Server/security decisions remain outside UI. | UI may consume public/server contracts; it must not become an authorization, secret or integration owner. | UI/component tests, Auth E2E when auth/navigation changes, `PROJECT_STRUCTURE.md`, API/RBAC docs when user-visible contract changes. |
| `worker/` | Local README + central | Server-facing HTTP/domain entry adapters, health, recovery and integration boundaries. | Entry adapters depend on domain/security/storage owners; browser code must not bypass them to reach privileged integrations. | Worker/domain contract tests, auth/RBAC/security tests, reference API/permissions/error-code docs. |
| `runtime/` | Local README + central | Canonical self-hosted production host, SQLite adapter, scheduler, gateway lifecycle and shutdown. | Runtime hosts existing application contracts; domain modules must not depend on Node runtime internals. | Production runtime, persistence, health/shutdown and Compose contract tests; architecture/deployment/configuration ADR impact. |
| `db/` | Local README + central | Canonical portal schema, migration definitions and migration lifecycle. | Application/domain code consumes schema contracts; handlers must not invent fallback DDL. | Migration/schema/storage/recovery tests; `operations/DATABASE_MIGRATIONS.md`, storage/recovery docs and ADRs when durable policy changes. |
| `scripts/` | Central | Operational launchers, recovery/acceptance tooling and repository automation. | Scripts orchestrate canonical runtime/domain owners; they must not become alternate business-rule registries. | Script-specific tests, package-script references, runbooks/configuration/deployment docs. |
| `tests/` | Central | Contract, regression and CI evidence. | Tests may inspect owners; production code must never depend on test modules. | Keep assertions aligned with current owners; update documentation-contract tests when current-state docs deliberately change. |
| `e2e/` | Central | Browser-level behavior and authentication acceptance. | E2E consumes externally observable behavior only. | Scoped E2E routing contract and full Auth E2E when affected. |
| root domain/security modules | Central via `PROJECT_STRUCTURE.md` + active docs | Canonical auth, permissions, audit, settings, FreeIPA/XYOps and recovery domain contracts. | UI/runtime/worker adapters consume these owners; avoid parallel registries in docs or scripts. | Domain tests plus `SOURCE_OF_TRUTH.md`, `SECURITY_MODEL.md`, normalized references and profile runbooks. |

## Before changing a module

1. Read `PROJECT_STRUCTURE.md` and `SOURCE_OF_TRUTH.md` for the canonical owner.
2. Read the local README when the module has one.
3. Identify the narrowest tests that prove the contract, then run the Required CI path before merge.
4. If the change alters routes, permissions, schema, configuration, runtime/deployment, trust boundaries or recovery behavior, update the corresponding active documentation/ADR in the same PR.
5. Never add a second registry of routes, permissions, error codes or configuration solely for documentation convenience.

## Local README contract

Local README files should contain only:

- module responsibility;
- explicit non-responsibilities / dependency direction;
- canonical owner links;
- scoped verification guidance;
- documentation-impact triggers.

They should not enumerate every file, route, table, permission or environment variable because those lists drift quickly and already have canonical owners.