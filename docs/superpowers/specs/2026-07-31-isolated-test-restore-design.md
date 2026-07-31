# Isolated Backup Test Restore Design

## Scope

This PR adds the next safe stage of issue #37 after encrypted full export and read-only preview:

- select an explicit subset of encrypted backup domains;
- bind an optimistic concurrency token to the approved preview;
- re-check the token immediately before test restore;
- restore decrypted full payloads only into an isolated in-memory database;
- verify structural and relational consistency without mutating production D1.

This PR does **not** add selective production restore, destructive full restore, maintenance mode, pre-restore recovery points, migrations, CLI recovery or any production DML.

## Goals

1. A preview result can be approved without allowing a later request to silently use a different backup, domain selection, schema version or current database state.
2. An administrator can prove that selected encrypted payloads can be staged and validated as a coherent restore candidate before any production write path exists.
3. Test restore results expose only safe counts, check names, warnings and normalized errors.
4. Production D1 remains read-only throughout preview and test restore.

## API changes

### Extended encrypted preview

`POST /api/admin/backups/import/encrypted/preview`

Request:

```json
{
  "document": {
    "manifest": {},
    "payloads": {},
    "summary": {}
  },
  "password": "user supplied backup password",
  "domains": ["settings", "local-auth", "rbac"]
}
```

`domains` is optional. When omitted, all domains in the manifest are selected. When present, it must be a non-empty, duplicate-free subset of the manifest domains and is normalized into canonical portal domain order.

The existing safe preview response is extended with:

```json
{
  "restorePlan": {
    "version": 1,
    "selectedDomains": ["settings", "local-auth", "rbac"],
    "approvalToken": "64-character lowercase SHA-256 hex"
  }
}
```

The token is opaque to the browser. No current-state digest, full payload digest, secret-bearing row, backup checksum or encryption material is separately returned.

### Isolated test restore

`POST /api/admin/backups/import/encrypted/test-restore`

Request:

```json
{
  "document": {
    "manifest": {},
    "payloads": {},
    "summary": {}
  },
  "password": "user supplied backup password",
  "domains": ["settings", "local-auth", "rbac"],
  "approvalToken": "token returned by preview"
}
```

Required permission: `backup.restore.test`, granted only to `admin`.

Response:

```json
{
  "tested": true,
  "productionMutated": false,
  "selectedDomains": ["settings", "local-auth", "rbac"],
  "sourceSchemaVersion": 1,
  "currentSchemaVersion": 1,
  "canCommit": true,
  "summary": {
    "tables": 5,
    "records": 23,
    "checks": 9,
    "warnings": 0
  },
  "domains": [
    {
      "domain": "settings",
      "tables": 5,
      "records": 7,
      "checks": ["table-contract", "json-fields", "settings-revisions"],
      "warnings": []
    }
  ]
}
```

The endpoint never returns the approval token, password, salt, IV, ciphertext, plaintext rows, primary keys, hashes, encrypted blobs, current-state fingerprints or SQL errors.

## Domain selection

Selection rules:

- only domains already present in the encrypted manifest may be selected;
- the list must be non-empty and duplicate-free;
- the result is canonicalized using `PORTAL_BACKUP_DOMAINS`;
- preview decrypts and projects only selected domains;
- the restore plan token binds the exact selected domain list;
- test restore rejects a token created for a different selection.

The existing preview behavior remains backward compatible: requests without `domains` select all manifest domains.

## Optimistic concurrency token

### Purpose

The token prevents time-of-check/time-of-use drift. It is not an authorization credential and does not replace server-side admin RBAC.

### Token material

Version 1 token input is canonical JSON containing only server-internal material:

```json
{
  "version": 1,
  "backup": {
    "format": "freeipa-admin-dashboard-backup",
    "version": 1,
    "mode": "encrypted",
    "schemaVersion": 1,
    "domains": ["settings"],
    "entries": [
      {
        "domain": "settings",
        "path": "domains/settings.json",
        "sha256": "...",
        "bytes": 512,
        "records": 3
      }
    ]
  },
  "current": {
    "schemaVersion": 1,
    "domains": [
      {
        "domain": "settings",
        "sha256": "hash of canonical current full domain payload",
        "records": 3
      }
    ]
  }
}
```

The approval token is `SHA-256(canonicalBackupJson(tokenMaterial))` as lowercase hex.

### Current-state fingerprint

For every selected domain, the server uses the existing exhaustive `FULL_BACKUP_EXPORTERS` registry to read the current full payload with explicit read-only `SELECT` statements. It validates the table bundle and hashes its canonical JSON in memory.

The current full digest is never returned or audited. Secret-bearing current values influence the token but are not disclosed.

### Verification

Test restore recomputes the token from:

- the submitted encrypted document;
- the submitted selected domains;
- the current schema version;
- freshly read current full domain payloads.

It compares the supplied token using a constant-time byte comparison. Any change to the backup document, domain selection, current schema or current selected-domain data returns:

```text
409 backup_restore_stale
```

The mismatch is rejected before the isolated restore store is created.

## Decryption boundary

The existing encrypted document validation order remains:

1. request size and JSON shape;
2. manifest, mode, domain, entry and canonical path validation;
3. encrypted envelope byte count and SHA-256 validation;
4. total encrypted document limit;
5. schema readiness and future-version gate;
6. one PBKDF2 key derivation;
7. per-domain authenticated AES-GCM decryption;
8. strict full table-bundle validation;
9. manifest record-count and payload schema-version validation.

