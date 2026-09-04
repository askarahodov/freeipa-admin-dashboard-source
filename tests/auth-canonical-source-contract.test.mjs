import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const owners = ["portal-permissions", "portal-route-contract", "stable-error-contract"];

test("declarative auth contracts have canonical src/auth owners with thin root compatibility shims", async () => {
  for (const owner of owners) {
    const canonical = await readFile(new URL(`../src/auth/${owner}.ts`, import.meta.url), "utf8");
    const shim = await readFile(new URL(`../${owner}.ts`, import.meta.url), "utf8");
    assert.ok(canonical.length > 100, owner);
    assert.equal(shim, `export * from "./src/auth/${owner}.ts";\n`, owner);
  }
});
