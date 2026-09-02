import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("isolated verification implementation is canonical under src/backup/restore", async () => {
  const canonical = await readFile(
    new URL("../src/backup/restore/backup-isolated-verification.ts", import.meta.url),
    "utf8",
  );
  const root = await readFile(new URL("../backup-isolated-verification.ts", import.meta.url), "utf8");

  assert.match(canonical, /from "\.\/backup-isolated-store\.ts"/);
  assert.match(canonical, /from "\.\.\/\.\.\/\.\.\/backup-manifest\.ts"/);
  assert.equal(
    root,
    'export * from "./src/backup/restore/backup-isolated-verification.ts";\n',
  );
});
