# Production Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace production `wrangler dev --local` with a standalone Node lifecycle that hosts the immutable Vinext Worker artifact, supplies explicit local SQLite/D1 and asset bindings, preserves scheduled catalog sync, and runs from a read-only production image.

**Architecture:** Preserve `dist/server/index.js` as the behavioral Worker boundary and replace only the hosting capabilities currently supplied by Wrangler/Miniflare. A Node launcher converts Node HTTP requests to Web `Request`, supplies a narrow D1-compatible SQLite adapter and immutable asset fetcher, invokes the existing `fetch`/`scheduled` exports, and owns Gateway/scheduler/database shutdown. Production cutover happens only after the same behavior suite passes against legacy and candidate runtime modes.

**Tech Stack:** Node.js >=22.13.0, Vinext 0.0.50 Worker bundle, Web Request/Response APIs, SQLite through a dedicated infrastructure adapter, Docker multi-stage build, node:test, Playwright, existing schema/health/security contracts.

## Global Constraints

- Do not change public API, auth/RBAC, same-origin, approval, audit or redaction semantics.
- Do not move FreeIPA/XYOps credentials or session material into browser state.
- Do not make the candidate Node runtime the production default until parity, persistence, SIGTERM, read-only filesystem, Trivy and full Playwright gates pass.
- `/data` is the only persistent writable application path; `/tmp` is temporary writable state.
- No automatic fallback from the new Node runtime to Wrangler.
- Canonical migrations remain the only schema owner.
- Existing Node baseline remains `>=22.13.0`.

---

### Task 1: Worker-bundle Node HTTP parity host

**Files:**
- Create: `scripts/node-runtime-http.mjs`
- Create: `scripts/node-worker-host.mjs`
- Test: `tests/node-runtime-http.test.mjs`
- Test: `tests/node-worker-host-contract.test.mjs`

**Interfaces:**
- Produces: `createExecutionContext()`, `nodeRequestToWebRequest(req, origin)`, `writeWebResponse(res, response)`, `createStaticAssetsFetcher(root)`, `startNodeWorkerHost(options)`.
- `startNodeWorkerHost` accepts `{ artifactPath, assetsRoot, env, host, port }` and returns `{ server, address, close }`.

- [ ] **Step 1: Write failing adapter tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionContext, createStaticAssetsFetcher } from "../scripts/node-runtime-http.mjs";

test("execution context drains waitUntil promises", async () => {
  const ctx = createExecutionContext();
  let completed = false;
  ctx.waitUntil(Promise.resolve().then(() => { completed = true; }));
  await ctx.drain();
  assert.equal(completed, true);
});

test("static assets fetcher rejects traversal", async () => {
  const assets = createStaticAssetsFetcher("/tmp/runtime-assets");
  const response = await assets.fetch(new Request("http://portal/../secret"));
  assert.equal(response.status, 404);
});
```

- [ ] **Step 2: Run RED tests**

Run: `node --test tests/node-runtime-http.test.mjs tests/node-worker-host-contract.test.mjs`

Expected: FAIL because the Node runtime modules do not exist.

- [ ] **Step 3: Implement the minimal Web HTTP/ExecutionContext/assets adapters**

```js
export function createExecutionContext() {
  const pending = new Set();
  return {
    waitUntil(promise) {
      const tracked = Promise.resolve(promise).finally(() => pending.delete(tracked));
      pending.add(tracked);
    },
    passThroughOnException() {},
    async drain() { await Promise.allSettled([...pending]); },
  };
}
```

The asset fetcher must resolve only files below `assetsRoot`, map MIME types for HTML/CSS/JS/JSON/SVG/common images/fonts, return `404` for missing/traversal paths, and never expose arbitrary filesystem paths.

- [ ] **Step 4: Implement an explicit candidate host**

`node-worker-host.mjs` must import the immutable `dist/server/index.js` default export, start `node:http`, convert each request to a Web `Request`, invoke `worker.fetch(request, env, ctx)`, stream the Web `Response` back, drain `waitUntil`, and close cleanly. It must not invoke Wrangler, Vite or a build command.

- [ ] **Step 5: Run GREEN tests and commit**

Run: `node --test tests/node-runtime-http.test.mjs tests/node-worker-host-contract.test.mjs`

Expected: PASS.

Commit: `feat: add candidate Node host for built Worker artifact`

---

### Task 2: Runtime parity harness

**Files:**
- Create: `scripts/runtime-parity-smoke.mjs`
- Create: `tests/runtime-parity-contract.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `runRuntimeSmoke({ command, env, expectedRuntime })` with assertions for `/health/live`, anonymous API status, HTML/login behavior and process shutdown.

