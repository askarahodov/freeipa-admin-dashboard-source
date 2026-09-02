import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("backup export implementation is canonical under src/backup/export", async () => {
  const canonical = await readFile(new URL("../src/backup/export/backup-export.ts", import.meta.url), "utf8");
  assert.match(canonical, /from "\.\.\/\.\.\/\.\.\/backup-manifest\.ts"/);
  await assert.rejects(
    () => access(new URL("../backup-export.ts", import.meta.url)),
    (error) => error?.code === "ENOENT",
  );
});
