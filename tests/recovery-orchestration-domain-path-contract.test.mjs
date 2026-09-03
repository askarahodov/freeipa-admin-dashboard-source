import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const moved = [
  ["../src/recovery/orchestration/recovery-candidate.ts", "../recovery-candidate.ts"],
  ["../src/recovery/orchestration/recovery-preflight.ts", "../recovery-preflight.ts"],
  ["../src/recovery/artifacts/recovery-point.ts", "../recovery-point.ts"],
  ["../src/recovery/orchestration/recovery-reconcile.ts", "../recovery-reconcile.ts"],
  ["../src/recovery/orchestration/recovery-swap.ts", "../recovery-swap.ts"],
];

test("recovery destructive core is canonical under src/recovery with no root copies", async () => {
  for (const [canonical, legacy] of moved) {
    await access(new URL(canonical, import.meta.url));
    await assert.rejects(access(new URL(legacy, import.meta.url)));
  }
});
