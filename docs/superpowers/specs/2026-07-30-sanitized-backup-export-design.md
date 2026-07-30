# Sanitized Backup Export API Design

## Status

Approved approach: versioned manifest plus separate domain payloads. This specification covers the second isolated PR of issue #37. It adds read-only sanitized export capability and intentionally excludes import, restore, archive encryption, maintenance mode, retention, remote storage, and UI workflows.

## Goals

- Provide an administrator-only API that exports selected portal data domains.
- Produce one deterministic payload per domain plus a versioned manifest with SHA-256 checksums and record counts.
- Remove secret-bearing fields before serialization and checksum calculation.
- Keep the operation read-only with respect to portal business data.
- Audit export attempts and outcomes without recording payloads, credentials, hashes, cookies, or encryption material.
- Establish contracts reusable by future encrypted archive, preview, selective restore, and offline CLI work.

## Non-goals

- Exporting `CONFIG_ENCRYPTION_KEY` or any equivalent encryption material.
- Returning password hashes, session tokens, encrypted settings blobs, upstream credentials, cookies, or raw FreeIPA/XYOps responses.
- Importing or restoring data.
- Creating ZIP/TAR archives.
- Encrypting the export with a backup password.
- Persisting generated backup payloads in D1.
- Exporting FreeIPA or XYOps source systems themselves.

## API

### Endpoint

`POST /api/admin/backups/export`

A POST request is used because the caller selects domains and export creation must be audited. The operation remains read-only for business data.

### Request

```json
{
  "domains": ["settings", "local-auth", "rbac", "policies", "catalog", "operations", "approvals", "audit"]
}
```

Rules:

- `domains` is required, must be a non-empty array, and must contain only values from `PORTAL_BACKUP_DOMAINS`.
- Duplicate domains are rejected.
- The server applies a fixed deterministic domain order, independent of request order.
- Unknown request fields are rejected.
- A request body size limit is enforced before JSON parsing.

### Response

```json
{
  "manifest": {
    "format": "freeipa-admin-dashboard-backup",
    "version": 1,
    "createdAt": "2026-07-30T14:00:00.000Z",
    "schemaVersion": 1,
    "mode": "sanitized",
    "domains": ["settings", "local-auth"],
    "entries": [
      {
        "domain": "settings",
        "path": "domains/settings.json",
        "bytes": 123,
        "sha256": "...",
        "records": 1
      }
    ],
    "encryption": null
  },
  "payloads": {
    "domains/settings.json": { "records": [] },
    "domains/local-auth.json": { "records": [] }
  }
}
```

The checksum and byte count are calculated from `canonicalBackupJson(payload)`, not from transport formatting. `payloads` keys must exactly match manifest entry paths. The API never returns partial success: if any selected domain fails validation or export, no export document is returned.

## Authorization

The route is protected by the existing server-side admin/session identity boundary.

Required conditions:

- authenticated portal identity;
- role `admin`;
- permission `backup.export`;
- existing administrator token/session checks remain enforced where the current admin API requires them.

Authorization is evaluated before any domain query. Direct API calls must not bypass checks. Unauthorized attempts return the existing normalized 401/403 responses and are audited without request body contents.

## Components

### `backup-export.ts`

Owns export orchestration and exposes narrow interfaces:

- `parseBackupExportRequest(value)` validates and normalizes the requested domains;
- `exportSanitizedBackup(env, options)` reads selected domains and returns `{ manifest, payloads, summary }`;
- `PortalBackupDomainExporter` describes one domain exporter;
- registry lookup is allowlisted and exhaustive for supported domains.

This module does not own routing, authentication, or audit persistence.

### Domain exporters

Each exporter has one responsibility: read a portal-owned domain and return a JSON-safe sanitized payload plus a record count.

Interface:

```ts
type PortalBackupDomainExporter = {
  domain: PortalBackupDomain;
  path: `domains/${string}.json`;
  export(env: BackupExportEnv): Promise<{ payload: unknown; records: number }>;
};
```

Exporters must:

- use explicit column lists; never use `SELECT *` for secret-bearing tables;
- exclude encrypted blobs, password hashes, session tokens, cookies, raw credentials, and recovery material at query/mapping time;
- call `assertSanitizedBackupPayload` as a final defense before entry creation;
- return deterministic arrays with explicit stable ordering;
- not mutate D1;
- not call FreeIPA or XYOps upstream services.

### Initial domain ownership

- `settings`: effective non-secret configuration, revision metadata, source/override metadata; no encrypted secret blob and no secret value.
- `local-auth`: local user identity, display name, role/status metadata, timestamps; no password hash, reset token, or session data.
- `rbac`: role/group assignment policy and normalized permission metadata.
- `policies`: catalog visibility, approval policy, and process presentation policy documents after sanitization.
- `catalog`: cached catalog snapshot/history metadata needed for portal recovery; no upstream API key or raw error body.
- `operations`: operation run metadata and sanitized summaries; no submitted secret input values.
- `approvals`: approval state, actors, decisions, expiry and sanitized summaries; no encrypted execution specification.
- `audit`: append-only audit records, excluding any fields disallowed by the existing audit sanitizer.

A domain may return an empty records array when its optional data is absent. Missing required tables or schema incompatibility fail the whole export with a normalized compatibility error.

## Consistency Model

