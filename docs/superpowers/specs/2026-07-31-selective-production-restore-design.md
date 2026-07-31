# Selective Production Restore Design

## Status

Approved continuation of issue #37 PR series after merged PR #69.

## Goal

Add an administrator-only selective production restore workflow that can replace explicitly selected portal-owned domains only after preview, isolated verification, optimistic concurrency recheck, a mandatory encrypted pre-restore recovery point, and an explicit commit confirmation.

Destructive full-database replacement, maintenance mode, audit replacement, automatic migrations, CLI recovery and volume-level restore remain PR #7.

## Chosen approach

Use a two-step staged workflow:

1. `prepare` validates the source backup, selected domains and approval token, runs the isolated restore checks, creates an encrypted recovery point from the current affected production domains, and persists only bounded stage metadata plus a hash of a random stage secret.
2. `commit` requires the original source backup, the downloaded recovery point, both passwords, the stage id/secret and an exact confirmation. It revalidates both documents and current state immediately before one guarded D1 batch.
3. `cancel` atomically marks a prepared stage as cancelled. No source or recovery payload is stored server-side.
4. `rollback` is the same selective prepare/commit workflow with the saved recovery point used as the source. Every rollback therefore creates another pre-rollback recovery point.

This design provides a real cancellation boundary and durable idempotency metadata without storing backup passwords, plaintext payloads, ciphertext documents, approval tokens or current-state fingerprints.

## Threat model

Protected assets:

- production portal database rows;
- backup and recovery passwords;
- password hashes, session token hashes, encrypted settings and encrypted operation specifications;
- approval tokens, stage secrets and current-state fingerprints;
- append-only audit history;
- schema readiness and migration journal.

Primary threats:

- stale preview committed after concurrent production changes;
- forged or replayed stage requests;
- partial domain replacement;
- cross-domain dangling references;
- replacement of append-only audit data;
- restoring a local-auth snapshot with no active administrator;
- reviving historical browser sessions;
- losing the pre-restore recovery point;
- leaking backup material through stage rows, audit, responses or CI artifacts.

## Stage persistence

Add canonical table `portal_backup_restore_stages`:

- `id TEXT PRIMARY KEY NOT NULL`;
- `operation TEXT NOT NULL` (`restore` or `rollback`);
- `actor_identity TEXT NOT NULL`;
- `selected_domains_json TEXT NOT NULL`;
- `stage_secret_hash TEXT NOT NULL`;
- `source_binding_hash TEXT NOT NULL`;
- `recovery_binding_hash TEXT NOT NULL`;
- `source_schema_version INTEGER NOT NULL`;
- `current_schema_version INTEGER NOT NULL`;
- `status TEXT NOT NULL` (`prepared`, `cancelled`, `committed`, `expired`);
- `created_at INTEGER NOT NULL`;
- `expires_at INTEGER NOT NULL`;
- `completed_at INTEGER`.

The table never stores backup documents, passwords, approval tokens, plaintext rows, ciphertext, IVs, salts, encrypted settings values or full current-state fingerprints.

The random stage secret is returned exactly once. Only its SHA-256 hash is stored. Administrator RBAC and same-origin checks remain mandatory; the stage secret never replaces authorization.

Default stage TTL: 15 minutes. Expired stages cannot commit and may be marked `expired` opportunistically.

## Domain policy

Selective production commit uses a fixed policy rather than treating every exported domain identically.

### `settings`

Replace the exact five settings lifecycle tables from the full backup registry. Encrypted secret blobs remain opaque and require the separately retained matching `CONFIG_ENCRYPTION_KEY` after restore.

### `local-auth`

Replace `portal_users`, require at least one active `admin`, and revoke all production sessions. Backup `portal_sessions` rows are validated and retained in the recovery point but are not reactivated by selective restore.

### `rbac`

`portal_role_assignments` is a logical projection of `portal_users`, not a physical table. It can be selected only together with `local-auth`; it adds validation but no DML statements.

### `policies`

Replace the exact policy and presentation tables.

### `catalog`

Replace catalog snapshot/history/sync-run tables. Transient catalog locks are never restored.

### `operations` and `approvals`

These domains form one dependency bundle and must be selected together. Replace their exact full-backup tables in dependency-safe order.

### `audit`

Audit remains preview/test-only in this PR. Replacing or deleting append-only audit events requires maintenance-mode destructive restore and is deferred to PR #7.

## Recovery point

