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
- `backup-export.ts`
- `backup-full-domains.ts`
- `backup-full-projections.ts`
- `backup-import-preview.ts`
- `backup-isolated-restore.ts`
- `backup-isolated-store.ts`
- `backup-isolated-verification.ts`
- `backup-manifest.ts`
- `backup-restore-plan.ts`
- `backup-restore-selection.ts`
- `backup-restore-stage-repository.ts`
- `backup-restore-stage.ts`
- `backup-selective-recovery-point.ts`
- `backup-selective-restore-commit.ts`
- `backup-selective-restore-policy.ts`
- `backup-selective-restore-prepare.ts`
- `backup-selective-write-plan.ts`

Risk: **medium-high**. The family is cohesive by naming but intersects recovery, storage/schema, encryption, maintenance and route/RBAC owners. Preserve one-way dependency direction; do not create a generic utility bucket while moving it.

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

### FreeIPA → `src/freeipa/`

- `freeipa-group-member-query.ts`
- `freeipa-ui-events.ts`
- `freeipa-user-query.ts`

Risk: **medium**. Small root family and a likely early source-move candidate, but imports from Worker/UI and server query contracts must be preserved exactly.

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

1. **FreeIPA query helpers** — smallest cohesive family; verify Worker/UI imports and focused FreeIPA tests first.
2. **Operations leaf modules** — move only leaf modules with low inbound fan-out; split approval/catalog/run subdomains if import evidence requires it.
3. **Storage read-only contracts/inspectors** — status/integrity read paths before migration-apply machinery.
4. **Backup read/export contracts** — previews/manifests/export before restore/commit flows.
5. **Storage migration mutation path** — preflight/apply/operation as a separate high-safety slice.
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

## First implementation candidate

The current preferred first production-code slice is the three-file FreeIPA root family. It has the smallest obvious domain surface and no destructive storage/recovery semantics. Before opening that move PR, enumerate exact inbound imports and path-contract tests for all three files; if that analysis reveals wider coupling, choose an even smaller leaf subset rather than broadening the PR.
