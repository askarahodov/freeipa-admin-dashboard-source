# Destructive Offline Full Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a fail-closed offline CLI that restores a complete encrypted portal backup into the stopped local Wrangler/D1 SQLite volume, creates a mandatory encrypted recovery point, swaps files atomically, verifies the restarted portal, and supports deterministic rollback.

**Architecture:** Keep recovery as focused pure contracts plus bounded Node adapters. The dashboard runtime and recovery process coordinate through an OS-held `flock`; offline commands discover the canonical SQLite file, validate/decrypt the existing encrypted backup format, create and verify an encrypted raw-SQLite recovery point, build a candidate by cloning the stopped database, replace only approved portal tables, verify the candidate, and perform a receipt-driven atomic swap. The Worker remains in persistent maintenance until an explicit `verify` command completes existing maintenance transitions.

**Tech Stack:** Node.js 22.13+, TypeScript ESM with explicit `.ts` imports, Node test runner, WebCrypto for existing logical-backup decryption, Node `crypto` streams for raw recovery-point encryption, Debian `sqlite3` CLI, util-linux `flock`, Docker multi-stage builds, Docker Compose profiles, Cloudflare Wrangler local D1 persistence.

## Global Constraints

- Target only the local named volume mounted at `/app/.wrangler`; remote Cloudflare D1 is unsupported.
- All imports between TypeScript modules include the `.ts` suffix.
- Destructive restore accepts only an encrypted backup containing every `PORTAL_BACKUP_DOMAINS` entry exactly once in canonical order.
- Wrong password, damaged ciphertext and invalid authentication tag return the same safe external code `recovery_backup_decryption_failed`.
- Secret values are read only from non-symlink regular files with mode `0600`, bounded size, and never appear in argv, stdout, stderr, receipts, logs or audit.
- Every mutating recovery command must hold an exclusive kernel `flock`; no `--force-running`, `--ignore-lock`, `--skip-recovery-point`, `--ignore-checksum` or `--ignore-schema` option exists.
- The recovery artifact directory must be outside the live persistence root.
- The live SQLite database is never mutated before candidate verification succeeds.
- The current migration journal, Miniflare/D1 internal schema and matching maintenance operation/controller hash are preserved from the stopped live database.
- Incoming historical `portal_sessions` rows are validated but never inserted; all sessions are empty after restore.
- Unfinished selective-restore stage state is cleared by an explicit physical policy.
- Production fault injection is forbidden; tests inject failures through dependency objects only.
- Any failure before maintenance completion leaves the portal fail-closed.
- Each task ends with focused tests, full relevant tests and a commit.

---

## File Structure

### New recovery contracts

- `recovery-errors.ts` — normalized safe error/result model.
- `recovery-paths.ts` — canonical roots, containment and symlink-safe path validation.
- `recovery-secrets.ts` — mode-0600 secret-file loading and exact value rules.
- `recovery-lock.ts` — `flock` command construction and child lifetime handling.
- `recovery-sqlite.ts` — bounded `sqlite3` subprocess adapter, query/checkpoint/backup primitives.
- `recovery-discovery.ts` — canonical database discovery without filename assumptions.
- `recovery-backup-source.ts` — full-domain encrypted logical-backup validation/decryption.
- `recovery-schema-adapters.ts` — exact supported source-layout registry.
- `recovery-preflight.ts` — immutable preflight aggregation.
- `recovery-receipt.ts` — canonical versioned receipt validation and atomic updates.
- `recovery-point.ts` — encrypted raw-SQLite recovery-point creation/verification.
- `recovery-restore-policy.ts` — physical table allowlist, ordering and cleanup rules.
- `recovery-candidate.ts` — clone, populate and validate candidate SQLite.
- `recovery-swap.ts` — atomic rename/fsync and retained rollback handling.
- `recovery-reconcile.ts` — crash-phase inspection and deterministic continuation/rollback.
- `recovery-online-verification.ts` — bounded HTTP verification and maintenance transitions.
- `recovery-maintenance.ts` — offline failed-maintenance recovery policy.

### New entrypoints and tests

- `scripts/portal-recovery.ts` — CLI parser and command orchestration only.
- `scripts/run-portal-runtime.mjs` — runtime `flock` wrapper around Wrangler.
- `tests/recovery-*.test.mjs` — unit/source/integration contracts.
- `scripts/recovery-compose-smoke.mjs` — real-volume integration scenario.

### Existing files modified

- `scripts/start-worker.mjs` — start Wrangler through the runtime lock wrapper.
- `worker/maintenance-control-dispatch.ts` — bounded verification-smoke route.
- `worker/maintenance-control-entry.ts` — authorization and request parsing for verification smoke.
- `maintenance-repository.ts` — offline-safe recovery transition helper with guarded audit mutation.
- `Dockerfile` — util-linux in runtime and dedicated recovery target with sqlite3.
- `compose.yaml` — opt-in `recovery` profile and bind mounts.
- `package.json` — recovery and recovery-test commands.
- `.github/workflows/ci.yml` — recovery unit/source tests and Compose smoke gate.
- `README.md`, `docs/MAINTENANCE_MODE.md`, `docs/PRODUCT_ROADMAP.md` — operational documentation.

---

### Task 1: Safe CLI Inputs, Paths and Results

