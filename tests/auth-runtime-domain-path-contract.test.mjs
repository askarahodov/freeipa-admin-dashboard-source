import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("runtime auth implementations are canonical under src/auth with exact root shims", async () => {
  const pairs = [
    ["local-auth.ts", "src/auth/local-auth.ts"],
    ["local-session-management.ts", "src/auth/local-session-management.ts"],
    ["admin-session-authorization.ts", "src/auth/admin-session-authorization.ts"],
  ];
  for (const [shimPath, canonicalPath] of pairs) {
    const [shim, canonical] = await Promise.all([read(shimPath), read(canonicalPath)]);
    assert.equal(shim, `export * from "./${canonicalPath}";\n`);
    assert.ok(canonical.length > shim.length, `${canonicalPath} must own the implementation`);
  }
});
