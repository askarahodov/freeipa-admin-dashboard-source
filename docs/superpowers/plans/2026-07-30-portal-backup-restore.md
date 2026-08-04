# Portal Backup and Restore Implementation Plan

## Goal

Implement issue #37 as a sequence of reviewable changes that never expose portal encryption material and reject corrupted or incompatible backups before any database mutation.

## Current status

- PR #65 — manifest foundation: merged.
- PR #66 — sanitized logical export: merged.
- PR #67 — read-only sanitized import preflight: merged.
- PR #68 — encrypted full logical export and read-only encrypted preview: merged.
- PR #69 — selected-domain preview plan and isolated in-memory test restore: merged.
- PR #70 — selective production restore: merged.
- PR #71 — persistent maintenance mode foundation: merged.
- PR #72 — destructive full restore and CLI/offline recovery: current.

PR #72 completes the local portal disaster-recovery sequence. Remote storage, retention, FreeIPA/XYOps backup and a browser restore wizard remain outside issue #37.

## Threat model

Protected assets:
- local users, password hashes, roles and sessions;
- integration settings and encrypted secret blobs;
- approvals, policies, operations, catalog metadata and audit records;
- schema compatibility and recovery history.

Primary threats:
- archive tampering or truncation;
- path traversal during import;
- wrong backup password or weak KDF parameters;
- backup archives containing `CONFIG_ENCRYPTION_KEY`, raw passwords, session tokens or logs;
- restore into an incompatible schema;
- destructive overwrite without preview, concurrency control or recovery point;
- partial restore leaving cross-domain references inconsistent;
- credentials appearing in HTTP responses, logs, audit metadata or CI artifacts;
- service-admin or scheduled work bypassing an active maintenance operation;
- restart losing the recovery state and reopening the portal prematurely;
- partial file replacement or a crash between SQLite rename/fsync boundaries;
- choosing a non-canonical local SQLite file by filename or modification time.

Security boundaries:
- `CONFIG_ENCRYPTION_KEY` is never included in an archive;
- full backups use a distinct user-supplied backup password/key;
- browser APIs never return raw password/key values;
- manifest, checksums, decryption and schema compatibility are verified before mutation;
- optimistic concurrency tokens do not replace administrator authorization;
- destructive restore requires maintenance mode, explicit confirmation and a mandatory full recovery point;
- restore audit records contain safe aggregate outcomes only, never backup credentials, approval tokens, fingerprints or plaintext secrets;
- maintenance is enforced before service-admin authorization and survives Worker restarts;
- maintenance controller material is client-held and is never persisted or audited in plaintext;
- offline secret values are accepted only through mode-`0600` files;
- runtime and recovery are mutually exclusive through the same kernel `flock`;
- candidate and rollback files are bound into a canonical receipt and remain on the live filesystem;
- receipt phases and file hashes determine crash reconciliation;
- historical `portal_sessions` are never restored;
- maintenance does not exit automatically on startup or timer.

## Data ownership

Canonical schema and migrations own all table definitions. Backup modules may read domain data but may not create or alter schema. Selective restore writes only through fixed registry-owned DML after the migration boundary reports a compatible schema and the approved preview is still current. Maintenance state is owned by canonical migration v3 and does not grant backup modules schema ownership.

Offline destructive recovery clones the stopped current SQLite, preserves migration and maintenance metadata, replaces only fixed registry-owned canonical domains and temporarily suspends only the canonical append-only audit trigger inside the candidate. It does not run request-path schema migration or accept request-controlled SQL identifiers.

Initial domain allowlist:
- settings;
- local-auth;
- rbac;
- policies;
- catalog;
- operations;
- approvals;
- audit.

Domains are explicit to prevent accidental export of new tables. Adding a domain requires schema mapping, sanitization rules, compatibility checks and tests.

## PR series

### PR 1 — manifest foundation — complete

- versioned backup format;
- deterministic canonical JSON and SHA-256 checksums;
- strict domain/path/checksum validation;
- sanitized payload secret-field guard;
- encryption metadata contract only, without implementing archive encryption;
- negative tests for malformed, incompatible and unsafe manifests.

### PR 2 — sanitized export — complete

- server-side admin authorization;
- per-domain serializers with explicit field allowlists;
- logical download without secret material;
- deterministic manifest, checksums and record counts;
- sanitized create/download audit.

### PR 3 — read-only import preflight — complete

- upload size and strict document validation;
- manifest/path/checksum verification;
- schema compatibility report;
- counts, conflicts and required migrations;
- no DML, restore commit or maintenance mode.

### PR 4 — encrypted full backup and preview — complete

