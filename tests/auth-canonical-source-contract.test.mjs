import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const owners = ["portal-permissions", "portal-route-contract", "stable-error-contract"];

test("declarative auth contracts live only under src/auth", async () => {
  for (const owner of owners) {
    const canonical = await readFile(new URL(`../src/auth/${owner}.ts`, import.meta.url), "utf8");
    assert.ok(canonical.length > 100, owner);
    await assert.rejects(access(new URL(`../${owner}.ts`, import.meta.url)), { code: "ENOENT" });
  }
});