**Files:**
- Create: `recovery-errors.ts`
- Create: `recovery-paths.ts`
- Create: `recovery-secrets.ts`
- Test: `tests/recovery-input-contract.test.mjs`
- Test: `tests/recovery-source-contract.test.mjs`

**Interfaces:**
- Produces: `RecoveryError`, `safeRecoveryFailure(error)`, `canonicalRecoveryResult(value)`.
- Produces: `resolveRecoveryRoots({ dataRoot, artifactRoot, secretsRoot })` returning real absolute roots.
- Produces: `resolveContainedRegularFile(root, inputPath, purpose)`.
- Produces: `readSecretFile({ root, path, maxBytes, trimFinalNewline })`.
- Consumes: only Node `fs/promises`, `path`, `crypto`; no project runtime or database imports.

- [ ] **Step 1: Write the failing input-contract tests**

```js
import { readFile, chmod, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const paths = await import("../recovery-paths.ts");
const secrets = await import("../recovery-secrets.ts");

test("recovery roots reject artifact storage inside live data", async () => {
  assert.throws(
    () => paths.resolveRecoveryRoots({ dataRoot: fixtureData, artifactRoot: `${fixtureData}/recovery`, secretsRoot: fixtureSecrets }),
    (error) => error.code === "recovery_roots_invalid",
  );
});

test("secret loader rejects symlink and group-readable files", async () => {
  await writeFile(secretPath, "value\n", { mode: 0o640 });
  await assert.rejects(() => secrets.readSecretFile({ root: fixtureSecrets, path: "secret", maxBytes: 1024, trimFinalNewline: true }),
    (error) => error.code === "recovery_secret_permissions_invalid");
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --experimental-strip-types --test tests/recovery-input-contract.test.mjs`

Expected: FAIL with module-not-found for `recovery-paths.ts` or `recovery-secrets.ts`.

- [ ] **Step 3: Implement normalized errors and root containment**

```ts
export class RecoveryError extends Error {
  constructor(
    readonly code: string,
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = "RecoveryError";
  }
}

export type RecoveryRoots = {
  dataRoot: string;
  artifactRoot: string;
  secretsRoot: string;
};

export function resolveRecoveryRoots(input: RecoveryRoots): RecoveryRoots;
export function resolveContainedRegularFile(root: string, inputPath: string, purpose: string): Promise<string>;
```

Containment must compare `realpath` values plus a path-separator suffix, reject equal/nested data and artifact roots, reject symlinks with `lstat`, reject devices/FIFOs/sockets and limit non-secret path length to 4096 bytes.

- [ ] **Step 4: Implement exact secret-file rules**

```ts
export async function readSecretFile(input: {
  root: string;
  path: string;
  maxBytes: number;
  trimFinalNewline: boolean;
}): Promise<string>;
```

Open with `O_RDONLY | O_NOFOLLOW`, compare `fstat` before and after read, require owner permission bits exactly `0600`, allow one terminal `\n` only when `trimFinalNewline` is true, reject NUL and empty values, zero the temporary `Buffer` in `finally`.

- [ ] **Step 5: Add source-contract assertions**

Assert recovery input modules do not import Worker roots, do not use `console.log` for secret values, and contain no bypass option names from Global Constraints.

- [ ] **Step 6: Run focused tests and lint**

Run:

```bash
node --experimental-strip-types --test tests/recovery-input-contract.test.mjs tests/recovery-source-contract.test.mjs
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add recovery-errors.ts recovery-paths.ts recovery-secrets.ts tests/recovery-input-contract.test.mjs tests/recovery-source-contract.test.mjs
git commit -m "feat: add safe offline recovery inputs"
```

---

### Task 2: Kernel-Held Runtime and Recovery Lock

**Files:**
- Create: `recovery-lock.ts`
- Create: `scripts/run-portal-runtime.mjs`
- Modify: `scripts/start-worker.mjs`
- Modify: `Dockerfile`
- Test: `tests/recovery-lock.test.mjs`
- Test: `tests/recovery-runtime-lock-source.test.mjs`

**Interfaces:**
- Produces: `runWithRecoveryLock({ lockPath, mode, command, args, env, stdio })`.
- Produces: `probeRecoveryLock(lockPath)` returning `{ available: boolean }`.
- Runtime wrapper exits `75` when the recovery lock is held.

- [ ] **Step 1: Write RED tests using two child processes**

```js
test("runtime and recovery cannot hold the same flock", async () => {
  const holder = spawn(process.execPath, [fixtureHolder, lockPath, "1500"]);
  await waitForLine(holder.stdout, "locked");
  const contender = await runProbe(lockPath);
  assert.equal(contender.exitCode, 75);
});

test("OS releases the lock after holder termination", async () => {
  holder.kill("SIGKILL");
  await once(holder, "exit");
  assert.equal((await runProbe(lockPath)).exitCode, 0);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types --test tests/recovery-lock.test.mjs`

Expected: FAIL because lock adapter is missing.

- [ ] **Step 3: Implement the bounded `flock` adapter**

```ts
export type RecoveryLockMode = "runtime" | "recovery";
export async function runWithRecoveryLock(input: {
  lockPath: string;
  mode: RecoveryLockMode;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe";
}): Promise<number>;
```

Spawn `/usr/bin/flock` with `--exclusive --nonblock --close` disabled so the child holds the descriptor for its lifetime. Use `--` before the command, do not invoke a shell, forward SIGTERM/SIGINT, and normalize contention to `recovery_lock_busy`/exit `75`.

