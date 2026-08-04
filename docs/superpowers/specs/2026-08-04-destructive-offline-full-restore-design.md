# Destructive Offline Full Restore Design

**Issue:** #37  
**Branch:** `agent/offline-full-restore`  
**Base:** `main` after PR #71  
**Status:** approved design, implementation not started

## 1. Purpose

This design adds the final disaster-recovery layer for the local portal database:

- destructive full restore from the existing encrypted logical backup format;
- a mandatory encrypted pre-restore recovery point;
- an offline CLI that works while the dashboard UI and Worker are unavailable;
- crash-safe SQLite replacement and rollback;
- restart verification while persistent maintenance mode remains active;
- a documented emergency path when the maintenance controller secret is lost.

The restore targets the local Wrangler/Miniflare persistence volume mounted at `/app/.wrangler`. It does not restore FreeIPA or XYOps data.

## 2. Scope

### In scope

- a dedicated recovery container and Compose profile;
- an OS-enforced exclusive runtime/recovery lock in the persistent volume;
- discovery of the live SQLite file without depending on a hashed Miniflare filename;
- validation and decryption of the current `EncryptedBackupDocument` format;
- rejection of partial-domain documents for destructive full restore;
- creation and verification of an encrypted raw-SQLite recovery point outside the live volume;
- candidate-database construction from the stopped current database;
- replacement of canonical portal data in the candidate;
- invalidation of historical sessions and unfinished restore stages;
- integrity, schema, administrator, encryption and audit checks;
- atomic same-filesystem swap;
- rollback using either the retained rollback file or the encrypted recovery point;
- post-restart smoke through maintenance recovery controls;
- an offline failed-maintenance recovery command;
- integration and Compose tests, including injected crash points.

### Out of scope

- FreeIPA or XYOps backup;
- remote Cloudflare D1;
- remote object storage;
- retention policy or scheduled cleanup;
- browser restore wizard;
- importing a raw SQLite file supplied by a user;
- automatic maintenance exit;
- automatic use of `CONFIG_ENCRYPTION_KEY` from a backup;
- bypassing a held runtime/recovery lock;
- recovering a host compromised by an attacker with root access.

## 3. Security and threat model

The recovery workflow assumes the operator controls the Docker host and the recovery directory. It protects against:

- accidental restore while the portal is running or paused;
- corrupted, truncated or wrong-password backup documents;
- path traversal and symlink substitution;
- ambiguous SQLite discovery;
- incompatible schema or payload layouts;
- restoring unusable administrator credentials;
- restoring sessions from the past;
- partial mutation of the live database;
- process crashes before, during or after file replacement;
- secret leakage through argv, logs, receipts or audit metadata;
- loss of the maintenance controller secret.

Host root compromise is outside the threat model. Offline possession of the live volume is already equivalent to privileged database access, so the emergency recovery authority is explicit host access plus validated administrator credentials, a fresh recovery point and an exact destructive confirmation. Supplying `ADMIN_TOKEN` to an offline process is not treated as proof of authority because the token has no persisted verifier.

## 4. Existing contracts reused

The implementation reuses, rather than redefines:

- `EncryptedBackupDocument` and its manifest/checksum validation;
- PBKDF2-SHA-256 and AES-256-GCM domain decryption from `backup-encryption.ts`;
- `validateEncryptedBackupDocument` and `decryptEncryptedBackupDomains`;
- `FULL_BACKUP_TABLES` and full-domain payload validation;
- canonical schema inventory, migrations, named indexes and append-only triggers;
- local administrator password verification;
- persistent maintenance states and controller-secret verification;
- aggregate audit conventions.

Destructive restore requires all `PORTAL_BACKUP_DOMAINS` exactly once and in canonical order. A document containing only selected domains remains valid for selective restore but is rejected by the offline full-restore command.

## 5. Deployment model

### 5.1 Recovery image

The Dockerfile gains a dedicated `recovery` target. It contains:

