# Root TypeScript module migration map

Status: migration planning for #251 / Epic #246. This document defines structural ownership before production modules are moved. It is not a runtime contract and does not authorize behavior changes.

## Goal

The repository root should contain project/tool entrypoints and configuration, not unrelated production domains. Production TypeScript modules currently accumulated at root will move incrementally to explicit domain directories only after their imports, tests and runtime entrypoints are updated in the same focused PR.

## Target domain layout

```text
src/
  auth/
  backup/
  freeipa/
  operations/
  recovery/
  storage/
```

Existing `app/`, `runtime/`, `worker/`, `db/`, `scripts/`, `tests/` and `e2e/` remain separate owners. Moving or merging those boundaries is not implied by this map.

## Root production module inventory

### Auth, access and shared contracts → `src/auth/`

- `admin-session-authorization.ts`
- `local-auth.ts`
- `local-session-management.ts`
- `portal-permissions.ts`
- `portal-route-contract.ts`
- `stable-error-contract.ts`

Risk: **high**. These modules participate in authorization, session and route contracts. Move only after all `app/`, `worker/`, `runtime/`, tests and scripts importing them are enumerated. Do not combine this move with auth/RBAC behavior changes.

### Backup → `src/backup/`

- `backup-encrypted-export.ts`
- `backup-encrypted-preview.ts`
- `backup-encryption.ts`
- `backup-export-domains.ts`
- `backup-full-domains.ts`
- `backup-import-preview.ts`
- `backup-isolated-restore.ts`
- `backup-manifest.ts`
- `backup-restore-stage-repository.ts`
- `backup-restore-stage.ts`
- `backup-selective-restore-commit.ts`
- `backup-selective-restore-prepare.ts`
- `backup-selective-write-plan.ts`

Risk: **medium-high**. The family is cohesive by naming but intersects recovery, storage/schema, encryption, maintenance and route/RBAC owners. Preserve one-way dependency direction; do not create a generic utility bucket while moving it.

Current #265 checkpoint: the read-only full-backup projection owner is canonical at `src/backup/preview/backup-full-projections.ts`; its root implementation is removed and active consumers use the canonical path directly. Export orchestration is canonical at `src/backup/export/backup-export.ts`; all production, Worker and focused behavior-test consumers use the canonical path directly, and the temporary root `backup-export.ts` compatibility entrypoint has been removed. Restore selection is canonical at `src/backup/restore/backup-restore-selection.ts`; all production and focused test consumers use the canonical path directly, and the temporary root `backup-restore-selection.ts` compatibility entrypoint has been removed. Isolated restore staging is canonical at `src/backup/restore/backup-isolated-store.ts`; all production and focused test consumers use the canonical path directly, and the temporary root `backup-isolated-store.ts` compatibility entrypoint has been removed. Selective restore policy is canonical at `src/backup/restore/backup-selective-restore-policy.ts`; all production and focused test consumers use the canonical path directly, and the temporary root `backup-selective-restore-policy.ts` compatibility entrypoint has been removed. Isolated restore verification is canonical at `src/backup/restore/backup-isolated-verification.ts`; all production and focused test consumers use the canonical path directly, and the temporary root `backup-isolated-verification.ts` compatibility entrypoint has been removed. Restore planning is canonical at `src/backup/restore/backup-restore-plan.ts`; all production and focused test consumers use the canonical path directly, and the temporary root `backup-restore-plan.ts` compatibility entrypoint has been removed. Selective recovery-point creation and verification are canonical at `src/backup/restore/backup-selective-recovery-point.ts`; all production and focused test consumers use the canonical path directly, and the temporary root `backup-selective-recovery-point.ts` compatibility entrypoint has been removed. Selective write planning is canonical at `src/backup/restore/backup-selective-write-plan.ts`; production and focused source-contract consumers use the canonical path directly, and the temporary root `backup-selective-write-plan.ts` compatibility entrypoint has been removed. Import preview is canonical at `src/backup/preview/backup-import-preview.ts`; all production, Worker and focused test/source-contract consumers use the canonical path directly, and the temporary root `backup-import-preview.ts` compatibility entrypoint has been removed. The remaining root `backup-*.ts` modules listed above stay in explicit follow-up scope and must move only in dependency-closed slices.

### Recovery and maintenance → `src/recovery/`

- `maintenance-mode.ts`
- `maintenance-repository.ts`
- `maintenance-verification-smoke.ts`
- `recovery-backup-source.ts`
- `recovery-candidate.ts`
- `recovery-cli-runtime.ts`
- `recovery-cli.ts`
- `recovery-command-handlers.ts`
- `recovery-discovery.ts`
- `recovery-errors.ts`
- `recovery-local-adapters.ts`
- `recovery-lock.ts`
- `recovery-maintenance.ts`
- `recovery-online-verification.ts`
- `recovery-paths.ts`
- `recovery-point.ts`
- `recovery-preflight.ts`
- `recovery-receipt.ts`
- `recovery-reconcile.ts`
- `recovery-restore-policy.ts`
- `recovery-runtime-command-handlers.ts`
- `recovery-schema-adapters.ts`
- `recovery-secrets.ts`
- `recovery-sqlite.ts`
- `recovery-swap.ts`