The export executes against one schema-ready D1 binding after the canonical migration boundary has completed.

For this PR:

- domain reads are performed sequentially in fixed order;
- each query is read-only;
- the response records one `createdAt` timestamp and one canonical schema version;
- no claim of cross-query transaction snapshot isolation is made.

The future encrypted snapshot PR may replace the reader with a D1/SQLite snapshot primitive without changing the manifest or exporter interfaces. The response and documentation explicitly call this export a logical sanitized export, not a full database snapshot.

## Data Flow

1. Route matches `POST /api/admin/backups/export`.
2. Existing authentication and authorization resolve the actor.
3. Request size and JSON shape are validated.
4. Requested domains are normalized into canonical order.
5. Orchestrator invokes each allowlisted domain exporter sequentially.
6. Each exporter maps explicit columns to a sanitized payload.
7. Final recursive sanitization guard validates the payload.
8. `createBackupEntry` calculates deterministic bytes, checksum, and record count.
9. The manifest is assembled and passed through `validateBackupManifest`.
10. An audit success event records actor, selected domains, counts, total bytes, format version, and correlation ID.
11. The API returns manifest and payloads with `cache-control: no-store` and a JSON attachment filename.

On failure, the server returns no payload document and writes a sanitized failure audit event.

## Error Handling

- `400 backup_request_invalid`: malformed JSON, empty domains, duplicates, unknown fields or unsupported domain.
- `401/403`: existing authentication/authorization responses.
- `409 backup_schema_incompatible`: canonical schema version/table contract is unavailable.
- `413 backup_request_too_large`: request exceeds the fixed body limit.
- `500 backup_export_failed`: unexpected exporter or checksum failure.
- `503 backup_database_unavailable`: D1 binding unavailable.

Responses contain a stable code and safe message. They never include SQL, raw database errors, payload fragments, secret field names with values, or stack traces.

## Audit Contract

Actions:

- `backup.export.requested` is optional and only emitted after authorization and valid request parsing if the existing audit pattern supports pending events.
- `backup.export.completed` records domains, entry counts, total records, total bytes, manifest version, schema version and duration.
- `backup.export.failed` records domains, safe error code and duration.
- `backup.export.denied` records actor and denial reason without request body content.

Never audit payloads, checksums of secret-bearing data, authorization tokens, backup passwords, encryption keys, cookies, or raw errors.

## Security Invariants

- `CONFIG_ENCRYPTION_KEY` is not read by the exporter and cannot appear in its response.
- Sanitized export never includes encrypted blobs merely because the ciphertext is unreadable.
- All secret-field variants are blocked by normalized field-name detection as defense in depth.
- Explicit SQL column lists are the primary defense; recursive payload validation is the secondary defense.
- Response headers include `cache-control: no-store`, `content-type: application/json`, and `content-disposition: attachment`.
- No generated backup is stored server-side in this PR.
- Domain paths are fixed by the exporter registry and cannot be supplied by the caller.
- Manifest validation occurs before response delivery.

## Testing

### Unit tests

- request normalization, canonical ordering, duplicate/unknown rejection;
- one exporter fixture per domain with explicit proof that secret columns are absent;
- snake_case, camelCase and mixed separator secret-name rejection;
- deterministic payload JSON, bytes, checksums and entry order;
- manifest/payload path bijection;
- failure in one domain returns no partial document;
- absent D1 and schema incompatibility errors;
- no DML/DDL statements in exporters.

### API/integration tests

- unauthorized, viewer and operator calls are rejected;
- admin with `backup.export` receives selected domains only;
- direct API call cannot bypass permission checks;
- response headers prevent caching and provide an attachment name;
- audit success/failure metadata contains no payload or secrets;
- selected empty domains remain valid;
- existing settings, local-auth, catalog, approval, operations and audit behavior is unchanged.

### Regression contracts

- source test rejects secret-bearing column names in sanitized exporter SELECT lists/mappings;
- source test rejects mutation SQL (`INSERT`, `UPDATE`, `DELETE`, schema DDL) inside backup exporter modules;
- complete CI test discovery includes all backup export tests.

## Rollout and Compatibility

The endpoint is additive and disabled only by absence of the new permission in RBAC. No schema migration is required for the logical export itself. Existing environments continue to operate unchanged.

The permission `backup.export` must be added to the permission catalogue and default admin role, but not to viewer or operator defaults. Any RBAC representation change must preserve existing custom mappings and be covered by compatibility tests.

## Future Extension Points

The next PRs may add, without changing this response model:

- archive packaging around `manifest` and domain payload files;
- backup-password encryption for full backups;
- import preview and checksum verification;
- isolated test restore;
- selective restore transactions;
- maintenance mode and pre-restore recovery points;
- CLI/offline recovery and volume-level procedures.

## Acceptance Criteria for This PR

- Authorized admin can request any non-empty allowlisted subset of domains.
- Response contains a validated versioned manifest and exactly one deterministic payload per selected domain.
- Checksums and byte sizes match canonical payload serialization.
- Secret values, encrypted blobs, password/session material and `CONFIG_ENCRYPTION_KEY` cannot appear in the response, logs or audit.
- Export performs no portal data mutation and makes no upstream calls.
- Failure produces no partial backup document.
- Audit captures safe outcome metadata.
- Lint, build, unit, API/integration and relevant Auth E2E checks pass.
