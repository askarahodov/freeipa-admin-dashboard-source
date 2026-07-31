# Backup Import Validation and Restore Preview Design

## Scope

This PR adds a read-only import preflight for portal backup documents. It does not restore or mutate portal data.

## Endpoint

`POST /api/admin/backups/import/preview`

Required permission: `backup.restore.preview`, granted only to the default admin role.

## Input

A complete logical backup document containing:

- validated versioned manifest;
- one payload per manifest entry path;
- no unknown top-level fields;
- request body size bounded before JSON parsing.

Encrypted/full backups are rejected as unsupported in this PR. Only `mode: sanitized` is accepted.

## Validation order

Validation is strictly non-mutating and fails before any domain comparison:

1. request size and JSON structure;
2. manifest format/version/mode;
3. canonical domain ordering and allowlist;
4. manifest entry/path/payload bijection;
5. canonical JSON byte length and SHA-256 checksum for every payload;
6. source schema version compatibility against the current inspected portal schema;
7. final sanitized payload assertion;
8. domain-specific preview comparison.

Any failure returns no partial preview.

## Preview result

The response contains:

- backup metadata and source/current schema versions;
- selected domains;
- per-domain incoming/current record counts;
- deterministic summary counts: `add`, `update`, `unchanged`, `conflict`, `removeIgnored`;
- bounded conflict samples with stable identifiers only;
- `canRestore: false` when validation or compatibility blocks restore;
- no secret values, raw SQL errors, hashes, tokens, credentials or full current rows.

## Comparison contract

Each domain previewer is explicit and read-only. It selects only safe identity/version fields required for deterministic comparison. It never uses `SELECT *`, DML/DDL or upstream network calls.

Sanitized backups are append/update previews only in this phase. Absence from the backup never implies deletion, so removals are reported as `removeIgnored` and are not actionable.

## Schema compatibility

- current portal schema must be `ready`;
- backup `schemaVersion` greater than current is rejected;
- older known schema versions may return `requiredMigrations` metadata but still perform no mutation;
- incompatible drift returns `409 backup_schema_incompatible`.

## Audit

Success and failure are audited with domains, counts, versions, duration and normalized error code. Backup payloads and conflict row contents are never persisted in audit metadata.

## Tests

- corrupted checksum and byte count;
- missing/extra payload path;
- unsupported format/version/mode/domain;
- future/incompatible schema;
- secret-bearing payload rejection;
- deterministic preview counts and ordering;
- all-or-nothing failure;
- API RBAC, request limits, safe errors and audit metadata;
- source contract proving read-only SQL and absence of forbidden secret column names.
