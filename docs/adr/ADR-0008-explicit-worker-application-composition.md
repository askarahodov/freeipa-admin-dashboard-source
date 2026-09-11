# ADR-0008: Compose the Worker through one explicit application router and security pipeline

- Status: Proposed
- Date: 2026-09-10
- Decision owner: Worker HTTP composition, routing and request security boundaries
- Tracking: #56, #626, #627; implementation begins in #628

## Context

The current Worker application is behaviorally mature but historically composed through a broad sequence of entry wrappers before `worker/index.ts`. Those wrappers own a mixture of schema readiness, maintenance/recovery gating, service-administrator delegation, local-session handling, settings lifecycle/source adaptation, FreeIPA query/bulk/member adapters, diagnostics and catalog synchronization.

The project already has important canonical building blocks:

- `src/auth/portal-route-contract.ts` owns stable method/path/auth/permission/mutation metadata;
- `src/auth/portal-route-router.ts` can match that metadata without dispatching;
- `src/auth/portal-route-security-plan.ts` derives an ordered metadata security plan without enforcing it;
- canonical request-context helpers exist under `src/auth/**`;
- domain capabilities increasingly live under explicit `src/**` owners;
- `runtime/**` and `scripts/start-production.mjs` own production process hosting separately from Worker application composition.

However, runtime dispatch and trust adaptation still live in wrappers. Some wrappers also rewrite headers/environment so older downstream handlers observe a synthetic static identity or internal admin token. Settings source handling contains a real branch and effective-configuration virtualization. `secure-entry.ts` currently combines identity adaptation with catalog-sync HTTP handling, persistence, audit and scheduled execution. `worker/index.ts` still mixes Vinext hosting with several independent product/integration domains.

Deleting or flattening these wrappers without preserving their behavior would create material authorization, recovery, configuration and operability risk. Keeping the wrapper chain as the permanent extension mechanism makes route ownership and middleware order increasingly expensive to reason about.

## Decision

The target Worker architecture will use **one explicit application composition point** under `worker/**` for HTTP routing and middleware/gate ordering.

The migration follows these rules:

1. **Reuse canonical route metadata.** Stable API method/path/auth/permission/mutation metadata remains owned by `src/auth/portal-route-contract.ts`. The application composition reuses `portal-route-router.ts`; it does not create a second route registry.
2. **Separate matching from enforcement.** `portal-route-security-plan.ts` may describe the intended stage order, but current security enforcement remains authoritative until behavior and negative parity tests prove the replacement. Metadata alone never grants access.
3. **Make trust mechanisms explicit.** Anonymous access, local portal sessions and service-administrator authorization remain distinct mechanisms. The canonical request context becomes the explicit principal passed through application composition; legacy header/env impersonation is retired only after downstream consumers no longer depend on it.
4. **Keep recovery gates explicit and ordered.** Schema readiness, maintenance/recovery gating and their intentional exceptions are first-class application gates rather than incidental wrapper order. Recovery/control/status routes must remain reachable exactly where current fail-closed behavior requires it.
5. **Register domain HTTP adapters, not duplicate domain logic.** Worker modules adapt HTTP to canonical owners under `src/**`/`db/**`; they do not become new business, schema, scheduler or integration sources of truth.
6. **Keep process hosting outside the application router.** `runtime/**` and production-host scripts continue to own listener/process lifecycle, trusted-proxy transport policy, SQLite hosting, scheduler startup and shutdown. Issue #53 remains the owner of reverse-proxy trust semantics.
7. **Treat infrastructure/static routes deliberately.** Health/dependency/metrics/diagnostics/static/Vinext surfaces that are not represented in `portalRouteContracts` are explicitly registered/classified by the application composition. They are not silently absorbed into domain metadata merely to make one list exhaustive.
8. **Keep scheduled composition explicit.** Portal scheduled work is wired separately from HTTP route registration and remains subject to schema/maintenance gates. XYOps continues to own upstream execution scheduling/queue/concurrency semantics.
9. **Migrate incrementally.** Legacy wrappers may delegate to the explicit composition or remain compatibility adapters while they still own unique behavior. A wrapper is removed only after parity evidence shows its semantics have an explicit new owner.
10. **No framework rewrite.** The implementation should use existing TypeScript/Node/Worker primitives unless a future ADR demonstrates that another router/DI framework is necessary. File-count or LOC reduction is not an architecture goal.

A likely target shape is conceptually:

