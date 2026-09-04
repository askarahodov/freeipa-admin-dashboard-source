# Project structure and module boundaries

## Purpose

This document explains **where current code belongs** in Admin Dashboard Softrust and which layer owns a change. It is a repository navigation and ownership map, not a generated `tree` listing and not a target refactoring plan.

For system behavior and trust/data flows, read [`ARCHITECTURE.md`](ARCHITECTURE.md). For authoritative contract owners, use [`SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md).

## Repository map

| Path | Responsibility | Canonical owner / entrypoint | Typical dependencies | Tests / verification | Do not put here |
| --- | --- | --- | --- | --- | --- |
| `app/` | Browser UI, route-level presentation, login/access/session/diagnostics screens and product interactions | `app/layout.tsx`, current page/screen modules and presentation owners | React/Vinext, shared UI primitives, portal HTTP APIs | UI/source contracts, Auth E2E where relevant | server authorization, direct FreeIPA credentials, raw DB ownership |
| `app/styles/` | Shared design tokens and global visual foundation | semantic token files under `app/styles/` | CSS variables/global styles | UI foundation tests + build | feature-specific business logic or one-off duplicate tokens |
| `app/ui/` | Domain-agnostic reusable UI primitives | explicit exports from `app/ui/index.ts` | tokens/styles only; caller-owned behavior | `tests/ui-foundation.test.mjs` and consumers | FreeIPA/XYOps fetches, route ownership, RBAC decisions |
| `app/shell/` | Reusable product shell and stable global navigation foundation | `app/shell/AppShell.tsx`, `app/shell/navigation.ts`, exports from `app/shell/index.ts` | React, shared tokens/styles, caller-supplied visibility/badges/navigation callback | `tests/app-shell.test.mjs` + build | server authorization, generated XYOps catalog structure, page-specific data fetching, a second global navigation model |
| `worker/` | Built Worker request entry chain, API handlers, security/runtime gates and integration-facing portal behavior | `worker/schema-migrations-entry.ts` through wrapper chain to `worker/index.ts` | auth, DB, settings, audit, integrations, recovery modules | server test suite and route/domain contracts | browser-only UX state or a second frontend data model |
| `runtime/` | Canonical Node production orchestration, SQLite persistence adapter/driver, HTTP Worker host, scheduler and shutdown lifecycle | `runtime/production-runtime.mjs` plus runtime application/database/host helpers | built Worker artifact, SQLite driver/adapter, startup environment | production-runtime and persistence contract tests | route-specific business logic or browser presentation |
| `db/` | Canonical portal schema, versioned migrations and schema lifecycle helpers | `db/portal-schema.ts`, migration registry/runtime | D1/SQLite-compatible storage | migration/schema/storage tests | UI concerns, upstream FreeIPA/XYOps ownership |
| root `*.ts` domain modules | Shared domain logic used by Worker/runtime such as auth, audit, automation, presentation, backup/recovery helpers | existing module that already owns the contract | Worker + DB + bounded domain helpers | matching `tests/*.test.mjs` | a duplicate service/client for an already-owned contract |
| `scripts/` | Production startup, local tooling, inspection, recovery and operational CLI helpers | production starts at `scripts/start-production.mjs`; other scripts own their specific workflows | Node.js, Docker/runtime files, bounded operational contracts | startup/runtime/script/compose/acceptance tests | normal browser features or hidden production business logic without an owner |
| `tests/` | Node test suite for server/domain/source/runtime contracts | `*.test.mjs` discovered by CI | built/runtime source | CI server-test matrix | production implementation logic |
| `e2e/` | Browser-level end-to-end scenarios for high-value flows | Playwright/Auth E2E workflow | built/running portal | Auth E2E workflow | exhaustive unit/domain coverage better owned by `tests/` |
| `docs/` | Active engineering docs, runbooks, references, governance and historical design artifacts | `docs/README.md`, `DOCUMENTATION_POLICY.md`, `SOURCE_OF_TRUTH.md` | current runtime/contracts | docs review + applicable tests/build | duplicated machine-readable registries or secrets |
| `docs/ai/` | Compact mandatory routing/rules for AI agents | `docs/ai/README.md` | documentation policy + source registry | manual/docs contract review | copied runtime facts already owned by active docs/code |
| `docs/superpowers/` | Design/implementation planning artifacts | individual spec/plan | issue/PR workflow | historical/reference review | current runtime truth after implementation merges |
| `.github/` | CI, PR contribution process and repository automation | workflow/template files | npm scripts/test discovery | GitHub Actions | application runtime behavior |
| `compose.yaml` / `Dockerfile` | Supported current container topology, runtime image, recovery profile and persistence mounts | deployment/runtime files | canonical startup/runtime scripts, environment contract | build, runtime/Compose contracts, recovery-compose, acceptance | secrets or undocumented alternate production topology |
| `package.json` / lockfile | Node/runtime/tooling dependency and command contract | package scripts/dependency graph | Node.js 22.13+ | `npm ci`, lint, build, tests | runtime secrets or app-specific mutable configuration |

## Important current boundaries

### Frontend presentation

Shared tokens and reusable primitives exist under `app/styles/` and `app/ui/`. `app/shell/` owns the reusable AppShell/navigation foundation.

Recent merged UI architecture work has extracted additional Home, Users and Groups presentation responsibilities out of the former monolithic composition. Treat the current `app/` tree and UI tests as authoritative when deciding which screen/component owns a change; historical statements that all primary presentation remains in `app/page.tsx` are no longer a safe current-state rule.

### Production runtime

Production startup begins at `scripts/start-production.mjs`, not `scripts/start-worker.mjs` and not Wrangler dev mode. That entrypoint constructs the canonical runtime using `runtime/production-runtime.mjs`, starts the private FreeIPA Gateway, loads the built Worker artifact, creates the SQLite-backed runtime database, hosts the Worker through the Node runtime host, starts the scheduler and coordinates shutdown.

`worker/schema-migrations-entry.ts` remains the built Worker application entry chain; it is hosted by the canonical Node production runtime rather than being the production process entrypoint itself.

### Server request handling

The supported Worker application entry is `worker/schema-migrations-entry.ts`, which composes the existing wrapper chain before the base `worker/index.ts` implementation. This is the current request architecture even though #56 tracks a clearer future router/module refactor.

When adding or changing a route, first identify the existing wrapper/domain owner and its tests. Do not create an independent route stack merely to avoid touching the current chain.

### Database and storage

`db/portal-schema.ts` and the canonical migration registry/runtime own the portal database shape. `runtime/runtime-database.mjs`, `runtime/sqlite-runtime-store.mjs`, the Node SQLite driver and D1 adapter own the production persistence/runtime adaptation around that schema.

The canonical production image uses `/data` as `PORTAL_DATA_DIR`. Current `compose.yaml` still mounts `dashboard-data` at `/app/.wrangler`; this mismatch is tracked by #209 and must be corrected before active documentation claims the current Compose mount persists the canonical Node production database.

Do not place ad-hoc table creation, destructive migration SQL or independent schema definitions in request handlers or scripts.

### FreeIPA integration

FreeIPA is an external directory owner. Server-side FreeIPA behavior goes through the existing integration/Gateway boundary, including `scripts/freeipa-gateway.mjs` and the existing Worker/domain ownership.

Do not add browser-side FreeIPA credentials, cookies or a second direct client from React components.

### XYOps integration

XYOps remains the upstream owner of process definitions and execution/scheduler semantics. Portal-side catalog normalization, presentation policy, run history and approvals belong to existing portal domain modules and Worker handlers.

Do not introduce a second scheduler/queue/concurrency engine in the portal.

### Auth and permissions

Portal authentication/session behavior is server-owned. Local users/sessions, built-in roles/permissions and service-admin boundaries must be changed in the existing auth/session/RBAC owners and their tests.

Frontend visibility is UX only and must never become the only enforcement mechanism.

### Recovery and maintenance

Backup, selective restore, maintenance mode, migration operations and offline full restore have separate owners and safety models. Extend the existing module/runbook that owns the operation instead of adding a generic recovery endpoint.

Production/recovery persistence paths must address the same underlying data contract. The current Compose path mismatch is tracked separately by #209.

## Where should this change go?

### UI presentation, page layout or reusable controls

1. Check the current screen/presentation owner plus `app/shell/`, `app/ui/` and `app/styles/` according to the change.
2. Reuse an existing shell/navigation owner, primitive or token when the semantic role already exists.
3. Do not assume `app/page.tsx` still owns a surface that has been extracted into a dedicated module.
4. If behavior requires new server data or mutation, add/change the server contract separately; do not hide it inside JSX.

### Production startup/runtime

1. Start from `scripts/start-production.mjs` and `runtime/production-runtime.mjs`.
2. Keep Worker hosting, runtime database creation, scheduler and shutdown orchestration in the existing runtime owners.
3. Keep the built Worker route/application chain separate from process-level runtime orchestration.
4. Update `ARCHITECTURE.md`, deployment/configuration docs and runtime contract tests when startup semantics change.

### Authentication, sessions, roles or permissions

1. Find the existing local-auth/session/RBAC owner and matching Worker boundary.
2. Change server-side enforcement first.
3. Update UI visibility/feedback only as a consumer of that contract.
4. Update `LOCAL_AUTH_RBAC.md` and security/reference docs when semantics change.

### FreeIPA users, groups or membership

1. Reuse the existing FreeIPA Gateway/integration path.
2. Extend the current Worker/domain handler rather than creating another client.
3. Keep credentials/session material server-side.
4. Add behavior tests for normalized errors and permission/security boundaries.

### XYOps catalog, run, approval or presentation behavior

1. Verify whether the change is upstream execution ownership or portal presentation/policy.
2. Extend the existing XYOps client/catalog/run/presentation owner.
3. Keep scheduler/concurrency/rate-limit ownership with XYOps.
4. Update `XYOPS_EXECUTION_OWNERSHIP.md` or related reference when the contract changes.

### Storage, schema or migration

1. Start from `db/portal-schema.ts` and the canonical migration registry/runtime for schema semantics.
2. Use the existing `runtime/` database/SQLite boundary for production persistence behavior.
3. Preserve immutable released migration checksums/definitions.
4. Use the existing schema lock/journal/preflight/apply boundaries.
5. Update `operations/DATABASE_MIGRATIONS.md`, configuration and storage runbooks when behavior changes.

### Backup, maintenance or restore

1. Identify whether the operation is backup/export, isolated restore, selective restore, maintenance, migration operation or offline full restore.
2. Extend that exact owner and its guarded workflow.
3. Preserve redaction, audit, controller/stage/recovery secret boundaries.
4. Update the active runbook in the same PR.

### Health or monitoring

1. Keep liveness, readiness, dependency health and metrics semantics distinct.
2. Extend the existing health handler/contract instead of creating a new overlapping health surface.
3. Update `HEALTH_CONTRACTS.md` / `HEALTH_METRICS.md` as appropriate.

### Documentation-only change

1. Start with `docs/README.md`, `DOCUMENTATION_POLICY.md` and `SOURCE_OF_TRUTH.md`.
2. Verify every current-state claim against current code/tests/ref.
3. Extend an existing active owner document before creating a new Markdown file.
4. Mark a document `verified-active` only after actual verification.

### Tests

- Server/domain behavior: `tests/`.
- Production runtime/persistence behavior: matching runtime/production/Compose contract tests under `tests/`.
- Browser-level authentication/high-value UI flow: `e2e/` plus the existing Auth E2E routing contract.
- CI/workflow behavior: `.github/` plus workflow-routing tests where they exist.
- Do not replace behavior coverage with source-text matching when runtime semantics can be exercised directly.

## Creating a new module or file

Before adding one, answer all of these:

1. Which domain owns the data/behavior?
2. Is there already an existing owner or analogous implementation?
3. Is this presentation, orchestration, persistence, integration, security or operational tooling?
4. Which current tests prove the behavior?
5. Which active document owns the contract?
6. Will the new file create a second way to perform the same operation?

If ownership is unclear, resolve the architecture/documentation gap first rather than creating a parallel abstraction.

## Parallel-agent coordination

Before modifying shared files such as production runtime owners, `worker/index.ts`, canonical schema/migrations, auth/RBAC owners, CI workflows or documentation governance files:

- inspect active PRs/issues for overlapping ownership;
- make dependencies explicit;
- prefer narrow independent slices;
- rebase/merge current `main` before final verification when another owner lands first;
- run final checks on the exact candidate head that will be merged.

## Current maintainability constraints

The project structure intentionally documents present reality:

- `worker/index.ts` plus the wrapper chain are still broad and complex;
- frontend ownership is being decomposed into reusable shell/UI primitives and dedicated presentation/screen modules, so old `app/page.tsx` ownership assumptions age quickly;
- API/permission/reference ownership is still distributed across handlers/tests/docs rather than a single generated registry;
- production now uses the canonical Node runtime rooted at `scripts/start-production.mjs` and `runtime/production-runtime.mjs`;
- the canonical production SQLite persistence root (`/data`) and current Compose named-volume mount (`/app/.wrangler`) are inconsistent; #209 tracks the required runtime/deployment fix;
- current Compose topology still uses host networking.

Those are tracked architecture gaps, not permission to create additional parallel structures.

## Related documents

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — runtime, trust and data-flow architecture.
- [`SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md) — authoritative contract-owner registry.
- [`DOCUMENTATION_POLICY.md`](../DOCUMENTATION_POLICY.md) — documentation lifecycle and verification rules.
- [`GLOSSARY.md`](../GLOSSARY.md) — stable terminology.
- [`ai/README.md`](../ai/README.md) — mandatory AI-agent workflow.

If this file and the current repository disagree, verify current `main` and the canonical owner first, then fix this document in the same scope as the confirmed structural change.