- Node.js 22;
- project dependencies and the TypeScript modules required by the recovery CLI;
- `sqlite3`;
- `flock` from `util-linux`;
- no dashboard process entrypoint.

The normal runtime image also contains `flock`, because the dashboard must hold the same advisory lock for its entire lifetime.

The recovery CLI runs with Node strip-types support and imports the existing backup/schema/auth modules directly. SQLite file operations are delegated to a bounded `sqlite3` subprocess wrapper. SQL is passed only through stdin with `.echo off` and `.bail on`; SQL or row contents are never placed in argv or logs.

### 5.2 Compose profile

`compose.yaml` gains a service similar to:

```yaml
recovery:
  profiles: ["recovery"]
  build:
    context: .
    target: recovery
  image: freeipa-admin-dashboard-recovery:local
  network_mode: host
  user: "${PORTAL_RECOVERY_UID:-10001}:${PORTAL_RECOVERY_GID:-10001}"
  volumes:
    - dashboard-data:/portal-data
    - ${PORTAL_RECOVERY_DIR:-./recovery}:/recovery
    - ${PORTAL_RECOVERY_SECRETS_DIR:-./recovery-secrets}:/run/portal-recovery-secrets:ro
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
```

The operator creates the bind directories with restrictive ownership and mode before use. `/recovery` must resolve outside `/portal-data`; the CLI rejects nested or identical roots.

## 6. Exclusive lock protocol

A single advisory lock file inside the persistent volume coordinates the dashboard runtime and all mutating recovery commands:

```text
/portal-data/.portal-exclusive.lock
/portal-data/.portal-exclusive.owner.json
```

### 6.1 Authority

- The kernel-held exclusive `flock` is authoritative.
- The dashboard acquires the lock before starting Wrangler and holds the file descriptor until the Worker and gateway have exited.
- `backup-current`, `restore`, `rollback` and `maintenance-recover` acquire the same exclusive lock.
- A running, paused or hung process keeps its lock; heartbeat age never permits bypass.
- The operating system releases the lock automatically on process exit or crash.
- File existence alone does not indicate ownership and is never used as permission to proceed.

### 6.2 Diagnostic owner record

While holding the lock, the owner atomically updates `.portal-exclusive.owner.json` with:

- format version;
- random lease ID;
- kind: `runtime` or `recovery`;
- command name;
- process ID as advisory metadata;
- start time;
- heartbeat time.

The heartbeat is diagnostic only. It may explain who holds the lock, but it cannot override a successful or failed `flock` acquisition. The owner record contains no secret or database path.

The dashboard refuses to start when recovery holds the lock. Recovery mutation refuses to run when runtime holds the lock. Read-only `preflight` attempts a non-blocking lock and reports `recovery_runtime_active` when the lock is held.

## 7. CLI contract

The entrypoint is:

```text
node --experimental-strip-types scripts/portal-recovery.ts <command>
```

Public commands:

```text
preflight
backup-current
restore
verify
rollback
maintenance-recover
```

All commands emit one bounded JSON result to stdout. Errors use a normalized code and safe message on stderr. Raw SQLite errors, SQL, decrypted payloads, password hashes and secret values are never emitted.

### 7.1 Secret inputs

Secret values are accepted only from regular files:

- backup password file;
- recovery-point password file;
- maintenance controller-secret file;
- administrator password file;
- configuration-encryption-key file;
- service-admin token file for online verification;
- destructive confirmation file.

The CLI rejects symlinks, non-regular files, oversized files and group/world-readable secret files. Secret values are normalized only according to the exact secret contract; arbitrary whitespace normalization is prohibited. Secret-file paths may appear in argv, but secret values may not.

### 7.2 Non-secret inputs

The backup document path, receipt path, administrator username and recovery roots are non-secret parameters. Every path is canonicalized with `realpath`, constrained to an allowed root and checked again immediately before mutation.

## 8. SQLite discovery

The live database filename is treated as unstable.

Discovery:

