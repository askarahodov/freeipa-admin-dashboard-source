# Machine-readable API Route Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce one typed machine-readable inventory for the current portal HTTP API without changing request dispatch or authorization behavior.

**Architecture:** Add a metadata-only `portal-route-contract.ts` as the canonical route inventory owner. Existing Worker handlers remain the execution path; tests connect representative handler/path constants and `docs/reference/API.md` to the registry. The later router/middleware refactor remains #56.

**Tech Stack:** TypeScript, Node.js 22+, Node test runner (`node --test`), existing Worker/Vinext runtime, canonical `PortalPermission` from `portal-permissions.ts`.

## Global Constraints

- No endpoint addition, removal or rename.
- No request dispatcher/router replacement.
- No middleware-order change.
- No RBAC/auth/service-admin semantic change.
- No request/response schema duplication.
- `/api/integrations/routes` is automation-routing configuration, not the portal HTTP route registry.
- Existing handler/domain modules remain runtime owners.
- Dynamic approval/maintenance/restore/catalog-policy decisions stay in their domain handlers.
- Final merge requires exact-head CI and Auth E2E success.

---

## File structure

- Create `portal-route-contract.ts` — typed route metadata and exported registry/query helpers only.
- Create `tests/portal-route-contract.test.mjs` — registry integrity, security invariants and representative runtime parity.
- Modify `tests/documentation-reference-layer.test.mjs` — verify API reference against the registry instead of monolith source scraping.
- Modify `docs/reference/API.md` — identify the machine-readable registry as canonical metadata owner and remove #121-as-missing wording.
- Modify `docs/SOURCE_OF_TRUTH.md` — register route metadata ownership.
- Modify `docs/ARCHITECTURE.md` and `docs/PROJECT_STRUCTURE.md` only if current ownership text still claims no registry exists.

---

### Task 1: Define the typed route-contract invariants

**Files:**
- Create: `tests/portal-route-contract.test.mjs`
- Create later in GREEN: `portal-route-contract.ts`

**Interfaces:**
- Consumes: `PortalPermission` and canonical permission order from `portal-permissions.ts`.
- Produces: `portalRouteContracts`, `PortalRouteContract`, `PortalRouteAuthBoundary`, `findPortalRouteContract(method, pathPattern)`.

- [ ] **Step 1: Write the failing registry integrity test**

Create tests that import the future registry and assert:

```js
assert.ok(portalRouteContracts.length > 0);
assert.equal(new Set(portalRouteContracts.map((route) => route.id)).size, portalRouteContracts.length);
assert.equal(
  new Set(portalRouteContracts.map((route) => `${route.method} ${route.path}`)).size,
  portalRouteContracts.length,
);
```

Also assert every route:

```js
assert.match(route.id, /^[a-z0-9.-]+$/);
assert.match(route.path, /^\//);
assert.ok(["GET", "POST", "PUT", "DELETE"].includes(route.method));
assert.ok(["read", "mutation"].includes(route.mutation));
assert.equal(route.mutation === "read" && route.sameOrigin, false);
```

- [ ] **Step 2: Add security-invariant assertions**

For each contract with `permission`, assert it exists in `portalPermissionOrder`. For `auth === "service-admin"`, assert `permission === undefined`. For `sameOrigin === true`, assert `mutation === "mutation"`.

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
node --test tests/portal-route-contract.test.mjs
```

Expected: FAIL because `portal-route-contract.ts` does not exist.

- [ ] **Step 4: Commit the RED test**

```bash
git add tests/portal-route-contract.test.mjs
git commit -m "test: define portal route contract invariants"
```

---

### Task 2: Implement the metadata-only registry foundation

**Files:**
- Create: `portal-route-contract.ts`
- Test: `tests/portal-route-contract.test.mjs`

**Interfaces:**
- Consumes: `PortalPermission` from `portal-permissions.ts`.
- Produces:

```ts
export type PortalRouteMethod = "GET" | "POST" | "PUT" | "DELETE";
export type PortalRouteAuthBoundary =
  | "public"
  | "local-session"
  | "admin-session"
  | "service-admin"
  | "admin-or-service-admin";
