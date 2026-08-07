# Project structure and module boundaries

## Purpose

This document explains **where current code belongs** in Admin Dashboard Softrust and which layer owns a change. It is a repository navigation and ownership map, not a generated `tree` listing and not a target refactoring plan.

For system behavior and trust/data flows, read [`ARCHITECTURE.md`](ARCHITECTURE.md). For authoritative contract owners, use [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md).

## Repository map

| Path | Responsibility | Canonical owner / entrypoint | Typical dependencies | Tests / verification | Do not put here |
| --- | --- | --- | --- | --- | --- |
| `app/` | Browser UI, route-level presentation, login/access/session/diagnostics screens and product interactions | `app/layout.tsx`, `app/page.tsx`, route/page modules | React/Vinext, shared UI primitives, portal HTTP APIs | UI/source contracts, Auth E2E where relevant | server authorization, direct FreeIPA credentials, raw DB ownership |
| `app/styles/` | Shared design tokens and global visual foundation | semantic token files merged under #93 | CSS variables/global styles | UI foundation tests + build | feature-specific business logic or one-off duplicate tokens |
| `app/ui/` | Domain-agnostic reusable UI primitives | explicit exports from `app/ui/index.ts` | tokens/styles only; caller-owned behavior | `tests/ui-foundation.test.mjs` and consumers | FreeIPA/XYOps fetches, route ownership, RBAC decisions |
| `worker/` | Server request entry chain, API handlers, security/runtime gates, integration-facing portal behavior | `worker/schema-migrations-entry.ts` through wrapper chain to `worker/index.ts` | auth, DB, settings, audit, integrations, recovery modules | server test suite and route/domain contracts | browser-only UX state or a second frontend data model |
| `db/` | Canonical portal schema, versioned migrations, schema lifecycle helpers | `db/portal-schema.ts`, migration registry/runtime | D1/SQLite-compatible storage | migration/schema/storage tests | UI concerns, upstream FreeIPA/XYOps ownership |
| root `*.ts` domain modules | Shared domain logic used by Worker/runtime such as auth, audit, automation, presentation, backup/recovery helpers | existing module that already owns the contract | Worker + DB + bounded domain helpers | matching `tests/*.test.mjs` | a duplicate service/client for an already-owned contract |
| `scripts/` | Startup, local tooling, inspection, recovery and operational CLI helpers | script-specific entrypoint; startup begins with `scripts/start-worker.mjs` | Node.js, Docker/runtime files, bounded operational contracts | script/compose/acceptance tests | normal browser features or hidden production business logic without an owner |
| `tests/` | Node test suite for server/domain/source contracts | `*.test.mjs` discovered by CI | built/runtime source | CI `Test complete server suite` + matrix | production implementation logic |
| `e2e/` | Browser-level end-to-end scenarios for high-value flows | Playwright/Auth E2E workflow | built/running portal | `.github/workflows/auth-e2e.yml` | exhaustive unit/domain coverage better owned by `tests/` |
| `docs/` | Active engineering docs, runbooks, references, governance and historical design artifacts | `docs/README.md`, `DOCUMENTATION_POLICY.md`, `SOURCE_OF_TRUTH.md` | current runtime/contracts | docs review + applicable tests/build | duplicated machine-readable registries or secrets |
| `docs/ai/` | Compact mandatory routing/rules for AI agents | `docs/ai/README.md` | documentation policy + source registry | manual/docs contract review | copied runtime facts already owned by active docs/code |
| `docs/superpowers/` | Design/implementation planning artifacts | individual spec/plan | issue/PR workflow | historical/reference review | current runtime truth after implementation merges |
| `.github/` | CI, PR contribution process and repository automation | workflow/template files | npm scripts/test discovery | GitHub Actions | application runtime behavior |
| `compose.yaml` / `Dockerfile` | Supported current container topology, runtime image, recovery profile and persistence mounts | deployment/runtime files | startup scripts, environment contract | build, recovery-compose, acceptance | secrets or undocumented alternate production topology |
| `package.json` / lockfile | Node/runtime/tooling dependency and command contract | package scripts/dependency graph | Node.js 22.13+ | `npm ci`, lint, build, tests | runtime secrets or app-specific mutable configuration |

## Important current boundaries

### Frontend presentation

`app/page.tsx` still contains a large part of the primary product presentation. Shared tokens and reusable primitives now exist under `app/styles/` and `app/ui/`; new UI work should reuse those owners instead of introducing another local design system.

The AppShell/navigation work tracked under #94/#106 is not part of current runtime until its PR is merged. Do not structure current-state documentation around draft files as though they were active owners.

### Server request handling

The supported Worker entry is `worker/schema-migrations-entry.ts`, which composes the existing wrapper chain before the base `worker/index.ts` implementation. This is the current request architecture even though #56 tracks a clearer future router/module refactor.

When adding or changing a route, first identify the existing wrapper/domain owner and its tests. Do not create an independent route stack merely to avoid touching the current chain.

### Database and storage

`db/portal-schema.ts` and the canonical migration registry/runtime own the portal database shape. Existing D1/SQLite-compatible persistence, migration journal/lock and storage/recovery contracts must be extended through those owners.

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

## Where should this change go?

### UI presentation, page layout or reusable controls

1. Check `app/ui/` and `app/styles/` first.
2. Reuse an existing primitive/token when the semantic role already exists.
3. Feature composition belongs in the relevant `app/` page/component layer.
4. If behavior requires new server data or mutation, add/change the server contract separately; do not hide it inside JSX.

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

1. Start from `db/portal-schema.ts` and the canonical migration registry/runtime.
2. Preserve immutable released migration checksums/definitions.
3. Use the existing schema lock/journal/preflight/apply boundaries.
4. Update `DATABASE_MIGRATIONS.md` and storage runbooks when behavior changes.

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

Before modifying shared files such as `app/page.tsx`, `worker/index.ts`, canonical schema/migrations, auth/RBAC owners, CI workflows or documentation governance files:

- inspect active PRs/issues for overlapping ownership;
- make dependencies explicit;
- prefer narrow independent slices;
- rebase/merge current `main` before final verification when another owner lands first;
- run final checks on the exact candidate head that will be merged.

## Current maintainability constraints

The project structure intentionally documents present reality:

- `worker/index.ts` plus the wrapper chain are still broad and complex;
- much product UI remains concentrated in `app/page.tsx` despite the new shared UI foundation;
- API/permission/reference ownership is still distributed across handlers/tests/docs rather than a single generated registry;
- production currently persists local Wrangler/D1-compatible state under the mounted `.wrangler` directory;
- current Compose topology still uses host networking and the current production command still starts local Wrangler development mode.

Those are tracked architecture gaps, not permission to create additional parallel structures.

## Related documents

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — runtime, trust and data-flow architecture.
- [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) — authoritative contract-owner registry.
- [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md) — documentation lifecycle and verification rules.
- [`GLOSSARY.md`](GLOSSARY.md) — stable terminology.
- [`ai/README.md`](ai/README.md) — mandatory AI-agent workflow.

If this file and the current repository disagree, verify current `main` and the canonical owner first, then fix this document in the same scope as the confirmed structural change.
