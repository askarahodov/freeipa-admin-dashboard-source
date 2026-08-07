# ADR-0001: Replace Wrangler development mode with a standalone Node production runtime

- Status: Proposed
- Date: 2026-08-07
- Decision owner: production runtime / issue #51
- Scope: Docker/self-hosted production runtime only

## Context

The current Docker runtime starts the already-built Vinext Worker through `wrangler dev --local` from `scripts/start-worker.mjs`. Wrangler/Miniflare currently provides several things at once:

- HTTP hosting for the built Worker bundle;
- `DB` as a local D1-compatible binding;
- static `ASSETS` binding;
- scheduled-event execution for the hourly catalog sync;
- persistence rooted under `.wrangler`;
- Workers execution-context behavior.

This is convenient for development, but it leaves the production container coupled to a development emulator, Wrangler state directories, Miniflare behavior and a larger dependency/security surface.

The built artifact already contains the important application contract. `dist/server/index.js` exports the Worker `fetch` handler and `scheduled` handler. `dist/server/wrangler.json` describes the `DB` binding, assets and the hourly cron. The domain/API/auth/schema/health behavior is therefore not intrinsically tied to the Wrangler CLI; the missing production boundary is a supported host for those Worker-facing capabilities.

Canonical schema/migration lifecycle (#57) and liveness/readiness/dependency-health contracts (#58) already exist and must be reused by the replacement runtime.

Vinext currently supports standalone Node deployment and Node/Nitro output. Its upstream documentation explicitly supports a standalone Node server (`output: "standalone"`) and Nitro `NITRO_PRESET=node`. Cloudflare Workers remains its deepest native integration, so any move away from Workers bindings must be treated as a compatibility migration and proven against this repository's contract suites.

## Decision drivers

The replacement must:

1. run only pre-built immutable artifacts in production;
2. remove `wrangler dev`, Miniflare and interactive development behavior from the production process;
3. preserve the existing public HTTP/API/browser contract;
4. preserve local persistent SQLite/D1 semantics without changing the product database to PostgreSQL;
5. preserve scheduled catalog sync;
6. preserve the private Node FreeIPA Gateway boundary;
7. support graceful SIGTERM/SIGINT shutdown;
8. use explicit persistent data and temporary paths;
9. support read-only root filesystem operation;
10. keep build-time tooling out of the runtime image;
11. allow staged rollout and rollback without a big-bang backend rewrite.

## Options considered

### Option A — Direct production Workerd

Run the built Worker directly in Workerd without Wrangler.

Advantages:

- execution model remains closest to Cloudflare Workers;
- the existing Worker entry and `ExecutionContext` semantics change least;
- no Node HTTP translation layer around requests.

Disadvantages:

- Workerd alone does not provide the current local D1 persistence implementation that Wrangler/Miniflare supplies;
- local D1, asset serving and scheduler behavior still require custom host bindings/services;
- production packaging and configuration become Workerd-specific while the existing FreeIPA Gateway remains a Node process;
- operating two runtimes does not materially simplify the self-hosted architecture.

Conclusion: technically possible, but it replaces Wrangler with a custom Workerd hosting layer while still requiring a database adapter. It does not minimize operational complexity.

### Option B — Standalone Node/Vinext server with a narrow D1-compatible SQLite adapter

Build Vinext for standalone Node and host the application in one production Node process. Preserve the existing domain modules and Worker-oriented API semantics through explicit adapters:

- local SQLite implements the subset of `D1Database` used by the application;
- static files are served from the immutable build output;
- the existing hourly `scheduled` behavior is invoked by an internal scheduler entrypoint;
- the private FreeIPA Gateway remains loopback-only and is lifecycle-managed by the production launcher;
- health/schema/auth/security startup validation remains unchanged in meaning.

Advantages:

- removes Wrangler/Miniflare from the production runtime;
- Node is already required for the FreeIPA Gateway and startup/security validation;
- standalone Node output is a supported Vinext deployment path;
- local SQLite can use an explicit file path rather than an internal `.wrangler` cache layout;
- process signals, readiness, logging and filesystem permissions become ordinary container behavior;
- allows incremental migration of the hosting boundary without rewriting business modules.

Disadvantages:

- requires a carefully bounded D1 compatibility adapter;
- Workers `ExecutionContext`, assets and scheduled behavior need explicit host adapters;
- image optimization or other Cloudflare-specific bindings must be replaced, disabled safely, or adapted;
- Node-target compatibility must be proven because Cloudflare Workers remains Vinext's deepest integration.

Conclusion: selected. It is the smallest architecture change that removes the development emulator while preserving the existing portal contract and storage model.

### Option C — Rewrite backend APIs onto a conventional Node HTTP framework

Move portal API/domain execution to Fastify/Express/Hono/etc. and keep the React/Vinext frontend separately.

Advantages:

- conventional self-hosted server architecture;
- no Workers compatibility layer required long term;
- direct access to SQLite/Node libraries.

Disadvantages:

- largest migration surface by far;
- duplicates or rewrites routing, auth, authorization, same-origin protection, schema gates, audit, health and integration behavior;
- significantly higher regression and security risk;
- violates the issue requirement to avoid a broad backend rewrite unless necessary.

Conclusion: rejected for #51. Reconsider only if the narrow Node adapter proves impossible or unmaintainable through evidence from the migration spike/tests.

## Decision

Adopt **Option B: standalone Node/Vinext production server with a narrow D1-compatible SQLite adapter**.

The Worker/domain code remains the behavioral source during migration. The new runtime is an adapter around the existing application, not a rewrite of the application into a second architecture.

## Target topology

```text
Browser / reverse proxy
        |
        v
+------------------------------------------+
| production Node process                  |
|                                          |
| startup security validation              |
|   |                                      |
|   +--> local SQLite/D1 adapter ----------+--> persistent /data/portal.sqlite
|   |                                      |
|   +--> Vinext standalone HTTP server     |
|   |       |                              |
|   |       +--> existing portal handlers  |
|   |       +--> immutable static assets   |
|   |                                      |
|   +--> scheduler adapter --> scheduled() |
|   |                                      |
|   +--> FreeIPA Gateway (127.0.0.1 only) -+--> FreeIPA
|                                          |
+------------------------------------------+
                 |
                 +----------------------------> XYOps
```

The process may internally use separate Node server objects/modules, but the container has one lifecycle owner and one explicit shutdown coordinator.

## Runtime components

### 1. Production launcher

A dedicated launcher replaces the Wrangler spawn path. Responsibilities:

- validate `CONFIG_ENCRYPTION_KEY` and identity startup policy before opening the public listener;
- resolve and validate the explicit data path;
- open the SQLite/D1 adapter;
- run/verify canonical migrations before readiness;
- start the loopback-only FreeIPA Gateway;
- start the standalone Vinext HTTP server;
- start the scheduler only after schema readiness;
- handle SIGTERM/SIGINT exactly once;
- stop accepting HTTP traffic, stop scheduler work, close Gateway, flush/close SQLite and exit cleanly.

The launcher must not build the application, invoke Vite or invoke Wrangler.

### 2. SQLite/D1 compatibility adapter

Create a small adapter implementing only the D1 surface actually used by the repository. It must not attempt to emulate the entire Cloudflare D1 API.

Required characteristics:

- explicit database file path, defaulting to a documented path under `/data`;
- parameterized SQL only through the same calling conventions currently used by domain modules;
- transaction behavior documented and covered by integration tests;
- `prepare`, bind, first/all/run/batch-style operations implemented only where proven necessary by code/tests;
- SQLite pragmas chosen explicitly and tested for container restart/recovery behavior;
- canonical migration lifecycle remains the only schema owner;
- no request handler may create schema as a fallback.

The adapter is an infrastructure boundary. Domain modules must not import Node SQLite libraries directly.

### 3. HTTP/Vinext adapter

Use Vinext's production Node output rather than `vinext dev`/`vinext start` as the container's runtime contract.

Preferred implementation path:

1. configure/build a standalone Node/Nitro artifact in the build stage;
2. start only the emitted server artifact in runtime;
3. inject portal runtime bindings through a small host adapter rather than global development emulation;
4. serve immutable client/static assets from the build output;
5. preserve existing route/status/header/cookie behavior through contract tests.

If the initial spike shows that standalone Vinext cannot safely inject the existing Worker entry/bindings without invasive framework changes, the implementation must stop and record that evidence before considering Option C.

### 4. Scheduled catalog sync

The current Worker artifact exposes `scheduled()` and configures an hourly cron. Production Node must preserve that behavior without a second external scheduler requirement for the basic Docker deployment.

The scheduler adapter will:

- derive the hourly cadence from one canonical runtime configuration;
- never overlap runs;
- skip execution while schema/readiness is not ready;
- call the same catalog-sync domain path used by the Worker scheduled handler;
- stop scheduling before database shutdown;
- expose last-run/next-run state only through existing safe diagnostics/health boundaries.

The implementation must remain compatible with a future external scheduler by keeping the actual sync action callable independently of the timer.

### 5. FreeIPA Gateway

Keep the Gateway as a private Node-only boundary:

- bind to `127.0.0.1` on an ephemeral or configured internal port;
- generate an ephemeral gateway token at process start;
- never expose the token or upstream session material to the browser;
- start before readiness can succeed;
- close during graceful shutdown before process exit.

The runtime migration must not merge FreeIPA credentials/session logic into browser-facing handlers.

## Data and persistence

Production persistence moves from an implementation-defined `.wrangler` location to an explicit data contract.

Proposed default:

```text
/data/
  portal.sqlite
  portal.sqlite-wal   # when WAL is enabled by the adapter
  portal.sqlite-shm   # when SQLite creates it
```

Rules:

- `/data` is the only persistent writable application path;
- `/tmp` may be writable for temporary process files;
- application source/build output is read-only;
- no persistent state may live in `/app`, `$HOME`, `.wrangler` or framework caches;
- existing deployments receive a documented one-time migration/export-import path from the current Wrangler persistence location;
- migration must be copy/verify/switch, never destructive in-place guessing.

The adoption path must validate schema version/integrity before the new runtime accepts traffic.

## Read-only filesystem model

Target container permissions:

- root filesystem: read-only;
- `/data`: writable persistent volume;
- `/tmp`: writable tmpfs or container temporary path;
- process runs as the existing non-root dashboard user;
- no compiler, Vite CLI, Wrangler CLI, Drizzle Kit or npm CLI is needed in final runtime;
- no writable source tree.

A dedicated test must start the container with Docker `--read-only` plus explicit `/data` and `/tmp` writable mounts.

## Health and startup order

Reuse #58 contracts.

Startup order:

1. validate security/identity configuration;
2. initialize data directory and SQLite adapter;
3. verify/apply allowed canonical migrations;
4. start private FreeIPA Gateway;
5. start public HTTP listener;
6. enable scheduler;
7. readiness becomes healthy only when the existing readiness checks pass.

Liveness must remain process-local and fast. External FreeIPA/XYOps failure remains dependency degradation and must not restart the portal.

If schema is incompatible, startup/readiness fails closed according to the existing schema contract.

## Graceful shutdown

On first SIGTERM/SIGINT:

1. mark runtime stopping and fail/withdraw readiness;
2. stop accepting new public HTTP connections;
3. stop creating new scheduled work;
4. allow bounded in-flight HTTP/domain work to complete;
5. close the FreeIPA Gateway;
6. checkpoint/close SQLite cleanly;
7. exit with the appropriate signal/status.

A second termination signal or shutdown timeout may force exit, but this must be observable and must not silently report success.

## Build and image model

Use a reproducible multi-stage build:

- **dependencies/build stage**: npm install, lint/test/build tooling as needed;
- **application build stage**: emit standalone Node/Vinext artifact and immutable client assets;
- **runtime stage**: copy only runtime Node modules/native SQLite dependency, standalone server, assets, migration metadata and runtime scripts.

The final image must contain no Wrangler/Miniflare dependency once the migration is complete.

Record in CI/PR evidence:

- image size;
- installed production package list or SBOM;
- Trivy result;
- exact image/commit identifier.

## Migration strategy

Implementation is staged to keep rollback cheap.

### Phase 0 — contract baseline

Before changing runtime behavior, add/confirm tests for:

- HTTP smoke and public route/API parity;
- auth/RBAC/session persistence;
- schema/readiness behavior;
- FreeIPA Gateway boundary;
- XYOps catalog/run contracts;
- scheduled catalog sync;
- restart/recreate persistence;
- SIGTERM;
- read-only root filesystem.

### Phase 1 — Node runtime spike behind an explicit test/profile path

Produce the standalone Node artifact and minimal adapters without making it the default production command. Run the same contract suite against both old and new runtime modes.

No product feature work is allowed in this phase.

### Phase 2 — persistence migration path

Add explicit SQLite data path and a safe migration utility/check from the existing local Wrangler state. Verify counts/schema/integrity before switching.

### Phase 3 — default production switch

Change Docker/Compose production command to the Node runtime only after parity tests are green. Keep the previous image tag/digest as the rollback target; do not keep Wrangler hidden as an automatic fallback inside the new image.

### Phase 4 — remove old runtime dependencies

Remove Wrangler/Miniflare and `.wrangler` production assumptions only after the new path is the tested default.

## Rollback

Rollback is image-level, not an automatic runtime fallback.

- retain the previous known-good image digest during rollout;
- database migration must be backward-readable or use a verified pre-switch copy/backup;
- on regression, stop the new container and redeploy the previous image against the verified compatible data copy;
- never silently start Wrangler from the new image when the Node runtime fails, because that would hide the production contract violation.

## Testing requirements

The implementation PR(s) must include automated evidence for:

- standalone image smoke test;
- clean database bootstrap;
- migration/adoption of existing database state;
- restart and full container recreate persistence;
- SIGTERM graceful shutdown and restart integrity;
- read-only root filesystem with only `/data` and `/tmp` writable;
- scheduler single-run/no-overlap semantics;
- liveness/readiness/dependency health behavior;
- local auth/RBAC/login/logout/restart behavior;
- FreeIPA Gateway contract tests;
- XYOps catalog/run/approval/cancel/result contracts;
- full Playwright Auth E2E suite;
- lint/build/full server suite;
- production dependency audit/SBOM/runtime-image scan established by #54.

The same behavioral scenarios should be runnable against the legacy and candidate runtime during the parity phase; source-text assertions alone are insufficient for the cutover decision.

## Security invariants

The runtime migration must not:

- move authorization into the browser;
- expose `ADMIN_TOKEN`, encryption material, portal session tokens, FreeIPA credentials/cookies, Gateway token or XYOps API key;
- weaken same-origin mutation checks, RBAC, audit, approval gates, schema fail-closed behavior or redaction;
- disable TLS verification to solve connectivity;
- add broad exception/fallback behavior merely to keep the container running.

## Consequences

Positive:

- production no longer depends on a development emulator;
- explicit SQLite ownership and persistence path;
- smaller and more auditable runtime image;
- conventional container signal/filesystem behavior;
- one runtime technology (Node) can own HTTP lifecycle and the existing FreeIPA Gateway;
- future network/acceptance work (#52/#61) gets a stable production process boundary.

Negative:

- a new infrastructure adapter must be maintained for the subset of D1 semantics used locally;
- Node-target Vinext behavior becomes part of the supported deployment contract and therefore needs dedicated tests;
- Cloudflare-specific capabilities such as image bindings require explicit decisions/adapters rather than being inherited from Miniflare.

## Rejected shortcuts

- keeping `wrangler dev` and only renaming it "production";
- calling `vinext start` as the final production contract if it remains a testing/dev-style launcher rather than an immutable standalone server artifact;
- storing the new SQLite file under `.wrangler` for compatibility;
- auto-fallback from Node runtime to Wrangler;
- rewriting all portal APIs into a new Node framework in the same task;
- changing database technology to PostgreSQL as part of #51.

## Follow-up implementation boundary

After this ADR is accepted, #51 should be executed as small reviewable implementation slices rather than one rewrite:

1. runtime parity harness + Node standalone build spike;
2. D1-compatible SQLite adapter + explicit data path;
3. scheduler and graceful lifecycle;
4. production Docker/read-only filesystem switch + persistence migration test;
5. remove Wrangler/Miniflare from runtime dependencies and complete rollback/operations documentation.

#51 remains open until all acceptance criteria and full exact-head tests pass.