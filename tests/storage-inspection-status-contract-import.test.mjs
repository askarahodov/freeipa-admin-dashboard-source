import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/storage/inspection/storage-inspect-cli.ts", import.meta.url),
  "utf8",
);

test("storage inspection CLI consumes the canonical status contract directly", () => {
  assert.match(
    source,
    /from "\.\.\/status\/storage-status-contract\.ts";/,
  );
  assert.equal(source.includes("../../../storage-status-contract.ts"), false);
});
