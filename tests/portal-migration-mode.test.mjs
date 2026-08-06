import assert from "node:assert/strict";
import test from "node:test";

import {
  automaticPendingMigrations,
  controlledPendingMigrations,
  portalMigrationsV3WithModes,
  validatePortalMigrationRegistry,
} from "../db/portal-migration-registry.ts";

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

test("production versions 1 through 3 are automatic metadata", () => {
  assert.deepEqual(
    portalMigrationsV3WithModes.map(({ version, mode }) => ({ version, mode })),
    [
      { version: 1, mode: "automatic" },
      { version: 2, mode: "automatic" },
      { version: 3, mode: "automatic" },
    ],
  );
});

test("registry partitions automatic prefix and controlled suffix", () => {
  const validated = validatePortalMigrationRegistry([
    migration(1, "automatic"),
    migration(2, "automatic"),
    migration(3, "controlled"),
    migration(4, "controlled"),
  ]);

  assert.deepEqual(validated.automatic.map((item) => item.version), [1, 2]);
  assert.deepEqual(validated.controlled.map((item) => item.version), [3, 4]);
  assert.deepEqual(automaticPendingMigrations(validated.all, [1]).map((item) => item.version), [2]);
  assert.deepEqual(controlledPendingMigrations(validated.all, [1, 2]).map((item) => item.version), [3, 4]);
});

test("mode metadata does not change checksum material", async () => {
  const original = portalMigrationsV3WithModes[0];
  const before = await original.checksum();
  const validated = validatePortalMigrationRegistry(portalMigrationsV3WithModes);
  const after = await validated.all[0].checksum();
  assert.equal(after, before);
});
