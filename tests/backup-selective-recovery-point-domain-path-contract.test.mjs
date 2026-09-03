import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("selective recovery point implementation is canonical under src/backup/restore", async () => {
  const canonical = await readFile(
    new URL("../src/backup/restore/backup-selective-recovery-point.ts", import.meta.url),
    "utf8",
  );
  const root = await readFile(new URL("../backup-selective-recovery-point.ts", import.meta.url), "utf8");

  assert.match(canonical, /from "\.\.\/\.\.\/\.\.\/backup-manifest\.ts"/);
  assert.match(canonical, /from "\.\.\/export\/backup-export\.ts"/);
  assert.match(canonical, /from "\.\/backup-selective-restore-policy\.ts"/);
  assert.equal(
    root,
    'export * from "./src/backup/restore/backup-selective-recovery-point.ts";\n',
  );
});
