import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";

const moved = [
  ["../src/backup/backup-manifest.ts", "../backup-manifest.ts"],
  ["../src/backup/export/backup-export-domains.ts", "../backup-export-domains.ts"],
  ["../src/backup/export/backup-full-domains.ts", "../backup-full-domains.ts"],
];

test("backup core contracts are canonical under src/backup with no root copies", async () => {
  for (const [canonical, legacy] of moved) {
    await access(new URL(canonical, import.meta.url));
    await assert.rejects(access(new URL(legacy, import.meta.url)));
  }
});
