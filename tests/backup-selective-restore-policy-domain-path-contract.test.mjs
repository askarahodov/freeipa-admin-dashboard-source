import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("selective restore policy implementation is canonical under src/backup/restore", async () => {
  const canonical = await readFile(
    new URL("../src/backup/restore/backup-selective-restore-policy.ts", import.meta.url),
    "utf8",
  );
  assert.match(canonical, /from "\.\.\/backup-manifest\.ts"/);
  await assert.rejects(
    access(new URL("../backup-selective-restore-policy.ts", import.meta.url)),
    { code: "ENOENT" },
  );
});
