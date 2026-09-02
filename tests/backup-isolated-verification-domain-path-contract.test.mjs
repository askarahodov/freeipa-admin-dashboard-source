import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("isolated verification implementation is canonical under src/backup/restore", async () => {
  const canonical = await readFile(
    new URL("../src/backup/restore/backup-isolated-verification.ts", import.meta.url),
    "utf8",
  );

  assert.match(canonical, /from "\.\/backup-isolated-store\.ts"/);
  assert.match(canonical, /from "\.\.\/\.\.\/\.\.\/backup-manifest\.ts"/);
  await assert.rejects(
    access(new URL("../backup-isolated-verification.ts", import.meta.url)),
    { code: "ENOENT" },
  );
});