1. recursively scans `/portal-data` with bounded depth and file count;
2. skips symlinks, sockets, devices and directories outside the real volume root;
3. identifies SQLite candidates by file header, not only extension;
4. opens candidates read-only;
5. checks the canonical migration journal and a minimum identity set of portal tables;
6. validates that schema state is ready;
7. succeeds only when exactly one candidate matches.

Zero matches returns `recovery_database_not_found`. More than one match returns `recovery_database_ambiguous`. The safe error lists only relative candidate paths and no SQL details.

## 9. Preflight

`preflight` performs no database mutation. It validates:

- roots and permissions;
- exclusive-lock state;
- unique SQLite discovery;
- current schema readiness;
- maintenance state and operation ID;
- controller secret against the stored maintenance hash when supplied;
- encrypted backup structure, checksums and decryption;
- complete canonical domain set;
- explicit source-schema adapter availability;
- administrator username/password against decrypted backup local-auth data;
- at least one enabled, non-locked administrator;
- `CONFIG_ENCRYPTION_KEY` compatibility for encrypted settings, replay and approval payloads included in the backup;
- free disk space.

Space requirements are computed from actual live-database and backup sizes. The volume must have room for candidate plus retained rollback file; the recovery root must have room for plaintext staging during encrypted recovery-point creation plus the encrypted artifact. Preflight never leaves plaintext artifacts behind.

## 10. Schema compatibility

Full restore never performs best-effort column matching.

A versioned adapter registry maps supported backup schema versions to exact table descriptors and transformations. The first implementation supports the backup schema versions whose full-domain layouts are explicitly identical to the current layout, including schema v2 and v3. A newer backup is rejected. An older version without a registered adapter is rejected with `recovery_schema_adapter_unavailable` before any mutation.

The candidate always retains the current database migration journal and current canonical schema. Backup migration rows, maintenance schema rows and Miniflare internal tables are never imported.

## 11. Mandatory encrypted recovery point

`backup-current` is a required stage before `restore`.

### 11.1 Preconditions and source stabilization

The command requires:

- the dashboard stopped and the recovery lock held;
- maintenance state `active` or `verifying`;
- a matching maintenance operation ID;
- a valid controller secret;
- a successful fresh preflight.

It then:

1. opens the discovered database;
2. performs and verifies a WAL checkpoint;
3. closes all SQLite handles;
4. rejects unexpected non-empty WAL state;
5. creates a consistent raw SQLite copy using SQLite backup semantics;
6. verifies `PRAGMA integrity_check` and canonical schema on the copy.

### 11.2 Encryption format

The raw copy is encrypted into a versioned streaming envelope, `portal-recovery-sqlite-v1`, using:

- PBKDF2-SHA-256 with bounded parameters;
- AES-256-GCM;
- random salt and IV;
- authenticated header metadata;
- plaintext byte count and SHA-256;
- ciphertext byte count and SHA-256.

Node streaming crypto is used so the database is not loaded into memory. The password comes from the recovery-password file. The plaintext copy is removed after encryption and directory fsync.

The encrypted artifact is then decrypted to a temporary verification file, its hashes and GCM tag are checked, and SQLite integrity/schema checks are repeated. Restore cannot proceed without this round-trip verification.

### 11.3 Receipt

`backup-current` writes an atomic mode-0600 canonical JSON receipt containing:

- receipt format/version;
- operation ID and creation time;
- relative live-database path;
- source size and SHA-256;
- source schema version;
- maintenance state and maintenance operation ID;
- backup document manifest SHA-256;
- encrypted recovery-point relative path, size and SHA-256;
- allowed confirmation challenge;
- phase `recovery_point_ready`;
- aggregate check outcomes.

It contains no password, key, controller secret, hash of a supplied secret, decrypted row or raw SQLite error.

## 12. Restore preconditions

`restore` requires:

- a valid `recovery_point_ready` receipt;
- the same encrypted backup document used by `backup-current`;
- a matching maintenance operation ID and controller secret;
- maintenance state `active` or `verifying`;
- an acquired recovery lock;
- an unchanged live database size and SHA-256;
- an exact confirmation read from a mode-0600 confirmation file;
- a successful fresh preflight.

