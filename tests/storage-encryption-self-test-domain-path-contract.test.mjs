import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("storage encryption self-test has one canonical status-domain owner", async () => {
  const [canonical, shim, statusSource] = await Promise.all([
    read("src/storage/status/storage-encryption-self-test.ts"),
    read("storage-encryption-self-test.ts"),
    read("storage-status.ts"),
  ]);

  assert.equal(
    shim,
    'export * from "./src/storage/status/storage-encryption-self-test.ts";\n',
    "root storage encryption self-test must remain an exact compatibility re-export",
  );
  assert.match(canonical, /export async function storageEncryptionSelfTest/);
  assert.match(canonical, /AES-GCM/);
  assert.match(canonical, /portal-storage-contract-v1/);
  assert.match(
    statusSource,
    /from "\.\/storage-encryption-self-test\.ts";/,
    "storage status may temporarily consume the compatibility shim until its own domain move",
  );
});