- separate user-supplied backup password;
- PBKDF2-SHA-256 with bounded versioned work factor;
- AES-256-GCM with an independent IV per domain payload;
- authenticated format/version/schema/domain/path context;
- explicit full-domain exporters containing portal recovery fields;
- wrong-password and tamper normalization;
- read-only in-memory decryption, safe projection and conflict preview;
- no backup password, key, plaintext or ciphertext in audit.

### PR 5 — isolated test restore and concurrency plan — complete

- canonical non-empty subset selection for encrypted domains;
- opaque SHA-256 approval token tied to selected backup entries, source/current schema and current full selected-domain fingerprints;
- constant-time token verification before decryption and staging;
- request-scoped isolated memory store with no D1 or SQL dependency;
- exact table/primary-key/record-count validation;
- known JSON-field parsing and local-auth, RBAC, settings, operations and approvals consistency checks;
- fixed bounded warnings without row identifiers;
- advisory `canCommit` only;
- production D1 remains read-only;
- no maintenance mode, DML, migrations or production restore commit.

### PR 6 — selective production restore — complete

- consume a current approved plan only under administrator RBAC;
- explicit selected-domain dependency policy;
- staged/transactional production commit behavior;
- optimistic concurrency recheck immediately before commit;
- cancellation before commit;
- mandatory pre-restore recovery point for affected domains;
- guarded fixed DML and aggregate audit;
- session revocation for local-auth restore;
- no destructive full-database replacement.

### PR 7 — persistent maintenance mode foundation — complete

- canonical additive migration v3 and singleton persistent state;
- client-held one-time controller secret with server-side SHA-256 only;
- guarded `inactive`, `entering`, `active`, `verifying`, `exiting` and fail-closed `failed` transitions;
- admin-only `maintenance.manage` and same-origin mutations;
- exact confirmation challenges for all dangerous transitions;
- all local sessions revoked atomically when maintenance becomes active;
- global API gate outside service-admin authorization;
- ordinary API and scheduled work blocked during maintenance;
- bounded public status, health, schema diagnostics and maintenance controls remain available;
- aggregate-only audit without controller, actor-group or backup material;
- no filesystem access, backup decryption or destructive restore in the PR #71 runtime foundation.

### PR 8 — destructive full restore and offline recovery — complete

- closed offline CLI command schema: `preflight`, `backup-current`, `restore`, `status`, `verify`, `rollback`, `maintenance-recover`;
- runtime/recovery mutual exclusion through a shared kernel `flock`;
- canonical SQLite discovery without hardcoded Wrangler/Miniflare filenames;
- mandatory encrypted raw-SQLite full recovery point with a password distinct from the logical backup password;
- canonical receipt binding live path/hash, maintenance operation, backup manifest, recovery point, candidate and rollback paths;
- complete encrypted logical backup validation and bounded source schema adapters;
- candidate database cloned from the stopped current SQLite;
- preservation of migration journal, schema lock and maintenance operation;
- fixed physical restore policy, RBAC projection validation and forced historical-session removal;
- candidate integrity, canonical schema, administrator password, settings encryption and audit checks before live mutation;
- same-filesystem atomic rename/fsync swap with receipt-driven crash reconciliation;
- rollback from retained original or verified encrypted recovery point;
- trusted service-admin-only `verification/smoke` without persistent session creation;
- bounded online health/schema/smoke and maintenance `VERIFY`, `EXIT`, `RESUME` sequence;
- audited offline failed-maintenance recovery;
- separate non-root recovery Docker target and opt-in Compose profile;
- fault matrix and disposable named-volume smoke in CI;
- operator procedure in `docs/OFFLINE_FULL_RESTORE.md`.

## Final issue #37 acceptance gate

- every backup/import/restore format is versioned and validated before mutation;
- sanitized and encrypted exports preserve fixed domain ownership and never include `CONFIG_ENCRYPTION_KEY`;
- selective restore is staged, concurrency-bound, transactional and recovery-point protected;
- maintenance survives restart, blocks ordinary API/scheduled work and cannot be bypassed by `ADMIN_TOKEN`;
- destructive restore cannot run concurrently with dashboard runtime;
- database discovery requires exactly one canonical schema match;
- full recovery point is created, integrity-checked, encrypted and reopened before candidate work;
- candidate restoration uses only static registry identifiers and never restores historical sessions;
- no live SQL mutation occurs before the verified atomic file swap;
- every rename/fsync crash boundary is fail-closed or maps to one receipt-driven reconciliation action;
- online verification checks schema, administrator access, settings decryption, audit write and session revocation before maintenance completion;
- offline failed-maintenance recovery requires exact confirmation, a valid receipt/recovery point and verified administrator/config credentials;
- secret values do not appear in argv, stdout, receipt, audit or CI artifacts;
- no bypass flags or automatic maintenance exit exist;
- lint, production build, complete server suite, Auth E2E, recovery image build and disposable named-volume Compose smoke pass on one final head before merge.