The challenge format is operation-bound, for example:

```text
RESTORE PORTAL DATABASE <operationId>
```

A receipt older than the bounded operation window or referring to a changed live database is rejected. The command never provides a `--skip-recovery-point`, `--force-running`, `--ignore-lock`, `--ignore-schema` or `--ignore-checksum` option.

## 13. Candidate database construction

### 13.1 Clone current database

The candidate is created in the same directory and filesystem as the live database using SQLite backup semantics. This preserves:

- Miniflare/D1 internal tables;
- the current migration journal;
- the current maintenance row and controller hash;
- schema metadata not present in the logical backup.

The candidate filename contains the random operation ID and is created with restrictive permissions.

### 13.2 Restore policy

Only an explicit physical-table policy may be mutated. Unknown tables or payload tables cause failure.

Rules:

- settings tables are fully replaced;
- `portal_users` is fully replaced from local-auth;
- incoming `portal_sessions` is checksum-validated but never inserted;
- the logical RBAC projection must exactly match role/disabled values in restored `portal_users`; it is validation evidence, not a physical insert target;
- policy tables are fully replaced;
- catalog tables are fully replaced;
- operation/result/replay/notification tables are fully replaced;
- approval and decision tables are fully replaced;
- historical audit events are fully replaced;
- current migration journal and maintenance state are preserved;
- unfinished selective-restore stage records and their operation credentials are deleted;
- all local sessions remain empty after restore;
- any runtime-only locks or caches stored in SQL are cleared by explicit policy.

Delete order and insert order are fixed by a dependency registry. Foreign-key enforcement is disabled only for the bounded candidate transaction and is followed by `foreign_key_check`. No live-database table is mutated.

### 13.3 Append-only audit handling

Canonical append-only audit triggers may be removed only inside the candidate transaction. Historical audit rows are inserted, the exact canonical triggers are recreated, trigger inventory is verified, and a new aggregate `portal.full_restore.candidate_verified` event is appended. Historical audit rows are never edited after trigger recreation.

### 13.4 Candidate checks

Before swap, all of the following must pass:

- `integrity_check`;
- `foreign_key_check`;
- canonical tables, indexes and triggers;
- migration journal checksum verification;
- maintenance operation and controller-hash preservation;
- all expected domain and table record counts;
- zero restored sessions;
- zero unfinished restore stages;
- at least one enabled and non-locked administrator;
- supplied administrator password verification;
- decryption and validation of settings secrets;
- decryption and validation of operation replay and approval encrypted specs;
- audit append/readback smoke;
- no unexpected schema objects created by the restore planner.

The candidate is checkpointed, closed and fsynced before swap.

## 14. Atomic swap

The swap operates only after all candidate checks pass:

1. verify source database hash again;
2. confirm the recovery process still owns the advisory lock;
3. verify candidate and live files are on the same filesystem;
4. checkpoint and close the live database;
5. reject unexpected non-empty WAL/SHM state;
6. fsync candidate and parent directory;
7. rename live database to an operation-bound rollback filename;
8. rename candidate to the original live path;
9. fsync the parent directory;
10. verify the new live path hash and SQLite header;
11. update the receipt atomically to phase `swapped`.

If the second rename or final fsync fails, the command immediately attempts the reverse rename and records a safe failure phase. The retained rollback file is never overwritten.

Test-only fault injection points cover every boundary before and after each rename and fsync. Production builds do not accept arbitrary fault-injection environment variables.

## 15. Restart and online verification

After a successful swap, the recovery lock is released and the operator starts the dashboard. Persistent maintenance remains active.

`verify` uses loopback HTTP and the service-admin token file. It verifies:

- integration health;
- schema readiness;
- maintenance operation ID and state;
- a new bounded maintenance verification-smoke endpoint;
- administrator credential validity without issuing a persistent session;
- settings decryption using the runtime `CONFIG_ENCRYPTION_KEY`;
- audit append/readback;
- zero active sessions before completion.

