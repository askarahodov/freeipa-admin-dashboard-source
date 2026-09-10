# Project structure and module boundaries

## Purpose

This document explains **where current code belongs** in Admin Dashboard Softrust and which layer owns a change. It is a repository navigation and ownership map for the current `main`, not a generated tree listing and not a target refactoring plan.

For system behavior and trust/data flows, read [`ARCHITECTURE.md`](ARCHITECTURE.md). For authoritative contract owners, use [`SOURCE_OF_TRUTH.md`](../reference/SOURCE_OF_TRUTH.md). For the role-oriented Knowledge Base, start at [`../guide/README.md`](../guide/README.md).

## Repository map

| Path | Responsibility | Canonical owner / entrypoint | Verification | Do not put here |
| --- | --- | --- | --- | --- |
| `app/` | Browser UI, routes, presentation and product interactions | current page/screen modules, `app/layout.tsx` | UI/source contracts and routed browser tests | server authorization, raw DB access, FreeIPA credentials |
| `app/styles/` | Shared design tokens and global visual foundation | semantic token/global style files | UI foundation tests + build | feature business logic or duplicate local token systems |
| `app/ui/` | Reusable domain-agnostic UI primitives | `app/ui/index.ts` and component owners | UI foundation/component tests | data fetching, RBAC decisions, route ownership |
| `app/shell/` | Reusable product shell and stable global navigation foundation | `app/shell/AppShell.tsx`, navigation owner | AppShell tests + build | a second navigation model or server-side authorization |
| `worker/` | Built Worker request chain, API handlers, runtime/security gates | `worker/schema-migrations-entry.ts` through current wrapper chain | server/domain/route contracts | browser-only state or independent auth/router stacks |
| `runtime/` | Canonical Node production orchestration, Worker hosting, SQLite adapter/driver, scheduler and shutdown | `runtime/production-runtime.mjs` and runtime helpers | production-runtime/persistence contracts | route-specific business logic or UI presentation |
| `db/` | Canonical portal schema and migration lifecycle | `db/portal-schema.ts`, migration registry/runtime | schema/migration/storage tests | UI logic or duplicate schema ownership |
| `src/auth/` | Authentication, session, permission and stable route/error contracts migrated from root | domain files under `src/auth/` | auth/RBAC/security contracts | browser-only enforcement |
| `src/backup/` | Backup projection/export/restore/crypto/domain ownership | explicit subdomains under `src/backup/` | backup/recovery tests | duplicate root backup implementations |
| `src/freeipa/` | Portal-side FreeIPA domain/query contracts migrated from root | domain files under `src/freeipa/` | FreeIPA query/integration tests | browser credentials or second direct FreeIPA client |
| `src/operations/` | Approval, catalog, explorer, presentation and run-lifecycle ownership | explicit subdomains under `src/operations/` | operation/catalog/approval tests | a second scheduler or XYOps execution engine |
| `src/recovery/` | Recovery, maintenance, destructive/offline orchestration and safety contracts | foundation/adapters/orchestration/maintenance/cli/verification subdomains | recovery/maintenance positive and negative tests | unguarded generic recovery endpoints |
| `src/storage/` | Storage status/integrity and migration preflight/apply/operation logic | explicit read/migration subdomains | storage/migration tests | canonical schema definitions, which remain in `db/` |
| root transitional modules | Frozen exceptions: `audit-log.ts`, `login-rate-limit.ts`, `storage-quick-check.ts` | existing owners until their named follow-up issues complete | `tests/architecture/repository-placement-policy.test.mjs` | any new root production TypeScript module |
| `scripts/` | Production startup, local tooling, inspection, recovery and operational CLI helpers | production starts at `scripts/start-production.mjs` | script/startup/runtime/compose tests | hidden product behavior without a domain owner |
| `tests/` | Node server/domain/source/runtime contracts | `*.test.mjs` discovered by CI | CI test matrix | production implementation logic |
| `e2e/` | Browser E2E for high-value flows | Playwright / Scoped E2E workflow | routed E2E categories | exhaustive unit coverage better owned by `tests/` |
| `docs/` | Engineering docs, runbooks, references, governance, Knowledge Base and historical artifacts | `docs/README.md`, documentation policy and source-of-truth registry | docs/link/contracts checks | secrets or duplicate machine-readable registries |
| `.github/` | CI, PR governance and repository automation | workflow/template files | GitHub Actions + routing tests | product runtime behavior |
| `compose.yaml` / `Dockerfile` | Supported current container topology, runtime/recovery images and persistence mounts | deployment/runtime files | build/compose/recovery/acceptance contracts | secrets or undocumented production topology |
| `package.json` / lockfile | Node/tooling dependency and command contract | package scripts/dependency graph | install/lint/build/tests | mutable production secrets |

