# Standalone Node Auth E2E Probe Design

## Context

Issue #117 still reproduces request-transport failures while the application runs under `wrangler dev --local`: transient HTTP 503, `socket hang up`, `ERR_CONNECTION_REFUSED`, `Network connection lost`, and Workerd `Broken pipe` / `Connection reset by peer`. Diagnostic PR #172 tested Wrangler 4.118.0 and made the failure class worse, so dependency bumping is rejected as a fix path.

The accepted runtime ADR (#120) selected a standalone Node runtime. The required building blocks are already merged:

- Node HTTP Worker host (#122);
- scheduler/shutdown lifecycle (#164);
- D1/SQLite adapter (#160);
- persistent SQLite store boundary (#166);
- built-in Node SQLite driver compatibility spike (#167);
- runtime DB composition (#171);
- runtime application composition (#174).

PR #175 independently owns FreeIPA Gateway lifecycle extraction. This probe must not duplicate or edit that ownership.

## Goal

Run the mutation-heavy local authentication/RBAC/XYOps browser scenarios against the standalone Node Worker host with the SQLite/D1 composition, with Wrangler/Miniflare absent from the request-serving path.

The probe answers one question only:

> Does removing `wrangler dev --local` eliminate the restart/socket-loss class seen in #117?

## Scope

### Included

- a diagnostic-only Node runtime launcher composed from already-merged runtime primitives;
- a diagnostic Dockerfile that contains source/runtime modules required by the launcher;
- a dedicated E2E Compose file so the legacy `compose.e2e.yaml` baseline remains untouched;
- the existing mock services and Playwright image;
- focused browser scenarios that do not require the still-owned FreeIPA Gateway lifecycle:
  - `auth.spec.mjs`;
  - `rbac-user.spec.mjs`;
  - `role-restrictions.spec.mjs`;
  - `xyops-lifecycle.spec.mjs`;
- retained Compose and Playwright artifacts through the existing Auth E2E harness.

### Excluded

- production Docker CMD changes;
- package or Wrangler version changes;
- modifications to `worker/index.ts`;
- FreeIPA Gateway lifecycle implementation;
- full FreeIPA CRUD browser coverage;
- scheduler production wiring;
- retry or timeout increases;
- weakened RBAC/destructive-operation assertions;
- changes to required GitHub workflows.

## Architecture

`scripts/start-node-e2e-runtime.mjs` composes existing modules only:

1. validate the existing encryption-key and identity startup policies;
2. create a SQLite runtime database using `openNodeSqliteDriver`;
3. configure WAL/synchronous/foreign-key/busy-timeout through `configureSqliteRuntimeDatabase`;
4. expose the DB through `createD1SqliteAdapter`;
5. run canonical `ensurePortalSchema`;
6. inject the ready DB into `createRuntimeApplication`;
7. start the built Worker artifact through `startNodeWorkerHost` on port 3001;
8. close HTTP before DB on SIGTERM/SIGINT via the application composition.

The diagnostic launcher must not import or execute Wrangler/Miniflare.

`compose.e2e.node-probe.yaml` uses a dedicated `e2e/Dockerfile.node-runtime` for the dashboard service and mounts a disposable volume at `/data`. The Playwright service runs only the four mutation-heavy specs listed above. Mock XYOps remains available through the current host-network E2E topology.

`scripts/run-auth-e2e.sh` is changed only on this diagnostic branch so its default compose file is the Node probe compose. The PR is not a merge candidate; after evidence is collected it is closed or superseded by a production runtime integration PR.

## Error handling

Startup must fail closed if:

- encryption/identity policy validation fails;
- the SQLite driver cannot open/configure the database;
- canonical schema readiness is not `ready`;
- the Worker HTTP host cannot start.

The launcher logs only safe startup/shutdown messages and relies on existing runtime modules for request error normalization. It must not expose database contents, secrets, tokens, SQL, or raw credentials.

## Test strategy

### RED contract

Before implementation, add `tests/node-runtime-e2e-probe.test.mjs` that requires the future launcher, diagnostic Dockerfile, and Compose topology. The first CI run must fail because these artifacts do not exist yet.

### GREEN contract

The focused source contract must prove:

- the launcher uses the canonical runtime composition modules;
- no `wrangler` or `miniflare` appears in the launcher/diagnostic Compose command path;
- `/data` is the owned SQLite persistence root;
- the diagnostic browser set contains the four exact specs and does not silently fall back to the full legacy suite;
- the legacy `compose.e2e.yaml` remains unchanged.

### Runtime decision rule

A Node-runtime probe is positive evidence only if the exact-head Auth E2E run:

- completes the four scenarios without Playwright retry;
- produces no HTTP 503 caused by runtime restart;
- produces no `socket hang up`, `ERR_CONNECTION_REFUSED`, or `Network connection lost`;
- produces no Workerd restart/disconnect messages, because Workerd is not serving requests.

If the probe fails for a Node-host/application defect, diagnose that defect separately. If it succeeds cleanly, #117 gains strong evidence that the legacy Wrangler/Workerd serving path is the source of the transport instability and production cutover work under #51 should be prioritized.

## Coordination

- #117 owns the diagnostic conclusion.
- #51 owns production runtime cutover.
- #175 owns FreeIPA Gateway lifecycle extraction.
- This probe must not modify files owned by #175.
- The PR remains diagnostic and must not be merged merely because the probe is green.