Risk: **high**. Recovery owns destructive/offline flows, atomic swap, locks, maintenance state and secret handling. It should move only after backup/storage boundaries are explicit and recovery container/script entrypoints are mapped.

### Storage and migrations → `src/storage/`

- `storage-encryption-self-test.ts`
- `storage-inspect-cli.ts`
- `storage-integrity-contract.ts`
- `storage-integrity-inspect-cli.ts`
- `storage-integrity.ts`
- `storage-migration-apply-context.ts`
- `storage-migration-apply-contract.ts`
- `storage-migration-apply-executor.ts`
- `storage-migration-apply.ts`
- `storage-migration-locked-preflight.ts`
- `storage-migration-operation-repository.ts`
- `storage-migration-operation.ts`
- `storage-migration-preflight-contract.ts`
- `storage-migration-preflight-inspect-cli.ts`
- `storage-migration-preflight.ts`
- `storage-quick-check.ts`
- `storage-status-contract.ts`
- `storage-status.ts`

Risk: **medium-high**. This family is strongly coupled to canonical `db/` schema/migration ownership and recovery/backup prerequisites. `db/` remains canonical; moving these files must not relocate schema ownership into `src/storage/`.

Current status: #263 and #264 are complete. Read-only storage contracts/inspectors and the storage migration preflight/apply/operation mutation path are canonical under `src/storage/`; their root compatibility entrypoints have been removed. `db/` remains the schema/migration source of truth.

### FreeIPA → `src/freeipa/`

- `freeipa-group-member-query.ts`
- `freeipa-ui-events.ts`
- `freeipa-user-query.ts`

Risk: **medium**. Small root family and a likely early source-move candidate, but imports from Worker/UI and server query contracts must be preserved exactly.

Current status: **completed (#253, implementation started in PR #255 and completed by subsequent consumer/shim cleanup).** All three implementations are canonical under `src/freeipa/`, active consumers use the domain paths, and no root compatibility copy remains.

### Operations, catalog and automation → `src/operations/`

- `approval-gates.ts`
- `automation-types.ts`
- `catalog-policies.ts`
- `field-conditions.ts`
- `operation-explorer-legacy-bridge.ts`
- `operation-explorer.ts`
- `process-presentation.ts`
- `run-notifications.ts`
- `run-replays.ts`
- `run-results.ts`

Risk: **medium-high**. This is not necessarily one final module: approval, catalog/presentation and run lifecycle may become subdomains after import analysis. Keep this grouping provisional rather than forcing unrelated code behind one facade.

## Files that stay at repository root

Root project/tool entrypoints are intentionally not part of the production-domain move, including:

- `Dockerfile` and Compose entrypoints until the dedicated deployment-layout audit;
- `package.json`, lockfile, TypeScript/Vite/Next/PostCSS/ESLint/Drizzle configuration;
- `README.md` and `AGENTS.md`;
- environment examples until the configuration-layout audit.

## Ordered migration slices

1. **FreeIPA query helpers — completed (#253).** The three implementations are canonical under `src/freeipa/` with no root compatibility entrypoints.
2. **Operations leaf modules** — move only leaf modules with low inbound fan-out; split approval/catalog/run subdomains if import evidence requires it.
3. **Storage read-only contracts/inspectors — completed (#263).** Status/integrity read paths are canonical under `src/storage/`.
4. **Backup read/export contracts — in progress (#265).** Read-only preview/projection leaves move first; remaining manifest/export/restore modules stay in dependency-closed follow-up slices.
5. **Storage migration mutation path — completed (#264).** Preflight/apply/operation ownership is canonical under `src/storage/migration/` with no root compatibility entrypoints.
6. **Recovery/maintenance** — only after backup/storage paths are stable.
7. **Auth/access/shared route contracts** — last, because of the widest security-sensitive fan-out.

Each numbered item can require multiple PRs. A slice must remain reviewable and must not mix structural move with implementation cleanup.

## Required checks before every move

For every candidate file, collect and record before editing:

1. inbound imports from root, `app/`, `runtime/`, `worker/`, `db/`, `scripts/`, `tests/` and `e2e/`;
2. outbound relative imports and cross-domain edges;
3. package/script/Docker/CI references that use a literal path;
4. source-reading tests that treat a physical path as a contract;
5. TypeScript/build resolution assumptions;
6. documentation/source-of-truth references to the physical path.

After moving, search for the old literal path/name, then run lint/build plus the domain tests selected by existing CI routing. Security/destructive domains require their existing negative and failure-path tests; a move is not a reason to weaken them.

## Dependency rules during migration

- `db/` remains the schema/migration source of truth.
- `worker/` and `runtime/` remain orchestration/runtime boundaries, not dumping grounds for moved root code.
- Do not introduce `src/utils/`, `src/common/` or `src/shared/` merely to avoid deciding ownership.
- Cross-domain imports should point toward an explicit public contract/module, not deep implementation files where a stable boundary already exists.
- Circular dependencies discovered during a move block that slice until ownership is clarified; do not hide a cycle with dynamic imports or path aliases.
- Keep public behavior, stable error codes, RBAC, audit, recovery safety and storage semantics unchanged in structure-only PRs.

## Completed first implementation slice

The three-file FreeIPA family is complete under `src/freeipa/`. The next structural work should follow the ordered slices above and re-inventory current `main` before every move, because parallel work may already have completed individual modules or consumers.
