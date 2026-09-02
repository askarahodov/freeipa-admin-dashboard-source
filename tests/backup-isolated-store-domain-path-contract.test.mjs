import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("backup isolated store implementation is canonical under src/backup/restore", async () => {
  const canonical = await readFile(
    new URL("../src/backup/restore/backup-isolated-store.ts", import.meta.url),
    "utf8",
  );
  const root = await readFile(new URL("../backup-isolated-store.ts", import.meta.url), "utf8");

  assert.match(canonical, /from "\.\.\/\.\.\/\.\.\/backup-full-domains\.ts"/);
  assert.match(canonical, /from "\.\.\/\.\.\/\.\.\/backup-manifest\.ts"/);
  assert.equal(
    root,
    'export * from "./src/backup/restore/backup-isolated-store.ts";\n',
  );
});