export type PortalRouteMutation = "read" | "mutation";
export type PortalRouteContract = {
  id: string;
  method: PortalRouteMethod;
  path: string;
  owner: string;
  auth: PortalRouteAuthBoundary;
  permission?: PortalPermission;
  mutation: PortalRouteMutation;
  sameOrigin: boolean;
  errorOwner?: string;
};
export const portalRouteContracts: readonly PortalRouteContract[];
export function findPortalRouteContract(method: PortalRouteMethod, path: string): PortalRouteContract | undefined;
```

- [ ] **Step 1: Create the types and empty/seed registry implementation**

Use `satisfies readonly PortalRouteContract[]` so invalid permission/method/auth values fail TypeScript compilation.

- [ ] **Step 2: Seed only independently verified outer routes**

Start with:

```ts
{ id: "health.live", method: "GET", path: "/health/live", owner: "worker/health-contracts.ts", auth: "public", mutation: "read", sameOrigin: false }
{ id: "health.ready", method: "GET", path: "/health/ready", owner: "worker/health-contracts.ts", auth: "public", mutation: "read", sameOrigin: false }
{ id: "schema.status", method: "GET", path: "/api/schema/status", owner: "worker/schema-migrations-entry.ts", auth: "service-admin", mutation: "read", sameOrigin: false }
```

Do not add unverified route methods.

- [ ] **Step 3: Implement exact metadata lookup**

```ts
export function findPortalRouteContract(method, path) {
  return portalRouteContracts.find((route) => route.method === method && route.path === path);
}
```

This helper is metadata lookup only; runtime Worker code must not import it in #121.

- [ ] **Step 4: Run tests**

```bash
node --test tests/portal-route-contract.test.mjs
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal-route-contract.ts tests/portal-route-contract.test.mjs
git commit -m "feat: add machine-readable portal route contract"
```

---

### Task 3: Inventory auth, settings and directory route families

**Files:**
- Modify: `portal-route-contract.ts`
- Modify: `tests/portal-route-contract.test.mjs`
- Read/verify: `worker/local-secure-entry.ts`, `worker/session-management-entry.ts`, `worker/diagnostics-entry.ts`, settings wrapper files, `worker/index.ts`, FreeIPA query/bulk/group-member entries.

**Interfaces:**
- Consumes: registry types from Task 2 and canonical permissions from `portal-permissions.ts`.
- Produces: registered auth/settings/FreeIPA contracts.

- [ ] **Step 1: Add failing representative parity assertions**

Assert registry entries exist for exact verified paths such as:

```js
assert.equal(findPortalRouteContract("POST", "/api/auth/login")?.auth, "public");
assert.equal(findPortalRouteContract("GET", "/api/auth/users")?.auth, "admin-session");
assert.equal(findPortalRouteContract("GET", "/api/integrations/users")?.permission, "directory.read");
assert.equal(findPortalRouteContract("POST", "/api/integrations/freeipa/actions")?.permission, "freeipa.write");
```

Add separate entries where one route can require a stronger permission for a subset of operations only if static metadata can represent it honestly. Otherwise leave dynamic operation-specific authorization documented in the handler/test and use the stable outer permission boundary.

- [ ] **Step 2: Run and confirm RED for missing entries**

```bash
node --test tests/portal-route-contract.test.mjs
```

- [ ] **Step 3: Add verified contracts**

Populate local auth/users/sessions/diagnostics, settings/drafts/revisions/audit, and FreeIPA families from current handlers/tests.

Dynamic paths use patterns such as `/api/auth/users/:userId` and `/api/integrations/groups/members`.

- [ ] **Step 4: Re-run focused tests, lint and build**

```bash
node --test tests/portal-route-contract.test.mjs
npm run lint
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add portal-route-contract.ts tests/portal-route-contract.test.mjs
git commit -m "feat: inventory auth settings and directory routes"
```

---

### Task 4: Inventory XYOps, approvals, runs and notification families

**Files:**
- Modify: `portal-route-contract.ts`
- Modify: `tests/portal-route-contract.test.mjs`
- Read/verify: current XYOps/catalog/run/approval/notification handlers and tests.

**Interfaces:**
- Produces: catalog/run/approval/runs/files/notifications route metadata.

- [ ] **Step 1: Write failing parity assertions**

Include at minimum:

```js
assert.equal(findPortalRouteContract("POST", "/api/integrations/catalog/run")?.permission, "xyops.run");
assert.equal(findPortalRouteContract("GET", "/api/integrations/routes")?.permission, "settings.manage");
assert.equal(findPortalRouteContract("POST", "/api/integrations/approvals/:approvalId/approve")?.permission, "xyops.approve");
assert.equal(findPortalRouteContract("POST", "/api/integrations/runs/:runId/rerun")?.permission, "xyops.run");
```

- [ ] **Step 2: Confirm RED, then register exact verified contracts**

Keep `/api/integrations/routes` description/ID clearly tied to automation routing config, not HTTP registry ownership.

- [ ] **Step 3: Preserve dynamic gates as handler-owned**

Do not encode requester/approver separation, catalog visibility, replay eligibility or policy decisions as static registry booleans.

- [ ] **Step 4: Run focused tests, lint and build**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat: inventory automation and run routes"
```

---

### Task 5: Inventory backup, storage, schema and maintenance administration

