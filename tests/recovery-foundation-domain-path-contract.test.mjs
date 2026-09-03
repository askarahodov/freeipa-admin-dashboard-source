import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const moved = [
  ["../src/recovery/foundation/recovery-errors.ts", "../recovery-errors.ts"],
  ["../src/recovery/foundation/recovery-paths.ts", "../recovery-paths.ts"],
  ["../src/recovery/foundation/recovery-receipt.ts", "../recovery-receipt.ts"],
  ["../src/recovery/foundation/recovery-sqlite.ts", "../recovery-sqlite.ts"],
  ["../src/recovery/foundation/recovery-lock.ts", "../recovery-lock.ts"],
  ["../src/recovery/foundation/recovery-restore-policy.ts", "../recovery-restore-policy.ts"],
  ["../src/recovery/foundation/recovery-discovery.ts", "../recovery-discovery.ts"],
  ["../src/recovery/foundation/recovery-secrets.ts", "../recovery-secrets.ts"],
  ["../src/recovery/foundation/recovery-backup-source.ts", "../recovery-backup-source.ts"],
  ["../src/recovery/adapters/recovery-schema-adapters.ts", "../recovery-schema-adapters.ts"],
  ["../src/recovery/adapters/recovery-local-adapters.ts", "../recovery-local-adapters.ts"],
];

test("recovery foundation and adapters are canonical under src/recovery with no root copies", async () => {
  for (const [canonical, legacy] of moved) {
    await access(new URL(canonical, import.meta.url));
    await assert.rejects(access(new URL(legacy, import.meta.url)));
  }
});
