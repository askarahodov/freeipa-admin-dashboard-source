# Configuration reference

## Purpose

This document normalizes the **supported current configuration surfaces** of Admin Dashboard Softrust without creating a second runtime configuration registry.

Canonical values still belong to the current runtime owners: `.env.example`, Compose, `scripts/start-production.mjs`, startup validators, settings lifecycle/source handlers and recovery tooling. The lack of one machine-readable global configuration registry is tracked by **#123**.

Never copy real credentials, internal hostnames or active secrets into documentation, Issues, logs or examples.

## Configuration classes

The current project has several different configuration classes. They must not be treated as interchangeable.

| Class | Typical owner | Lifetime / precedence | Examples |
| --- | --- | --- | --- |
| Process/deployment configuration | `.env`, Compose, canonical production startup/runtime | startup/process lifetime | `CONFIG_ENCRYPTION_KEY`, identity/bootstrap, port/host, recovery mounts |
| Dynamic portal integration settings | settings lifecycle/source handlers + D1 | D1 override when explicitly set; otherwise inherited ENV/default according to current settings source logic | demo mode, FreeIPA URL/user/password, XYOps URL/API key |
| Bootstrap/catalog/policy metadata | ENV bootstrap + persisted portal state where implemented | persisted portal state may take precedence over bootstrap ENV | XYOps routes, catalog policies, approval policies, process metadata |
| Recovery-only configuration | Compose recovery profile / recovery tooling | only the offline recovery workflow | `PORTAL_RECOVERY_*` paths/UID/GID and recovery secret mount |
| Internal ephemeral runtime configuration | `scripts/start-production.mjs` | generated at process start; not operator-persisted | `IPA_NODE_GATEWAY_URL`, `IPA_NODE_GATEWAY_TOKEN` |
| Test/E2E/development fixtures | `.env.*.example`, tests/workflows | isolated non-production only | fixture encryption keys, static identity profiles |

## Core deployment variables

| Variable | Required? | Secret? | Lifetime | Current owner / rule |
| --- | --- | --- | --- | --- |
| `DASHBOARD_PORT` | documented deployment setting | no | startup | `.env.example`; product port is 3001 in the supported Compose/runtime configuration |
| `PORT` | runtime process setting | no | startup | Compose/canonical Node production runtime; defaults to `3001` in `scripts/start-production.mjs` |
| `HOST` | runtime process setting | no | startup | canonical Node production runtime; defaults to `0.0.0.0` in `scripts/start-production.mjs` |
| `CONFIG_ENCRYPTION_KEY` | **yes in supported production startup** | **yes** | startup; changing active key requires migration/rotation design | `scripts/config-encryption-key.mjs`; must be 32-byte canonical base64 or 64-character hex, reject published/test/weak keys outside allowed profile |
| `ADMIN_TOKEN` | required only for the explicit service-admin capability when used | **yes** | process/startup | service-admin authorization owner; does not replace local authentication/RBAC |
| `PORTAL_RUNTIME_PROFILE` | optional; default production semantics in validators | no | startup | startup validators; controls whether isolated fixtures/static identity are permitted |

### `CONFIG_ENCRYPTION_KEY`

Production startup validates this value before the Worker runtime is started. Current validation requires:

- a configured value;
- exactly 32 decoded bytes;
- either 64-character hex or canonical base64;
- rejection of known published production keys;
- rejection of test/E2E fixture keys outside their explicit isolated profile;
- rejection of trivially weak repeated-byte keys.

The key protects persisted encrypted integration/settings material. Do not rotate it by simply replacing ENV: existing encrypted data becomes unreadable without an explicit migration/rotation procedure.

## Identity and session configuration