- [ ] **Step 1: Write a failing contract requiring two explicit runtime modes**

```js
assert.match(packageJson.scripts["test:runtime:parity"], /runtime-parity-smoke\.mjs/);
assert.match(source, /legacy/);
assert.match(source, /candidate/);
assert.doesNotMatch(candidateCommand, /wrangler|vite|\bdev\b/);
```

- [ ] **Step 2: Implement smoke harness**

Legacy mode runs the current production launcher. Candidate mode runs `node scripts/node-worker-host.mjs` against a prebuilt artifact. The first candidate milestone may exercise only DB-independent endpoints; DB-dependent parity is added in Task 4.

- [ ] **Step 3: Add CI job after build artifact creation**

The CI job must reuse the existing built `dist` artifact and run the candidate host without rebuilding source.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/runtime-parity-contract.test.mjs && npm run build && npm run test:runtime:parity`

Expected: PASS for the defined Phase-1 DB-independent contract.

Commit: `test: add legacy and candidate runtime parity harness`

---

### Task 3: D1 API surface inventory and SQLite adapter contract

**Files:**
- Create: `runtime/sqlite-d1.mjs`
- Create: `tests/sqlite-d1.test.mjs`
- Create: `docs/D1_SQLITE_ADAPTER.md`

**Interfaces:**
- Produces: `openD1Database({ path })` returning a D1-compatible object with only `prepare`, `batch`, and `exec` plus prepared statement methods `bind`, `first`, `all`, `run` proven by repository usage.

- [ ] **Step 1: Freeze the actual required method surface in a test**

The current built Worker uses `prepare`, `batch`, `exec` and prepared-statement `bind`, `first`, `all`, `run`. The adapter test must fail if unsupported methods are silently added to the public surface.

- [ ] **Step 2: Add behavior tests**

Cover positional binding, `first()` null behavior, `all()` `{ results }`, mutation metadata returned by `run()`, ordered `batch()`, multi-statement `exec()`, SQL errors, file persistence across close/reopen, and rejection of use after close.

- [ ] **Step 3: Implement adapter with one SQLite owner**

Use a maintained Node SQLite driver supported by Node 22.13 and pin its exact production version. Domain modules must receive the D1-compatible object and must not import the driver directly.

- [ ] **Step 4: Configure explicit persistence**

Default path: `/data/portal.sqlite`. Tests use a temporary directory. Enable only explicitly documented pragmas; if WAL is enabled, test recreate/recovery and checkpoint-on-close behavior.

- [ ] **Step 5: Run tests/security checks and commit**

Run: `npm ci && npm ls --omit=dev && npm run security:audit && node --test tests/sqlite-d1.test.mjs`

Expected: PASS with no new unhandled HIGH/CRITICAL production advisory.

Commit: `feat: add narrow SQLite-backed D1 adapter`

---

### Task 4: Candidate runtime with schema, auth and persistence parity

**Files:**
- Modify: `scripts/node-worker-host.mjs`
- Modify: `scripts/runtime-parity-smoke.mjs`
- Test: `tests/node-runtime-persistence.test.mjs`
- Test: existing schema/local-auth tests

**Interfaces:**
- Candidate env receives `DB` from `openD1Database`, `ASSETS` from `createStaticAssetsFetcher`, and existing secret/integration variables unchanged.

- [ ] **Step 1: Add failing clean-database bootstrap test**

Start candidate runtime on an empty SQLite file with explicit test bootstrap credentials. Assert readiness reaches healthy only after canonical migrations and local admin bootstrap complete.

- [ ] **Step 2: Add restart persistence test**

Create/authenticate local state, terminate runtime, start a new process against the same database path, and assert the stored state remains readable without re-bootstrap mutation.

- [ ] **Step 3: Wire DB and schema lifecycle into candidate launcher**

Security validation occurs before public listen; schema readiness occurs before ordinary API traffic is accepted.

- [ ] **Step 4: Expand parity smoke to authenticated/RBAC/schema endpoints**

Run identical scenarios against legacy and candidate modes and compare status classes, redirects, cookie semantics and safe response fields rather than unstable timestamps/IDs.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:local-auth:acceptance && node --test tests/node-runtime-persistence.test.mjs && npm run test:runtime:parity`

Commit: `feat: provide SQLite bindings to candidate Node runtime`

---

### Task 5: Scheduler and graceful lifecycle

**Files:**
- Create: `runtime/scheduler.mjs`
- Modify: `scripts/node-worker-host.mjs`
- Test: `tests/runtime-scheduler.test.mjs`
- Test: `tests/runtime-shutdown.test.mjs`