## Important current boundaries

### Frontend presentation

Shared tokens and reusable primitives live under `app/styles/`, `app/ui/` and `app/shell/`. Recent merged UI architecture work has extracted additional Home, Users and Groups presentation responsibilities out of the former monolithic composition. Treat the current `app/` tree and UI tests as authoritative when deciding which screen or component owns a change; historical statements that all primary presentation remains in `app/page.tsx` are no longer a safe current-state rule.

Before changing a screen, inspect the current `app/` tree and its tests. Reuse an existing primitive or shell owner before introducing a new visual or interaction pattern. Do not assume `app/page.tsx` still owns a surface that has been extracted into a dedicated module.

### Production runtime

Production startup begins at `scripts/start-production.mjs`, not `scripts/start-worker.mjs` and not Wrangler development mode. It constructs the canonical runtime around `runtime/production-runtime.mjs`, the private FreeIPA Gateway, the built Worker artifact, SQLite-backed persistence, the Node Worker host, scheduler and shutdown lifecycle.

`worker/schema-migrations-entry.ts` is the current built Worker application entry chain hosted by that Node runtime. Issue #56 tracks simplification of the Worker wrapper/router composition; it does not change the current production process entrypoint by itself.

### Database and persistent storage

`db/portal-schema.ts` and the canonical migration registry/runtime own database shape and migration semantics. Runtime SQLite/D1 adaptation remains under `runtime/` and `src/storage/` according to responsibility.

The current production Compose contract mounts the named volume `dashboard-data` at `/data` for the dashboard service. The recovery profile mounts **the same named volume** at `/portal-data`. These are two container paths to the same persistent volume by design; active documentation must not describe the old `/app/.wrangler` dashboard mount as current behavior.

Current `compose.yaml` still uses host networking. A future bridge-network model is tracked separately and must not be documented as implemented until it lands on `main`.

### Transitional root TypeScript exceptions

The repository placement policy allows only three frozen production-module exceptions at repository root:

- `audit-log.ts` — legacy audit owner, retained until audit/module ownership is migrated through #43/#56;
- `login-rate-limit.ts` — legacy authentication-protection owner, retained until middleware ownership is migrated through #56/#59;
- `storage-quick-check.ts` — compatibility re-export retained until storage ownership cleanup through #44.

This list is executable policy, not a convention copied into documentation: [`../../scripts/repository-placement-policy.mjs`](../../scripts/repository-placement-policy.mjs) defines it and [`../../tests/architecture/repository-placement-policy.test.mjs`](../../tests/architecture/repository-placement-policy.test.mjs) asserts the exact three-file set. New root production TypeScript modules are rejected; changing the exception list requires changing its owner/reason and the placement contract deliberately.

### Audited cleanup candidates

Issue #538 revalidated the suspected unused frontend/auth candidates against current repository ownership. **No deletion is justified by that audit alone.** Absence of an ordinary import is not sufficient evidence when a file is a prepared owner, compatibility surface or security/hosting boundary.

