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
- PR #71 — persistent maintenance mode foundation: current.
- Destructive full restore and CLI/offline recovery remain future isolated PRs.

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
- restart losing the recovery state and reopening the portal prematurely.

Security boundaries:
- `CONFIG_ENCRYPTION_KEY` is never included in an archive;
- full backups use a distinct user-supplied backup password/key;
- browser APIs never return raw password/key values;
- manifest, checksums, decryption and schema compatibility are verified before mutation;
- optimistic concurrency tokens do not replace administrator authorization;
- destructive restore requires maintenance mode, explicit confirmation and a pre-restore backup;
- restore audit records contain safe aggregate outcomes only, never backup credentials, approval tokens, fingerprints or plaintext secrets;
- maintenance is enforced before service-admin authorization and survives Worker restarts;
- maintenance controller material is client-held and is never persisted or audited in plaintext.

## Data ownership

Canonical schema and migrations own all table definitions. Backup modules may read domain data but may not create or alter schema. Selective restore writes only through fixed registry-owned DML after the migration boundary reports a compatible schema and the approved preview is still current. Maintenance state is owned by canonical migration v3 and does not grant backup modules schema ownership.

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

### PR 7 — persistent maintenance mode foundation — current

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
- no filesystem access, backup decryption or destructive restore.

### PR 8 — destructive full restore and offline recovery

- mandatory full pre-restore recovery point;
- explicit destructive confirmation bound to the selected artifact;
- offline process shutdown and volume-level SQLite file discovery;
- authenticated backup decryption outside the live request path;
- SQLite integrity, schema and administrator-access smoke before atomic file replacement;
- fsync/rename or equivalent crash-safe replacement procedure;
- restart smoke, failed-maintenance recovery and rollback procedure;
- CLI/offline tooling and operator documentation;
- Playwright/browser verification only after the portal returns to `inactive`.

## Current maintenance foundation acceptance gate

- migration v3 is additive, immutable and included in final schema drift verification;
- only one concurrent prepare can succeed;
- the raw controller secret is returned once and the server persists only its hash;
- exact state, operation, hash and confirmation guards protect every transition;
- entering `active` and revoking sessions happen in one D1 batch;
- state remains authoritative after a Worker/container restart;
- malformed or unavailable state fails closed;
- the maintenance gate executes after schema readiness and before service-admin authorization;
- `ADMIN_TOKEN` cannot bypass maintenance;
- ordinary API receives safe `503` and scheduled work is suppressed;
- static assets, public status, health, schema status and bounded maintenance controls remain available;
- no controller secret/hash, actor groups, backup material, SQL or raw D1 errors appear in responses or audit;
- maintenance production modules contain no backup crypto, filesystem access, outbound recovery calls or `CONFIG_ENCRYPTION_KEY` access;
- destructive full restore, SQLite file replacement and offline CLI are absent from PR #71;
- lint, build, complete server suite and Auth E2E must pass on the final head before review readiness.
