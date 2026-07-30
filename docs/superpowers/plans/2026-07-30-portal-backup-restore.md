# Portal Backup and Restore Implementation Plan

## Goal

Implement issue #37 as a sequence of reviewable changes that never expose portal encryption material and reject corrupted or incompatible backups before any database mutation.

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

### PR 1 — manifest foundation

- versioned backup format;
- deterministic canonical JSON and SHA-256 checksums;
- strict domain/path/checksum validation;
- sanitized payload secret-field guard;
- encryption metadata contract only, without implementing archive encryption;
- negative tests for malformed, incompatible and unsafe manifests.

No database mutation or HTTP API is added in this PR.

### PR 2 — sanitized export and preview

- server-side admin authorization;
- consistent read snapshot;
- per-domain serializers with explicit field allowlists;
- archive download without secret material;
- import upload limits and manifest/checksum preview;
- counts, conflicts and required migration report;
- audit create/download/import/verify.

### PR 3 — encrypted full backup

- separate backup password;
- PBKDF2-SHA-256 with versioned minimum work factor;
- AES-256-GCM authenticated encryption;
- password/key never persisted or logged;
- wrong-password and tamper tests.

### PR 4 — selective restore

- domain-level diff;
- optimistic concurrency token;
- isolated test restore;
- transactional or staged commit behavior;
- cancellation before commit;
- rollback and audit.

### PR 5 — destructive full restore and recovery

- maintenance mode;
- explicit confirmation challenge;
- mandatory pre-restore recovery point;
- CLI/offline restore;
- volume-level recovery documentation;
- Playwright restore smoke and rollback verification.

## PR 1 acceptance gate

- manifest serialization is deterministic;
- checksums use SHA-256;
- unknown domains, duplicate paths and traversal paths are rejected;
- sanitized payload guard rejects encryption keys, password hashes, integration secrets and session tokens;
- incompatible format/version is rejected before future mutation paths;
- encrypted mode requires explicit strong encryption metadata;
- lint, build and full unit suite pass.
