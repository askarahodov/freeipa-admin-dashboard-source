# Encrypted Full Backup Design

## Scope

This PR adds administrator-only encrypted logical full backup export and read-only encrypted import preview. It does not restore, mutate, migrate or place the portal into maintenance mode.

The implementation extends the existing versioned backup manifest and keeps one independently encrypted payload per canonical portal domain:

- settings;
- local-auth;
- rbac;
- policies;
- catalog;
- operations;
- approvals;
- audit.

## API

### Export

`POST /api/admin/backups/export/encrypted`

Request:

```json
{
  "domains": ["settings", "local-auth", "rbac"],
  "password": "user supplied backup password"
}
```

Required permission: `backup.export.encrypted`, granted only to the default admin role.

The password is request-scoped. It is never persisted, returned, logged, placed in audit metadata or reused as the portal encryption key.

### Preview

`POST /api/admin/backups/import/encrypted/preview`

Request:

```json
{
  "document": {
    "manifest": {},
    "payloads": {},
    "summary": {}
  },
  "password": "user supplied backup password"
}
```

Required permission: `backup.restore.preview`, granted only to the default admin role.

Preview verifies and decrypts the document in memory, compares safe projections with current D1 and returns counts/conflict identifiers only. It performs no restore commit.

## Document format

The outer document remains:

```json
{
  "manifest": {},
  "payloads": {
    "domains/settings.json": {
      "iv": "base64",
      "ciphertext": "base64"
    }
  },
  "summary": {
    "entries": 1,
    "records": 1,
    "bytes": 512
  }
}
```

Manifest rules:

- `format` and `version` use the existing backup constants;
- `mode` is `encrypted`;
- `encryption.algorithm` is `AES-256-GCM`;
- `encryption.kdf` is `PBKDF2-SHA-256`;
- one random backup salt is stored in the manifest;
- the work factor is versioned and must be at least 210000 iterations;
- each manifest entry checksum and byte count describe the canonical encrypted envelope, not plaintext;
- each domain payload has an independent random 96-bit IV;
- manifest entries and payload paths remain canonical and one-to-one.

## Cryptography

The implementation uses Web Crypto only:

1. normalize and validate the user password without persisting it;
2. derive a 256-bit AES key with PBKDF2-SHA-256, the manifest salt and the declared iteration count;
3. serialize each full domain payload with `canonicalBackupJson`;
4. encrypt each payload independently with AES-256-GCM;
5. authenticate immutable context as additional authenticated data:
   - backup format;
   - backup version;
   - schema version;
   - domain;
   - canonical payload path;
6. store `iv` and combined ciphertext/tag as strict base64;
7. calculate outer bytes/checksum from the canonical encrypted envelope.

Wrong passwords, modified salt, IV, AAD or ciphertext all return the same normalized `backup_decryption_failed` response. Low-level cryptographic errors are never exposed.

## Full domain data

Full exporters are separate from sanitized exporters and use explicit SQL column lists. They include portal-owned recovery data that sanitized export intentionally excludes, including:

- `app_settings.encrypted_secrets`;
- local user password hash, salt, iteration and lock state;
- portal sessions and token hashes;
- settings drafts/revisions/apply commits with encrypted secret blobs;
- operation replay and approval `encrypted_spec` values;
- complete portal-owned policy, catalog, operation, approval and audit rows needed for later restore.

`CONFIG_ENCRYPTION_KEY`, backup passwords, derived keys, upstream FreeIPA credentials and XYOps API keys outside encrypted portal-owned blobs are never read directly or included as standalone fields.

Each domain payload is a versioned table bundle:

```json
{
  "domain": "settings",
  "schemaVersion": 1,
  "tables": [
    {
      "name": "app_settings",
      "columns": ["id", "config_json", "encrypted_secrets", "updated_at"],
      "primaryKey": ["id"],
      "rows": []
    }
  ]
}
```

Rows use positional arrays in the declared column order. Table names, columns, primary keys and ordering are fixed by an exhaustive registry; callers cannot supply SQL identifiers.

## Consistency and limits

- export runs only after the canonical schema boundary reports `ready`;
- domain/table reads are sequential and deterministic;
- no claim of cross-query transaction snapshot isolation is made in this PR;
- request size is checked before JSON parsing;
- password length, base64 length, decoded ciphertext size, domain count and total document size are bounded;
- import validates outer structure/checksums before password derivation and decryption;
- no generated backup is stored server-side.

## Encrypted preview

Encrypted preview performs:

1. request and document size checks;
2. strict manifest/path/envelope validation;
3. canonical encrypted-envelope byte/checksum verification;
4. schema compatibility check;
5. password derivation;
6. per-domain authenticated decryption;
7. strict full payload table-bundle validation;
8. conversion to the existing safe comparison projections;
9. comparison with current sanitized exporters;
10. safe aggregate result and audit.

Plaintext, secret-bearing rows and encrypted payloads are not returned or audited.

## Authorization and audit

Both routes use the existing local-admin/service-admin boundary and same-origin mutation protection.

Audit success/failure metadata may contain:

- domains;
- manifest/schema versions;
- encrypted bytes;
- aggregate record counts;
- duration;
- normalized outcome/error code.

Audit must never contain:

- password or password length;
- salt, IV, ciphertext or derived key;
- plaintext rows or encrypted secret blobs;
- payload/checksum values;
- raw Web Crypto or SQL errors.

## Explicit non-goals

- restore commit endpoint;
- INSERT, UPDATE, DELETE or DDL;
- maintenance mode;
- automatic migrations;
- pre-restore recovery-point persistence;
- selective restore;
- full destructive restore;
- CLI/offline recovery;
- ZIP/TAR packaging;
- remote object storage.

## Tests

- KDF/password policy and deterministic derivation with fixed fixtures;
- independent IV and AAD for every domain;
- successful encrypt/decrypt round trip;
- wrong password and tampering of salt/IV/AAD/ciphertext;
- strict base64 and decoded-size limits;
- deterministic manifest/checksum output with injected salt/IV/time;
- exhaustive full exporter registry and explicit SQL columns;
- required sensitive recovery fields are present;
- `CONFIG_ENCRYPTION_KEY` and raw backup credentials are absent;
- API RBAC, request limits, safe headers/errors and sanitized audit;
- encrypted preview produces the same safe counts as equivalent plaintext projections;
- source contract proves no DML/DDL, maintenance mode, restore commit, upstream calls or credential logging;
- full CI and Auth E2E remain green.