| Candidate | Evidence on current `main` | Classification / owner | Removal condition |
| --- | --- | --- | --- |
| `app/ShowcaseView.tsx` | No ordinary application consumer was found; the component is a self-contained interactive catalogue of the canonical UI primitives. Open design-system issue #293 explicitly names this file as a candidate project-native showcase. | prepared design-system asset owned by #293; retain | #293 must explicitly choose reuse/update or identify a canonical replacement before removal. |
| `app/overview/OperationalOverview.tsx`, `app/overview/operational-overview-model.ts`, `app/overview/index.ts` | The new overview implementation/model are present and exported, while `app/page.tsx` still imports and renders `LegacyOverview`. | prepared replacement owned by open #97; retain both new and legacy overview families during integration | #97 must complete parity/integration and prove remaining consumers before retiring `LegacyOverview`; `OperationalOverview` is not dead code merely because integration is incomplete. |
| `app/chatgpt-auth.ts` | No ordinary repository consumer or declaration in `.openai/hosting.json` was found. The module nevertheless defines provider-specific trusted identity headers and `/signin-with-chatgpt`, `/signout-with-chatgpt` and `/callback` redirect contracts. Repository inspection alone cannot prove that a hosting/framework entrypoint never discovers or expects this boundary. | security-sensitive dormant/compatibility candidate; retain pending explicit hosting-owner verification | handle as a dedicated Level 3 auth/hosting change only after the hosting contract is positively shown not to consume or require it, with local/session/service-admin and hosting checks selected by the test router. |
| `storage-quick-check.ts` | The root file is an intentional re-export of `src/storage/integrity/storage-quick-check.ts`. It is one of the exact frozen root exceptions in `scripts/repository-placement-policy.mjs`, protected by the repository-placement test, while #44 remains open for the storage operational surface. | compatibility exception owned by #44 / placement policy; retain | remove only in a focused compatibility cleanup that migrates every import/literal consumer and removes the matching executable placement exception in the same change. |

This table is an ownership decision, not a permanent exemption. Re-audit current code, tests, scripts, build/hosting configuration, literal source-path readers and the linked owning issue before a future deletion. Do not reopen #538 merely because one of these owners later completes; the owning change should remove its obsolete compatibility/preparation artifact when its own evidence supports that action.

### FreeIPA integration

FreeIPA is the external directory source of truth. Browser code must not receive FreeIPA credentials or session cookies. Reuse the existing server-side Gateway/integration path and `src/freeipa/` domain owners rather than creating a second direct client.

### XYOps integration

XYOps owns process definitions, execution, scheduler, queue, concurrency and rate limiting. Portal-side approvals, catalog normalization, presentation and run history live in existing portal owners such as `src/operations/`.

Do not introduce a second orchestration engine in the portal. See [`../integrations/XYOPS_EXECUTION_OWNERSHIP.md`](../integrations/XYOPS_EXECUTION_OWNERSHIP.md).

### Authentication and permissions

Authentication/session/RBAC behavior is server-owned. Canonical auth/access contracts migrated to `src/auth/`; Worker handlers and runtime consumers must use those owners rather than recreating permission logic locally.

Frontend visibility is UX only and must never become the sole enforcement boundary.

### Backup, recovery and maintenance

Backup and recovery were migrated into explicit `src/backup/` and `src/recovery/` subdomains. Destructive/offline flows retain their dedicated safety contracts, locks, confirmations, secret boundaries and runbooks.

Do not create a generic recovery endpoint or bypass maintenance/recovery state in order to simplify an operation.

## Where should this change go?

### UI or reusable controls

1. Identify the current screen owner under `app/`.
2. Reuse `app/shell/`, `app/ui/` and `app/styles/` according to the semantic role.
3. Keep business/security decisions on the server.
4. Use routed browser coverage only where the user-facing risk requires it.

### Production startup/runtime

1. Start from `scripts/start-production.mjs` and `runtime/production-runtime.mjs`.
2. Keep Worker hosting, runtime DB creation, scheduler and shutdown in existing runtime owners.
3. Update deployment/configuration docs and runtime contracts if startup semantics change.

### Authentication, sessions or permissions

1. Start from `src/auth/` and the current Worker boundary.
2. Preserve server-side enforcement and negative paths.
3. Update security/reference documentation when semantics change.

### FreeIPA users, groups or membership

1. Reuse the current FreeIPA Gateway/integration path and `src/freeipa/` owners.
2. Keep credentials/session material server-side.
3. Add behavior tests for normalized errors and permission boundaries.