Prepare creates an encrypted full backup of the exact affected physical domains from current production state using a separate user-provided recovery password.

The response contains the recovery document and safe aggregate metadata. The browser must save it before enabling commit.

Commit requires the same recovery document and recovery password. Before mutation the server:

1. validates manifest, checksums, encryption and schema;
2. decrypts only selected domains;
3. compares canonical full-domain payload hashes with a fresh production export;
4. verifies the persisted recovery binding;
5. rejects any mismatch as `backup_recovery_point_stale`.

This proves the supplied recovery point represents the production state that is about to be replaced.

## Optimistic concurrency

Prepare consumes the PR #69 approval token and stores only an opaque source binding hash.

Commit recreates the restore plan from a fresh full production export and verifies the approval token before password derivation and staging. It repeats the current-state export immediately before constructing the write batch.

The guarded batch first atomically claims the stage only when id, actor, secret hash, status and expiry all match. Every delete/insert statement is conditioned on that claimed stage row. If the claim fails, the transaction performs no domain mutation.

## Transactional write plan

No dynamic table or column names come from requests or backup documents.

A fixed write registry is derived from `FULL_BACKUP_TABLES` and the domain policy. Each selected physical table produces:

1. a guarded `DELETE` statement in reverse dependency order;
2. guarded parameterized `INSERT ... SELECT ... WHERE EXISTS(stage guard)` statements in canonical row order.

`rbac` produces no DML. `audit` is rejected. `local-auth` deletes sessions and inserts only users.

The same D1 `batch` includes:

- stage claim;
- all guarded domain deletes/inserts;
- append-only aggregate restore audit event;
- final stage transition to `committed`.

D1 batch failure rolls back the complete mutation.

## Confirmation and cancellation

Commit requires exact confirmation fields:

- `acknowledgeRecoverySaved: true`;
- `acknowledgeSessionRevocation: true` when `local-auth` is selected;
- `confirmation: "RESTORE:<stageId>"` for restore or `"ROLLBACK:<stageId>"` for rollback.

Cancel requires stage id and stage secret, verifies the same actor and administrator RBAC, and changes only `prepared` to `cancelled`.

## API

- `POST /api/admin/backups/import/encrypted/prepare-commit`;
- `POST /api/admin/backups/import/encrypted/commit`;
- `POST /api/admin/backups/import/encrypted/cancel`.

The request operation is `restore` or `rollback`; both use the same server contract and safety gates.

All responses use `cache-control: no-store`.

New permissions:

- `backup.restore.prepare` — admin only;
- `backup.restore.commit` — admin only;
- `backup.restore.cancel` — admin only.

## Safe responses and audit

Responses contain only:

- stage id, expiry and one-time stage secret from prepare;
- selected domains and schema versions;
- aggregate record/table counts;
- fixed warning/error codes;
- recovery document from prepare;
- commit/cancel outcome.

Audit contains action, operation, selected domains, schema versions, aggregate counts, duration, stage status and normalized error code. It excludes passwords, stage secret/hash, approval token, source/recovery bindings, checksums, IV, salt, ciphertext, plaintext rows and encrypted blobs.

## Error model

Fixed errors include:

- `backup_restore_dependency_invalid` — selected domains violate policy;
- `backup_restore_domain_unsupported` — audit or unknown domain requested;
- `backup_restore_stage_invalid` — stage id/secret/actor mismatch;
- `backup_restore_stage_expired` — stage is expired;
- `backup_restore_stage_cancelled` — stage was cancelled;
- `backup_restore_stage_committed` — stage was already committed;
- `backup_recovery_point_invalid` — recovery document is invalid;
- `backup_recovery_point_stale` — recovery document does not match current state;
- `backup_restore_confirmation_required` — confirmation contract is incomplete;
- `backup_restore_admin_required` — local-auth payload has no active administrator;
- `backup_restore_commit_failed` — normalized internal batch failure.

## Rollback

Rollback is not a hidden automatic mutation. The operator uses the saved recovery point as the source of a new `operation: rollback` prepare. The normal preview, isolated test, recovery-point generation, confirmation, CAS and transaction gates run again. This prevents an old recovery file from overwriting newer state without a new review.

## Explicitly out of scope

- full database or volume replacement;
- maintenance mode;
- audit deletion/replacement;
- restoration of historical browser sessions;
- schema migration during restore;
- storing backup/recovery documents on the server;
- remote object storage;
- CLI/offline recovery;
- automatic use or export of `CONFIG_ENCRYPTION_KEY`.
