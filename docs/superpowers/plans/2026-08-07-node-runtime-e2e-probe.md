# Standalone Node Auth E2E Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the mutation-heavy local auth/RBAC/XYOps browser scenarios against the standalone Node Worker host and determine whether removing `wrangler dev --local` eliminates #117 transport failures.

**Architecture:** Add a diagnostic-only Node launcher composed from the already-merged SQLite/D1/database/application/HTTP-host primitives, package it in a dedicated E2E Dockerfile, and run a focused Playwright subset through a dedicated Compose topology. Do not touch production Docker startup or the FreeIPA Gateway lifecycle owned by #175.

**Tech Stack:** Node.js 22, `node:sqlite`, Vinext Worker artifact, Node `http`, Docker Compose, Playwright, Node test runner.

## Global Constraints

- Diagnostic PR only; not a production merge candidate.
- No Wrangler/Miniflare in the request-serving path.
- No package-version changes.
- No `worker/index.ts` changes.
- No FreeIPA Gateway lifecycle implementation or edits to #175-owned files.
- No retry/timeout increases and no weakened assertions.
- Legacy `compose.e2e.yaml` remains untouched.
- SQLite data lives under `/data` and uses the existing canonical schema lifecycle.

---

### Task 1: Establish RED source contract

**Files:**
- Create: `tests/node-runtime-e2e-probe.test.mjs`

**Interfaces:**
- Consumes: repository source files only.
- Produces: source contract for the future diagnostic launcher, Dockerfile, Compose topology and focused spec set.

- [ ] **Step 1: Write the failing test**

Create a Node test that reads:

```js
const launcher = readFileSync(new URL("../scripts/start-node-e2e-runtime.mjs", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../e2e/Dockerfile.node-runtime", import.meta.url), "utf8");
const compose = readFileSync(new URL("../compose.e2e.node-probe.yaml", import.meta.url), "utf8");
const runner = readFileSync(new URL("../scripts/run-auth-e2e.sh", import.meta.url), "utf8");
```

Assert that the launcher references these exact canonical functions:

```text
createRuntimeApplication
createRuntimeDatabase
openNodeSqliteDriver
configureSqliteRuntimeDatabase
createD1SqliteAdapter
ensurePortalSchema
startNodeWorkerHost
```

Assert `/wrangler|Miniflare|miniflare/u` does not match the launcher or dashboard command path.

Assert Compose mounts `dashboard-e2e-node-data:/data` and Playwright command contains exactly:

```text
specs/auth.spec.mjs
specs/rbac-user.spec.mjs
specs/role-restrictions.spec.mjs
specs/xyops-lifecycle.spec.mjs
```

Assert the diagnostic branch runner defaults `COMPOSE_FILE` to `compose.e2e.node-probe.yaml`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/node-runtime-e2e-probe.test.mjs
```

Expected: FAIL with `ENOENT` for `scripts/start-node-e2e-runtime.mjs` or the diagnostic Docker/Compose artifact.

- [ ] **Step 3: Commit RED state**

```bash
git add tests/node-runtime-e2e-probe.test.mjs
git commit -m "test: define standalone Node E2E probe contract"
```

---

### Task 2: Compose the diagnostic Node runtime

**Files:**
- Create: `scripts/start-node-e2e-runtime.mjs`

**Interfaces:**
- Consumes:
  - `validateProductionEncryptionKey(value, { profile })`
  - `validateIdentityStartup(env)`
  - `createRuntimeApplication({ env, createDatabase, startHttp })`
  - `createRuntimeDatabase({ env, openDriver, configureDatabase, createAdapter, ensureSchema })`
  - `openNodeSqliteDriver(path)`
  - `configureSqliteRuntimeDatabase(driver)`
  - `createD1SqliteAdapter(driver)`
  - `ensurePortalSchema(env)`
  - `startNodeWorkerHost({ host, port, env })`
- Produces: standalone Node process serving the built Worker artifact on `HOST`/`PORT` with a ready SQLite-backed D1 binding.

- [ ] **Step 1: Implement the minimal launcher**

Use this composition shape:

```js
process.env.CONFIG_ENCRYPTION_KEY = validateProductionEncryptionKey(
  process.env.CONFIG_ENCRYPTION_KEY,
  { profile: process.env.PORTAL_RUNTIME_PROFILE },
);
const identityPolicy = validateIdentityStartup(process.env);
for (const warning of identityPolicy.warnings) console.warn(`[identity-policy] ${warning}`);

const env = {
  ...process.env,
  PORTAL_DATA_DIR: process.env.PORTAL_DATA_DIR || "/data",
  PORTAL_DATABASE_PATH: process.env.PORTAL_DATABASE_PATH || "/data/portal.sqlite",
};