Only selected domains are decrypted for selective preview and test restore. Wrong passwords and authenticated tampering remain normalized to `backup_decryption_failed`.

## Isolated database model

The isolated restore database is a request-scoped, memory-backed relational store implemented as maps of exact table bundles. It is deliberately not a D1 binding and has no reference to `env.DB` after current-state fingerprint reads finish.

Properties:

- created fresh for every test-restore request;
- no persistence between requests;
- no network calls;
- no dynamic SQL;
- no production D1 statement execution;
- exact table names, columns and primary keys come only from `FULL_BACKUP_TABLES`;
- each row is copied into request-local memory;
- duplicate/empty primary keys are already rejected by full payload validation and are checked again on staging;
- a failure discards the whole isolated store and returns no partial result.

The logical `portal_role_assignments` table remains a verification projection. It does not claim a second physical copy of `portal_users`.

## Verification checks

### Common checks

Every selected domain receives:

- `table-contract`: exact domain/table/column/primary-key contract;
- `record-count`: staged rows match manifest and payload counts;
- `primary-keys`: primary keys are present and unique;
- `json-fields`: known JSON text columns contain valid JSON where required.

### Local authentication

When `local-auth` is selected:

- each user has a non-empty password hash and salt;
- password iterations are safe positive integers;
- role is one of `viewer`, `operator`, `admin`;
- session token hashes are non-empty;
- every staged session references a staged user.

The test does not need or request a plaintext user password.

### RBAC

When `rbac` and `local-auth` are both selected, every role assignment must match the corresponding staged user role and disabled state. When `rbac` is selected without `local-auth`, the result contains a bounded `dependency_not_selected:local-auth` warning rather than reading production users into the isolated candidate.

### Settings

Known configuration, changes, validation, health and reset JSON fields must parse. Revision numbers must be valid integers. When both relevant tables are present, apply commits and revisions must reference staged drafts where the source identifier is non-null.

Encrypted secret blobs are treated as opaque recovery data in this PR. Their plaintext is not decrypted with `CONFIG_ENCRYPTION_KEY`, and the key is not read by test-restore modules.

### Operations

Within the selected operations domain:

- results and replays reference staged runs;
- notifications reference staged runs;
- notification reads reference staged notifications;
- known JSON fields parse.

### Approvals

Approval decisions reference staged approvals and known JSON fields parse.

### Policies, catalog and audit

Known JSON fields parse. Audit identifiers and metadata are validated structurally; historical optional references are not required to resolve because audit is append-only historical evidence.

## Warnings and failures

Warnings are safe fixed codes, bounded and sorted. They contain no row identifiers.

Examples:

- `dependency_not_selected:local-auth`;
- `dependency_not_selected:operations`.

Failures are normalized:

- `backup_request_invalid` — malformed request, domain selection or token shape;
- `backup_schema_incompatible` — current/future schema mismatch;
- `backup_decryption_failed` — wrong password or authenticated tampering;
- `backup_full_payload_invalid` — invalid decrypted table bundle;
- `backup_restore_stale` — approval token mismatch;
- `backup_test_restore_failed` — isolated staging or invariant failure;
- `backup_database_unavailable` — current D1 unavailable for fingerprinting.

No raw SQL, cryptographic or invariant exception body reaches the client.

## Authorization and audit

Both extended preview and test restore remain behind the existing local-admin/service-admin identity boundary and same-origin mutation protection.

Audit may contain:

- selected allowlisted domains;
- source/current schema versions;
- aggregate preview or test counts;
- number of checks and warnings;
- `canCommit`;
- duration;
- normalized error code.

Audit must not contain:

- approval token or token material;
- current-state or backup fingerprints;
- password or password length;
- salt, IV, ciphertext or derived key;
- plaintext rows, row identifiers, password/session hashes or encrypted blobs;
- raw errors.

## `canCommit` meaning

`canCommit` is an advisory result for a later production selective-restore PR. It is true only when:

- the preflight has no conflicts;
- no migration is required;
- the approval token is current;
- isolated staging and all required checks succeed.

This PR contains no endpoint that consumes `canCommit` to modify production data.

## Explicit non-goals

- production `INSERT`, `UPDATE`, `DELETE` or DDL;
- selective production restore;
- destructive full restore;
- maintenance mode;
- automatic migrations;
- pre-restore backup persistence;
- archive retention/status;
- CLI/offline recovery;
- decrypting portal secret blobs with `CONFIG_ENCRYPTION_KEY`;
- testing a plaintext user login;
- remote storage or upstream FreeIPA/XYOps calls.

## Test strategy

- domain selection canonicalization and rejection cases;
- deterministic approval token fixtures;
- token changes for backup entry, domain selection, schema or current full payload changes;
- constant-time token validation contract;
- decrypt only selected domains;
- stale token rejected before isolated store creation;
- exact in-memory table staging and all-or-nothing failure;
- local-auth/session, RBAC, settings, operations and approvals invariants;
- dependency warnings without row identifiers;
- API body limits, safe headers/errors and admin-only RBAC;
- audit source excludes token/fingerprints/password/payloads;
- source contract proves no production DML/DDL, `SELECT *`, maintenance mode, restore commit, upstream `fetch`, `console.*` or `CONFIG_ENCRYPTION_KEY` in new production modules;
- existing encrypted export/preview and sanitized backup tests remain unchanged and green;
- full lint, build, complete server suite and Auth E2E pass before review readiness.
