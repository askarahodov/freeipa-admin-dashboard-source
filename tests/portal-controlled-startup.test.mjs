import assert from "node:assert/strict";
import test from "node:test";

import {
  ensurePortalSchemaWithManagedRegistry,
  inspectPortalSchemaWithManagedRegistry,
} from "../db/portal-controlled-migrations.ts";

function migration(version, mode) {
  return {
    version,
    name: `migration-${version}`,
    mode,
    statements: [`CREATE TABLE migration_${version} (id INTEGER)`],
    tableStatements: [`CREATE TABLE migration_${version} (id INTEGER)`],
    secondaryStatements: [],
    snapshot: { tables: [], indexes: [], triggers: [] },
    checksum: async () => `checksum-${version}`,
  };
}

function status(registry, appliedVersions, state = "ready", errorCode = "") {
  const applied = [...appliedVersions];
  return {
    state,
    currentVersion: applied.at(-1) ?? 0,
    latestVersion: registry.at(-1)?.version ?? 0,
    appliedVersions: applied,
    pendingVersions: registry.map((item) => item.version).filter((version) => !applied.includes(version)),
    compatibleDrift: [],
    incompatibleDrift: [],
    errorCode,
    verifiedAt: 100,
  };
}

test("startup applies only automatic prefix and stops before controlled suffix", async () => {
  const registry = [migration(1, "automatic"), migration(2, "controlled")];
  const calls = [];
  let applied = [];
  const result = await ensurePortalSchemaWithManagedRegistry(
    { DB: {} },
    registry,
    {},
    {
      inspect: async (_env, received) => {
        calls.push(["inspect", received.map((item) => `${item.version}:${item.mode}`)]);
        return status(registry, applied);
      },
      ensure: async (_env, received) => {
        calls.push(["ensure", received.map((item) => `${item.version}:${item.mode}`)]);
        applied = received.map((item) => item.version);
        return status(received, applied);
      },
    },
  );

  assert.equal(result.state, "pending");
  assert.equal(result.errorCode, "schema_migration_pending");
  assert.deepEqual(result.appliedVersions, [1]);
  assert.deepEqual(result.pendingVersions, [2]);
  assert.deepEqual(calls, [
    ["inspect", ["1:automatic", "2:controlled"]],
    ["ensure", ["1:automatic"]],
    ["inspect", ["1:automatic", "2:controlled"]],
  ]);
});

test("startup reports controlled pending without acquiring mutation path", async () => {
  const registry = [migration(1, "automatic"), migration(2, "controlled")];
  let ensureCalls = 0;
  const result = await ensurePortalSchemaWithManagedRegistry(
    { DB: {} },
    registry,
    {},
    {
      inspect: async () => status(registry, [1]),
      ensure: async () => {
        ensureCalls += 1;
        throw new Error("must not mutate");
      },
    },
  );
  assert.equal(result.state, "pending");
  assert.equal(result.currentVersion, 1);
  assert.equal(result.latestVersion, 2);
  assert.deepEqual(result.pendingVersions, [2]);
  assert.equal(ensureCalls, 0);
});

test("inspect projects pending state without invoking ensure", async () => {
  const registry = [migration(1, "automatic"), migration(2, "controlled")];
  const result = await inspectPortalSchemaWithManagedRegistry(
    { DB: {} },
    registry,
    {},
    { inspect: async () => status(registry, [1]) },
  );
  assert.equal(result.state, "pending");
  assert.equal(result.errorCode, "schema_migration_pending");
});

test("fully applied controlled registry remains ready", async () => {
  const registry = [migration(1, "automatic"), migration(2, "controlled")];
  const result = await inspectPortalSchemaWithManagedRegistry(
    { DB: {} },
    registry,
    {},
    { inspect: async () => status(registry, [1, 2]) },
  );
  assert.equal(result.state, "ready");
  assert.equal(result.errorCode, "");
});

test("invalid registry fails before database dependencies", async () => {
  const registry = [migration(1, "controlled"), migration(2, "automatic")];
  let calls = 0;
  const result = await ensurePortalSchemaWithManagedRegistry(
    { DB: {} },
    registry,
    {},
    {
      inspect: async () => { calls += 1; throw new Error("unexpected"); },
      ensure: async () => { calls += 1; throw new Error("unexpected"); },
    },
  );
  assert.equal(result.state, "failed");
  assert.equal(result.errorCode, "migration_registry_invalid");
  assert.equal(calls, 0);
});
