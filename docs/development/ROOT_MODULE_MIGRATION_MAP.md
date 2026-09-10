# Root TypeScript module migration record

Status: **historical completion record for Epic #246 / inventory #251, with current residual defects tracked separately**.

This document records the completed migration program that moved selected root production-module families into explicit `src/` domain ownership. It is **not an active execution plan**, not a runtime contract and not a source of new backlog. For current repository ownership use [`../architecture/PROJECT_STRUCTURE.md`](../architecture/PROJECT_STRUCTURE.md); for current work use GitHub Issues and active PRs.

A closed migration issue is historical status, not proof that every current consumer is still correct. During #539 reconciliation, current `main` revealed one stale backup type import to a removed root path; that bounded cleanup is tracked by #579 and is called out below rather than hidden by the historical completion state.

## Why this record exists

The migration program reduced ambiguous root-level production ownership without intending to change product behavior. Structural moves were executed in dependency-closed slices with import, routing, security and behavior contracts preserved.

The ownership model established by the program is:

```text
src/
  auth/
  backup/
  freeipa/
  operations/
  recovery/
  storage/
```

`app/`, `runtime/`, `worker/`, `db/`, `scripts/`, `tests/` and `e2e/` remain separate architectural owners and were never intended to be folded into this migration.

## Completed domain migrations

### FreeIPA → `src/freeipa/`

Completed by #253 and follow-up consumer/shim cleanup.

Canonical ownership includes the former root FreeIPA query/UI helper family under `src/freeipa/`. Active consumers use canonical paths and no root compatibility copy remains.

Preserved contracts:

- server-side FreeIPA credential/session boundary;
- existing query behavior and errors;
- Worker/UI consumer behavior;
- routed test coverage for runtime paths.

### Operations/catalog → `src/operations/`

Completed by #262 and its implementation slices.

Canonical subdomains include approvals, catalog policy, explorer, presentation and run-lifecycle ownership. Shared automation contracts remain under their explicit automation owner rather than being forced behind one generic facade.

Preserved contracts:

- approval semantics and execution safety;
- catalog/presentation behavior;
- run history/result/replay behavior;
- stable errors, audit and API compatibility.

### Storage → `src/storage/`

Completed by #263 and #264.

Read-only storage status/integrity contracts and migration preflight/apply/operation logic are canonical under `src/storage/`. The canonical database schema and released migration definitions remain in `db/`; this migration did not move schema ownership.

Preserved contracts:

- migration journal/checksum semantics;
- storage status/integrity behavior;
- locks/preflight/apply/failure behavior;
- recovery prerequisites and stable errors.

### Backup → `src/backup/`

Issue #265 is closed/completed and canonical backup ownership is under explicit `src/backup/` subdomains covering projection/preview, export, manifest/domain contracts, restore planning/staging/selection, selective restore and encryption.

Current-main reconciliation for #539 found a residual stale active consumer: `src/backup/restore/backup-restore-plan.ts` still imports the `EncryptedBackupDocument` type from removed root path `../../../backup-encrypted-export.ts`, while the canonical module is `src/backup/export/backup-encrypted-export.ts`. The root file is absent. This is tracked as bounded cleanup #579.

Therefore the historical migration issue remains completed, but documentation must not claim that every current backup consumer is fully reconciled until #579 is merged and verified.

Preserved contracts expected from the migration and #579 cleanup:

- backup formats/manifests;
- encryption compatibility and secret boundaries;
- restore selection/planning semantics;
- RBAC/audit behavior;
- failure and recovery behavior.

### Recovery/maintenance → `src/recovery/`

Completed by #266 and its implementation slices.

Canonical subdomains cover foundation, adapters, orchestration, artifacts, maintenance, CLI/runtime composition and verification. Root `recovery-*` / `maintenance-*` production implementations were removed after active consumers moved.

Preserved contracts:

- destructive/offline confirmation boundaries;
- locks and atomic swap/reconcile behavior;
- maintenance persistence;
- recovery secrets and receipts;
- rollback/failure semantics;
- CLI/container entrypoint behavior.