| Variable | Secret? | Current behavior |
| --- | --- | --- |
| `PORTAL_IDENTITY_MODE` | no | Supported production mode is `local`; startup validator defaults an omitted mode to `anonymous`, so production deployment must explicitly configure the intended secure mode. |
| `PORTAL_DEFAULT_ROLE` | no | Default role for applicable local/bootstrap flows; built-in roles are `viewer`, `operator`, `admin`. |
| `PORTAL_BOOTSTRAP_ADMIN_USERNAME` | no | Required with local-mode bootstrap on empty user storage. |
| `PORTAL_BOOTSTRAP_ADMIN_PASSWORD` | **yes** | Local-mode startup requires a non-placeholder password of at least 12 characters. Bootstrap is not a password-reset mechanism for an existing admin. |
| `PORTAL_BOOTSTRAP_ADMIN_NAME` | no | Display name for the initial local administrator. |
| `PORTAL_SESSION_TTL_HOURS` | no | Local-session TTL input consumed by local-auth runtime. |
| `PORTAL_STATIC_IDENTITY` | potentially identity-bearing | Development/test/e2e only when `PORTAL_IDENTITY_MODE=static`. |
| `PORTAL_STATIC_NAME` | no | Static development identity display name where that isolated mode is used. |
| `PORTAL_RBAC_JSON` | no/possibly sensitive policy metadata | Legacy/configurable RBAC input accepted by runtime; do not treat it as a replacement canonical built-in permission registry. RBAC consolidation is tracked by #119. |

`static` identity is explicitly rejected by the startup policy outside `development`, `test` or `e2e` runtime profiles.

## Dynamic integration settings

The current settings-source runtime explicitly recognizes these six fields:

| Portal field | ENV fallback | Secret? | Dynamic source behavior |
| --- | --- | --- | --- |
| `demoMode` | `DEMO_MODE` | no | D1 override or inherited ENV/default according to the active override set |
| `ipaUrl` | `IPA_URL` | no | normalized `http`/`https` URL; credentials embedded in URL are rejected by normalization |
| `ipaUsername` | `IPA_USERNAME` | sensitive identifier | D1 override or inherited ENV |
| `ipaPassword` | `IPA_PASSWORD` | **yes** | encrypted when persisted in D1; inherited ENV when not overridden |
| `xyopsUrl` | `XYOPS_URL` | no | normalized `http`/`https` URL |
| `xyopsApiKey` | `XYOPS_API_KEY` | **yes** | encrypted when persisted in D1; inherited ENV when not overridden |

### ENV / D1 precedence

The settings source code maintains an explicit override set. For a field in that set, the persisted D1 value is the active override. For a field not in the override set, current ENV is inherited and can refresh the effective persisted representation used by the lifecycle.

Resetting an override therefore means “return this field to its inherited ENV/default source”, not “write the current ENV value as a permanent override”.

Secrets (`ipaPassword`, `xyopsApiKey`) are stored in the encrypted secret payload rather than plain configuration JSON.

## FreeIPA configuration

| Variable | Secret? | Notes |
| --- | --- | --- |
| `IPA_URL` | no | Upstream FreeIPA base URL. Use a server-reachable HTTPS URL in production. |
| `IPA_USERNAME` | sensitive identifier | Dedicated FreeIPA service/account identity; should be least-privilege for the portal capabilities. |
| `IPA_PASSWORD` | **yes** | Server-side only. Never expose it to browser state or diagnostics. |
| `IPA_VERIFY_TLS` | no | TLS verification control; production should verify TLS. |
| `IPA_GATEWAY_PORT` | no | Optional local Gateway listen port request; startup accepts integer `0..65535`, with `0` allowing an ephemeral port. |

### Internal FreeIPA Gateway values

`IPA_NODE_GATEWAY_URL` and `IPA_NODE_GATEWAY_TOKEN` are **internal ephemeral runtime values**, not supported operator configuration. The canonical `scripts/start-production.mjs` startup path:

- generates a random 32-byte Gateway token at every startup;
- binds the Gateway to `127.0.0.1`;
- starts the Gateway on the requested `IPA_GATEWAY_PORT` or an ephemeral port when the value is `0`/omitted;
- injects the resulting loopback URL and token into the in-process runtime environment passed to the Worker host and application runtime;
- keeps the token process-local rather than persisting it as operator configuration.

The previous `scripts/start-worker.mjs` temp-env-file mechanism is not the canonical production owner after the #51/#194 Node runtime cutover. Do not add `IPA_NODE_GATEWAY_URL` or `IPA_NODE_GATEWAY_TOKEN` to `.env.example` as persistent operator secrets.

## XYOps configuration