const application = await createRuntimeApplication({
  env,
  createDatabase: ({ env: runtimeEnv }) => createRuntimeDatabase({
    env: runtimeEnv,
    openDriver: openNodeSqliteDriver,
    configureDatabase: configureSqliteRuntimeDatabase,
    createAdapter: createD1SqliteAdapter,
    ensureSchema: ensurePortalSchema,
  }),
  startHttp: ({ env: runtimeEnv }) => startNodeWorkerHost({
    host: process.env.HOST || "0.0.0.0",
    port: Number(process.env.PORT || 3001),
    env: runtimeEnv,
  }),
});
```

Add idempotent SIGTERM/SIGINT handling that awaits `application.close()` and reports only safe startup/shutdown errors.

- [ ] **Step 2: Run focused source contract**

```bash
node --test tests/node-runtime-e2e-probe.test.mjs
```

Expected: still FAIL because Docker/Compose artifacts are not present yet, but launcher-specific assertions pass.

- [ ] **Step 3: Commit launcher**

```bash
git add scripts/start-node-e2e-runtime.mjs
git commit -m "test: add standalone Node E2E launcher"
```

---

### Task 3: Add isolated Docker/Compose probe topology

**Files:**
- Create: `e2e/Dockerfile.node-runtime`
- Create: `compose.e2e.node-probe.yaml`
- Modify: `scripts/run-auth-e2e.sh`

**Interfaces:**
- Consumes: existing `.env.e2e`, `e2e/freeipa-mock.mjs`, `e2e/xyops-mock.mjs`, `e2e/Dockerfile`, and the diagnostic launcher.
- Produces: a disposable `/data` SQLite volume and focused Playwright execution against `http://127.0.0.1:3001`.

- [ ] **Step 1: Add diagnostic Dockerfile**

Build from Node 22, install dependencies, copy the repository, run the normal production build, create `/data`, switch to a non-root `dashboard` user, and run:

```dockerfile
CMD ["node", "--experimental-strip-types", "scripts/start-node-e2e-runtime.mjs"]
```

Do not install or invoke Wrangler as the server command.

- [ ] **Step 2: Add dedicated Compose topology**

Keep the existing FreeIPA and XYOps mock definitions. For `dashboard`:

```yaml
build:
  context: .
  dockerfile: e2e/Dockerfile.node-runtime
environment:
  NODE_ENV: production
  PORT: 3001
  HOST: 0.0.0.0
  PORTAL_RUNTIME_PROFILE: e2e
  PORTAL_DATA_DIR: /data
  PORTAL_DATABASE_PATH: /data/portal.sqlite
volumes:
  - dashboard-e2e-node-data:/data
```

For Playwright override the command to:

```yaml
command:
  - npx
  - playwright
  - test
  - specs/auth.spec.mjs
  - specs/rbac-user.spec.mjs
  - specs/role-restrictions.spec.mjs
  - specs/xyops-lifecycle.spec.mjs
```

- [ ] **Step 3: Point only this diagnostic branch at the probe**

Change the default in `scripts/run-auth-e2e.sh` to:

```bash
COMPOSE_FILE="${E2E_COMPOSE_FILE:-compose.e2e.node-probe.yaml}"
```

Do not edit the legacy compose file.

- [ ] **Step 4: Run the focused source contract**

```bash
node --test tests/node-runtime-e2e-probe.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit GREEN state**

```bash
git add e2e/Dockerfile.node-runtime compose.e2e.node-probe.yaml scripts/run-auth-e2e.sh tests/node-runtime-e2e-probe.test.mjs
git commit -m "test: run auth mutations on standalone Node runtime"
```

---

### Task 4: Collect exact-head GitHub evidence

**Files:**
- No production files.
- Update PR/issue discussion only.

**Interfaces:**
- Consumes: normal PR `CI`, `Auth E2E`, and `PR Collision Guard` checks plus retained `auth-e2e-report` artifact.
- Produces: accepted/rejected #117 runtime hypothesis.

- [ ] **Step 1: Verify normal CI**

Require the source contract, build/lint, security audit/SBOM, Trivy, recovery and all bounded shards to complete on one exact head.

- [ ] **Step 2: Inspect browser result, not only workflow conclusion**

The focused Auth E2E must complete with no retry. Inspect retained logs for:

```text
503
worker restarted mid-request
socket hang up
ERR_CONNECTION_REFUSED
Network connection lost
Broken pipe
Connection reset by peer
```

- [ ] **Step 3: Apply decision rule**

If the Node probe is clean, comment on #117 that removing Wrangler materially eliminates the transport class and hand production cutover back to #51. If it fails, identify whether failure is Node host, SQLite/D1 composition, or missing Gateway behavior; do not add retries/timeouts.

- [ ] **Step 4: Keep diagnostic PR unmerged**

Close or supersede the probe after evidence is recorded. A production runtime cutover must be a separate #51-owned PR with full FreeIPA/Gateway/runtime parity.