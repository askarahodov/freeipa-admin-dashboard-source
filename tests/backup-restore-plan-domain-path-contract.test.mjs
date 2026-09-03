import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("backup restore plan implementation is canonical under src/backup/restore", async () => {
  const canonical = await readFile(
    new URL("../src/backup/restore/backup-restore-plan.ts", import.meta.url),
    "utf8",
  );

  assert.match(canonical, /from "\.\/backup-restore-selection\.ts"/);
  assert.match(canonical, /from "\.\.\/export\/backup-export\.ts"/);
  assert.match(canonical, /from "\.\.\/\.\.\/\.\.\/backup-manifest\.ts"/);
  await assert.rejects(
    access(new URL("../backup-restore-plan.ts", import.meta.url)),
    { code: "ENOENT" },
  );
});
