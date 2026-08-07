import assert from "node:assert/strict";
import test from "node:test";

import { validatePortalMigrationRegistry } from "../db/portal-migration-registry.ts";

function migration(version, mode, { snapshot = true } = {}) {
  return {
    version,
    name: `migration-${version}`,
    mode,
    statements: [`SELECT ${version}`],
    ...(snapshot ? { snapshot: { tables: [], indexes: [], triggers: [] } } : {}),
    checksum: async () => `checksum-${version}`,
  };
}

function invalid(registry) {
  assert.throws(
    () => validatePortalMigrationRegistry(registry),
    (error) => error?.code === "migration_registry_invalid" && error?.message === "migration_registry_invalid",
  );
}

test("registry versions must start at one and remain contiguous", () => {
  invalid([migration(2, "automatic")]);
  invalid([migration(1, "automatic"), migration(3, "controlled")]);
  invalid([migration(1, "automatic"), migration(1, "controlled")]);
});

test("automatic migration cannot follow controlled migration", () => {
  invalid([
    migration(1, "automatic"),
    migration(2, "controlled"),
    migration(3, "automatic"),
  ]);
});

test("controlled migration requires deterministic snapshot", () => {
  invalid([
    migration(1, "automatic"),
    migration(2, "controlled", { snapshot: false }),
  ]);
});

test("unknown mode and malformed migration fail closed", () => {
  invalid([migration(1, "manual")]);
  invalid([{ ...migration(1, "automatic"), name: "" }]);
  invalid([{ ...migration(1, "automatic"), statements: null }]);
  invalid([{ ...migration(1, "automatic"), checksum: null }]);
});

test("input registry and returned partitions are immutable", () => {
  const source = [migration(1, "automatic"), migration(2, "controlled")];
  const validated = validatePortalMigrationRegistry(source);
  assert.equal(Object.isFrozen(validated.all), true);
  assert.equal(Object.isFrozen(validated.automatic), true);
  assert.equal(Object.isFrozen(validated.controlled), true);
  source.push(migration(3, "controlled"));
  assert.deepEqual(validated.all.map((item) => item.version), [1, 2]);
});
