import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const exists = async (path) => {
  try {
    await stat(new URL(`../${path}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
};

test("storage encryption self-test has one canonical status-domain owner", async () => {
  const [canonical, statusSource] = await Promise.all([
    read("src/storage/status/storage-encryption-self-test.ts"),
    read("src/storage/status/storage-status.ts"),
  ]);

  assert.equal(
    await exists("storage-encryption-self-test.ts"),
    false,
    "root storage encryption self-test shim must be removed",
  );
  assert.match(canonical, /export async function storageEncryptionSelfTest/);
  assert.match(canonical, /AES-GCM/);
  assert.match(canonical, /portal-storage-contract-v1/);
  assert.match(
    statusSource,
    /from "\.\/storage-encryption-self-test\.ts";/,
    "canonical storage status service must consume the canonical sibling encryption self-test",
  );
  assert.equal(statusSource.includes('from "../../../storage-encryption-self-test.ts"'), false);
});
