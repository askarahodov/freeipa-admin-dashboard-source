# Portal Backup and Restore Implementation Plan

## Goal

Implement issue #37 as a sequence of reviewable changes that never expose portal encryption material and reject corrupted or incompatible backups before any database mutation.

## Current status

- PR #65 — manifest foundation: merged.
- PR #66 — sanitized logical export: merged.
- PR #67 — read-only sanitized import preflight: merged.
- PR #68 — encrypted full logical export and read-only encrypted preview: merged.
- PR #69 — selected-domain preview plan and isolated in-memory test restore: current.
- Selective production restore, destructive full restore, maintenance mode and offline recovery remain future isolated PRs.

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
- credentials appearing in HTTP responses, logs, audit metadata or CI artifacts.

Security boundaries:
- `CONFIG_ENCRYPTION_KEY` is never included in an archive;
- full backups use a distinct user-supplied backup password/key;
- browser APIs never return raw password/key values;
- manifest, checksums, decryption and schema compatibility are verified before mutation;
- optimistic concurrency tokens do not replace administrator authorization;
- destructive restore requires maintenance mode, explicit confirmation and a pre-restore backup;
- restore audit records contain safe aggregate outcomes only, never backup credentials, approval tokens, fingerprints or plaintext secrets.

## Data ownership

Canonical schema and migrations own all table definitions. Backup modules may read domain data but may not create or alter schema. Production restore modules may write only in a future PR after the migration boundary reports a compatible schema and the approved preview is still current.

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

### PR 5 — isolated test restore and concurrency plan — current

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

### PR 6 — selective production restore

- consume a current approved plan only under administrator RBAC;
- explicit selected-domain dependency policy;
- staged/transactional production commit behavior;
- optimistic concurrency recheck immediately before commit;
- cancellation before commit;
- mandatory pre-restore recovery point for affected domains;
- rollback and aggregate audit;
- no destructive full-database replacement.

### PR 7 — destructive full restore and recovery

- maintenance mode;
- explicit confirmation challenge;
- mandatory full pre-restore recovery point;
- CLI/offline restore;
- volume-level recovery documentation;
- Playwright restore smoke and rollback verification.

## Current isolated test restore acceptance gate

- encrypted preview and test restore are administrator-only;
- omitted preview selection remains backward compatible and selects all manifest domains;
- explicit selection must be non-empty, duplicate-free and a subset of manifest domains;
- approval token changes with selected backup entries, selection, source/current schema or any current selected-domain field;
- token comparison uses a constant-time byte loop and malformed tokens are rejected;
- stale tokens are rejected before password derivation, decrypted payload staging or isolated store creation;
- current full fingerprints, approval token material and secret-bearing values are never returned or audited;
- only selected domains are decrypted;
- isolated store is request-scoped, all-or-nothing and has no D1, Worker, SQL or network dependency;
- consistency failures return fixed safe errors without table rows or identifiers;
- `canCommit` is advisory and cannot trigger production mutation;
- no DML, DDL, maintenance mode, production restore endpoint, upstream call or `CONFIG_ENCRYPTION_KEY` access exists in this PR;
- lint, build, complete server suite and Auth E2E must pass on the final head before review readiness.