### Auth/access → `src/auth/`

Completed by #267 as the final security-sensitive root migration family.

Authentication, local sessions, portal permissions, route contracts and stable error ownership are canonical under `src/auth/`. Active app/Worker/test/script consumers use canonical paths and temporary root compatibility shims are gone.

Preserved contracts:

- authentication mechanisms and trust boundaries;
- session/cookie behavior;
- RBAC and permission semantics;
- route metadata and stable errors;
- negative/bypass coverage and CI routing.

## Completion matrix

| Migration family | Historical issue status | Current reconciliation | Canonical owner |
| --- | --- | --- | --- |
| FreeIPA helpers | #253 completed | reconciled | `src/freeipa/` |
| Operations/catalog | #262 completed | reconciled | `src/operations/` |
| Storage read/integrity | #263 completed | reconciled | `src/storage/` |
| Storage migration mutation path | #264 completed | reconciled | `src/storage/` + canonical schema in `db/` |
| Backup | #265 completed | residual stale type import tracked by #579 | `src/backup/` |
| Recovery/maintenance | #266 completed | reconciled | `src/recovery/` |
| Auth/access/contracts | #267 completed | reconciled | `src/auth/` |

Historical issue descriptions and old checkpoints may still contain intermediate phrases such as “next slice”, “in progress” or temporary shim names. Those statements describe the state at that historical checkpoint and must not be used as current scheduling data.

## What intentionally remains outside this migration

The program did not mean “move every root file into `src/`”. Repository/tool entrypoints and configuration remain at their appropriate top-level locations, including:

- `Dockerfile` and `compose.yaml`;
- `package.json`, lockfile and build/tool configuration;
- `README.md` and `AGENTS.md`;
- environment examples;
- frozen transitional root exceptions explicitly owned by the repository placement policy.

The exact current transitional root exceptions are documented in [`../architecture/PROJECT_STRUCTURE.md`](../architecture/PROJECT_STRUCTURE.md) and enforced by `scripts/repository-placement-policy.mjs` plus `tests/architecture/repository-placement-policy.test.mjs`.

Do not create a new cleanup task merely because a TypeScript file is located at repository root. First prove an ownership, maintainability or collision problem on current `main`.

## Invariants preserved by the migration

Every structural slice was expected to preserve:

1. public/runtime behavior;
2. authentication, RBAC and security boundaries;
3. stable error and API contracts;
4. audit behavior;
5. database/migration semantics;
6. backup/recovery safety and compatibility;
7. test discovery and CI routing for moved runtime paths;
8. absence of duplicate active production copies after compatibility cleanup.

A future structural refactor must re-inventory current `main`; this record does not authorize repeating an already completed move. A newly discovered residual defect, such as #579, should receive its own bounded owner rather than rewriting historical completion status into a fictional active migration queue.

## Historical migration method

The migration was intentionally executed as narrow structural slices:

1. inventory inbound/outbound imports and literal-path consumers;
2. identify source-reading/path-contract tests;
3. move one dependency-closed owner;
4. migrate active consumers;
5. remove compatibility shim only after no active consumers remain;
6. update path/routing contracts;
7. run focused tests plus required CI/routed E2E;
8. verify the resulting `main` before declaring the slice complete.

This method remains useful guidance for future structural work, but the numbered sequence above is historical process guidance, **not an ordered queue of unfinished migration tasks**.

## Current navigation

Use these sources for present-day decisions:

- [`../architecture/PROJECT_STRUCTURE.md`](../architecture/PROJECT_STRUCTURE.md) — current repository/module ownership and where-to-change routing;
- [`../architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md) — runtime/trust/data-flow architecture;
- [`../reference/SOURCE_OF_TRUTH.md`](../reference/SOURCE_OF_TRUTH.md) — authoritative contract owners;
- [`../README.md`](../README.md) — engineering documentation index;
- [`../guide/developer/README.md`](../guide/developer/README.md) — developer/AI task-first navigation;
- GitHub Issues and active PRs — current execution state.

If this historical record conflicts with current code/tests or current ownership docs, current code/tests and canonical owners win.