import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const moved = [
  ["../src/recovery/maintenance/maintenance-mode.ts", "../maintenance-mode.ts"],
  ["../src/recovery/maintenance/maintenance-repository.ts", "../maintenance-repository.ts"],
  ["../src/recovery/maintenance/maintenance-verification-smoke.ts", "../maintenance-verification-smoke.ts"],
];

test("maintenance state ownership is canonical under src/recovery with no root copies", async () => {
  for (const [canonical, legacy] of moved) {
    await access(new URL(canonical, import.meta.url));
    await assert.rejects(access(new URL(legacy, import.meta.url)));
  }
});
