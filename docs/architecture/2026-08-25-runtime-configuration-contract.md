# Runtime Configuration Contract

## Status

Proposed implementation slice for issue #123.

## Purpose

`worker/portal-configuration-contract.ts` is the canonical machine-readable metadata owner for supported runtime configuration. It describes configuration ownership and exposure without storing credentials or replacing domain-specific validation, encrypted D1 settings, Compose behavior, or startup transport.

## Ownership model

| Concern | Owner |
| --- | --- |
| Supported configuration metadata | `worker/portal-configuration-contract.ts` |
| Production encryption-key validation | `scripts/config-encryption-key.mjs` |
| Identity startup validation | `scripts/identity-startup-policy.mjs` |
| Production ENV transport | `scripts/start-production.mjs` (process environment pass-through) |
| Legacy development ENV transport | `scripts/start-worker.mjs` |
| Production/recovery Compose defaults and mounts | `compose.yaml` |
| Persisted encrypted settings lifecycle | existing settings/integration domain |
| Documentation | `docs/reference/CONFIGURATION.md` plus this contract |

The registry must not become a second parser or a second encrypted-settings implementation.

## Metadata contract

Each record describes:

- `name` — environment/configuration key;
- `class` — production, development, recovery, startup-local, or internal-ephemeral;
- `required` — whether the supported deployment contract requires the value;
- `secret` — whether the value is credential material;
- `lifecycle` — startup, runtime, or both;
- `defaultSemantics` — none, documented, generated, or Compose default;
- `precedence` — human-readable description of the implemented source precedence;
- `validationOwner` — existing module responsible for validation/semantics;
- `transportOwner` — existing module/profile responsible for making the value available;
- `exposure` — whether status APIs may expose metadata/value presence;
- `compatibility` — supported, legacy, or internal.

The registry contains no secret values and must never be used as a secret store.

## Configuration classes

### Production

Operator-facing deployment configuration, including identity, FreeIPA, XYOps, encryption, and process metadata.

### Development

Compatibility controls such as static identity and `PORTAL_RBAC_JSON`. These remain explicitly non-production and do not replace canonical RBAC ownership.

### Recovery

Variables owned by the recovery Compose profile, such as recovery UID/GID and recovery directories.

### Startup-local

Local integration controls generated or consumed during startup, such as `IPA_GATEWAY_PORT`.

### Internal-ephemeral

Generated values such as `IPA_NODE_GATEWAY_URL` and `IPA_NODE_GATEWAY_TOKEN` are deliberately excluded from the operator registry.

## Drift policy

Tests may enforce exact relationships where semantics are mechanical:

1. active assignments in `.env.example` must have registry records;
2. explicit legacy `start-worker.mjs` forwarded keys must have registry records;
3. the canonical production entrypoint must retain process-environment pass-through without a production forwarding allowlist;
4. internal generated gateway variables must remain excluded;
5. secret records must remain non-exposable;
6. recovery records must remain explicitly classified.

The registry must not infer that a variable is production-supported merely because a repository-wide grep finds its name in tests or CI.

## Production transport after #51

The canonical production entrypoint is `scripts/start-production.mjs`. It passes the process environment through the runtime composition into the Worker environment rather than rebuilding it from an explicit forwarding allowlist. `XYOPS_RESULT_FILE_MAX_BYTES` and `XYOPS_CATALOG_SYNC_LOCK_TTL_SECONDS` therefore remain operator runtime configuration without requiring additions to the legacy `start-worker.mjs` allowlist. Issue #188 should verify this behavior against the canonical production path before deciding whether any legacy-development forwarding change is still useful.

## Migration rule

Future consumers should read metadata from this registry rather than creating independent lists. Domain-specific validators and settings owners remain authoritative for behavior. Documentation should reference this contract for inventory while preserving domain-specific operational guidance.