- [ ] **Step 4: Route Wrangler through the runtime wrapper**

`start-worker.mjs` continues to own the FreeIPA gateway and environment file, but its child command becomes:

```js
spawn(process.execPath, [
  "scripts/run-portal-runtime.mjs",
  "/app/.wrangler/.portal-exclusive.lock",
  process.execPath,
  wrangler,
  "dev",
  // existing args
], { stdio: "inherit", env: runtimeEnv });
```

The wrapper itself invokes `flock`; no stale lock-file deletion exists.

- [ ] **Step 5: Install `util-linux` in runtime image**

Use a single apt layer:

```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends util-linux \
 && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 6: Run lock, source, build and existing startup tests**

Run:

```bash
node --experimental-strip-types --test tests/recovery-lock.test.mjs tests/recovery-runtime-lock-source.test.mjs
npm run build
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add recovery-lock.ts scripts/run-portal-runtime.mjs scripts/start-worker.mjs Dockerfile tests/recovery-lock.test.mjs tests/recovery-runtime-lock-source.test.mjs
git commit -m "feat: coordinate runtime and recovery with flock"
```

---

### Task 3: SQLite Adapter and Canonical Database Discovery

**Files:**
- Create: `recovery-sqlite.ts`
- Create: `recovery-discovery.ts`
- Test: `tests/recovery-sqlite.test.mjs`
- Test: `tests/recovery-discovery.test.mjs`

**Interfaces:**
- Produces: `runSqlite({ databasePath, mode, script, maxOutputBytes })`.
- Produces: `backupSqliteDatabase(sourcePath, destinationPath)` using `.backup`.
- Produces: `checkpointSqlite(databasePath)` and `verifySqliteIntegrity(databasePath)`.
- Produces: `discoverPortalDatabase({ dataRoot, maxDepth, maxFiles, sqlite })`.

- [ ] **Step 1: Write fixture-based RED tests**

Create temporary SQLite databases through the real `sqlite3` binary. Cover zero candidates, one canonical candidate, two canonical candidates, fake `.sqlite` text, symlinks, depth overflow and output overflow.

```js
test("discovery succeeds only for one canonical portal database", async () => {
  await createCanonicalFixture(`${root}/state/v3/d1/hash.sqlite`);
  assert.equal(await discoverPortalDatabase({ dataRoot: root }), realDatabasePath);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types --test tests/recovery-sqlite.test.mjs tests/recovery-discovery.test.mjs`

Expected: FAIL because modules are missing.

- [ ] **Step 3: Implement the sqlite subprocess adapter**

```ts
export async function runSqlite(input: {
  databasePath: string;
  mode: "read-only" | "read-write";
  script: string;
  maxOutputBytes?: number;
}): Promise<{ stdout: string }>;
```

Spawn `sqlite3` without a shell. Prefix stdin with `.bail on`, `.echo off`, `.timeout 5000`, `.headers off`. For read-only mode pass `file:<encoded>?mode=ro&immutable=1` only after WAL absence is established; otherwise use `mode=ro`. Cap stdout and stderr at 1 MiB, kill on overflow/timeout, and map all raw failures to safe codes.

- [ ] **Step 4: Implement canonical identity checks**

A candidate matches only when it has:

- SQLite header `SQLite format 3\0`;
- `portal_schema_migrations`;
- `portal_users`;
- `app_settings`;
- `portal_audit_events`;
- `portal_maintenance_state`;
- schema journal state `ready` under existing hardened schema verification.

Return only the real absolute file path. Safe ambiguity errors contain relative paths capped at ten entries.

- [ ] **Step 5: Run focused tests and lint**

Run:

```bash
node --experimental-strip-types --test tests/recovery-sqlite.test.mjs tests/recovery-discovery.test.mjs
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add recovery-sqlite.ts recovery-discovery.ts tests/recovery-sqlite.test.mjs tests/recovery-discovery.test.mjs
git commit -m "feat: discover and inspect offline portal sqlite"
```

---

### Task 4: Full Backup Source, Schema Adapters and Immutable Preflight

**Files:**
- Create: `recovery-backup-source.ts`
- Create: `recovery-schema-adapters.ts`
- Create: `recovery-preflight.ts`
- Test: `tests/recovery-backup-source.test.mjs`
- Test: `tests/recovery-preflight.test.mjs`

**Interfaces:**
- Consumes: `validateEncryptedBackupDocument`, `decryptEncryptedBackupDomains`, `FULL_BACKUP_TABLES`, `PORTAL_BACKUP_DOMAINS`.
- Produces: `loadFullRestoreSource(document, password)`.
- Produces: `resolveRecoverySchemaAdapter(sourceVersion, currentVersion)`.
- Produces: `runRecoveryPreflight(input, dependencies)` returning only aggregate checks and fingerprints.

- [ ] **Step 1: Write RED backup-source tests**

Cover missing domain, duplicate/noncanonical domain, sanitized mode, wrong password, corrupted GCM payload, newer schema, unsupported older schema, RBAC projection mismatch and active-admin absence.

```js
test("destructive restore rejects partial encrypted backup", async () => {
  await assert.rejects(() => loadFullRestoreSource(partialDocument, password),
    (error) => error.code === "recovery_full_backup_required");
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types --test tests/recovery-backup-source.test.mjs tests/recovery-preflight.test.mjs`

Expected: FAIL because source and preflight modules are missing.

- [ ] **Step 3: Implement exact source loading**

```ts
export type FullRestoreSource = {
  manifestSha256: string;
  sourceSchemaVersion: number;
  payloads: ReadonlyMap<PortalBackupDomain, FullBackupDomainPayload>;
  tableCounts: Readonly<Record<string, number>>;
};

export async function loadFullRestoreSource(
  document: unknown,
  password: unknown,
): Promise<FullRestoreSource>;
```

First call `validateEncryptedBackupDocument`, then require exact canonical domains, then decrypt all domains. Catch checksum/password/tag failures and return only `recovery_backup_decryption_failed`.

- [ ] **Step 4: Implement explicit schema adapters**

```ts
export type RecoverySchemaAdapter = {
  sourceVersion: number;
  currentVersion: number;
  transform(source: FullRestoreSource): FullRestoreSource;
};
```

Register only `(2 -> 3)` and `(3 -> 3)` after asserting every descriptor name/column/primary-key matches the exact known source layout. No generic column intersection or default-value synthesis is allowed.

- [ ] **Step 5: Implement immutable preflight**

`runRecoveryPreflight` aggregates:

- roots and lock availability;
- discovered database path and SHA-256;
- current schema readiness/version;
- maintenance state `active` or `verifying` and operation ID;
- controller-secret hash verification;
- complete decrypted backup and adapter;
- enabled, unlocked administrator in backup plus supplied password verification;
- settings/replay/approval decryptability under supplied config key;
- disk-space estimates.

Return fingerprints, counts and booleans only. Never return decrypted values, password hashes or controller hashes.

- [ ] **Step 6: Run focused and existing encrypted-backup tests**

Run:

```bash
node --experimental-strip-types --test \
  tests/recovery-backup-source.test.mjs \
  tests/recovery-preflight.test.mjs \
  tests/backup-encryption.test.mjs \
  tests/backup-encrypted-preview.test.mjs
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add recovery-backup-source.ts recovery-schema-adapters.ts recovery-preflight.ts tests/recovery-backup-source.test.mjs tests/recovery-preflight.test.mjs
git commit -m "feat: validate complete offline restore sources"
```

---

### Task 5: Encrypted Raw-SQLite Recovery Point and Receipt

**Files:**
- Create: `recovery-receipt.ts`
- Create: `recovery-point.ts`
- Test: `tests/recovery-receipt.test.mjs`
- Test: `tests/recovery-point.test.mjs`

**Interfaces:**
- Produces: `createRecoveryPoint(input, dependencies)`.
- Produces: `verifyRecoveryPoint(input, dependencies)`.
- Produces: `loadRecoveryReceipt(path)` and `writeRecoveryReceiptAtomic(path, receipt)`.
- Receipt phases: `recovery_point_ready`, `candidate_ready`, `swap_started`, `swapped`, `verified`, `rollback_started`, `rolled_back`, `failed`, `post_complete_failed`.

- [ ] **Step 1: Write RED receipt and encryption tests**

Cover canonical JSON ordering, mode `0600`, symlink rejection, atomic temp-file rename, wrong recovery password, truncated ciphertext, header tampering, round-trip hash mismatch and plaintext cleanup on injected failure.

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types --test tests/recovery-receipt.test.mjs tests/recovery-point.test.mjs`

Expected: FAIL because receipt and recovery-point modules are missing.

- [ ] **Step 3: Implement versioned receipt validation**

```ts
export type RecoveryReceiptPhase =
  | "recovery_point_ready" | "candidate_ready" | "swap_started" | "swapped"
  | "verified" | "rollback_started" | "rolled_back" | "failed" | "post_complete_failed";

export type RecoveryReceipt = {
  format: "portal-offline-recovery-receipt";
  version: 1;
  operationId: string;
  createdAt: string;
  updatedAt: string;
  phase: RecoveryReceiptPhase;
  liveDatabaseRelativePath: string;
  liveDatabaseSha256: string;
  liveDatabaseBytes: number;
  schemaVersion: number;
  maintenanceOperationId: string;
  backupManifestSha256: string;
  recoveryPointRelativePath: string;
  recoveryPointSha256: string;
  recoveryPointBytes: number;
  confirmation: string;
  checks: Record<string, "ok">;
};
```

Reject unknown keys, invalid hashes, absolute paths, `..`, future timestamps and invalid phase transitions. Atomic writes use a same-directory temp file, file fsync, rename and directory fsync.

- [ ] **Step 4: Implement streaming recovery-point encryption**

Use a binary envelope:

```text
magic(32) | headerLength(u32be) | canonicalHeader | ciphertext | gcmTag(16)
```

Header fields: format `portal-recovery-sqlite-v1`, version `1`, PBKDF2 iterations `310000`, salt, IV, plaintext bytes, plaintext SHA-256. The canonical header bytes are AES-GCM AAD. Use `pipeline(createReadStream, cipher, createWriteStream)` and append `getAuthTag()` only after successful completion.

- [ ] **Step 5: Implement mandatory round-trip verification**

`createRecoveryPoint` must:

1. checkpoint live SQLite;
2. create a plaintext temp copy through `.backup`;
3. verify integrity/schema;
4. encrypt outside data root;
5. fsync artifact;
6. decrypt to a second temp file;
7. compare byte count/SHA-256;
8. repeat integrity/schema checks;
9. remove all plaintext temps;
10. atomically write `recovery_point_ready` receipt.

- [ ] **Step 6: Run focused tests and lint**

Run:

```bash
node --experimental-strip-types --test tests/recovery-receipt.test.mjs tests/recovery-point.test.mjs
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add recovery-receipt.ts recovery-point.ts tests/recovery-receipt.test.mjs tests/recovery-point.test.mjs
git commit -m "feat: create encrypted offline recovery points"
```

---

### Task 6: Physical Restore Policy and Candidate Builder

**Files:**
- Create: `recovery-restore-policy.ts`
- Create: `recovery-candidate.ts`
- Test: `tests/recovery-restore-policy.test.mjs`
- Test: `tests/recovery-candidate.test.mjs`

**Interfaces:**
- Produces: `RECOVERY_PHYSICAL_TABLES`, `RECOVERY_DELETE_ORDER`, `RECOVERY_INSERT_ORDER`.
- Produces: `buildRecoveryCandidate(input, dependencies)`.
- Produces: `verifyRecoveryCandidate(input, dependencies)`.

- [ ] **Step 1: Write RED physical-policy tests**

Assert every `FULL_BACKUP_TABLES` physical table is either `replace`, `validate-only` or `discard`; no unknown table is silently ignored. Explicit rules:

```ts
portal_sessions: "discard"
portal_role_assignments: "validate-only"
portal_schema_migrations: "preserve-live"
portal_maintenance_state: "preserve-live"
```

Also assert selective restore stage tables discovered from canonical schema are `clear-runtime`.

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types --test tests/recovery-restore-policy.test.mjs tests/recovery-candidate.test.mjs`

Expected: FAIL because policy and candidate modules are missing.

- [ ] **Step 3: Implement exhaustive policy registry**

```ts
export type RecoveryTableAction = "replace" | "discard" | "validate-only" | "preserve-live" | "clear-runtime";
export type RecoveryTablePolicy = {
  table: string;
  action: RecoveryTableAction;
  columns: readonly string[];
  primaryKey: readonly string[];
};
```

At module load, compare the registry with `FULL_BACKUP_TABLES` and canonical schema inventory; throw if any source table has no rule or if a replace rule targets an unknown canonical table.

- [ ] **Step 4: Implement candidate clone and transaction script**

`buildRecoveryCandidate`:

1. `.backup` live DB to candidate in live directory;
2. verify source hash still matches receipt;
3. begin immediate transaction on candidate;
4. drop only named append-only audit triggers;
5. delete replace/clear-runtime tables in fixed dependency order;
6. insert bounded parameter-safe SQL literals generated from validated scalar payload rows;
7. validate RBAC projection against restored `portal_users` without inserting a duplicate physical table;
8. recreate exact canonical triggers;
9. append aggregate candidate audit row;
10. commit;
11. run `foreign_key_check`, `integrity_check` and canonical inventory verification.

Do not interpolate identifiers from backup input. Table/column identifiers come only from the static registry; values are encoded by a dedicated SQLite literal encoder supporting `null`, finite number and UTF-8 string.

- [ ] **Step 5: Implement candidate semantic verification**

Verify:

- preserved migration rows and maintenance operation/hash equal live snapshot;
- source table counts match receipt/source summary except discard/validate-only tables;
- sessions count is zero;
- selective restore stages are absent or terminal according to schema;
- active administrator/password works;
- settings, replays and approvals decrypt with supplied config key;
- audit write/readback succeeds;
- no unexpected schema object appeared.

- [ ] **Step 6: Run focused and isolated restore tests**

Run:

```bash
node --experimental-strip-types --test \
  tests/recovery-restore-policy.test.mjs \
  tests/recovery-candidate.test.mjs \
  tests/backup-isolated-restore.test.mjs \
  tests/backup-selective-write-plan.test.mjs
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add recovery-restore-policy.ts recovery-candidate.ts tests/recovery-restore-policy.test.mjs tests/recovery-candidate.test.mjs
git commit -m "feat: build verified full restore candidates"
```

---

### Task 7: Atomic Swap, Crash Reconciliation and Rollback

**Files:**
- Create: `recovery-swap.ts`
- Create: `recovery-reconcile.ts`
- Test: `tests/recovery-swap.test.mjs`
- Test: `tests/recovery-reconcile.test.mjs`

**Interfaces:**
- Produces: `swapRecoveryCandidate(input, dependencies)`.
- Produces: `rollbackRecoverySwap(input, dependencies)`.
- Produces: `reconcileRecoveryReceipt(input, dependencies)`.
- All filesystem operations are dependency-injected for deterministic fault tests.

- [ ] **Step 1: Write RED phase/fault tests**

Inject failure before/after:

- source hash verification;
- candidate fsync;
- receipt `swap_started` write;
- live-to-rollback rename;
- candidate-to-live rename;
- parent directory fsync;
- receipt `swapped` write.

Assert every resulting filesystem state is classified and no two files are silently chosen as live.

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types --test tests/recovery-swap.test.mjs tests/recovery-reconcile.test.mjs`

Expected: FAIL because swap/reconcile modules are missing.

- [ ] **Step 3: Implement same-filesystem guarded swap**

```ts
export async function swapRecoveryCandidate(input: {
  receiptPath: string;
  livePath: string;
  candidatePath: string;
  rollbackPath: string;
  expectedLiveSha256: string;
  lockPath: string;
}, dependencies?: RecoverySwapDependencies): Promise<RecoveryReceipt>;
```

Use `stat.dev` equality, `O_NOFOLLOW`, file fsync and directory fsync. Write receipt phase `swap_started` before the first rename and `swapped` after final verification. Never overwrite an existing rollback path.

- [ ] **Step 4: Implement deterministic reconciliation**

Classify by receipt phase plus presence/hash of live/candidate/rollback files. Allowed outcomes:

- continue verification when live hash equals candidate hash and rollback hash equals original;
- finish first rename when original live is at rollback and verified candidate still exists;
- reverse first rename when candidate is absent/invalid;
- reject ambiguous or hash-mismatched state with `recovery_filesystem_ambiguous`.

No timestamp or filename-newness heuristic is allowed.

- [ ] **Step 5: Implement rollback**

Prefer the retained rollback file. If unavailable, decrypt and verify the encrypted recovery point to a same-filesystem temp candidate. Apply the same two-rename/fsync protocol and receipt phases `rollback_started` → `rolled_back`.

- [ ] **Step 6: Run focused tests and lint**

Run:

```bash
node --experimental-strip-types --test tests/recovery-swap.test.mjs tests/recovery-reconcile.test.mjs
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add recovery-swap.ts recovery-reconcile.ts tests/recovery-swap.test.mjs tests/recovery-reconcile.test.mjs
git commit -m "feat: add crash-safe sqlite swap and rollback"
```

---

### Task 8: Offline CLI Orchestration

**Files:**
- Create: `scripts/portal-recovery.ts`
- Modify: `package.json`
- Test: `tests/recovery-cli.test.mjs`
- Test: `tests/recovery-cli-source.test.mjs`

**Interfaces:**
- Commands: `preflight`, `backup-current`, `restore`, `status`, `verify`, `rollback`, `maintenance-recover`.
- CLI stdout: exactly one canonical bounded JSON document.
- CLI stderr: one safe message plus code; exit code is stable per category.

- [ ] **Step 1: Write RED parser/orchestration tests**

Cover unknown command/flag, duplicate flag, missing required file, secret value accidentally passed in argv, lock contention, stale receipt, mismatched backup manifest, changed live DB, wrong confirmation and happy command dependency order.

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types --test tests/recovery-cli.test.mjs tests/recovery-cli-source.test.mjs`

Expected: FAIL because CLI is missing.

- [ ] **Step 3: Implement a closed command schema**

```ts
const commands = {
  preflight: ["--data-root", "--artifact-root", "--secrets-root", "--backup", "--backup-password-file", "--controller-secret-file", "--admin-username", "--admin-password-file", "--config-key-file"],
  "backup-current": [/* preflight args + recovery password/receipt */],
  restore: [/* receipt + confirmation file + all validation inputs */],
  status: ["--receipt"],
  verify: [/* receipt + controller/admin/service token files + base URL */],
  rollback: [/* receipt + recovery password */],
  "maintenance-recover": [/* receipt + admin/config/confirmation */],
} as const;
```

Reject all flags not listed for the selected command. Do not support `--password`, environment-secret fallbacks or interactive prompts.

- [ ] **Step 4: Implement orchestration only**

The entrypoint parses, loads files, acquires `flock` for mutating offline commands, calls existing modules, writes the safe result and exits. It contains no SQL, crypto algorithm, path traversal logic or transition rules.

Add scripts:

```json
{
  "recovery": "node --experimental-strip-types scripts/portal-recovery.ts",
  "test:recovery": "node --experimental-strip-types --test tests/recovery-*.test.mjs"
}
```

- [ ] **Step 5: Run CLI tests, lint and build**

Run:

```bash
node --experimental-strip-types --test tests/recovery-cli.test.mjs tests/recovery-cli-source.test.mjs
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/portal-recovery.ts package.json tests/recovery-cli.test.mjs tests/recovery-cli-source.test.mjs
git commit -m "feat: add offline portal recovery cli"
```

---

### Task 9: Bounded Restart Verification and Failed-Maintenance Recovery

**Files:**
- Create: `recovery-online-verification.ts`
- Create: `recovery-maintenance.ts`
- Modify: `worker/maintenance-control-dispatch.ts`
- Modify: `worker/maintenance-control-entry.ts`
- Modify: `maintenance-repository.ts`
- Test: `tests/recovery-verification-api.test.mjs`
- Test: `tests/recovery-online-verification.test.mjs`
- Test: `tests/recovery-maintenance.test.mjs`

**Interfaces:**
- New route: `POST /api/admin/maintenance/verification/smoke`.
- Produces: `verifyRestoredPortalOnline(input, dependencies)`.
- Produces: `recoverFailedMaintenanceOffline(input, dependencies)`.

- [ ] **Step 1: Write RED API authorization tests**

Require service-admin authorization, same-origin, matching operation ID/controller secret, maintenance state `active` or `verifying`, bounded admin credentials, no persistent session issuance and no raw result details.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
node --experimental-strip-types --test tests/recovery-verification-api.test.mjs tests/recovery-online-verification.test.mjs tests/recovery-maintenance.test.mjs
```

Expected: FAIL because route/modules are missing.

- [ ] **Step 3: Implement verification-smoke handler**

Checks in one bounded handler:

- matching maintenance operation/controller;
- administrator password verification without creating `portal_sessions`;
- settings secret decryption;
- append/readback of an aggregate audit event inside a transaction;
- active session count remains zero.

Response:

```json
{
  "operationId": "maintenance_...",
  "checks": {
    "administratorAccess": "ok",
    "settingsDecryption": "ok",
    "auditWrite": "ok",
    "sessionsRevoked": "ok"
  }
}
```

Do not return usernames, hashes, settings or audit row data.

- [ ] **Step 4: Implement explicit online verification sequence**

`verifyRestoredPortalOnline` performs health/schema/status/smoke, then existing `verification/start`, `exit`, `complete`, then real login/logout and final audit/status checks. Every request uses `cache-control: no-store`, timeout and exact response validation.

- [ ] **Step 5: Implement offline failed-maintenance recovery**

Require stopped runtime lock, verified receipt/recovery point, current DB integrity/schema, supplied administrator password/config key, exact confirmation `RECOVER FAILED MAINTENANCE <operationId>`, and state `failed` or controller-secret-loss case. Mutate maintenance and append audit in one SQLite transaction; never allow transition when DB checks fail.

- [ ] **Step 6: Run maintenance/API tests and Auth E2E contract tests**

Run:

```bash
node --experimental-strip-types --test \
  tests/recovery-verification-api.test.mjs \
  tests/recovery-online-verification.test.mjs \
  tests/recovery-maintenance.test.mjs \
  tests/maintenance-control-api.test.mjs \
  tests/maintenance-gate.test.mjs
npm run build
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add recovery-online-verification.ts recovery-maintenance.ts worker/maintenance-control-dispatch.ts worker/maintenance-control-entry.ts maintenance-repository.ts tests/recovery-verification-api.test.mjs tests/recovery-online-verification.test.mjs tests/recovery-maintenance.test.mjs
git commit -m "feat: verify restored portal through maintenance controls"
```

---

### Task 10: Recovery Docker Target and Compose Profile

**Files:**
- Modify: `Dockerfile`
- Modify: `compose.yaml`
- Create: `compose.recovery.test.yaml`
- Test: `tests/recovery-container-contract.test.mjs`

**Interfaces:**
- Image target: `recovery`.
- Compose service: `recovery`, profile `recovery`.
- Shared named volume mounted read-write at `/portal-data`.
- Bind roots: `/recovery` and `/run/portal-recovery-secrets`.

- [ ] **Step 1: Write RED source-contract test**

Assert target/service/profile/mounts, non-root user, dropped capabilities, no Docker socket, no automatic startup, `sqlite3` and `flock` availability, and no secret values in Compose environment.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test tests/recovery-container-contract.test.mjs`

Expected: FAIL because target/profile are missing.

- [ ] **Step 3: Add dedicated Docker target**

```dockerfile
FROM dependencies AS recovery
RUN apt-get update \
 && apt-get install -y --no-install-recommends sqlite3 util-linux ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY . .
RUN useradd --system --uid 10001 recovery \
 && mkdir -p /portal-data /recovery /run/portal-recovery-secrets \
 && chown -R recovery:recovery /portal-data /recovery /run/portal-recovery-secrets
USER recovery
ENTRYPOINT ["node", "--experimental-strip-types", "scripts/portal-recovery.ts"]
```

Use only files required at runtime in the final implementation; do not retain build caches or development credentials.

- [ ] **Step 4: Add opt-in Compose profile**

The service has no `restart`, no ports, no healthcheck and no dashboard command. It uses the same named volume and host bind roots. Add `read_only: true` plus tmpfs `/tmp` if SQLite tooling does not need writes outside mounted roots.

- [ ] **Step 5: Build and inspect image**

Run:

```bash
docker build --target recovery -t freeipa-admin-dashboard-recovery:test .
docker run --rm --entrypoint sh freeipa-admin-dashboard-recovery:test -lc 'id -u; command -v sqlite3; command -v flock'
docker compose config
node --test tests/recovery-container-contract.test.mjs
```

Expected: UID `10001`, both binaries present, contract PASS.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile compose.yaml compose.recovery.test.yaml tests/recovery-container-contract.test.mjs
git commit -m "build: add isolated recovery container"
```

---

### Task 11: Real-Volume Integration, Fault Matrix and CI

**Files:**
- Create: `scripts/recovery-compose-smoke.mjs`
- Create: `tests/recovery-compose-smoke.test.mjs`
- Create: `tests/recovery-fault-matrix.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- `npm run test:recovery:compose` performs a disposable named-volume lifecycle.
- Fault matrix uses dependency injection and never exposes production fault flags.

- [ ] **Step 1: Write a failing end-to-end test harness**

The scenario must:

1. start a fixture dashboard volume;
2. create admin/settings/audit data;
3. export a complete encrypted backup;
4. enter maintenance;
5. stop dashboard;
6. run `preflight`, `backup-current`, `restore`;
7. restart dashboard;
8. run `verify`;
9. assert restored login/settings/audit and zero old sessions;
10. repeat with injected post-swap verification failure and execute rollback;
11. remove containers, volume, artifacts and secret files in `finally`.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test tests/recovery-compose-smoke.test.mjs`

Expected: FAIL until the harness and Compose fixture are complete.

- [ ] **Step 3: Implement bounded Compose harness**

Use a random Compose project name and temporary host directories. Secret files are mode `0600`. Commands are arrays passed to `spawn`, not shell strings. Cap output and redact every known secret before assertion/reporting.

- [ ] **Step 4: Add fault matrix**

For every swap/recovery-point boundary, inject one failure and assert:

- live DB remains original, or receipt reconciliation identifies exactly one safe continuation;
- recovery point remains verifiable;
- no plaintext backup remains;
- maintenance never becomes inactive automatically;
- rollback restores original hash and valid administrator access.

- [ ] **Step 5: Add CI gates**

CI sequence:

```yaml
- run: npm run test:recovery
- run: npm run test
- run: docker build --target recovery -t portal-recovery-ci .
- run: npm run test:recovery:compose
```

The Compose job uses a separate timeout and always uploads only sanitized JSON receipts/test summaries, never recovery artifacts or secret files.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm run lint
npm run build
npm run test:recovery
npm test
npm run test:e2e:auth
npm run test:recovery:compose
```

Expected: every command exits `0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/recovery-compose-smoke.mjs tests/recovery-compose-smoke.test.mjs tests/recovery-fault-matrix.test.mjs .github/workflows/ci.yml package.json
git commit -m "test: verify destructive recovery lifecycle"
```

---

### Task 12: Operations Documentation, Final Security Review and PR Readiness

**Files:**
- Modify: `README.md`
- Modify: `docs/MAINTENANCE_MODE.md`
- Modify: `docs/PRODUCT_ROADMAP.md`
- Create: `docs/OFFLINE_FULL_RESTORE.md`
- Modify: `docs/superpowers/plans/2026-07-30-portal-backup-restore.md`
- Test: `tests/recovery-documentation.test.mjs`

**Interfaces:**
- Produces an operator runbook matching the exact CLI and Compose profile.
- Does not change production behavior.

- [ ] **Step 1: Write RED documentation contract**

Require the runbook to contain:

- prerequisites and threat model;
- exact secret-file creation/mode commands;
- maintenance prepare/enter sequence;
- dashboard stop command;
- preflight, recovery point, restore, status, restart, verify and rollback commands;
- failed-maintenance recovery;
- receipt phases and safe interpretation;
- explicit warnings against copying live WAL files or deleting maintenance state;
- backup-password and `CONFIG_ENCRYPTION_KEY` separation;
- no automatic maintenance exit.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test tests/recovery-documentation.test.mjs`

Expected: FAIL because runbook/status updates are absent.

- [ ] **Step 3: Write the operational runbook**

Use copy-pasteable commands with placeholders only for operator-owned values, for example:

```bash
install -d -m 0700 recovery recovery-secrets
printf '%s' "$BACKUP_PASSWORD" > recovery-secrets/backup-password
chmod 0600 recovery-secrets/backup-password

docker compose stop dashboard
docker compose --profile recovery run --rm recovery preflight ...
docker compose --profile recovery run --rm recovery backup-current ...
docker compose --profile recovery run --rm recovery restore ...
docker compose up -d dashboard
docker compose --profile recovery run --rm recovery verify ...
```

Explain that secrets must not be exported into shell history in real operation; recommend secure file provisioning.

- [ ] **Step 4: Update roadmap and parent backup plan**

Mark PR #72 complete only after final verification. Keep browser wizard, remote storage and retention open. Link the new runbook from README and maintenance docs.

- [ ] **Step 5: Run documentation and full final verification**

Run:

```bash
node --test tests/recovery-documentation.test.mjs
npm run lint
npm run build
npm run test:recovery
npm test
npm run test:e2e:auth
npm run test:recovery:compose
```

Expected: all PASS on one final head SHA.

- [ ] **Step 6: Perform final security/diff review**

Verify manually and with source contracts:

- no secret values in argv/output/receipt/audit;
- no bypass flags;
- all mutable paths require `flock`;
- no live SQL mutation before swap;
- all rename/fsync phases are receipt-driven;
- sessions cannot be restored;
- maintenance cannot exit on startup/timer;
- recovery artifact is outside live volume;
- PR comments/review threads contain no unresolved Critical or Important item.

- [ ] **Step 7: Commit documentation and update PR body**

```bash
git add README.md docs/MAINTENANCE_MODE.md docs/PRODUCT_ROADMAP.md docs/OFFLINE_FULL_RESTORE.md docs/superpowers/plans/2026-07-30-portal-backup-restore.md tests/recovery-documentation.test.mjs
git commit -m "docs: document offline full restore operations"
```

Update draft PR #72 with exact final head, CI/Auth E2E/Compose run numbers, test counts, threat model, rollback evidence and remaining exclusions. Mark Ready for review only when all checks are green.

---

## Plan Self-Review Results

- **Spec coverage:** all design sections map to Tasks 1–12: authority/inputs, discovery, backup validation, recovery point, candidate, atomic swap, CLI, online verification, emergency maintenance recovery, containerization, integration/fault testing and operations docs.
- **No placeholders:** no `TBD`, `TODO`, generic “handle errors” step or undefined future task remains.
- **Type consistency:** receipt phases, command names, module interfaces and file names are defined once and reused consistently.
- **Scope:** this plan remains one disaster-recovery subsystem. Remote storage, retention, FreeIPA/XYOps backup and browser UI remain excluded.