The verification-smoke endpoint is available only during the matching maintenance operation, requires service-admin authorization plus operation ID and controller secret, accepts bounded credential input, never returns a secret, and emits aggregate audit only.

On success, `verify` performs the existing transitions:

1. `verification/start` when required;
2. `exit` with aggregate outcomes;
3. `complete` with the exact challenge.

After maintenance becomes `inactive`, `verify` performs a real login/logout smoke with the supplied administrator credentials and confirms that the resulting audit event exists. If a check fails before `complete`, maintenance remains fail-closed. A failure after `complete` marks the receipt `post_complete_failed` and instructs the operator to stop the dashboard and run rollback.

On full success, the receipt becomes `verified`. The same-filesystem rollback file may then be removed after hash verification and directory fsync; the encrypted recovery point remains available according to operator policy.

## 16. Rollback

`rollback` requires the dashboard to be stopped and the recovery lock to be acquired.

Preferred source:

1. retained same-filesystem rollback file whose hash matches the receipt;
2. otherwise the encrypted recovery point, decrypted and round-trip verified with the recovery password.

Rollback creates a recovery point of the currently failed live database before replacing it. It then performs the same atomic swap protocol, integrity/schema checks and receipt transitions. It does not automatically leave maintenance mode.

The receipt records `rolled_back` only after the original source hash and canonical checks are restored.

## 17. Emergency failed-maintenance recovery

`maintenance-recover` is an offline last-resort command for a lost controller secret or irrecoverable maintenance operation metadata.

It requires:

- dashboard stopped and recovery lock held;
- a newly created and verified encrypted recovery point of the current database;
- SQLite integrity and canonical schema success;
- supplied credentials for an enabled, non-locked administrator;
- successful settings and encrypted-payload checks with the supplied configuration key;
- exact operation-bound destructive confirmation;
- an appendable audit table.

It appends an aggregate emergency-recovery audit event and resets only the maintenance singleton to `inactive`, clearing operation credentials and actor metadata. It does not restore business data, delete audit history or alter migrations. No automatic or online secret bypass is added.

## 18. Error model

Representative stable codes:

- `recovery_runtime_active`;
- `recovery_lock_active`;
- `recovery_database_not_found`;
- `recovery_database_ambiguous`;
- `recovery_path_invalid`;
- `recovery_secret_file_invalid`;
- `recovery_backup_incomplete`;
- `recovery_backup_invalid`;
- `recovery_backup_decryption_failed`;
- `recovery_schema_adapter_unavailable`;
- `recovery_maintenance_required`;
- `recovery_controller_invalid`;
- `recovery_confirmation_invalid`;
- `recovery_source_changed`;
- `recovery_space_insufficient`;
- `recovery_point_failed`;
- `recovery_candidate_invalid`;
- `recovery_administrator_unusable`;
- `recovery_config_key_invalid`;
- `recovery_swap_failed`;
- `recovery_verification_failed`;
- `recovery_rollback_failed`.

Wrong password, corrupted ciphertext and authentication-tag failure are intentionally normalized to `recovery_backup_decryption_failed`.

Unexpected errors are normalized to a safe code. Debug logs may contain operation IDs and phases, but never raw database errors, SQL, backup payloads or credentials.

## 19. Idempotency and crash recovery

Each mutating command is receipt-driven.

- Re-running `backup-current` with the same completed receipt returns the existing aggregate result only after verifying artifacts.
- `restore` refuses an already `swapped`, `verified` or `rolled_back` receipt.
- A crash before live rename leaves the original database untouched and candidate cleanup is safe.
- A crash after live-to-rollback rename but before candidate-to-live rename is detected from receipt plus filesystem state; the next invocation restores the rollback file before doing anything else.
- A crash after candidate-to-live rename but before receipt update is resolved by comparing live, candidate and rollback hashes against the receipt.
- Ambiguous filesystem state fails closed and requires rollback, never guesswork.

## 20. Testing strategy

### Unit and contract tests

