# Portal Backup and Restore Implementation Plan

## Goal

Implement issue #37 as a sequence of reviewable changes that never expose portal encryption material and reject corrupted or incompatible backups before any database mutation.

## Current status

- PR #65 — manifest foundation: merged.
- PR #66 — sanitized logical export: merged.
- PR #67 — read-only sanitized import preflight: merged.
- PR #68 — encrypted full logical export and read-only encrypted preview: implemented in this branch.
- Selective restore, destructive full restore, maintenance mode and offline recovery remain future isolated PRs.

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
- destructive restore requires maintenance mode, explicit confirmation and a pre-restore backup;
- restore audit records contain identifiers and outcomes only, never backup credentials or plaintext secrets.

## Data ownership

Canonical schema and migrations own all table definitions. Backup modules may read domain data but may not create or alter schema. Restore modules write only after the migration boundary reports a compatible schema.

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

### PR 4 — encrypted full backup and preview — current

- separate user-supplied backup password;
- PBKDF2-SHA-256 with bounded versioned work factor;
- AES-256-GCM with an independent IV per domain payload;
- authenticated format/version/schema/domain/path context;
- explicit full-domain exporters containing portal recovery fields;
- wrong-password and tamper normalization;
- read-only in-memory decryption, safe projection and conflict preview;
- no backup password, key, plaintext or ciphertext in audit.

### PR 5 — isolated test restore and selective restore

- domain-level diff and selected domains;
- optimistic concurrency token tied to the approved preflight;
- isolated test database restore;
- transactional or staged commit behavior;
- cancellation before commit;
- rollback and audit.

### PR 6 — destructive full restore and recovery

- maintenance mode;
- explicit confirmation challenge;
- mandatory pre-restore recovery point;
- CLI/offline restore;
- volume-level recovery documentation;
- Playwright restore smoke and rollback verification.

## Current encrypted backup acceptance gate

- encrypted export is administrator-only;
- backup password is request-scoped and never persisted or audited;
- AES-256-GCM authentication rejects wrong passwords and tampering;
- PBKDF2 iterations are bounded from 210000 through 1000000;
- each domain has an independent IV and authenticated canonical path;
- outer encrypted envelopes have deterministic bytes and SHA-256 checksums;
- full exporters use explicit read-only SQL and include required recovery fields;
- `CONFIG_ENCRYPTION_KEY` is never read by encrypted backup modules;
- preview checks outer integrity and schema before password derivation;
- decrypted payload record counts must match manifest entries;
- preview exposes only safe projections and aggregate conflicts;
- no DML, DDL, maintenance mode, restore endpoint or upstream call exists in this PR;
- lint, build, complete server suite and Auth E2E must pass before review readiness.
