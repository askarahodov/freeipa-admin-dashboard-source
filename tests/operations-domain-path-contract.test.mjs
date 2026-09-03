import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const moved = [
  ["../src/operations/approvals/approval-gates.ts", "../approval-gates.ts"],
  ["../src/operations/catalog/catalog-policies.ts", "../catalog-policies.ts"],
  ["../src/operations/explorer/operation-explorer.ts", "../operation-explorer.ts"],
  ["../src/operations/explorer/operation-explorer-legacy-bridge.ts", "../operation-explorer-legacy-bridge.ts"],
  ["../src/operations/presentation/process-presentation.ts", "../process-presentation.ts"],
  ["../src/operations/run/run-notifications.ts", "../run-notifications.ts"],
  ["../src/operations/run/run-replays.ts", "../run-replays.ts"],
  ["../src/operations/run/run-results.ts", "../run-results.ts"],
];

test("operations production modules are canonical under src/operations with no root copies", async () => {
  for (const [canonical, legacy] of moved) {
    await access(new URL(canonical, import.meta.url));
    await assert.rejects(access(new URL(legacy, import.meta.url)));
  }
});