- advisory lock acquisition, ownership and release-on-process-exit;
- runtime/recovery mutual exclusion, including a paused lock holder;
- safe-path and secret-file validation;
- backup completeness and schema-adapter selection;
- receipt validation and phase transitions;
- SQL literal and statement generation without logging values;
- table dependency ordering and physical restore policy;
- RBAC projection consistency;
- session and stage invalidation;
- normalized error mapping;
- source contracts that prohibit secret argv values and force options.

### SQLite integration tests

Using real temporary SQLite files and the recovery image tooling:

- unique discovery by canonical schema;
- zero and multiple candidates;
- WAL checkpoint and backup round trip;
- encrypted recovery-point round trip;
- corrupted ciphertext, wrong password and truncated files;
- full candidate restore and record counts;
- v2-to-v3 supported adapter;
- unavailable adapter rejection;
- administrator lock, disable and password failures;
- wrong configuration key;
- foreign-key and trigger drift;
- audit restore and append-only trigger recreation;
- no restored sessions;
- no unfinished restore stages;
- rollback from retained file and encrypted point.

### Crash tests

Deterministic test-only faults before and after:

- recovery-point fsync;
- candidate fsync;
- live-to-rollback rename;
- candidate-to-live rename;
- directory fsync;
- receipt update.

Every case must end in either the original verified database or the candidate verified database with an unambiguous rollback path.

### Compose and E2E

- real named `dashboard-data` volume;
- dashboard enters maintenance and sessions are revoked;
- dashboard is stopped;
- offline `backup-current` and `restore` run in the recovery profile;
- dashboard restarts in maintenance;
- verification-smoke, exit and complete succeed;
- real administrator login/logout succeeds;
- settings and audit are visible;
- a second scenario injects post-swap verification failure and proves rollback.

## 21. Documentation

The PR updates:

- `docs/MAINTENANCE_MODE.md` with the complete destructive workflow;
- a dedicated `docs/OFFLINE_RECOVERY.md` runbook;
- Compose setup and required directory permissions;
- backup and recovery secret handling;
- normal restore, rollback and emergency maintenance recovery;
- crash-state decision table;
- `README.md`, product roadmap and issue #37 status.

Examples use secret files and never place credentials directly in command lines.

## 22. Implementation boundaries

Implementation remains modular:

- `portal-recovery-lock.ts` — advisory lock ownership only;
- `portal-recovery-paths.ts` — path and secret validation only;
- `portal-recovery-sqlite.ts` — bounded sqlite3 subprocess and discovery only;
- `portal-recovery-envelope.ts` — streaming raw-SQLite encryption only;
- `portal-recovery-receipt.ts` — receipt schema and atomic phases only;
- `portal-recovery-backup.ts` — encrypted logical backup validation only;
- `portal-recovery-plan.ts` — physical table policy and order only;
- `portal-recovery-candidate.ts` — candidate mutation and checks only;
- `portal-recovery-swap.ts` — atomic replacement and reconciliation only;
- `portal-recovery-online.ts` — loopback verification only;
- `scripts/portal-recovery.ts` — CLI composition only.

No module combines backup cryptography, SQLite mutation, online HTTP and filesystem swap.

## 23. Acceptance criteria

PR #72 is ready only when:

- restore cannot run while the runtime holds the advisory lock, even if the runtime heartbeat is stale;
- restore cannot run without a verified encrypted recovery point;
- partial, corrupted, wrong-password or incompatible backups fail before live mutation;
- only a unique canonical SQLite database can be selected;
- historical sessions and unfinished restore stages are absent after restore;
- current migrations and maintenance operation survive candidate construction;
- all candidate checks pass before swap;
- every swap crash point has a deterministic recovery path;
- restart verification proves administrator access, settings decryption and audit consistency;
- rollback works from both the retained file and encrypted recovery point;
- emergency maintenance recovery is offline, audited and cannot alter business data;
- no secret value appears in argv, responses, receipts, logs, audit or test artifacts;
- lint, production build, full server suite, recovery integration and relevant Playwright E2E are green;
- operations documentation matches effective behavior.
