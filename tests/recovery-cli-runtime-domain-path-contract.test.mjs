import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const moved = [
  ["../src/recovery/cli/recovery-cli.ts", "../recovery-cli.ts"],
  ["../src/recovery/cli/recovery-cli-runtime.ts", "../recovery-cli-runtime.ts"],
  ["../src/recovery/cli/recovery-command-handlers.ts", "../recovery-command-handlers.ts"],
  ["../src/recovery/cli/recovery-runtime-command-handlers.ts", "../recovery-runtime-command-handlers.ts"],
  ["../src/recovery/maintenance/recovery-maintenance.ts", "../recovery-maintenance.ts"],
  ["../src/recovery/verification/recovery-online-verification.ts", "../recovery-online-verification.ts"],
];

test("recovery CLI/runtime ownership is canonical under src/recovery with no root copies", async () => {
  for (const [canonical, legacy] of moved) {
    await access(new URL(canonical, import.meta.url));
    await assert.rejects(access(new URL(legacy, import.meta.url)));
  }
});