```text
worker/
  app.ts                 # one application composition / entry
  router.ts              # thin adapter over canonical route matching
  middleware/            # explicit request/security/recovery gates
  modules/               # HTTP adapters grouped by domain

src/
  auth/                   # canonical auth/permission/route contracts
  freeipa/                # FreeIPA domain/application behavior
  operations/             # XYOps-facing portal operations/policies/history
  backup/
  recovery/
  storage/

runtime/                  # process hosting, DB adapter, scheduler host, shutdown

db/                       # canonical schema and migrations
```

The exact filenames are implementation details. The durable decision is one obvious composition owner, dependency direction and explicit trust/gate ordering.

## Consequences

Positive:

- a protected request can be understood from one composition point plus its canonical route/domain owners;
- adding a stable route no longer requires adding another feature-specific entry wrapper;
- route metadata can be checked against registered handlers and actual security enforcement;
- authentication mechanisms and recovery exceptions become visible instead of encoded in wrapper order;
- `worker/index.ts` can shrink in responsibility without moving business logic into another central file;
- domain extraction can proceed incrementally with bounded rollback and parity evidence;
- architecture fitness checks can protect meaningful dependency/ownership invariants after migration.

Costs and constraints:

- during migration, explicit composition and compatibility wrappers will coexist temporarily;
- every cutover needs conservative negative/security regression because current wrappers contain hidden adaptation behavior;
- settings source virtualization and internal admin-token bridges cannot be removed mechanically;
- infrastructure/static routes require an explicit ownership classification separate from ordinary stable product APIs;
- central dispatch extraction should remain sequential because parallel edits to composition create high merge and parity risk.

Security consequences:

- the target must remove accidental trust in caller-provided identity/admin headers rather than reproduce it in a new abstraction;
- local session and service-admin cannot collapse into a single generic “admin” principal that bypasses purpose-specific checks;
- same-origin, maintenance, schema, approval, encryption, audit and recovery behavior remains fail-closed;
- the application router does not redefine trusted-proxy semantics owned by the production host/#53.

Operational consequences:

- liveness/readiness/dependency/metrics distinctions and pre-schema diagnostic availability must be preserved;
- scheduled catalog synchronization remains an explicit portal responsibility but not a second XYOps scheduler;
- Vinext HTML/static/RSC/image hosting remains reachable while API dispatch is migrated.

## Migration sequence

Implementation is intentionally staged through the #56 children:

1. #627 — current composition/ownership inventory and this ADR;
2. #628 — explicit router/application composition behind parity tests;
3. #629 — explicit security middleware around the canonical request context;
4. #630 — diagnostics/health extraction pilot;
5. #631 — FreeIPA HTTP adapter extraction;
6. #632 — XYOps/operations/approvals extraction;
7. #633 — settings/local-admin extraction;
8. #634 — backup/recovery/storage/maintenance extraction;
9. #635 — scheduled/assets integration and legacy-wrapper retirement;
10. #636 — staged architecture fitness enforcement, finalized after the cutover;
11. #638 — independent exit review proving reduced change amplification.

If a phase discovers that the proposed composition cannot preserve a current security/recovery contract without disproportionate complexity, stop at that bounded phase and revise this ADR before broadening the migration.

## Canonical evidence / owners

Current-state evidence and ownership map:

- `docs/architecture/WORKER_COMPOSITION.md`;
- `src/auth/portal-route-contract.ts`;
- `src/auth/portal-route-router.ts`;
- `src/auth/portal-route-security-plan.ts`;
- canonical request-context/auth/permission modules under `src/auth/**`;
- `worker/schema-migrations-entry.ts` and the current wrapper/handler graph;
- `worker/maintenance-mode-gate.ts`;
- `worker/local-secure-entry.ts` and `worker/middleware/service-admin-authentication.ts`;
- settings lifecycle/source wrappers;
- `worker/secure-entry.ts` and `worker/index.ts`;
- canonical domain modules under `src/**`;
- `db/portal-schema.ts`;
- route/auth/security/domain/recovery tests under `tests/**`;
- `docs/reference/SOURCE_OF_TRUTH.md` for precedence and authoritative owners.

Process-host boundary evidence remains `scripts/start-production.mjs`, `runtime/production-runtime.mjs` and the active #53 trusted-proxy/runtime-host contracts.

## Supersession

No prior ADR is superseded. This decision concerns Worker HTTP application composition and is compatible with the accepted production-runtime, identity-separation, persistence, migration, maintenance and staged-recovery ADRs.

If the project later replaces the single Worker application composition with a materially different hosting/application architecture, that change must supersede this ADR explicitly.