| Variable | Secret? | Notes |
| --- | --- | --- |
| `XYOPS_URL` | no | Upstream XYOps base URL. |
| `XYOPS_API_KEY` | **yes** | Server-side API key; may be stored encrypted through the settings lifecycle. |
| `XYOPS_EVENT_ID` | no | Compatibility/default event identifier where current runtime uses it. |
| `XYOPS_RESULT_FILE_MAX_BYTES` | no | Declared output-file proxy `Content-Length` bound; `.env.example` currently uses `52428800` (50 MiB). |
| `XYOPS_CATALOG_SYNC_ENABLED` | no | Enables/disables automatic catalog synchronization. |
| `XYOPS_CATALOG_SYNC_LOCK_TTL_SECONDS` | no | Catalog sync lock TTL bootstrap value. |
| `XYOPS_ROUTES_JSON` | potentially sensitive operational metadata | Bootstrap route profiles. Persisted routes take priority according to `.env.example`. This is **not** the portal HTTP API registry. |

## Portal bootstrap policy/metadata configuration

Current `.env.example` also documents JSON bootstrap surfaces for portal policy/presentation behavior:

- `PORTAL_CATALOG_POLICIES_JSON` — catalog visibility policy bootstrap;
- `PORTAL_APPROVAL_POLICIES_JSON` — dangerous-process approval policy bootstrap;
- `PORTAL_PROCESS_METADATA_JSON` — optional process presentation/localization metadata.

These values describe portal-owned policy/presentation state. Where the runtime persists an override, persisted state is the operational source after bootstrap; do not assume changing the environment variable always mutates existing persisted configuration.

## Recovery-only configuration

The Compose `recovery` profile defines configuration that belongs only to offline recovery tooling:

| Variable | Secret? | Default / purpose |
| --- | --- | --- |
| `PORTAL_RECOVERY_UID` | no | Recovery container UID; default `10001`. |
| `PORTAL_RECOVERY_GID` | no | Recovery container GID; default `10001`. |
| `PORTAL_RECOVERY_DIR` | path | Host recovery working directory; default `./recovery`. |
| `PORTAL_RECOVERY_SECRETS_DIR` | **points to secret material** | Read-only host directory mounted at `/run/portal-recovery-secrets`; default `./recovery-secrets`. |

These are not normal dashboard runtime settings. Destructive recovery procedure and required secret files belong to [`../OFFLINE_FULL_RESTORE.md`](../OFFLINE_FULL_RESTORE.md).

## Exposure and redaction rules

- Never expose `CONFIG_ENCRYPTION_KEY`, `ADMIN_TOKEN`, `PORTAL_BOOTSTRAP_ADMIN_PASSWORD`, `IPA_PASSWORD`, `XYOPS_API_KEY`, Gateway token or recovery secrets through browser APIs, logs or diagnostics.
- Effective settings/status APIs may expose **source metadata and configured/not-configured state** where the current contract defines it, not raw secret values.
- URLs must be sanitized before diagnostics if they may contain credentials or sensitive query components.
- Configuration examples must use placeholders and non-internal example hostnames.

## Known configuration ownership limitation

There is no single machine-readable registry that currently describes every supported production, development, recovery and test variable with type, secrecy, lifecycle and validation metadata. The current contract is distributed across `.env.example`, Compose, canonical production startup/runtime, startup validators, settings-source/lifecycle code and recovery tooling.

Follow-up **#123** tracks consolidation into a machine-readable supported configuration contract. Until then:

1. check this reference for orientation;
2. verify the exact variable in its runtime owner before changing behavior;
3. do not document arbitrary `process.env.*` occurrences as supported operator configuration;
4. do not promote test/E2E fixtures into production configuration;
5. update `.env.example` and this reference together when the supported operator contract changes.

## Related references

- [`../SECURITY_MODEL.md`](../SECURITY_MODEL.md) — secret/trust boundaries.
- [`PERMISSIONS.md`](PERMISSIONS.md) — RBAC reference.
- [`../LOCAL_AUTH_RBAC.md`](../LOCAL_AUTH_RBAC.md) — local identity/session behavior.
- [`../SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md) — canonical owner registry.
- [`../OFFLINE_FULL_RESTORE.md`](../OFFLINE_FULL_RESTORE.md) — recovery-only operational contract.

If this document and current runtime disagree, current validators/handlers and their tests win until the documentation defect is resolved.