**Files:**
- Modify: `portal-route-contract.ts`
- Modify: `tests/portal-route-contract.test.mjs`
- Read/verify: backup route roots/contracts, storage contract constants, schema migration entry and maintenance control handlers/tests.

**Interfaces:**
- Produces: administrative route metadata with portal-vs-service auth distinction.

- [ ] **Step 1: Write failing assertions using canonical literal storage paths**

Import or otherwise verify current constants for:

```text
/api/admin/storage/status
/api/admin/storage/integrity/check
/api/admin/storage/migrations/preflight
/api/admin/storage/migrations/apply
/api/admin/storage/migrations/apply/status
/api/admin/storage/migrations/apply/reconcile
```

- [ ] **Step 2: Verify exact methods for current `route-owned` backup entries**

Read the owning handler/tests before registering `/api/admin/backups/export`, preview, encrypted export/preview/test-restore. Do not infer method from name.

- [ ] **Step 3: Register selective restore and maintenance contracts**

Declare only stable outer auth/permission/same-origin metadata. Stage secrets, controller confirmation and recovery state remain handler-owned.

- [ ] **Step 4: Add service-admin separation assertions**

Ensure `/api/schema/status` stays `service-admin` and no service-admin-only contract claims a `PortalPermission`.

- [ ] **Step 5: Run focused tests, lint and build**

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: inventory administrative routes"
```

---

### Task 6: Connect the human API reference to the registry

**Files:**
- Modify: `tests/documentation-reference-layer.test.mjs`
- Modify: `docs/reference/API.md`

**Interfaces:**
- Consumes: `portalRouteContracts`.
- Produces: docs drift verification without Worker-monolith source scraping.

- [ ] **Step 1: Write the failing documentation drift test**

For every registered route, require `docs/reference/API.md` to contain the normalized path pattern. For representative routes also require the method token.

```js
for (const route of portalRouteContracts) {
  assert.ok(api.includes(`\`${route.path}\``), `missing API reference path: ${route.path}`);
}
```

- [ ] **Step 2: Update `API.md` ownership wording**

State that `portal-route-contract.ts` is the canonical machine-readable metadata owner while runtime dispatch remains distributed until #56.

Remove wording that describes #121 as a future missing registry.

- [ ] **Step 3: Run documentation/reference tests**

```bash
node --test tests/documentation-reference-layer.test.mjs tests/portal-route-contract.test.mjs
```

- [ ] **Step 4: Commit**

```bash
git add docs/reference/API.md tests/documentation-reference-layer.test.mjs
git commit -m "docs: bind API reference to route contract"
```

---

### Task 7: Register canonical ownership in engineering docs

**Files:**
- Modify: `docs/SOURCE_OF_TRUTH.md`
- Modify if stale: `docs/ARCHITECTURE.md`
- Modify if stale: `docs/PROJECT_STRUCTURE.md`
- Test: extend an existing documentation contract or `tests/portal-route-contract.test.mjs` with source-of-truth assertions only where useful.

**Interfaces:**
- Produces: canonical ownership rule for future agents and #56.

- [ ] **Step 1: Update source-of-truth registry**

Add a row stating:

```text
Portal HTTP route metadata -> portal-route-contract.ts
Runtime route behavior -> owning Worker/domain handler + tests
```

- [ ] **Step 2: Remove stale architecture claims**

If current docs still say “a single declarative API/permission registry does not yet exist,” narrow the statement: route metadata now has a registry; runtime routing remains distributed and #56 is still open.

- [ ] **Step 3: Add/adjust docs guard**

Ensure future docs cannot revert to claiming no route metadata registry exists while `portal-route-contract.ts` remains present.

- [ ] **Step 4: Run focused docs tests**

- [ ] **Step 5: Commit**

```bash
git commit -am "docs: register route metadata source of truth"
```

---

### Task 8: Final verification and merge gate

**Files:**
- No new implementation scope unless verification finds a defect.

- [ ] **Step 1: Verify branch overlap with active PRs and latest `main`**

Inspect all files changed by the candidate and concurrent PRs. If `main` moved, sync before final evidence and re-run exact-head checks.

- [ ] **Step 2: Run local/CI commands**

```bash
npm ci
npm run lint
npm run build
node --test tests/portal-route-contract.test.mjs tests/documentation-reference-layer.test.mjs
node --test
```

Expected: all PASS.

- [ ] **Step 3: Inspect exact PR diff**

Confirm there are no runtime dispatcher changes, endpoint changes, new auth bypasses, secrets, internal production URLs or unrelated UI changes.

- [ ] **Step 4: Require exact-head GitHub checks**

CI and Auth E2E must both complete successfully on the exact candidate head that will be merged.

- [ ] **Step 5: Merge with expected head SHA**

Use the repository-supported merge method and expected-head protection. Confirm #121 closes and `main` contains the route registry.