**Interfaces:**
- Produces: `createNonOverlappingScheduler({ intervalMs, run, isReady, now })` with `start()`, `stop()`, `runNow()` and safe status metadata.

- [ ] **Step 1: Write scheduler RED tests**

Assert no overlap, skip while unready, failed run does not permanently stop future scheduling, and `stop()` prevents new work.

- [ ] **Step 2: Invoke the existing Worker `scheduled()` export**

The scheduler creates a Workers-compatible controller payload and execution context, then calls the same artifact's `scheduled(controller, env, ctx)` path.

- [ ] **Step 3: Add SIGTERM test**

Assert readiness withdrawal, listener close, scheduler stop, Gateway close, SQLite close/checkpoint and bounded process exit.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/runtime-scheduler.test.mjs tests/runtime-shutdown.test.mjs`

Commit: `feat: add scheduled sync and graceful Node runtime shutdown`

---

### Task 6: Safe persistence adoption from legacy Wrangler state

**Files:**
- Create: `scripts/adopt-wrangler-d1.mjs`
- Create: `tests/runtime-storage-adoption.test.mjs`
- Create: `docs/PRODUCTION_RUNTIME_MIGRATION.md`

**Interfaces:**
- Produces a read-only preflight result and an explicit copy/verify/switch command. It never guesses among multiple legacy DB files and never mutates the source database.

- [ ] **Step 1: Write fixtures for zero/one/multiple legacy database candidates**

Zero or multiple candidates must fail with a safe diagnostic. Exactly one candidate proceeds only after SQLite integrity and canonical schema compatibility checks.

- [ ] **Step 2: Implement copy/verify/switch staging**

Copy source to a temporary file under the target data directory, open the copy, run integrity/schema checks and record counts/checksum metadata before atomic rename to `portal.sqlite`.

- [ ] **Step 3: Add rollback evidence test**

Keep source unchanged, prove old runtime test fixture remains readable, and prove failed verification never replaces an existing target.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/runtime-storage-adoption.test.mjs`

Commit: `feat: add safe legacy D1 storage adoption path`

---

### Task 7: Production Docker cutover and read-only filesystem

**Files:**
- Modify: `Dockerfile`
- Modify: `compose.yaml`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml`
- Test: `tests/production-node-runtime.test.mjs`
- Create: `scripts/node-runtime-compose-smoke.mjs`

**Interfaces:**
- Production command becomes direct Node launcher only after all prior tasks are green.

- [ ] **Step 1: Add RED source/runtime contract**

Assert final production command contains neither Wrangler nor `dev`, final image does not include Vite/Drizzle Kit/Wrangler, and Compose mounts an explicit data volume to `/data`.

- [ ] **Step 2: Change final runtime image**

Copy only immutable artifact/assets, runtime scripts, migrations and production dependencies. Run as non-root. Remove writable `.wrangler` assumptions.

- [ ] **Step 3: Add read-only container smoke**

Run the final image with `--read-only`, writable `/data`, and tmpfs `/tmp`. Verify live/ready, authenticated restart persistence and SIGTERM.

- [ ] **Step 4: Reuse #54 supply-chain gates**

Build the exact final runtime target, run production npm audit/SBOM and Trivy HIGH/CRITICAL gate.

- [ ] **Step 5: Run full acceptance and commit**

Run: `npm run lint && npm run build && npm test && npm run test:e2e:auth && node scripts/node-runtime-compose-smoke.mjs`

Commit: `feat: switch production image to standalone Node runtime`

---

### Task 8: Final cleanup and operations evidence

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: runtime/security/operations docs impacted by #51
- Test: full exact-head CI/Auth E2E

- [ ] **Step 1: Remove Wrangler/Miniflare production dependency and legacy runtime-only scripts**

Development tooling may remain only if still required for supported development/build paths; production dependency tree must not include Wrangler solely for hosting.

- [ ] **Step 2: Update runtime documentation**

Document `/data`, `/tmp`, startup order, scheduler, health probes, SIGTERM, image rollback and legacy-data adoption. Do not describe development emulation as production.

- [ ] **Step 3: Record image/package evidence**

Capture final image size, production SBOM, Trivy result and exact commit/image identifier in the PR.

- [ ] **Step 4: Run exact-head merge gates**

Require `CI / Required CI` and `Auth E2E / auth-e2e` success on the exact candidate head, with no unresolved review threads.

- [ ] **Step 5: Merge and close #51**

Only after exact-head gates and rollback evidence are complete.

Commit: `docs: finalize production runtime operations contract`