### XYOps catalog, run or approvals

1. Separate upstream execution ownership from portal presentation/policy.
2. Extend existing `src/operations/` or integration owners.
3. Preserve XYOps scheduler/concurrency/rate-limit ownership.

### Storage, schema or migrations

1. Start from `db/portal-schema.ts` for schema semantics.
2. Use existing runtime/storage boundaries for persistence, status and migration execution.
3. Preserve released migration definitions/checksums and recovery behavior.
4. Update active storage/migration runbooks in the same change when behavior changes.

### Backup, maintenance or restore

1. Select the exact existing `src/backup/` or `src/recovery/` subdomain.
2. Preserve redaction, audit, locks, confirmation and rollback/recovery behavior.
3. Update the authoritative runbook rather than duplicating destructive commands in overview docs.

### Documentation-only work

1. Start with `docs/README.md`, the documentation policy and source-of-truth registry.
2. Verify every current-state claim against current code/tests and GitHub state.
3. Extend an active owner document before creating a new competing reference.
4. Treat historical plans and closed-issue appendices as history, not the execution scheduler.

## Tests and validation

- Server/domain behavior: `tests/`.
- Runtime/persistence/Compose behavior: matching production/runtime/storage/recovery tests under `tests/`.
- Browser-level product flows: `e2e/` through the canonical routing policy.
- CI/workflow behavior: `.github/` plus its routing/contract tests.
- Repository placement/ownership: `tests/architecture/repository-placement-policy.test.mjs` plus `scripts/repository-placement-policy.mjs`.
- Documentation-only changes: repository docs/link checks plus `git diff --check` and the routed CI plan.

Green CI is meaningful only if the required test families were actually selected and executed.

## Creating a new module or file

Before adding one, answer:

1. Which domain owns the behavior/data?
2. Does a canonical owner already exist?
3. Is the change presentation, orchestration, persistence, integration, security or operational tooling?
4. Which tests prove the behavior?
5. Which active document owns the contract?
6. Would the new file create a second way to perform the same operation?

If ownership is unclear, resolve the ownership/documentation gap before introducing another abstraction.

## Parallel-agent coordination

Before modifying shared runtime owners, `worker/`, canonical schema/migrations, `src/auth/`, CI workflows or documentation-governance files:

- inspect active PRs and changed files;
- declare owned paths and dependencies;
- prefer dependency-closed slices;
- avoid a second implementation when an owning PR already exists;
- revalidate against current `main` before final merge;
- run checks on the exact candidate head.

## Current maintainability constraints

This document describes present reality, including remaining gaps:

- the Worker wrapper chain is still broad and #56 tracks explicit composition work;
- frontend ownership continues to evolve as product screens adopt shared shell/UI primitives;
- API/permission/reference ownership is distributed across canonical code/tests/docs rather than generated from one registry;
- production uses the canonical Node runtime rooted at `scripts/start-production.mjs` / `runtime/production-runtime.mjs`;
- dashboard persistence is mounted at `/data`, with the recovery container accessing the same named volume at `/portal-data`;
- exactly three root production TypeScript modules remain frozen transitional exceptions under the placement policy;
- current Compose topology still uses host networking until the dedicated network-model work is merged.

These are constraints to preserve or improve deliberately, not permission to create parallel owners.

## Related documents

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — runtime, trust and data-flow architecture.
- [`../reference/SOURCE_OF_TRUTH.md`](../reference/SOURCE_OF_TRUTH.md) — authoritative contract-owner registry.
- [`../development/DOCUMENTATION_POLICY.md`](../development/DOCUMENTATION_POLICY.md) — documentation lifecycle and verification rules.
- [`../development/ROOT_MODULE_MIGRATION_MAP.md`](../development/ROOT_MODULE_MIGRATION_MAP.md) — completed root-module migration record and historical context.
- [`../guide/README.md`](../guide/README.md) — role-oriented Knowledge Base.
- [`../ai/README.md`](../ai/README.md) — mandatory AI-agent entrypoint.

If this file and the current repository disagree, current code/tests and canonical owners win; update this document in the same scope as the confirmed structural change.